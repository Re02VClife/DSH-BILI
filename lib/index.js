/**
 * dsh-bili-whale —— 宿主侧插件（设置壳）
 *
 * 职责只有三件：
 *   1. 设置页：GET /dsh-bili/  → lib/settings.html（单文件，内联样式/脚本）
 *   2. 配置读写：GET/POST /dsh-bili/api/settings → 读写 ~/.dsh/bili-whale.config.json
 *      （与 bilibili-tools 里的 lib/config.mjs 共用同一份文件 —— 不搞两套配置）
 *   3. 依赖体检：GET /dsh-bili/api/deps → 跑 `node <tools>/bili.mjs deps --json`
 *      （这就是"装完之后让 agent/用户自己确认依赖能不能用"）
 *
 * 凭据（cookie）**单独写**到 ~/.bili-ai/credentials.json，且**永远不回显**。
 *
 * 所有路由都过一遍 connection.requestRejection 的信任栅栏：DSH 的 Web 端口是回环地址，
 * 但浏览器里任何一个网页都能向回环发请求 —— 不加栅栏等于把配置与账号凭据开放给任意页面。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startScheduler, personaLineFromCfg } from './scheduler.js'
import { parseWatchlist, expandWatchlistLinks } from '../tools/lib/watchlist.mjs'
import { appendSpend, clampReplyTokens } from '../tools/lib/budget.mjs'
import { loadOutbox, saveOutbox, patchItem, setStatus, findItem, stats as outboxStats } from '../tools/lib/outbox.mjs'
// 2026-10-21 v0.8：任务台（主人派活：指定视频 + 评论格式）
import {
  loadTasks, saveTasks, addTask, findTask, claimTask, setTaskStatus, taskStats, staleIds,
  buildTaskPrompt, syncFromDraft, FORMATS, STATUS_LABEL,
} from '../tools/lib/tasks.mjs'
// 2026-10-21 v0.9：表情库（窗口里的"打开表情库"要按标签/图墙挑）
import { load as loadEmoteLib } from '../tools/lib/emotes.mjs'
// 2026-10-22：自己的表情包（贴纸库）—— 窗口里要能看见图（本地文件经 /sticker 路由以图片吐出来）
import { load as loadStickerLib } from '../tools/lib/stickers.mjs'

// 2026-10-19：真 node 路径（Electron 的 process.execPath 是 Harness.exe ✗ 跑不了 node 脚本）
const NODE_EXE = (() => {
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const cands = [
    process.env.DSH_NODE,
    path.join(dshHome, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'),
    path.join(os.homedir(), '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'),
  ]
  for (const c of cands) { try { if (c && fs.existsSync(c)) return c } catch {} }
  return process.execPath
})()

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PAGE = path.join(HERE, 'settings.html')
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const CFG_FILE = path.join(DSH_HOME, 'bili-whale.config.json')
const CRED_FILE = path.join(DSH_HOME, '..', '.bili-ai', 'credentials.json')
const HOME = process.env.USERPROFILE || os.homedir()

/** 默认配置（与 lib/config.mjs 的中性默认对齐；这里多一个 toolsPath） */
const DEFAULTS = {
  owner: { mid: '', name: '' },
  night: {
    windows: [{ start: '20:00', end: '24:00', wakes: 1 }],
    skipChance: 0.3,
    maxVideos: 5,
  },
  preferences: {
    like: ['DSH/AI 工具与插件', '鬼畜与怀旧向剪辑', '猫咪', 'Live2D/模型', 'B站生态八卦'],
    dislike: ['带货', '擦边', '标题党', '纯搬运'],
    keywords: [],
  },
  quota: { shareDaily: 3 },
  diary: { push: true, enabled: true },   // 2026-10-20：写日记不可关；只留"要不要推送"一个开关
  // ④ 2026-10-18：补上 persona / self（和 tools/lib/config.mjs 对齐 ✓ 否则设置页首次打开是空的 ✗）
  persona: { name: '', ownerTitle: '主人', selfClaim: '我' },
  self: { mid: '', name: '' },
  notify: { type: 'none', url: '', template: 'text', cmd: '' },
  listen: { comment: true, commentIntervalSec: 300, scope: 'both', oncePerPerson: false, allDay: false, dm: false, live: false, liveRoom: '', liveScope: 'owner', introDaily: 1, replyDm: false, replyDmDaily: 1, replyDmHours: 72, dmCostNote: true },
  share: { enabled: true, via: 'comment', minScore: 13, silentAfterDays: 3, decayPerDay: 1 },
  toolsPath: '',
  // 2026-10-21 v0.4：指定清单（feed 里永远排最前 ★）与预算（单条回复硬顶 + 单视频/单轮估算）
  watchlist: { ups: [], videos: [] },
  budget: { replyMaxTokens: 1200, videoMaxTokens: 12000, wakeMaxTokens: 60000 },
  // 2026-10-21 v0.5：口味源（关注/收藏/历史 → 加分与排除）
  taste: {
    enabled: true, owner: true, self: true,
    useFollowing: true, useFavorites: true, useHistory: true,
    maxFolders: 20, maxFavItems: 200, maxHistory: 60, recentDays: 30,
    boostFollow: 6, boostTopic: 3, excludeFavorites: true, excludeHistory: true, selfWeight: 0.5,
  },
}

const clone = (o) => JSON.parse(JSON.stringify(o))
const merge = (base, over) => {
  const out = { ...base }
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(base[k] ?? {}, v) : v
  }
  return out
}

/** 工具链里 bili.mjs 的位置：① 设置里的 toolsPath ② 插件自带的 tools/ ③ 开发目录 */
function resolveBiliMjs() {
  const cfg = readConfig()
  // 2026-10-18：去掉"作者机器"回退 ✗（换机器就是静默失效）→ 只有两个候选：设置里的 toolsPath / 插件自带 tools/ ✓
  return cfg.toolsPath || path.join(HERE, '..', 'tools', 'bili.mjs')
}

function readConfig() {
  let user = {}
  try { user = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')) } catch { /* 没配就用默认 */ }
  return { ...merge(DEFAULTS, user), __hasUserFile: Object.keys(user).length > 0 }
}

function writeConfig(next) {
  fs.mkdirSync(path.dirname(CFG_FILE), { recursive: true })
  fs.writeFileSync(CFG_FILE, JSON.stringify(next, null, 2) + '\n')
}

/** 只回"能不能用"，不回显任何凭据内容 */
function credState() {
  try {
    const c = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'))
    return { present: true, hasSess: !!c.sessdata, hasJct: !!c.bili_jct, hasBuvid: !!c.buvid3 }
  } catch { return { present: false, hasSess: false, hasJct: false, hasBuvid: false } }
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(obj))
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export default {
  name: 'dsh-bili-whale',
  // ⚠️ 2026-10-18 踩的坑：这里以前**写了两个 inject 键** ✗ —— 对象字面量后者覆盖前者 →
  //   `sessionController` 没被注入 → 生物钟每 60 秒静默 `return`（不报错、也不干活 ✗）
  //   一个数组写全 ✓
  inject: ['sessionController', 'webServer', 'connection'],
  apply(ctx) {

/** 写操作只认本机回环（2026-10-17 加，Kimi 评审指出）：DSH 的 Web 端口万一绑到 0.0.0.0，
 *  局域网里任何人都能改 cookie / 换主人 mid —— 那样"@分享"就全 @ 给攻击者了。
 *  这一层是兜底：host 不是回环就直接 403。 */
function isLoopbackReq(req) {
  const host = String(req.headers?.host ?? '').toLowerCase()
  const h = host.split(':')[0]
  return h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1'
}

    // P1-1（Kimi 评审 #8）：这条路以前是 fail-open —— connection 缺失/抛错就**放行** ✗
    // 安全组件的默认值必须是"关"：栅栏不可用 → 拒绝（写操作尤其），只对静态页面留一条活路。
    function rejected(req, res, { strict = true } = {}) {
      if (isLoopbackReq(req) === false) {
        // 连 Host 都不是回环 → 一律拒（防"服务绑到 0.0.0.0"那种情况）
        json(res, 403, { ok: false, error: '只接受本机回环访问' })
        return true
      }
      try {
        const conn = ctx.get('connection') || ctx.connection
        if (!conn || typeof conn.requestRejection !== 'function') {
          if (!rejected.warned) {
            rejected.warned = true
            console.warn('[bili-whale] 信任栅栏不可用：connection 服务缺失 → 按 fail-closed 处理')
          }
          if (strict) { json(res, 503, { ok: false, error: '信任栅栏不可用，拒绝访问（fail-closed）' }); return true }
          return false
        }
        const code = conn.requestRejection(req)
        if (code === undefined || code === null || code === false) return false
        res.statusCode = typeof code === 'number' ? code : 403
        res.end()
        return true
      } catch (e) {
        if (strict) { json(res, 503, { ok: false, error: '信任栅栏异常，拒绝访问（fail-closed）' }); return true }
        return false
      }
    }

    const disposers = []
    function route(kind, pathname, handler) {
      disposers.push(ctx.webServer.register({
        kind,
        path: pathname,
        handler: async (req, res) => {
          if (rejected(req, res)) return
          try { await handler(req, res) } catch (err) {
            try { json(res, 500, { ok: false, error: String(err?.message ?? err) }) } catch {}
          }
        },
      }))
    }

    // 旧的独立设置页已下线（2026-10-18）：DSH 的信任栅栏不认插件路径，这个页面在浏览器里永远 403 ✗
    // 现在唯一的入口是「设置 → 养鱼」（客户端 section ✓）。`lib/settings.html` 保留在仓库里当参考，不再挂路由。
    // 需要本地直开时：把该文件拷到桌面双击（它的 API 调用会被栅栏拒，只作静态预览 ✓）

    // 写设置：浅合并，但**只接受已知的顶层字段** ✓（2026-10-18 加白名单，兑现这句注释 ✗ 原来是什么都收）
    // P0-2（Kimi 评审 #2）：读和写**合成一个 handler**（原来同一路径注册两次，
    //   宿主若是"首个匹配即终止"，后注册的 POST 永远收不到请求 ✗）
    route('exact', '/dsh-bili/api/settings', async (req, res) => {
      if (req.method === 'GET') { json(res, 200, { ok: true, config: readConfig(), credentials: credState(), configPath: CFG_FILE }); return }
      if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const body = JSON.parse(await readBody(req) || '{}')
      const cur = readConfig()
      delete cur.__hasUserFile
      // ⚠️ 2026-10-18 修的 bug：客户端发的是**配置本身**，这里却只认 `body.config` ✗
      //   → merge(cur, {}) = 什么都没改 → "保存成功"但值没变（主人实测就是这个 ✗）
      //   现在两种都收：{ config: {...} } 或直接 {...}
      const incoming = (body && typeof body.config === 'object' && body.config) || body || {}
      // 顶层白名单：只合并认识的键（防止被塞任意字段 ✓）
      const KNOWN = new Set(['persona', 'preferences', 'notify', 'aliases', 'owner', 'self', 'quota', 'share', 'listen', 'night', 'toolsPath', 'watchlist', 'budget', 'taste'])
      const filtered = {}
      for (const [k, v] of Object.entries(incoming)) if (KNOWN.has(k)) filtered[k] = v
      const next = merge(cur, filtered)
      // 基本的范围校验（别让设置页把东西写成负数/离谱值）
      const n = next.night
      if (!Array.isArray(n.windows) || !n.windows.length) { json(res, 400, { ok: false, error: '至少要有一个作息窗口' }); return }
      n.maxWakesPerDay = Math.min(12, Math.max(0, Number(n.maxWakesPerDay ?? 0) || 0))   // 12 = 与 whale-night 的上限一致 ✓
      n.skipChance = Math.min(0.95, Math.max(0, Number(n.skipChance) || 0))
      n.maxVideos = Math.min(20, Math.max(1, Number(n.maxVideos) || 5))
      // P0-3（Kimi 评审 #3）：Number(0) || 3 === 3 → 用户取消勾选"分享"会被强行改回 3 ✗
      const sd = Number(next.quota.shareDaily)
      next.quota.shareDaily = Number.isFinite(sd) ? Math.min(20, Math.max(0, sd)) : 3
      // 2026-10-21 v0.4：指定清单归一化 + **短链展开**（b23.tv）
      //   ⚠️ 以前认不出的行被静默丢掉 → 保存 200、输入框清空，看起来就是"保存不了" ✗
      //   现在：先展开短链，再解析；被丢掉的行原样回话（warn），设置页能看见为什么 ✓
      let wlIn = next.watchlist
      try { wlIn = await expandWatchlistLinks(wlIn) } catch { /* 展开失败不影响保存 */ }
      const parsedWl = parseWatchlist(wlIn)
      next.watchlist = { ups: parsedWl.ups, videos: parsedWl.videos }
      // 预算：区间夹一下，别让手滑写成 1 或 99999999
      const b = next.budget ?? (next.budget = {})
      const clampBudget = (k, lo, hi, dft) => {
        const v = Number(b[k])
        b[k] = Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : dft
      }
      clampBudget('replyMaxTokens', 256, 8000, 1200)
      clampBudget('videoMaxTokens', 2000, 120000, 12000)
      clampBudget('wakeMaxTokens', 5000, 400000, 60000)
      // 口味源：布尔照收，数字夹区间（别让人手滑写成 1000 个收藏夹）
      const ts = next.taste ?? (next.taste = {})
      for (const k of ['enabled', 'owner', 'self', 'useFollowing', 'useFavorites', 'useHistory', 'excludeFavorites', 'excludeHistory']) {
        if (k in ts) ts[k] = Boolean(ts[k])
      }
      const clampTaste = (k, lo, hi, dft) => {
        const v = Number(ts[k])
        ts[k] = Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v)) * 100) / 100 : dft
      }
      clampTaste('maxFolders', 1, 50, 20)
      clampTaste('maxFavItems', 20, 1000, 200)
      clampTaste('maxHistory', 10, 300, 60)
      clampTaste('recentDays', 1, 365, 30)
      clampTaste('boostFollow', 0, 20, 6)
      clampTaste('boostTopic', 0, 10, 3)
      clampTaste('selfWeight', 0, 1, 0.5)
      writeConfig(next)
      // 改完立刻生效 ✓（主人 2026-10-18 要求）：清掉旧计划，让生物钟按新配置重算
      try { sched?.invalidate() } catch {}
      const warns = []
      if (next.quota.shareDaily > 3) warns.push('分享条数 >3：看起来会像刷量，平台可能限流/封号')
      if (parsedWl.rejected.length) {
        warns.push(`指定清单里有 ${parsedWl.rejected.length} 行认不出来，已跳过：${parsedWl.rejected.join(' ｜ ')}`)
        warns.push('（可贴完整视频 / 空间链接，或 BV 号 / mid；b23.tv 短链会自动展开。改完再点一次保存即可 ✓）')
      }
      json(res, 200, { ok: true, config: next, warn: warns.length ? warns.join('\n') : null })
    })

    // 写凭据（只写不读回）
    route('exact', '/dsh-bili/api/cookie', async (req, res) => {
      if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const b = JSON.parse(await readBody(req) || '{}')
      const sessdata = String(b.sessdata ?? '').trim()
      const bili_jct = String(b.bili_jct ?? '').trim()
      const buvid3 = String(b.buvid3 ?? '').trim()
      if (!sessdata || !bili_jct) { json(res, 400, { ok: false, error: 'SESSDATA 和 bili_jct 必填' }); return }
      fs.mkdirSync(path.dirname(CRED_FILE), { recursive: true })
      fs.writeFileSync(CRED_FILE, JSON.stringify({ sessdata, bili_jct, buvid3 }, null, 2) + '\n')
      try { fs.chmodSync(CRED_FILE, 0o600) } catch {}
      // 2026-10-19：写完 cookie 立刻问一次 nav，把 self 刷成新号 ✓
      let whoNow = null
      try {
        const navRes = await fetch('https://api.bilibili.com/x/web-interface/nav', {
          headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://www.bilibili.com/', cookie: `SESSDATA=${sessdata}; bili_jct=${bili_jct}; buvid3=${buvid3}` },
        })
        const navJson = await navRes.json().catch(() => ({}))
        if (navJson?.data?.isLogin && navJson.data.mid) {
          whoNow = { mid: String(navJson.data.mid), name: String(navJson.data.uname ?? '') }
          const cur = readConfig()
          writeConfig({ ...cur, self: whoNow })
        }
      } catch {}
      json(res, 200, { ok: true, detail: whoNow ? `已写入 ✓ 当前登录：${whoNow.name}（mid ${whoNow.mid}）` : '已写入（但 nav 没确认成功 —— cookie 可能缺项或过期 ✗）', self: whoNow })
    })

    // 依赖体检：跑 bili.mjs deps --json
    route('exact', '/dsh-bili/api/deps', async (req, res) => {
      const cfg = readConfig()
      // 工具位置（2026-10-18 收敛为两个候选 ✗ 去掉"作者机器"路径）：
      //   ① 设置里的 toolsPath  ② <插件根>/tools/bili.mjs（发布版自带 ✓）
      const tools = cfg.toolsPath || path.join(HERE, "..", "tools", "bili.mjs")
      if (!fs.existsSync(tools)) {
        json(res, 200, { ok: false, error: `找不到 bili.mjs：${tools}（在设置里填「工具目录」）`, items: [] })
        return
      }
      execFile(NODE_EXE, [tools, 'deps', '--json'], { timeout: 60_000, windowsHide: true }, (err, stdout, stderr) => {
        try {
          const parsed = JSON.parse(String(stdout || '{}'))
          // 2026-10-19：顺手把"她自己是谁"从 cookie 体检里抠出来写回配置 ✓
          //   以前 self.mid / self.name 只有默认值、没人写 → 设置页永远空 ✗
          let selfNow = null
          try {
            const ck = (parsed.items ?? []).find((it) => it.name === 'B站 cookie')
            const m = String(ck?.detail ?? '').match(/已登录：(.+?)（mid (\d+)）/)
            if (m) {
              selfNow = { name: m[1], mid: m[2] }
              const cur = readConfig()
              if (String(cur.self?.mid ?? '') !== selfNow.mid || String(cur.self?.name ?? '') !== selfNow.name) writeConfig({ ...cur, self: selfNow })
            }
          } catch {}
          // 2026-10-20：把"跑没跑过启动测试"一起返回 —— 设置页用它决定要不要显示首次安装横幅
          let selftestPassed = false
          try {
            selftestPassed = fs.existsSync(path.join(HOME, ".bili-ai", "selftest-passed.json"))
          } catch {}
          json(res, 200, { ok: !!parsed.ok, items: parsed.items ?? [], node: parsed.node, self: selfNow, selftestPassed })
        } catch {
          json(res, 200, { ok: false, error: String(stderr || err?.message || 'deps 跑失败').slice(0, 300), items: [] })
        }
      })
    })

    // ── 待审回复（2026-10-18 主人选 B 档：**发前审核**）──────────────────────────
    //   她的回复先进 pending-replies.json → 主人在「设置 → 养鱼 → 待审核」里点发才发 ✓
    const PENDING = path.join(HOME, '.bili-ai', 'pending-replies.json')
    route('exact', '/dsh-bili/api/pending', async (req, res) => {
      if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
      let items = []
      try { items = JSON.parse(fs.readFileSync(PENDING, 'utf8')).items ?? [] } catch {}
      json(res, 200, { ok: true, items })
    })
    route('exact', '/dsh-bili/api/pending/reject', async (req, res) => {
      if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const b = JSON.parse(await readBody(req) || '{}')
      const id = String(b.id ?? '')
      if (!id) { json(res, 400, { ok: false, error: '需要 id' }); return }
      execFile(NODE_EXE, [resolveBiliMjs(), 'reply-draft', 'drop', id], { timeout: 20000, windowsHide: true }, (err, stdout) => {
        // 否掉也是一种反馈 → 记事件流（她下次能学到"这种不要" ✓）
        // ⚠️ 只有真的删掉了才记 ✗ —— 以前连点几次会重复记三条（2026-10-18 修 ✓）
        if (!err) {
          try {
            fs.appendFileSync(path.join(DSH_HOME, 'whale-log.jsonl'),
              JSON.stringify({ at: new Date().toISOString(), kind: 'reply-rejected', target: null, note: `主人否掉了草稿 ${id}${b.reason ? '：' + String(b.reason).slice(0, 80) : ''}` }) + '\n')
          } catch {}
        }
        json(res, 200, { ok: !err, out: String(stdout ?? '').slice(0, 300) })
      })
    })
    route('exact', '/dsh-bili/api/pending/approve', async (req, res) => {
      if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const b = JSON.parse(await readBody(req) || '{}')
      const id = String(b.id ?? '')
      if (!id) { json(res, 400, { ok: false, error: '需要 id' }); return }
      const bili = resolveBiliMjs()
      // ① 从队列取出（取不到 = 已经发过/删过 ✓）
      execFile(NODE_EXE, [bili, 'reply-draft', 'take', id], { timeout: 20000, windowsHide: true }, (err, stdout) => {
        let item = null
        try { item = JSON.parse(String(stdout ?? '')) } catch {}
        if (!item) { json(res, 400, { ok: false, error: '队列里没有这条（可能已经发过）' }); return }
        // ② 真发（--auto → 自动报备 ✓；--once-per-person → 判重 ✓）
        const args = ['comment', '--oid', item.oid, '--root', item.root, '--parent', item.parent,
          '--message', item.message, '--auto', ...(cfg.listen?.oncePerPerson !== false ? ['--once-per-person'] : []), '--go']
        if (item.bvid) args.push('--bvid', item.bvid)
        execFile(NODE_EXE, [bili, ...args], { timeout: 120000, windowsHide: true }, (e2, out2, err2) => {
          const text = String(out2 ?? '')
          const ok = !e2 && /code=0/.test(text)
          const rpid = (text.match(/rpid=(\d+)/) ?? [])[1] ?? null
          try {
            fs.appendFileSync(path.join(DSH_HOME, 'whale-log.jsonl'),
              JSON.stringify({ at: new Date().toISOString(), kind: ok ? 'reply-sent' : 'reply-failed', target: item.who || item.parent, note: `${ok ? '主人批准并发出' : '发送失败'} · ${String(item.message).slice(0, 60)}` }) + '\n')
          } catch {}
          json(res, 200, { ok, rpid, out: text.slice(-600), err: String(err2 ?? '').slice(0, 400) })
        })
      })
    })

    // ── 私信收件箱（2026-10-21 v0.7）────────────────────────────────────
    //   她发给主人的私信，dm 命令会同步进 ~/.bili-ai/outbox.json；
    //   这里给 DSH 的「鱼的私信」窗口提供：列表 / 保存修改 / 发评论 / 否掉 / 删除。
    //   ⚠️ 发评论**只在主人点按钮时**发生（本路由就是那个按钮），走 comment 且不带 --auto：
    //      属于「主人授权」的发言，不占她自主发言的每日额度 ✓
    route('exact', '/dsh-bili/api/outbox', async (req, res) => {
      if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
      const data = loadOutbox()
      json(res, 200, { ok: true, stats: outboxStats(data), items: data.items })
    })

    route('exact', '/dsh-bili/api/outbox/save', async (req, res) => {
      if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const b = JSON.parse(await readBody(req) || '{}')
      const data = loadOutbox()
      const patch = { text: String(b.text ?? ''), bv: String(b.bv ?? '') }
      // 表情：只在窗口真的传了字段时改（不传 = 保持原样，别把已有的表情抹掉 ✗）
      // v0.9：数组（最多 3 个）；老客户端传单个 `emote` 也认
      if (Array.isArray(b.emotes)) patch.emotes = b.emotes
      else if (typeof b.emote === 'string') patch.emote = b.emote
      if (Array.isArray(b.mentions)) patch.mentions = b.mentions
      // 2026-10-22：自己的表情包图片（评论里的"大表情"实验；最多 2 张）
      if (Array.isArray(b.stickers)) patch.stickers = b.stickers
      const item = patchItem(data, String(b.id ?? ''), patch)
      if (!item) { json(res, 404, { ok: false, error: '没有这条' }); return }
      saveOutbox(data)
      json(res, 200, { ok: true, item })
    })

    route('exact', '/dsh-bili/api/outbox/reject', async (req, res) => {
      if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const b = JSON.parse(await readBody(req) || '{}')
      const data = loadOutbox()
      const item = setStatus(data, String(b.id ?? ''), 'rejected', { error: String(b.reason ?? '') })
      if (!item) { json(res, 404, { ok: false, error: '没有这条' }); return }
      saveOutbox(data)
      // 这条是任务交的稿 → 任务也变「已取消」（两边状态一致，别一个说已否、一个说待审 ✓）
      try { syncFromDraft(item, 'rejected') } catch {}
      // 否掉也是反馈 → 记事件流（她下次能学到"这种不要"）
      try {
        fs.appendFileSync(path.join(DSH_HOME, 'whale-log.jsonl'),
          JSON.stringify({ at: new Date().toISOString(), kind: 'outbox-rejected', target: item.bv || null, note: `主人否掉了私信 ${item.id}${b.reason ? '：' + String(b.reason).slice(0, 80) : ''}` }) + '\n')
      } catch {}
      json(res, 200, { ok: true, item })
    })

    route('exact', '/dsh-bili/api/outbox/delete', async (req, res) => {
      if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const b = JSON.parse(await readBody(req) || '{}')
      const id = String(b.id ?? '')
      const data = loadOutbox()
      const item = findItem(data, id)
      const before = data.items.length
      data.items = data.items.filter((x) => x.id !== id)
      if (data.items.length === before) { json(res, 404, { ok: false, error: '没有这条' }); return }
      saveOutbox(data)
      // 删的是某条任务的草稿 → 任务退回「排队中」，草稿指针清掉（别留一个点不开的「看草稿」✗）
      try { if (item) syncFromDraft(item, 'deleted') } catch {}
      json(res, 200, { ok: true })
    })

    // 发到评论区：把（改过的）正文写成临时文件，交给 CLI 的 outbox post（状态机与记账都在那边 ✓）
    route('exact', '/dsh-bili/api/outbox/post', async (req, res) => {
      if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const b = JSON.parse(await readBody(req) || '{}')
      const data = loadOutbox()
      const item = findItem(data, String(b.id ?? ''))
      if (!item) { json(res, 404, { ok: false, error: '没有这条' }); return }
      if (item.status === 'posted') { json(res, 400, { ok: false, error: `已经发过了（rpid=${item.rpid ?? '?'}）` }); return }
      const text = String(b.text ?? item.edited ?? item.text ?? '')
      const bv = String(b.bv ?? item.bv ?? '')
      if (!bv) { json(res, 400, { ok: false, error: '没有目标视频：在窗口里填一个 BV' }); return }
      // 窗口里改过的表情/@ 要在发之前落盘（CLI 从条目里读它们去补 --emote ✓）
      const pre = {}
      if (Array.isArray(b.emotes)) pre.emotes = b.emotes
      else if (typeof b.emote === 'string') pre.emote = b.emote
      if (Array.isArray(b.mentions)) pre.mentions = b.mentions
      if (Array.isArray(b.stickers)) pre.stickers = b.stickers
      if (Object.keys(pre).length) { patchItem(data, item.id, pre); saveOutbox(data) }
      const tmp = path.join(os.tmpdir(), `whale-outbox-${Date.now()}-${process.pid}.txt`)
      try { fs.writeFileSync(tmp, text, 'utf8') } catch (e) { json(res, 500, { ok: false, error: `写临时文件失败：${e.message}` }); return }
      const args = ['outbox', 'post', item.id, '--text-file', tmp, ...(bv ? ['--bv', bv] : []), '--go']
      execFile(NODE_EXE, [resolveBiliMjs(), ...args], { timeout: 180_000, windowsHide: true }, (err, stdout, stderr) => {
        try { fs.unlinkSync(tmp) } catch {}
        const out = String(stdout ?? '')
        const ok = !err && /已发布/.test(out)
        const rpid = (out.match(/rpid=(\d+)/) ?? [])[1] ?? null
        // 失败时把最后几行当 error 带回去 —— 窗口里要能看见"为什么没发出去"（不是一句 HTTP 200 ✗）
        const tail = out.trim().split('\n').slice(-3).join(' / ').slice(-240)
        json(res, 200, { ok, rpid, out: out.slice(-800), err: String(stderr ?? '').slice(-400), error: ok ? null : (tail || '没发出去') })
      })
    })

    // ── 任务台（2026-10-21 v0.8）────────────────────────────────────────
    //   主人原话：「能在这个板块中发布任务吗？比如观看指定的视频，按要求的格式写评论
    //   （如总结大纲、写时间轴、提出观点、活跃气氛、读简介中的链接等）」
    //   分工：任务台=下指令 · 她交稿进私信窗口 · **发不发是主人的手**（这里没有发评论的路由 ✗）
    //   会话 id 与预算/生物钟共用（下面 budget 那段的 SESSION 就是它 —— 这里先声明，别写两份 ✗）
    const SESSION = 'bili-whale'
    const TASK_SESSION = SESSION

    function taskPromptText(task) {
      const cfg = readConfig()
      return [
        personaLineFromCfg(cfg),   // 跟生物钟同一份身份注入（别两处抄 ✗）
        buildTaskPrompt(task, { ownerName: String(cfg.owner?.name ?? '') }),
      ].filter(Boolean).join('\n')
    }

    /** 立刻把活交给她（等于"到点叫醒"，只是不等作息）。失败必须退回排队，不能停在「她在看」✗ */
    async function promptTaskNow(id) {
      const data = loadTasks()
      const task = findTask(data, id)
      if (!task) throw new Error('没有这个任务')
      if (task.status === 'posted') throw new Error('这条已经发过了')
      const claimed = claimTask(data, id)
      if (!claimed) throw new Error('领不到这个任务')
      saveTasks(data)
      try {
        try { await ctx.sessionController.create({ sessionId: TASK_SESSION, cwd: HOME }) } catch { /* 已存在就忽略 */ }
        await ctx.sessionController.prompt(
          {
            requestId: `bili-whale-task-${id}-${Date.now()}`,
            sessionId: TASK_SESSION,
            mode: 'queue',
            content: [{ type: 'text', text: taskPromptText(claimed) }],
          },
          new AbortController().signal,
        )
      } catch (e) {
        try {
          const back = loadTasks()
          setTaskStatus(back, id, 'todo', { error: `没能叫醒她：${String(e?.message ?? e).slice(0, 160)}` })
          saveTasks(back)
        } catch { /* 退不回排队也不能吞掉原始错误 */ }
        throw e
      }
      return claimed
    }

    route('exact', '/dsh-bili/api/task', async (req, res) => {
      if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
      const data = loadTasks()
      json(res, 200, {
        ok: true,
        // 格式清单由后端给（窗口不抄一份，加格式只改 tasks.mjs ✓）
        formats: FORMATS.map(({ id, label, hint, chars }) => ({ id, label, hint, chars })),
        tasks: data.tasks,
        stats: taskStats(data),
        stale: staleIds(data),
        labels: STATUS_LABEL,
      })
    })

    route('exact', '/dsh-bili/api/task/add', async (req, res) => {
      if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const b = JSON.parse(await readBody(req) || '{}')
      const data = loadTasks()
      const { task, created, error } = addTask(data, {
        bv: b.bv, format: b.format, chars: b.chars, instruction: b.instruction,
        emote: b.emote, mentionOwner: b.mentionOwner,
        // v0.9：@ 除了主人还能点别人（窗口里逗号分隔 → 数组）
        mentions: b.mentions ?? b.mentionOthers,
        // v0.9.1：指定表情（窗口里点图挑的，最多 3 个）
        emotes: b.emotes,
        // v0.10：自己的表情包（评论里当大表情，实验；最多 2 张）
        stickers: b.stickers,
      })
      if (error) { json(res, 400, { ok: false, error }); return }
      saveTasks(data)
      let prompted = false
      let warn = null
      if (created && b.now) {
        try { await promptTaskNow(task.id); prompted = true } catch (e) { warn = `已排队，但没能叫醒她：${String(e?.message ?? e)}` }
      }
      // 立刻做那条会把状态改到 running —— 回话要用**磁盘上的最新那份**（别回一个已经过期的对象 ✗）
      const shown = findTask(loadTasks(), task.id) ?? task
      json(res, 200, { ok: true, task: shown, created, prompted, warn })
    })

    route('exact', '/dsh-bili/api/task/run', async (req, res) => {
      if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const b = JSON.parse(await readBody(req) || '{}')
      try {
        const task = await promptTaskNow(String(b.id ?? ''))
        json(res, 200, { ok: true, task })
      } catch (e) {
        json(res, 500, { ok: false, error: String(e?.message ?? e) })
      }
    })

    route('exact', '/dsh-bili/api/task/cancel', async (req, res) => {
      if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const b = JSON.parse(await readBody(req) || '{}')
      const data = loadTasks()
      const task = setTaskStatus(data, String(b.id ?? ''), 'cancelled', {})
      if (!task) { json(res, 404, { ok: false, error: '没有这个任务' }); return }
      saveTasks(data)
      json(res, 200, { ok: true, task })
    })

    route('exact', '/dsh-bili/api/task/delete', async (req, res) => {
      if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const b = JSON.parse(await readBody(req) || '{}')
      const id = String(b.id ?? '')
      const data = loadTasks()
      const before = data.tasks.length
      data.tasks = data.tasks.filter((x) => x.id !== id)
      if (data.tasks.length === before) { json(res, 404, { ok: false, error: '没有这个任务' }); return }
      saveTasks(data)
      json(res, 200, { ok: true })
    })

    // 表情库（v0.9）：窗口里"打开表情库"用 —— 按标签筛、给图墙渲染
    //   ⚠️ 这里只读本地库（`emotes sync` 拉下来的官方包），不碰网络、不改任何东西 ✓
    route('exact', '/dsh-bili/api/emotes', async (req, res) => {
      if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
      const lib = loadEmoteLib()
      if (!lib) { json(res, 200, { ok: false, error: '本地还没有表情库：先跑 node bili.mjs emotes sync' }); return }
      const u = new URL(String(req.url ?? '/'), 'http://localhost')
      const tag = String(u.searchParams.get('tag') ?? '').trim()
      const q = String(u.searchParams.get('q') ?? '').trim().toLowerCase()
      const all = (lib.emotes ?? []).filter((e) => String(e.text ?? '').startsWith('['))
      // 只收 `[名字]` 这种表情：另一种是「颜文字」（type 4），它的"转义符"就是那几个字符本身，
      //   插进正文的规则不一样，容易插错 ✓ → 窗口里不提供，手打就行（不影响已有功能）
      const counts = new Map()
      for (const e of all) for (const t of e.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1)
      let items = all
      if (tag) items = items.filter((e) => (e.tags ?? []).includes(tag))
      if (q) items = items.filter((e) => e.text.toLowerCase().includes(q) || (e.tags ?? []).some((t) => t.toLowerCase().includes(q)))
      json(res, 200, {
        ok: true,
        total: all.length,
        syncedAt: lib.syncedAt ?? null,
        tags: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([name, n]) => ({ name, n })),
        items: items.slice(0, 200).map((e) => ({ text: e.text, url: e.url, tags: e.tags ?? [], package_id: e.package_id })),
        // 2026-10-22：自己的表情包（贴纸库）。图走 /sticker 路由，不在这里塞 base64 ✓
        stickers: (() => {
          const s = loadStickerLib()
          const dir = s?.dir ?? ''
          return { dir, count: (s?.stickers ?? []).length,
            items: (s?.stickers ?? []).slice(0, 200).map((x) => ({ name: x.name, type: x.type, tags: x.tags ?? [], desc: x.desc ?? '' })) }
        })(),
      })
    })

    // 贴纸列表（2026-10-22）：单独一条路由，**不依赖官方表情库**
    //   （表情库没 sync 的时候，「我的表情包」也得能看见 ✓）
    route('exact', '/dsh-bili/api/stickers', async (req, res) => {
      if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
      const s = loadStickerLib()
      if (!s) { json(res, 200, { ok: false, error: '还没有贴纸库：先 node bili.mjs stickers sync --dir "<表情包目录>"' }); return }
      json(res, 200, {
        ok: true,
        dir: s.dir ?? '',
        count: (s.stickers ?? []).length,
        items: (s.stickers ?? []).slice(0, 300).map((x) => ({ name: x.name, type: x.type, tags: x.tags ?? [], desc: x.desc ?? '' })),
      })
    })

    // 贴纸图片（本地文件 → 浏览器能显示的图片）。⚠️ 只认贴纸库里**登记过的名字**，
    //   不按路径读文件（否则就是一个任意文件读取洞 ✗）
    route('exact', '/dsh-bili/api/sticker', async (req, res) => {
      if (!isLoopbackReq(req)) { res.statusCode = 403; res.end(); return }
      const u = new URL(String(req.url ?? '/'), 'http://localhost')
      const name = String(u.searchParams.get('name') ?? '')
      const lib = loadStickerLib()
      const s = (lib?.stickers ?? []).find((x) => x.name === name)
      if (!s) { res.statusCode = 404; res.end(); return }
      // 纵深防御：只读「扫描目录里面」的文件（库文件被手改指到别处也不读）
      const base = path.resolve(lib.dir || path.dirname(s.path))
      const full = path.resolve(s.path)
      if (full !== path.join(base, path.basename(full))) { res.statusCode = 404; res.end(); return }
      try {
        const buf = fs.readFileSync(full)
        const mime = s.type === 'png' ? 'image/png' : s.type === 'gif' ? 'image/gif' : 'image/jpeg'
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'private, max-age=3600' })
        res.end(buf)
      } catch { res.statusCode = 404; res.end() }
    })

    // 「发条测试」：真的跑一次 notify.mjs --test，把结果原样返回（配错了当场能看见 ✓）
    // 2026-10-18 主人要求：必须有这个按钮，不然配错了不知道 ✗
    route('exact', '/dsh-bili/api/notify-test', async (req, res) => {
      if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const cfg = readConfig()
      const tools = cfg.toolsPath || path.join(HERE, "..", "tools", "bili.mjs")
      const notifyMjs = path.join(path.dirname(tools), 'commands', 'notify.mjs')
      if (!fs.existsSync(notifyMjs)) { json(res, 200, { ok: false, error: `找不到 notify.mjs：${notifyMjs}` }); return }
      execFile(NODE_EXE, [notifyMjs, '--test'], { timeout: 60_000, windowsHide: true }, (err, stdout, stderr) => {
        json(res, 200, {
          ok: !err,
          out: String(stdout ?? '').slice(0, 800),
          err: String(stderr ?? '').slice(0, 800),
          type: cfg.notify?.type ?? 'none',
        })
      })
    })

    // 状态（只读）：今天分享了几条 / 今天的作息计划 / 判重账本里记了几个人
    route('exact', '/dsh-bili/api/status', async (req, res) => {
      const localHome = os.homedir()
      const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
      const quota = readJson(path.join(localHome, '.bili-ai', 'quota.json')) ?? { log: [] }
      const today = new Date().toLocaleDateString('sv-SE')
      const todays = (quota.log ?? []).filter((x) => String(x.at).startsWith(today))
      const night = readJson(path.join(DSH_HOME, 'whale-night.json'))
      const replied = readJson(path.join(localHome, '.bili-ai', 'replied.json'))
      json(res, 200, {
        ok: true, today,
        shares: todays.filter((x) => x.share).length,
        sharesMax: quota.shareDaily ?? 3,
        commentsToday: todays.length,
        repliedPeople: Object.keys(replied?.byUid ?? {}).length,
        plan: night ? { date: night.date, action: night.action, atText: night.atText ?? null, wakes: Number(night.wakes ?? 0), windows: night.usedWindows ?? [] } : null,
      })
    })

    // ── 预算（2026-10-21 v0.4）──────────────────────────────────────────────
    //   「单个回复最多吐多少 token」这一条**只能在宿主侧硬顶**：
    //   `agent/request` 是宿主给的 waterfall —— `next()` 拿到本该用的 LlmCallConfig，
    //   返回一个替换值就改了这一次调用；`maxTokens` 就是「这条回复最多生成多少 token」。
    //   只对养鱼这一个会话生效（别的会话不该被我们的预算管 ✗）。
    //   （`SESSION` 在任务台那段已经声明 —— 同一个会话 id，别写两份 ✗）
    const budgetCache = { at: 0, val: null }
    function budgetNow() {
      if (Date.now() - budgetCache.at < 3000 && budgetCache.val) return budgetCache.val
      const b = readConfig().budget ?? {}
      budgetCache.at = Date.now()
      budgetCache.val = {
        reply: Math.max(256, Math.min(8000, Number(b.replyMaxTokens) || 1200)),
        video: Math.max(2000, Math.min(120000, Number(b.videoMaxTokens) || 12000)),
        wake: Math.max(5000, Math.min(400000, Number(b.wakeMaxTokens) || 60000)),
      }
      return budgetCache.val
    }
    let clampLogged = false
    let clampLoggedAt = 0
    // 真实用量与硬顶的落点：有它才能事后证明"这条硬顶真的挂上了"（不靠翻控制台）
    const SPEND = path.join(DSH_HOME, 'whale-spend.jsonl')
    try {
      ctx.on('agent/request', async (payload, next) => {
        const conf = await next()
        try {
          if (String(payload?.agent?.id ?? '') !== SESSION) return conf
          const cap = budgetNow().reply
          const clamped = clampReplyTokens(conf, cap)
          if (clamped !== conf) {
            // 每 10 分钟最多记一笔：够证明生效，又不会把账本刷爆
            const now = Date.now()
            if (!clampLogged || now - clampLoggedAt > 600_000) {
              clampLogged = true
              clampLoggedAt = now
              console.log(`[bili-whale] 单条回复已顶到 maxTokens=${cap}（改设置页或 budget set 即生效）`)
              appendSpend({ kind: 'clamp', cap }, SPEND)
            }
          }
          return clamped
        } catch { /* 预算坏了也不能挡模型调用 */ }
        return conf
      })
    } catch (e) {
      console.warn('[bili-whale] agent/request 挂不上（单条回复硬顶失效）：' + String(e?.message ?? e).slice(0, 120))
    }

    // 真实用量：assistant/message 自带宿主的 TokenUsage —— 有就记一笔（估算归估算，账单归账单）
    try {
      ctx.on('session/event', (session, event) => {
        try {
          // 有的版本 Session 对象只暴露 sessionId，两个都认（认不出就不记，不猜）
          const sid = String(session?.id ?? session?.sessionId ?? '')
          if (sid !== SESSION) return
          if (!event || event.type !== 'assistant/message') return
          const u = event.data?.usage
          if (!u) return
          appendSpend({
            kind: 'usage',
            turn: event.data?.turn,
            step: event.data?.step,
            input: Number(u.inputTokens ?? 0),
            output: Number(u.outputTokens ?? 0),
            cacheRead: Number(u.cacheReadTokens ?? 0),
            cacheWrite: Number(u.cacheWriteTokens ?? 0),
          }, SPEND)
        } catch { /* 记账失败不影响对话 */ }
      })
    } catch (e) {
      console.warn('[bili-whale] session/event 挂不上（真实用量不记）：' + String(e?.message ?? e).slice(0, 120))
    }

    // ── 自主生物钟（2026-10-18）：插件自己 tick，到点自己叫醒她（不靠对话框 ✓）────────
    let sched = null
    try {
      sched = startScheduler(ctx, {
        dshHome: DSH_HOME,
        biliMjs: resolveBiliMjs(),
        cwd: HOME,   // 2026-10-18：她那个会话的工作目录 = 用户主目录（原来写死 'ai work' ✗ 换机器会建会话失败 ✗）
        sessionId: 'bili-whale',
        log: (m) => { try { console.log(m) } catch {} },
      })
    } catch (e) {
      try { console.warn('[bili-whale] 生物钟启动失败：' + e.message) } catch {}
    }

    ctx.effect(() => () => {
      try { sched?.stop() } catch {}
      for (const d of disposers) { try { d() } catch {} }
    })

    try {
      console.log(`[bili-whale] 设置页已挂载：/dsh-bili/ · 配置 ${CFG_FILE}`)
    } catch {}
  },
}
