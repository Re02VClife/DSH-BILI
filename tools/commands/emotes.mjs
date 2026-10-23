// 表情库的命令行入口
//
//   node bili.mjs emotes sync                  # 拉一遍官方表情包，写 ~/.dsh/whale-emotes.json
//   node bili.mjs emotes list [--tag 笑] [--pkg 1] [--limit 20]
//   node bili.mjs emotes search 吃瓜           # 名字/别名/标签都能搜
//   node bili.mjs emotes pick --tag 无语 --n 3  # 按语义随机挑几个候选
//   node bili.mjs emotes show 笑哭            # 确认某个表情在库里（给 comment --emote 用）
//
// 标签是第一版粗分（见 tools/lib/emotes.mjs 的 TAG_RULES），可以手动改库文件里的 tags。
import { sync, load, search, pick, findByText, LIB_PATH } from '../lib/emotes.mjs'

const argv = process.argv.slice(2)
const cmd = argv[0] ?? 'list'
const flag = (name, fallback = '') => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const has = (name) => argv.includes(`--${name}`)
const num = (name, d) => { const n = Number(flag(name, '')); return Number.isFinite(n) && flag(name, '') !== '' ? n : d }

if (cmd === 'sync') {
  const r = await sync()
  console.log(`✓ 已同步 ${r.packages} 个表情包 / ${r.emotes} 个表情`)
  console.log(`  库文件：${r.path}`)
  const lib = load()
  for (const p of lib?.packages ?? []) console.log(`  · ${p.text}（${p.n}）`)
  process.exit(0)
}

if (cmd === 'show') {
  const want = argv[1]
  if (!want) { console.error('用法: emotes show <表情名，如 笑哭>'); process.exit(2) }
  const e = findByText(want)
  if (!e) {
    console.error(`✗ 库里没有 [${String(want).replace(/^\[|\]$/g, '')}] —— 先跑 emotes sync，或 emotes search 找找`)
    process.exit(2)
  }
  console.log(`✓ ${e.text}  id=${e.id}  package_id=${e.package_id}  type=${e.type}`)
  console.log(`  标签：${(e.tags ?? []).join(' / ') || '(无)'}`)
  console.log(`  图片：${e.url}`)
  process.exit(0)
}

const lib = load()
if (!lib) { console.error('本地还没有表情库 → 先跑：node bili.mjs emotes sync'); process.exit(2) }

if (cmd === 'search' || cmd === 'pick') {
  const kw = cmd === 'pick' ? flag('tag', '') : argv[1]
  if (!kw) { console.error(`用法: emotes ${cmd} ${cmd === 'pick' ? '--tag 笑' : '<关键词>'}`); process.exit(2) }
  const list = cmd === 'pick' ? pick(kw, num('n', 3)) : search(kw)
  if (!list.length) { console.error(`没找到跟「${kw}」相关的表情（标签有：${[...new Set(lib.emotes.flatMap((e) => e.tags ?? []))].join(' ')}）`); process.exit(1) }
  console.log(`${cmd === 'pick' ? '候选' : '匹配'} ${list.length} 个：`)
  for (const e of list) console.log(`  ${e.text.padEnd(16)} ${(e.tags ?? []).join(',')}`)
  process.exit(0)
}

// list
const tag = flag('tag', '')
const pkg = num('pkg', 0)
const limit = num('limit', 40)
let rows = lib.emotes
if (tag) rows = rows.filter((e) => (e.tags ?? []).includes(tag) || (e.tags ?? []).some((t) => t.includes(tag)))
if (pkg) rows = rows.filter((e) => e.package_id === pkg)
console.log(`库：${lib.emotes.length} 个表情（同步于 ${lib.syncedAt}）${tag ? ` · 标签「${tag}」` : ''}${pkg ? ` · 包 ${pkg}` : ''} → ${rows.length} 个`)
for (const e of rows.slice(0, limit)) console.log(`  ${e.text.padEnd(16)} ${(e.tags ?? []).join(',')}`)
if (rows.length > limit) console.log(`  … 还有 ${rows.length - limit} 个（--limit 调大）`)
console.log(`\n全部标签：${[...new Set(lib.emotes.flatMap((e) => e.tags ?? []))].join(' ')}`)
console.log(`库文件：${LIB_PATH}（tags 可以手改）`)
