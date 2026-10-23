// 口味源（taste）—— 2026-10-21 v0.5
//
// 主人原话：「提取我自己的 B 站账号的关注、收藏列表来制定更符合我口味的观看策略，
//             同时也能排除一部分我看过的视频」。
//
// 能拿到什么（2026-10-21 实测，全部只读）：
//   · 关注列表   x/relation/followings?vmid=       —— 自己的全量；别人的只给公开部分
//   · 收藏夹     x/v3/fav/folder/created/list-all  —— **别人的公开收藏夹也能读**（实测主人 31 个）
//   · 收藏内容   x/v3/fav/resource/list?media_id=  —— 含 bvid / 标题 / UP / 收藏时间
//   · 观看历史   x/web-interface/history/cursor    —— **只对登录账号有效**（别人的拿不到）
//
// 关键设计（为什么不是"照关注列表推"）：
//   ① 收藏夹的**文件夹名**是主人手写的兴趣标签（GitHub / 前端 / 算法…）→ 权重最高的主题词
//   ② 收藏过的 BV = 已经看过/想留着 → **直接从候选里排除**
//   ③ 历史里 progress/duration 能区分"看完"和"点开就退" → 前者学口味，后者不学
//   ④ 关注的人发的新视频 → 加分（不排除：关注≠看过）
//
// 隐私：全部落在本机 ~/.bili-ai/taste.json（与凭据同目录），不上传、不进日记。
import fs from 'node:fs'
import path from 'node:path'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export const TASTE_FILE = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.bili-ai', 'taste.json')

export const DEFAULTS = {
  enabled: true,
  owner: true,          // 读主人的公开收藏 + 关注（零额外授权）
  self: true,           // 读登录账号自己的收藏 + 历史（历史只有自己能读）
  useFollowing: true,
  useFavorites: true,
  useHistory: true,
  maxFolders: 20,       // 最多翻几个收藏夹（按条目数从多到少）
  maxFavItems: 200,     // 收藏条目上限（去重用）
  maxHistory: 60,       // 历史条数上限
  recentDays: 30,       // 历史只学最近 N 天
  boostFollow: 6,       // 关注的人发的新视频：+6 分
  boostTopic: 3,        // 每个命中的口味词：+3 分（封顶 6）
  excludeFavorites: true,
  excludeHistory: true,
  selfWeight: 0.5,      // 登录账号自身口味的权重（鱼自己的动漫口味不该压过主人）
}

// ── 纯函数：主题词 / 索引 / 打分 ─────────────────────────────────────────────

const STOP = new Set(['这个', '那个', '什么', '自己', '可以', '就是', '一个', '我们', '他们', '没有', '已经', '还是', '因为', '所以', '但是', '如果', '不是', '这样', '那样', '真的', '感觉', '今天', '明天', '时候', '现在', '视频', '官方', '第一', '第二'])

/** 从标题/文件夹名里抽主题词：拉丁词 ≥3 字 + 中文 2~3 字 n-gram。 */
export function topicTokens(text) {
  const out = new Set()
  const t = String(text ?? '').replace(/@\S+/g, ' ')
  for (const m of t.matchAll(/[A-Za-z][A-Za-z0-9+#.-]{2,}/g)) out.add(m[0].toLowerCase())
  for (const m of t.matchAll(/[\u4e00-\u9fa5]{2,}/g)) {
    const run = m[0]
    for (const n of [2, 3]) for (let i = 0; i + n <= run.length; i += 1) {
      const g = run.slice(i, i + n)
      if (!STOP.has(g)) out.add(g)
    }
  }
  return [...out]
}

/**
 * 把口味档案压成"可查询的索引"（feed 每轮直接查它，不再重新算）。
 * 返回 { followMids:Set, favoriteBvs:Set, historyBvs:Set, topicWeights:Map }
 */
export function tasteIndex(taste) {
  const t = taste && typeof taste === 'object' ? taste : {}
  const followMids = new Set()
  const favoriteBvs = new Set()
  const historyBvs = new Set()
  const topicWeights = new Map()

  const bump = (tok, w) => { if (!tok) return; topicWeights.set(tok, (topicWeights.get(tok) ?? 0) + w) }

  for (const acct of ['owner', 'self']) {
    const a = t[acct]
    if (!a) continue
    const scale = acct === 'self' ? Number(t?.meta?.selfWeight ?? DEFAULTS.selfWeight) : 1
    for (const u of a.following ?? []) if (u?.mid) followMids.add(String(u.mid))
    // 文件夹名是主人**手写**的分类，价值最高 —— 但**不随条目数放大**（否则 102 条的"剑魔"会吃掉整个档案 ✗）
    for (const folder of a.folders ?? []) {
      for (const tok of topicTokens(folder?.title ?? '')) bump(tok, 6 * scale)
    }
    for (const f of a.favorites ?? []) {
      if (f?.bv) favoriteBvs.add(String(f.bv))
      for (const tok of topicTokens(f?.title ?? '')) bump(tok, 1 * scale)
    }
    for (const h of a.history ?? []) {
      if (h?.bv) historyBvs.add(String(h.bv))
      const ratio = Number(h?.duration) > 0 ? Number(h?.progress ?? 0) / Number(h.duration) : 0
      // 点开就退（<8%）不学；看完（>85%）学得最重
      const w = ratio >= 0.85 ? 1.2 : ratio >= 0.3 ? 0.6 : ratio > 0.08 ? 0.2 : 0
      for (const tok of topicTokens(h?.title ?? '')) bump(tok, w * scale)
    }
  }
  // 只留够强的词，防止长尾把候选池打散
  for (const [k, v] of [...topicWeights]) if (v < 1.5) topicWeights.delete(k)
  return { followMids, favoriteBvs, historyBvs, topicWeights }
}

/** 一条候选的口味加分（0 ~ boostFollow+2*boostTopic）。 */
export function tasteBoost(item, index, cfg = {}) {
  const boostFollow = Number(cfg.boostFollow ?? DEFAULTS.boostFollow)
  const boostTopic = Number(cfg.boostTopic ?? DEFAULTS.boostTopic)
  if (!item || !index) return 0
  let score = 0
  if (index.followMids?.has(String(item.mid ?? ''))) score += boostFollow
  let hits = 0
  const title = String(item.t ?? item.title ?? '')
  if (title && index.topicWeights?.size) {
    for (const tok of topicTokens(title)) if (index.topicWeights.has(tok)) hits += 1
  }
  score += Math.min(boostTopic * 2, hits * boostTopic)
  return score
}

/** 是否该从候选里排除（收藏过 / 看过）。 */
export function tasteExcluded(item, index, cfg = {}) {
  if (!item || !index) return false
  const bv = String(item.bv ?? '')
  if (cfg.excludeFavorites !== false && index.favoriteBvs?.has(bv)) return true
  if (cfg.excludeHistory !== false && index.historyBvs?.has(bv)) return true
  return false
}

/** 读档案（坏了就当没有，不让 feed 崩）。 */
export function loadTaste(file = TASTE_FILE) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

export function saveTaste(t, file = TASTE_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(t, null, 2) + '\n')
  fs.renameSync(tmp, file)
}

/** 多久没同步了（小时）；从没同步过 → null。 */
export function tasteAgeHours(t) {
  const at = Number(t?.syncedAt ?? 0)
  if (!at) return null
  return (Date.now() - at) / 3600000
}

// ── 取数（只读；每步失败都写进 errors，不静默）────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function jget(cred, url, referer) {
  const r = await fetch(url, {
    headers: {
      'user-agent': UA,
      referer,
      accept: 'application/json, text/plain, */*',
      cookie: `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}`,
    },
  })
  const text = await r.text()
  try { return JSON.parse(text) } catch { return { code: -1, message: `非 JSON（HTTP ${r.status}）` } }
}

/** 关注列表（自己的全量；别人的公开部分）。 */
export async function fetchFollowing(cred, mid, { maxPages = 3, ps = 50 } = {}) {
  const out = []
  for (let pn = 1; pn <= maxPages; pn += 1) {
    const j = await jget(cred, `https://api.bilibili.com/x/relation/followings?vmid=${mid}&pn=${pn}&ps=${ps}&order=desc&order_type=attention`,
      `https://space.bilibili.com/${mid}/fans/follow`)
    if (j?.code !== 0) return { items: out, error: `code=${j?.code} ${j?.message ?? ''}`.slice(0, 60), total: j?.data?.total }
    const list = j?.data?.list ?? []
    for (const u of list) out.push({ mid: String(u.mid), name: String(u.uname ?? '') })
    if (list.length < ps) break
    await sleep(350)
  }
  return { items: out }
}

/** 收藏夹列表（含别人的公开夹）。 */
export async function fetchFavFolders(cred, mid) {
  const j = await jget(cred, `https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${mid}`, `https://space.bilibili.com/${mid}/favlist`)
  if (j?.code !== 0) return { items: [], error: `code=${j?.code} ${j?.message ?? ''}`.slice(0, 60) }
  const list = (j?.data?.list ?? []).map((f) => ({ id: f.id, title: String(f.title ?? ''), count: Number(f.media_count ?? 0), attr: f.attr }))
  return { items: list }
}

/** 一个收藏夹里的条目（分页到 maxItems）。 */
export async function fetchFavItems(cred, folder, { maxItems = 20, mid = '' } = {}) {
  const out = []
  const ps = Math.min(20, maxItems)
  for (let pn = 1; out.length < maxItems; pn += 1) {
    const j = await jget(cred, `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${folder.id}&pn=${pn}&ps=${ps}&platform=web&order=mtime&type=0&tid=0`,
      `https://space.bilibili.com/${mid || ''}/favlist?fid=${folder.id}`)
    if (j?.code !== 0) return { items: out, error: `code=${j?.code} ${j?.message ?? ''}`.slice(0, 60) }
    const medias = j?.data?.medias ?? []
    for (const m of medias) {
      if (!m?.bvid) continue
      out.push({ bv: m.bvid, title: String(m.title ?? ''), up: String(m.upper?.name ?? ''), favAt: Number(m.fav_time ?? 0), folder: folder.title })
      if (out.length >= maxItems) break
    }
    if (medias.length < ps) break
    await sleep(350)
  }
  return { items: out }
}

/**
 * 观看历史（**只对登录账号有效**）。别人的历史拿不到 —— 调用方必须自己保证。
 * 返回含 progress/duration，用来区分"看完"和"点开就退"。
 */
export async function fetchHistory(cred, { maxItems = 60 } = {}) {
  const out = []
  let max = 0
  let viewAt = 0
  while (out.length < maxItems) {
    const j = await jget(cred, `https://api.bilibili.com/x/web-interface/history/cursor?max=${max}&view_at=${viewAt}&business=`,
      'https://www.bilibili.com/account/history')
    if (j?.code !== 0) return { items: out, error: `code=${j?.code} ${j?.message ?? ''}`.slice(0, 60) }
    const list = j?.data?.list ?? []
    if (!list.length) break
    for (const h of list) {
      const hb = h?.history ?? {}
      if (!hb.bvid || hb.business !== 'archive') continue
      out.push({
        bv: hb.bvid, title: String(h.title ?? ''), up: String(h.author_name ?? ''),
        viewAt: Number(h.view_at ?? 0), progress: Number(h.progress ?? 0), duration: Number(h.duration ?? 0),
      })
      if (out.length >= maxItems) break
    }
    const c = j?.data?.cursor ?? {}
    if (!c.max) break
    max = c.max
    viewAt = c.view_at
    await sleep(350)
  }
  return { items: out }
}

/**
 * 同步整份口味档案。
 * @param {object} p
 * @param {object} p.cred      凭据
 * @param {string} p.selfMid   登录账号 mid（历史只能读它）
 * @param {string} p.ownerMid  主人 mid（公开收藏/关注）
 * @param {object} p.cfg       taste 配置
 */
export async function syncTaste({ cred, selfMid, ownerMid, cfg = {} }) {
  const c = { ...DEFAULTS, ...cfg }
  const errors = []
  const out = { syncedAt: Date.now(), meta: { selfWeight: c.selfWeight }, owner: null, self: null, errors }

  const readAccount = async (mid, { isSelf }) => {
    const acct = { mid: String(mid), following: [], favorites: [], history: [] }
    if (c.useFollowing) {
      const r = await fetchFollowing(cred, mid)
      acct.following = r.items
      if (r.error) errors.push(`关注(${mid})：${r.error}${r.total ? `（总数 ${r.total}，只拿到公开部分）` : ''}`)
      await sleep(300)
    }
    if (c.useFavorites) {
      const fr = await fetchFavFolders(cred, mid)
      if (fr.error) errors.push(`收藏夹(${mid})：${fr.error}`)
      const folders = (fr.items ?? []).sort((a, b) => b.count - a.count).slice(0, Math.max(1, Number(c.maxFolders) || 20))
      acct.folders = folders
      let budget = Math.max(20, Number(c.maxFavItems) || 200)
      for (const folder of folders) {
        if (budget <= 0) break
        const per = Math.min(20, budget)
        const ir = await fetchFavItems(cred, folder, { maxItems: per, mid })
        if (ir.error) errors.push(`收藏内容(${folder.title})：${ir.error}`)
        acct.favorites.push(...ir.items)
        budget -= ir.items.length
        await sleep(300)
      }
      // 同一个 BV 可能被收进多个夹：按 BV 去重，保留先出现的（夹名不丢：拼起来）
      const seen = new Map()
      for (const f of acct.favorites) {
        const prev = seen.get(f.bv)
        if (prev) { if (f.folder && !String(prev.folder).includes(f.folder)) prev.folder += '/' + f.folder }
        else seen.set(f.bv, { ...f })
      }
      acct.favorites = [...seen.values()]
    }
    if (isSelf && c.useHistory) {
      const hr = await fetchHistory(cred, { maxItems: Number(c.maxHistory) || 60 })
      if (hr.error) errors.push(`历史：${hr.error}`)
      const since = Date.now() - Math.max(1, Number(c.recentDays) || 30) * 86400000
      acct.history = hr.items.filter((h) => (h.viewAt ? h.viewAt * 1000 : Date.now()) >= since)
    }
    return acct
  }

  if (c.owner && ownerMid && String(ownerMid) !== String(selfMid)) {
    out.owner = await readAccount(ownerMid, { isSelf: false })
  }
  if (c.self && selfMid) {
    out.self = await readAccount(selfMid, { isSelf: true })
  }
  out.index = (() => {
    const idx = tasteIndex(out)
    return {
      followMids: [...idx.followMids],
      favoriteBvs: [...idx.favoriteBvs],
      historyBvs: [...idx.historyBvs],
      topics: [...idx.topicWeights.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80),
    }
  })()
  return out
}

/** 同步摘要（给 CLI / 唤醒提示用；不带前缀，调用方自己加）。 */
export function tasteSummary(t) {
  if (!t) return '还没有口味档案 —— 跑 `node bili.mjs taste sync`'
  const o = t.owner ?? {}, s = t.self ?? {}
  const age = tasteAgeHours(t)
  const idx = t.index ?? {}
  return `主人 关注 ${o.following?.length ?? 0} / 收藏 ${o.favorites?.length ?? 0}；自己 收藏 ${s.favorites?.length ?? 0} / 历史 ${s.history?.length ?? 0}；` +
    `主题词 ${idx.topics?.length ?? 0} 个 · 同步于 ${age === null ? '从未' : age < 1 ? '刚刚' : age.toFixed(1) + ' 小时前'}`
}
