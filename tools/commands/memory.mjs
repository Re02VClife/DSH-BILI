// 记忆库（2026-10-26 v0.14）—— 把「要记住的事」从会话历史里挪到文件里。
//
// 为什么要有它：
//   1M 上下文一周用掉 40%，而压缩只是把旧历史换成摘要 —— 摘要再压缩，细节就没了。
//   根子上的问题不是窗口小，是**把上下文当仓库用**。
//   正确的结构是：会话里只放工作集（今天要干什么），记忆放在可检索的文件里，按需召回。
//
// 三份库 + 一份索引：
//   facts.md        事实：看过什么、得出什么结论（一行一条，带日期，可 grep）
//   people.md       人际：谁、什么时候、说过什么（按人分节）
//   open-loops.md   未完成：答应过的、想跟进的
//   index.md        自动汇总：最近 7 天 + 未完成 + 计数（每轮醒来只读这一份）
//
// 用法:
//   node bili.mjs memory add fact "..." [--tag AI] [--date 2026-10-26]
//   node bili.mjs memory add person <名字> "..." [--uid 412682542]
//   node bili.mjs memory add loop "..."
//   node bili.mjs memory done <关键词>        # 把一条未完成标记成做完
//   node bili.mjs memory search <词> [--n 20] # 三份库里搜行
//   node bili.mjs memory index                # 重建 index.md
//   node bili.mjs memory show                 # 打印 index.md
//   node bili.mjs memory stats
//
// ⚠️ 这里只做「记事实」。日记（叙事、情绪）仍然写 whale-diary.md，两套东西别混：
//   日记给人读，记忆库给检索。
import fs from 'node:fs'
import path from 'node:path'

const HOME = process.env.USERPROFILE || process.env.HOME || '.'
const DIR = process.env.WHALE_MEMORY_DIR || path.join(HOME, '.dsh', 'whale-memory')
const F = {
  facts: path.join(DIR, 'facts.md'),
  people: path.join(DIR, 'people.md'),
  loops: path.join(DIR, 'open-loops.md'),
  index: path.join(DIR, 'index.md'),
}

const argv = process.argv.slice(2)
const cmd = argv[0]
const opt = {}
const pos = []
for (let i = 1; i < argv.length; i += 1) {
  const a = argv[i]
  if (!a.startsWith('--')) { pos.push(a); continue }
  const k = a.slice(2)
  const next = argv[i + 1]
  if (next === undefined || String(next).startsWith('--')) { opt[k] = true; continue }
  opt[k] = next
  i += 1
}

const pad = (n) => String(n).padStart(2, '0')
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const read = (f) => { try { return fs.readFileSync(f, 'utf8') } catch { return '' } }
const write = (f, s) => fs.writeFileSync(f, s, 'utf8')
const wipe = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

const HEAD = {
  facts: '# 事实库 —— 一行一条，带日期。只写「查得到、以后还会用」的；不写情绪（那去日记）。\n\n',
  people: '# 人际库 —— 按人分节。记「谁说过什么、我怎么回的」，不记闲聊流水。\n\n',
  loops: '# 未完成 —— 答应过的、想跟进的。做完改成 `- [x]`（别删，留着当历史）。\n\n',
}

function ensure() {
  fs.mkdirSync(DIR, { recursive: true })
  for (const [k, f] of [['facts', F.facts], ['people', F.people], ['loops', F.loops]]) {
    if (!fs.existsSync(f)) write(f, HEAD[k])
  }
}

const line = (body, date, tag) => `- [${date || dayKey()}] ${wipe(body)}${tag ? ` #${wipe(tag).replace(/^#/, '')}` : ''}`

function appendFact(body, { date, tag } = {}) {
  ensure()
  const s = read(F.facts)
  const row = line(body, date, tag)
  if (s.split('\n').some((l) => l.trim() === row.trim())) return { dup: true, row }
  write(F.facts, s.replace(/\s*$/, '\n') + row + '\n')
  return { row }
}

function appendPerson(name, body, { date, uid } = {}) {
  ensure()
  const s = read(F.people)
  const head = `## ${wipe(name)}${uid ? `（UID ${uid}）` : ''}`
  const row = line(body, date)
  const lines = s.split('\n')
  const at = lines.findIndex((l) => l.trim() === head.trim())
  if (at >= 0) {
    let end = lines.length
    for (let i = at + 1; i < lines.length; i += 1) if (lines[i].startsWith('## ')) { end = i; break }
    const block = lines.slice(at, end)
    if (block.some((l) => l.trim() === row.trim())) return { dup: true, row }
    // 插在这一节最后一条记录之后
    let insertAt = at + 1
    for (let i = at + 1; i < end; i += 1) if (lines[i].trim().startsWith('- [')) insertAt = i + 1
    lines.splice(insertAt, 0, row)
    write(F.people, lines.join('\n'))
  } else {
    const sep = s.trim() ? '\n' : ''
    write(F.people, s.replace(/\s*$/, '\n') + sep + head + '\n' + row + '\n')
  }
  return { row }
}

function appendLoop(body, { date } = {}) {
  ensure()
  const s = read(F.loops)
  const row = line(body, date)
  if (s.split('\n').some((l) => l.trim() === row.trim())) return { dup: true, row }
  write(F.loops, s.replace(/\s*$/, '\n') + row + '\n')
  return { row }
}

/** 把含关键词的那条未完成改成 [x]；返回被改的行 */
function closeLoop(kw) {
  ensure()
  const s = read(F.loops)
  const lines = s.split('\n')
  let hit = null
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i]
    if (!l.startsWith('- [ ]') && !/^- \[\d{4}-\d{2}-\d{2}\]/.test(l)) continue
    if (!l.includes(kw)) continue
    hit = l
    // 保留原日期（`- [x] [2026-10-26] …`），别把时间信息弄丢
    const m = /^- \[(\d{4}-\d{2}-\d{2})\] (.*)$/.exec(l)
    lines[i] = m ? `- [x] [${m[1]}] ${m[2]}` : l.replace(/^- \[[^\]]*\]/, '- [x]')
    break
  }
  if (!hit) return null
  write(F.loops, lines.join('\n'))
  return hit
}

const FACT_RE = /^- \[(\d{4}-\d{2}-\d{2})\] (.+)$/

function parseFacts() {
  return read(F.facts).split('\n').map((l) => l.trim()).filter((l) => FACT_RE.test(l))
    .map((l) => { const m = FACT_RE.exec(l); return { date: m[1], text: m[2] } })
}

function parseLoops() {
  return read(F.loops).split('\n').map((l) => l.trim()).filter((l) => l.startsWith('- ['))
    .map((l) => {
      // 做完的：`- [x] [2026-10-26] 内容`（done 时保留了原日期）
      const doneM = /^- \[x\] \[(\d{4}-\d{2}-\d{2})\] (.+)$/.exec(l)
      if (doneM) return { done: true, date: doneM[1], text: doneM[2] }
      // 没做的：`- [2026-10-26] 内容`
      const openM = /^- \[(\d{4}-\d{2}-\d{2})\] (.+)$/.exec(l)
      if (openM) return { done: false, date: openM[1], text: openM[2] }
      return { done: false, date: '', text: l.replace(/^- \[[^\]]*\]\s*/, '') }
    })
}

function parsePeople() {
  const out = []
  let cur = null
  for (const raw of read(F.people).split('\n')) {
    const l = raw.trim()
    if (l.startsWith('## ')) { cur = { name: l.slice(3).trim(), rows: [] }; out.push(cur); continue }
    if (!cur) continue
    if (l.startsWith('- [')) cur.rows.push(l)
  }
  return out
}

function buildIndex() {
  ensure()
  const now = new Date()
  const cutoff = dayKey(new Date(now.getTime() - 7 * 86400000))
  const facts = parseFacts()
  const recent = facts.filter((f) => f.date >= cutoff)
  const loops = parseLoops()
  const open = loops.filter((l) => !l.done)
  const people = parsePeople()
  const shown = recent.slice(-15)
  const body = [
    '# 记忆索引（自动生成，别手改）',
    '',
    '> 每轮醒来只读这一份。要查细节：`node bili.mjs memory search <词>`。',
    '',
    `## 最近 7 天的事实（${recent.length} 条${recent.length > shown.length ? `，这里只列最近 ${shown.length}` : ''}）`,
    ...(shown.length ? shown.map((f) => `- [${f.date}] ${f.text}`) : ['- （还没有）']),
    '',
    `## 未完成（${open.length} 件）`,
    ...(open.length ? open.map((l) => `- [${l.date}] ${l.text}`) : ['- （没有）']),
    '',
    '## 人际',
    ...(people.length ? people.map((p) => `- ${p.name}：${p.rows.length} 条（\`memory search ${p.name.replace(/（.*$/, '')}\`）`) : ['- （还没有）']),
    '',
    '## 统计',
    `- 事实 ${facts.length} 条 · 人际 ${people.length} 人 · 未完成 ${open.length} 件`,
    `- 索引生成：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    '',
    '## 怎么用',
    '- 想找看过什么：`memory search 关键词`',
    '- 想找某人：`memory search 名字`',
    '- 收工时记事实：`memory add fact "…"`（一行一条，带日期）',
    '',
  ].join('\n')
  write(F.index, body)
  return { facts: facts.length, people: people.length, open: open.length, index: F.index }
}

function search(kw, n = 20) {
  ensure()
  const hits = []
  for (const [label, f] of [['fact', F.facts], ['person', F.people], ['loop', F.loops]]) {
    const lines = read(f).split('\n')
    lines.forEach((l, i) => {
      if (l.includes(kw)) hits.push({ label, line: l.trim(), n: i + 1 })
    })
  }
  return hits.slice(-n)
}

// ── 入口 ──────────────────────────────────────────────────────────────────
if (!cmd || cmd === 'help') {
  console.log([
    '用法: node bili.mjs memory <add|done|search|index|show|stats>',
    '  add fact "…" [--tag X] [--date YYYY-MM-DD]',
    '  add person <名字> "…" [--uid 123]',
    '  add loop "…"',
    '  done <关键词>',
    '  search <词> [--n 20]',
    '  index / show / stats',
  ].join('\n'))
  process.exit(cmd ? 0 : 2)
}

if (cmd === 'add') {
  const kind = pos[0]
  if (!kind) { console.error('add 什么？fact / person / loop'); process.exit(2) }
  if (kind === 'fact') {
    const body = pos.slice(1).join(' ')
    if (!body) { console.error('缺正文'); process.exit(2) }
    const r = appendFact(body, { date: typeof opt.date === 'string' ? opt.date : '', tag: typeof opt.tag === 'string' ? opt.tag : '' })
    console.log(r.dup ? '（已存在，没重复写）' : '✓ 已记进事实库')
    buildIndex()
    process.exit(0)
  }
  if (kind === 'person') {
    const name = pos[1]
    const body = pos.slice(2).join(' ')
    if (!name || !body) { console.error('用法: add person <名字> "…"'); process.exit(2) }
    const r = appendPerson(name, body, { date: typeof opt.date === 'string' ? opt.date : '', uid: opt.uid })
    console.log(r.dup ? '（已存在，没重复写）' : '✓ 已记进人际库')
    buildIndex()
    process.exit(0)
  }
  if (kind === 'loop') {
    const body = pos.slice(1).join(' ')
    if (!body) { console.error('缺正文'); process.exit(2) }
    appendLoop(body, { date: typeof opt.date === 'string' ? opt.date : '' })
    console.log('✓ 已记进未完成')
    buildIndex()
    process.exit(0)
  }
  console.error(`不认识: ${kind}`);
  process.exit(2)
}

if (cmd === 'done') {
  const kw = pos.join(' ')
  if (!kw) { console.error('用法: memory done <关键词>'); process.exit(2) }
  const hit = closeLoop(kw)
  if (!hit) { console.error(`没找到含「${kw}」的未完成`); process.exit(3) }
  console.log('✓ 标记完成：' + hit)
  buildIndex()
  process.exit(0)
}

if (cmd === 'search') {
  const kw = pos.join(' ')
  if (!kw) { console.error('用法: memory search <词>'); process.exit(2) }
  const hits = search(kw, Number(opt.n) || 20)
  if (!hits.length) { console.log(`没有含「${kw}」的记录`); process.exit(0) }
  for (const h of hits) console.log(`[${h.label}] ${h.line}`)
  process.exit(0)
}

if (cmd === 'index') {
  const r = buildIndex()
  console.log(`✓ 索引已重建：${r.index}（事实 ${r.facts} · 人际 ${r.people} · 未完成 ${r.open}）`)
  process.exit(0)
}

if (cmd === 'show') {
  ensure()
  const s = read(F.index)
  if (!s) { buildIndex() }
  console.log(read(F.index))
  process.exit(0)
}

if (cmd === 'stats') {
  ensure()
  const facts = parseFacts().length
  const people = parsePeople().length
  const open = parseLoops().filter((l) => !l.done).length
  console.log(`事实 ${facts} 条 · 人际 ${people} 人 · 未完成 ${open} 件`)
  console.log(`目录：${DIR}`)
  process.exit(0)
}

console.error(`未知子命令: ${cmd}（add / done / search / index / show / stats）`)
process.exit(2)
