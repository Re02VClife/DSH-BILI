// 人设成长记录（2026-10-26）—— AI 自己攒的「我对自己的理解」。
//
// 为什么单独一份：核心人设（~/AGENTS.md）是主人的决定，不该被 AI 随手改；
// 但"今天被夸了一句""看到一条很准的评论"这种经验，本来就该被她自己吸收。
// ⇒ core 不动，growth 只追加；攒到一定程度由主人决定要不要提进核心。
//
// 用法:
//   node bili.mjs persona add "…"     # 追加一条（自动带日期）
//   node bili.mjs persona show        # 打印全部
//   node bili.mjs persona tail [n]    # 最近 n 条（默认 8）
import fs from 'node:fs'
import path from 'node:path'

const HOME = process.env.USERPROFILE || process.env.HOME || '.'
const DSH = process.env.DSH_HOME || path.join(HOME, '.dsh')
const FILE = path.join(DSH, 'whale-persona-growth.md')

const HEAD = [
  '# 人设成长记录',
  '',
  '> 我（AI）自己攒的「我对自己的理解」。**只追加，不改核心人设**（AGENTS.md 是主人的决定）。',
  '> 每轮醒来读最近几条；好的条目主人会手动提进核心。',
  '',
].join('\n')

const argv = process.argv.slice(2)
const cmd = argv[0] || 'show'
const pad = (n) => String(n).padStart(2, '0')
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const read = () => { try { return fs.readFileSync(FILE, 'utf8') } catch { return '' } }
const ensure = () => {
  fs.mkdirSync(DSH, { recursive: true })
  if (!read()) fs.writeFileSync(FILE, HEAD, 'utf8')
}
const rows = (s) => s.split('\n').filter((l) => /^- \[\d{4}-\d{2}-\d{2}\]/.test(l.trim()))

if (cmd === 'add') {
  const body = argv.slice(1).join(' ').trim()
  if (!body) { console.error('用法: persona add "我对自己的新理解"'); process.exit(2) }
  ensure()
  const cur = read() || HEAD
  const row = `- [${dayKey()}] ${body.replace(/\s+/g, ' ')}`
  if (cur.includes(row)) { console.log('（已经有这一条，没重复写）'); process.exit(0) }
  fs.writeFileSync(FILE, cur.replace(/\s*$/, '\n') + row + '\n', 'utf8')
  console.log('✓ 已记进人设成长记录')
  process.exit(0)
}

if (cmd === 'show') {
  ensure()
  console.log(read())
  process.exit(0)
}

if (cmd === 'tail') {
  ensure()
  const n = Math.max(1, Math.min(Number(argv[1]) || 8, 50))
  const list = rows(read()).slice(-n)
  if (!list.length) { console.log('（还没有成长记录）'); process.exit(0) }
  console.log(list.join('\n'))
  process.exit(0)
}

console.error(`未知子命令: ${cmd}（add / show / tail）`)
process.exit(2)
