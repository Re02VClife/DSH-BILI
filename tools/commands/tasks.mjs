// 任务台 CLI —— 2026-10-21 v0.8
//
// 用法:
//   node bili.mjs task list [--status todo] [--json]
//   node bili.mjs task add --bv BV… [--format outline|timeline|opinion|banter|links|custom]
//                          [--chars 280] [--instruction "额外要求"] [--emote] [--mention]
//   node bili.mjs task take <id>        # 领活：状态→running，并打印"怎么干"的说明
//   node bili.mjs task prompt <id>      # 只看说明，不改状态
//   node bili.mjs task draft <id> --text-file 路径 [--emote 笑哭]   # 交稿：进私信窗口待审
//   node bili.mjs task fail <id> --reason "…"
//   node bili.mjs task cancel <id> | rm <id> | status
//
// ⚠️ 这里**没有**"发评论"这个命令 —— 发不发是主人在窗口里点的事 ✓
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../lib/config.mjs'
import {
  loadTasks, saveTasks, addTask, findTask, claimTask, linkDraft, setTaskStatus, nextTodo,
  taskStats, staleIds, buildTaskPrompt, formatOf, FORMATS, STATUS_LABEL,
} from '../lib/tasks.mjs'
import { loadOutbox, saveOutbox, addItem, patchItem, setStatus, findItem, clampText, normalizeEmotes, normalizeMentions, normalizeStickers } from '../lib/outbox.mjs'
import { detect as detectEmotes } from '../lib/emotes.mjs'

const argv = process.argv.slice(2)
const cmd = argv[0]
const opt = {}
// 2026-10-21 v0.9：`--emote` / `--mention` 是**可重复**的（一条评论最多 3 个表情、5 个人）
//   老写法 `opt[key] = value` 会把重复的键覆盖掉 → 只剩最后一个 ✗
const multi = { emote: [], mention: [] }
for (let i = 1; i < argv.length; i += 1) {
  if (!argv[i].startsWith('--')) continue
  const key = argv[i].slice(2)
  const next = argv[i + 1]
  const bare = next === undefined || String(next).startsWith('--')
  if (key in multi) {
    if (bare) { opt[`${key}-flag`] = true; continue }
    multi[key].push(next)
    i += 1
    continue
  }
  if (bare) { opt[key] = true; continue }
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
const fmtTime = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('zh-CN', { hour12: false })
}
const ownerName = () => { try { return String(config().owner?.name ?? '') } catch { return '' } }

const data = loadTasks()

if (cmd === 'list' || !cmd) {
  const wanted = typeof opt.status === 'string' ? opt.status : ''
  const items = (data.tasks ?? []).filter((x) => !wanted || x.status === wanted)
  const stale = new Set(staleIds(data))
  if (opt.json) { console.log(JSON.stringify({ stats: taskStats(data), tasks: items }, null, 2)); process.exit(0) }
  const s = taskStats(data)
  console.log(`任务台（${s.todo} 排队 / ${s.running} 在做 / ${s.drafted} 待审 / ${s.posted} 已发 / 共 ${s.total}）`)
  for (const x of items.slice(0, 30)) {
    const f = formatOf(x.format)
    console.log(
      `  [${STATUS_LABEL[x.status] ?? x.status}${stale.has(x.id) ? '·像卡住了' : ''}] ${x.id}  ${x.bv}  ${f.label}  ≤${x.chars}字  ${fmtTime(x.at)}` +
      ((x.emotes ?? []).length ? `  表情 ${x.emotes.map((e) => '[' + e + ']').join('')}` : '') +
      (x.title ? `  《${x.title}》` : '') + (x.error ? `  ✗ ${x.error}` : ''),
    )
  }
  if (!items.length) console.log('（还没有任务 —— 在 DSH「鱼的私信 · 任务台」里派一个，或者用 task add）')
  const n = nextTodo(data)
  if (n) console.log(`\n下一个该做的：${n.id}（${n.bv} · ${formatOf(n.format).label}）→ node bili.mjs task take ${n.id}`)
  process.exit(0)
}

if (cmd === 'formats') {
  for (const f of FORMATS) console.log(`  ${f.id.padEnd(9)} ${f.label.padEnd(6)} ≤${String(f.chars).padEnd(4)}字  ${f.hint}`)
  process.exit(0)
}

if (cmd === 'add') {
  const { task, created, error } = addTask(data, {
    bv: typeof opt.bv === 'string' ? opt.bv : pos,
    format: typeof opt.format === 'string' ? opt.format : '',
    chars: opt.chars,
    instruction: typeof opt.instruction === 'string' ? opt.instruction : (typeof opt.text === 'string' ? opt.text : ''),
    emote: !!opt['emote-flag'] || multi.emote.length > 0,
    // 给了名字 = 指定这几个（`--emote doge --emote 大哭`）；只给裸旗标 = 允许她自己挑
    emotes: multi.emote,
    mentionOwner: !!opt['mention-flag'],
    mentions: multi.mention,
  })
  if (error) { console.error(error); process.exit(2) }
  saveTasks(data)
  if (!created) {
    console.log(`（同一条视频 + 同一个格式还在队列里，没重复排）：${task.id} [${STATUS_LABEL[task.status]}]`)
    process.exit(0)
  }
  console.log(`✓ 已排队：${task.id}  ${task.bv} · ${formatOf(task.format).label} · ≤${task.chars}字`)
  console.log(`  她下一次醒来会先做它；想立刻做：node bili.mjs task take ${task.id}`)
  process.exit(0)
}

if (cmd === 'prompt' || cmd === 'take') {
  if (!pos) { console.error(`用法: task ${cmd} <id>`); process.exit(2) }
  const task = cmd === 'take' ? claimTask(data, pos) : findTask(data, pos)
  if (!task) { console.error(`没有这个任务：${pos}${cmd === 'take' ? '（或者它已经发过了）' : ''}`); process.exit(3) }
  if (cmd === 'take') saveTasks(data)
  console.log(buildTaskPrompt(task, { ownerName: ownerName() }))
  process.exit(0)
}

if (cmd === 'draft') {
  if (!pos) { console.error('用法: task draft <id> --text-file 路径'); process.exit(2) }
  const task = findTask(data, pos)
  if (!task) { console.error(`没有这个任务：${pos}`); process.exit(3) }
  const text = clampText(readText())
  if (!text) { console.error('正文是空的（--text-file 或者 --text）'); process.exit(2) }

  const ob = loadOutbox()
  // 表情：任务里**指定**的几个必须带上；她另外挑的（或正文里认出来的）也收，最多 3 个
  const specified = task.emotes ?? []
  let emotes = normalizeEmotes([...specified, ...(multi.emote.length ? multi.emote : detectEmotes(text))])
  const missing = specified.filter((e) => !text.includes(`[${e}]`))
  if (missing.length) {
    console.warn(`⚠️ 主人指定的表情没写进正文：${missing.map((e) => '[' + e + ']').join('')} —— 只带元数据不会显示，正文里得出现这个转义符`)
  }
  const mentions = normalizeMentions([
    ...(task.mentionOwner ? [ownerName()] : []),
    ...(task.mentions ?? []),
    ...multi.mention,
  ])
  // 贴纸（主人指定自己的表情包）：跟着任务走 → 发布时作为评论图片附上（不需要正文里有转义符）
  const stickers = normalizeStickers(task.stickers ?? [])
  let item = task.draftId ? findItem(ob, task.draftId) : null
  if (item && item.status === 'posted') {
    console.error(`这条任务的草稿已经发出去了（rpid=${item.rpid ?? '?'}），不能再改 ✗`); process.exit(3)
  }
  if (item) {
    // 重写草稿：**只改 edited，原文留着**（跟窗口里改同一条路径 ✓）
    patchItem(ob, item.id, { text, bv: task.bv, emotes, mentions, stickers })
    if (item.status !== 'pending') setStatus(ob, item.id, 'pending')
  } else {
    const { item: created } = addItem(ob, {
      text, bv: task.bv, title: task.title, kind: 'task', dedupe: false, emotes, mentions, stickers,
      note: `任务 ${task.id} · ${formatOf(task.format).label}`,
      taskId: task.id,
    })
    item = created
  }
  if (!item) { console.error('没能入箱（正文空了？）'); process.exit(2) }
  saveOutbox(ob)
  linkDraft(data, task.id, item.id)
  saveTasks(data)
  console.log(`✓ 交稿：${task.id} → 私信收件箱 ${item.id}（${text.length} 字` +
    `${emotes.length ? `，表情 ${emotes.map((e) => '[' + e + ']').join('')}` : ''}` +
    `${mentions.length ? `，@ ${mentions.join(' ')}` : ''}，状态=待审）`)
  console.log('  DSH「鱼的私信」窗口里能看到；**我没有发出去** —— 发不发由主人点 ✓')
  process.exit(0)
}

if (cmd === 'fail') {
  if (!pos) { console.error('用法: task fail <id> --reason "…"'); process.exit(2) }
  const task = setTaskStatus(data, pos, 'failed', { error: typeof opt.reason === 'string' ? opt.reason : '没做成（没写原因）' })
  if (!task) { console.error(`没有这个任务：${pos}`); process.exit(3) }
  saveTasks(data)
  console.log(`✓ 已标记没做成：${pos}`)
  process.exit(0)
}

if (cmd === 'cancel') {
  if (!pos) { console.error('用法: task cancel <id>'); process.exit(2) }
  const task = setTaskStatus(data, pos, 'cancelled', {})
  if (!task) { console.error(`没有这个任务：${pos}`); process.exit(3) }
  saveTasks(data)
  console.log(`✓ 已取消：${pos}`)
  process.exit(0)
}

if (cmd === 'rm') {
  if (!pos) { console.error('用法: task rm <id>'); process.exit(2) }
  const before = data.tasks.length
  data.tasks = data.tasks.filter((x) => x.id !== pos)
  if (data.tasks.length === before) { console.error(`没有这个任务：${pos}`); process.exit(3) }
  saveTasks(data)
  console.log(`✓ 已删除：${pos}（草稿如果还在，去 outbox 里删 ✓）`)
  process.exit(0)
}

if (cmd === 'status') {
  const s = taskStats(data)
  console.log(`任务台：共 ${s.total} · 排队 ${s.todo} · 在做 ${s.running} · 写成草稿 ${s.drafted} · 已发 ${s.posted} · 没做成 ${s.failed} · 已取消 ${s.cancelled}`)
  const stale = staleIds(data)
  if (stale.length) console.log(`⚠️ 像是卡住了（running 超过 30 分钟）：${stale.join('、')}（重新 take 一次即可）`)
  process.exit(0)
}

console.error('用法: task list [--status todo] [--json] | add --bv BV [--format …] | take <id> | prompt <id> | draft <id> --text-file … [--emote 笑哭] | fail <id> --reason "…" | cancel <id> | rm <id> | status | formats')
process.exit(2)
