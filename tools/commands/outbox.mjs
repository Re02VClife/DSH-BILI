// 私信收件箱 CLI —— 2026-10-21 v0.7
//
// 用法:
//   node bili.mjs outbox list [--status pending] [--json]
//   node bili.mjs outbox add --text "…" [--bv BV…] [--title "…"] [--kind dm]
//   node bili.mjs outbox post <id> [--bv BV…] [--text-file 路径] --go
//   node bili.mjs outbox reject <id> [--reason "…"]
//   node bili.mjs outbox delete <id>
//
// 发评论只在 **主人点** 的时候发生（DSH 窗口里点按钮 = 走这条 CLI 的 post --go）。
// 它走 `comment` 且**不带 --auto**：这是主人授权的发言，不占"她自主发言"的每日额度 ✓
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  loadOutbox, saveOutbox, addItem, patchItem, setStatus, findItem, effectiveText, stats, normalizeBv, clampText,
  normalizeEmotes, emotesOf,
} from '../lib/outbox.mjs'
import { loadTasks, saveTasks, setTaskStatus, syncFromDraft } from '../lib/tasks.mjs'
import { detect as detectEmotes } from '../lib/emotes.mjs'
import { find as findSticker } from '../lib/stickers.mjs'
import { uploadImage } from '../lib/upload.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BILI = path.join(HERE, '..', 'bili.mjs')
const HOME = process.env.USERPROFILE || process.env.HOME || '.'

const argv = process.argv.slice(2)
const cmd = argv[0]
const opt = {}
// 2026-10-21 v0.9：--emote 可重复（一条评论最多 3 个表情）
const emoteArgs = []
for (let i = 1; i < argv.length; i += 1) {
  if (!argv[i].startsWith('--')) continue
  const key = argv[i].slice(2)
  const next = argv[i + 1]
  if (key === 'emote') {
    if (next !== undefined && !String(next).startsWith('--')) { emoteArgs.push(next); i += 1 } else opt.emote = true
    continue
  }
  if (next === undefined || String(next).startsWith('--')) { opt[key] = true; continue }
  opt[key] = next
  i += 1
}
const pos = argv.slice(1).find((a) => !a.startsWith('--')) ?? ''

const readText = () => {
  if (typeof opt['text-file'] === 'string') {
    try { return fs.readFileSync(opt['text-file'], 'utf8') } catch (e) { console.error(`读不到 --text-file：${e.message}`); process.exit(2) }
  }
  return typeof opt.text === 'string' ? opt.text : ''
}

function fmtTime(iso) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('zh-CN', { hour12: false })
}

const data = loadOutbox()

if (cmd === 'list' || !cmd) {
  const wanted = typeof opt.status === 'string' ? opt.status : ''
  const items = (data.items ?? []).filter((x) => !wanted || x.status === wanted)
  if (opt.json) { console.log(JSON.stringify({ stats: stats(data), items }, null, 2)); process.exit(0) }
  const s = stats(data)
  console.log(`私信收件箱（${s.pending} 待审 / ${s.posted} 已发 / ${s.rejected} 已否 / 共 ${s.total}）`)
  for (const x of items.slice(0, 30)) {
    const badge = { pending: '待审', posted: '已发', rejected: '已否', archived: '归档' }[x.status] ?? x.status
    console.log(`  [${badge}] ${x.id}  ${fmtTime(x.at)}  ${x.bv ? x.bv + '  ' : ''}${String(effectiveText(x)).replace(/\s+/g, ' ').slice(0, 50)}`)
  }
  if (!items.length) console.log('（空 —— 她发给你的私信会自动出现在这里）')
  process.exit(0)
}

if (cmd === 'add') {
  const text = readText()
  const { item, created } = addItem(data, {
    text, bv: typeof opt.bv === 'string' ? opt.bv : '', title: typeof opt.title === 'string' ? opt.title : '',
    kind: typeof opt.kind === 'string' ? opt.kind : 'manual', note: typeof opt.note === 'string' ? opt.note : '',
  })
  if (!item) { console.error('正文是空的'); process.exit(2) }
  saveOutbox(data)
  console.log(`${created ? '✓ 已入箱' : '（10 分钟内同一条，已合并）'}：${item.id}`)
  process.exit(0)
}

if (cmd === 'post') {
  if (!pos) { console.error('用法: outbox post <id> [--bv BV…] [--text-file 路径] --go'); process.exit(2) }
  if (!opt.go) { console.error('发评论必须显式 --go（窗口里点按钮 = 已经确认过）'); process.exit(2) }
  const item = findItem(data, pos)
  if (!item) { console.error(`没有这条：${pos}`); process.exit(3) }
  if (item.status === 'posted') { console.error(`已经发过了（rpid=${item.rpid ?? '?'}）`); process.exit(3) }

  const bv = normalizeBv(opt.bv) || item.bv
  if (!bv) { console.error('没有目标视频：给 --bv，或在窗口里填一个 BV'); process.exit(2) }
  let text = clampText(readText() || effectiveText(item))
  if (!text) { console.error('正文是空的'); process.exit(2) }

  // aid 是 comment 接口的必填（oid），从 view 拿
  let aid = ''
  let cred = {}
  try {
    cred = JSON.parse(fs.readFileSync(path.join(HOME, '.bili-ai', 'credentials.json'), 'utf8'))
    const r = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bv}`, {
      headers: { 'user-agent': 'Mozilla/5.0', referer: `https://www.bilibili.com/video/${bv}/`, cookie: `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}` },
    })
    const j = await r.json()
    if (j?.code !== 0 || !j?.data?.aid) { console.error(`拿不到 ${bv} 的 aid：code=${j?.code} ${j?.message ?? ''}`); process.exit(4) }
    aid = String(j.data.aid)
  } catch (e) { console.error(`取 aid 失败：${e.message}`); process.exit(4) }

  console.log(`[outbox] 发评论 → ${bv}（aid ${aid}）${text.length} 字`)
  // v0.8：表情要两份 —— 正文里的 `[笑哭]` + 请求里的 emote 元数据（缺一份就变纯文本 ✗）
  // v0.9：支持多个（最多 3 个）；命令行临时给的 --emote 优先；都没有就从正文里认（库里有才算）
  let emotes = normalizeEmotes(emoteArgs.length ? emoteArgs : emotesOf(item))
  if (!emotes.length) emotes = detectEmotes(text)
  const cArgs = [
    BILI, 'comment', '--oid', aid, '--bvid', bv, '--message', text,
    ...emotes.flatMap((e) => ['--emote', `[${e}]`]),
    '--go',
  ]
  if (emotes.length) console.log(`[outbox] 带表情：${emotes.map((e) => '[' + e + ']').join('')}`)

  // 2026-10-22：**评论带图**（B站 支持，评论条目里就是 content.pictures）
  //   先传 CDN 拿 img_src，再把 {img_src,img_width,img_height,img_size} 塞进 pictures 字段。
  //   发完回读 content.pictures；一张都没进 → 当场删掉这条评论（不留一条没有图的评论）
  let pictureFile = ''
  let picCount = 0
  if ((item.stickers ?? []).length) {
    const pics = []
    for (const name of item.stickers) {
      const s = findSticker(name)
      if (!s) { console.warn(`⚠️ 找不到贴纸「${name}」—— 先 node bili.mjs stickers sync --dir "<目录>"`); continue }
      try {
        const up = await uploadImage(s, cred)
        pics.push({ img_src: up.url, img_width: up.width || 0, img_height: up.height || 0, img_size: up.size || 0 })
      } catch (e) { console.warn(`⚠️ 贴纸「${name}」上传失败：${e.message}`) }
    }
    picCount = pics.length
    if (picCount) {
      pictureFile = path.join(os.tmpdir(), `whale-pic-${Date.now()}-${process.pid}.json`)
      fs.writeFileSync(pictureFile, JSON.stringify(pics), 'utf8')
      cArgs.splice(cArgs.length - 1, 0, '--picture-file', pictureFile)
      console.log(`[图片] 已上传 ${picCount} 张 → 评论带图（pictures 字段）`)
    }
  }
  // @ 谁：B站 评论没有 @ 参数，@ 就是正文里的文字 —— 这里只提示"发完怎么核对"
  if ((item.mentions ?? []).length) {
    console.log(`[outbox] @ 了 ${item.mentions.map((n) => '@' + n).join(' ')} —— 名字必须和对方现有昵称一致；`)
    console.log(`         发完可跑 node bili.mjs thread --aid ${aid} --rpid <rpid> 看「@到」有没有解析出来 ✓`)
  }
  const r = spawnSync(process.execPath, cArgs, { encoding: 'utf8', timeout: 120000 })
  try { if (pictureFile) fs.unlinkSync(pictureFile) } catch {}
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
  console.log(out.trim().split('\n').slice(-6).join('\n'))
  const rpid = (out.match(/rpid=(\d+)/) ?? [])[1] ?? null
  const ok = r.status === 0 && /已发布/.test(out)
  // 图片一张都没进评论（服务端没认 pictures）→ 立刻删掉这条评论（不留一条没图的评论 ✓）
  const picDrop = Number((out.match(/PIC_DROP=(\d+)/) ?? [])[1] ?? 0)
  if (ok && picCount && picDrop >= picCount) {
    console.warn('⚠️ 图片没进评论 —— 正在删掉刚发的评论（不然只剩一条纯文字的）')
    let delOk = false
    if (rpid) {
      const d = spawnSync(process.execPath, [BILI, 'comment-del', '--oid', aid, '--rpid', String(rpid), '--bvid', bv, '--go'], { encoding: 'utf8', timeout: 60000 })
      delOk = d.status === 0 && /code=0/.test(`${d.stdout ?? ''}`)
      console.warn(`  删除 ${delOk ? '✓ 成功' : '✗ 失败（请手动删 rpid=' + rpid + '）'}`)
    }
    setStatus(data, item.id, 'pending', {
      error: delOk ? '评论带图没被接受（这条评论已自动删除）；可去掉配图再发，或改发私信/动态'
        : `图片没被接受，且删除失败，请手动删 rpid=${rpid}`,
    })
    saveOutbox(data)
    process.exit(7)
  }
  if (ok && picCount && picDrop > 0) {
    console.warn(`⚠️ 只进了 ${picCount - picDrop}/${picCount} 张图（服务端截断了），评论已保留`)
  }
  if (ok) {
    setStatus(data, item.id, 'posted', { rpid })
    patchItem(data, item.id, { text })
    saveOutbox(data)
    // v0.8：这条是任务交的稿 → 任务也标记成「已发评论」（窗口里两边状态一致 ✓）
    if (item.taskId) {
      try {
        const td = loadTasks()
        if (setTaskStatus(td, item.taskId, 'posted')) saveTasks(td)
      } catch { /* 任务账坏了不影响已经发出去的评论 */ }
    }
    console.log(`✓ 已发布并记账：${item.id}${rpid ? `（rpid=${rpid}）` : ''}`)
    console.log(`  https://www.bilibili.com/video/${bv}/#reply${rpid ?? ''}`)
    process.exit(0)
  }
  setStatus(data, item.id, 'pending', { error: clampText(out.slice(-300), 300) })
  saveOutbox(data)
  console.error('✗ 没发出去（状态仍是「待审」，错误已记在条目上）')
  process.exit(6)
}

if (cmd === 'reject') {
  if (!pos) { console.error('用法: outbox reject <id> [--reason "…"]'); process.exit(2) }
  const item = setStatus(data, pos, 'rejected', { error: typeof opt.reason === 'string' ? opt.reason : '' })
  if (!item) { console.error(`没有这条：${pos}`); process.exit(3) }
  saveOutbox(data)
  try { syncFromDraft(item, 'rejected') } catch {}   // 任务交的稿被否 → 任务也「已取消」
  console.log(`✓ 已否：${pos}`)
  process.exit(0)
}

if (cmd === 'delete') {
  if (!pos) { console.error('用法: outbox delete <id>'); process.exit(2) }
  const gone = findItem(data, pos)
  const before = data.items.length
  data.items = data.items.filter((x) => x.id !== pos)
  if (data.items.length === before) { console.error(`没有这条：${pos}`); process.exit(3) }
  saveOutbox(data)
  try { if (gone) syncFromDraft(gone, 'deleted') } catch {}   // 草稿删了 → 任务退回排队
  console.log(`✓ 已删除：${pos}`)
  process.exit(0)
}

console.error('用法: outbox list [--status pending] [--json] | add --text "…" [--bv BV] | post <id> [--bv BV] --go | reject <id> | delete <id>')
process.exit(2)
