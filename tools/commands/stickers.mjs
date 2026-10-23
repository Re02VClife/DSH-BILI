// 贴纸库的命令行入口
//
//   node bili.mjs stickers sync --dir "C:\…\表情包" [--tags tags.json]   # 扫目录、写索引（标签会继承）
//   node bili.mjs stickers list [--tag 无语]                            # 看有哪些 / 按标签筛
//   node bili.mjs stickers show 悠闲                                    # 确认名字 + 标签 + 描述
//   node bili.mjs stickers tag 悠闲 摆烂,泡澡 --desc "泡在碗里"           # 改标签
//
// 注意：这些图**只能**用在私信（dm --image）和动态（dynamic-image --image），
//       评论区发不了自定义图 ✗（评论只有官方表情包的转义符）
import { scan, load, find, byTag, allTags, setTags, LIB_PATH } from '../lib/stickers.mjs'

const argv = process.argv.slice(2)
const cmd = argv[0] ?? 'list'
const flag = (name, fallback = '') => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}

if (cmd === 'sync') {
  const lib = load()
  const dir = flag('dir', lib?.dir ?? '')
  if (!dir) { console.error('用法: stickers sync --dir "<表情包目录>" [--tags <tags.json>]'); process.exit(2) }
  const out = scan(dir, flag('tags', ''))
  console.log(`✓ 已索引 ${out.stickers.length} 张贴纸 → ${LIB_PATH}`)
  console.log(`  目录：${out.dir}`)
  for (const s of out.stickers) {
    console.log(`  · ${s.name.padEnd(20)} ${s.type} ${String(s.width).padStart(4)}x${String(s.height).padEnd(4)} ${(s.bytes / 1024).toFixed(0)}KB  ${(s.tags ?? []).join('/')}`)
  }
  process.exit(0)
}

if (cmd === 'tag') {
  const name = argv[1]
  const tags = String(argv[2] ?? '').split(/[,，\s]+/).filter(Boolean)
  if (!name || !tags.length) { console.error('用法: stickers tag <名字> 标签1,标签2 [--desc "…"]'); process.exit(2) }
  try {
    const s = setTags(name, tags, flag('desc', undefined))
    console.log(`✓ ${s.name} → ${s.tags.join(' / ')}${s.desc ? '  「' + s.desc + '」' : ''}`)
  } catch (e) { console.error('✗ ' + e.message); process.exit(2) }
  process.exit(0)
}

if (cmd === 'show') {
  const want = argv[1]
  if (!want) { console.error('用法: stickers show <名字>'); process.exit(2) }
  const s = find(want)
  if (!s) { console.error(`✗ 没有叫「${want}」的贴纸 —— 先 stickers sync，或 stickers list 看看`); process.exit(2) }
  console.log(`✓ ${s.name}  ${s.type} ${s.width}x${s.height} ${(s.bytes / 1024).toFixed(0)}KB`)
  console.log(`  标签：${(s.tags ?? []).join(' / ') || '(无)'}`)
  if (s.desc) console.log(`  描述：${s.desc}`)
  console.log(`  文件：${s.path}`)
  if (!['png', 'jpg', 'gif'].includes(s.type)) console.error('✗ 这个格式 B 站不收（只能 png/jpg/gif）')
  process.exit(0)
}

const lib = load()
if (!lib) { console.error('还没有贴纸库 → 先跑：node bili.mjs stickers sync --dir "<目录>"'); process.exit(2) }

const tag = flag('tag', '')
const rows = tag ? byTag(tag) : lib.stickers
console.log(`贴纸库：${lib.stickers.length} 张（${lib.dir}）${tag ? ` · 标签「${tag}」→ ${rows.length} 张` : ''}`)
for (const s of rows) {
  console.log(`  · ${s.name.padEnd(20)} ${(s.tags ?? []).join('/') || '-'}${s.desc ? '  ' + s.desc : ''}`)
}
if (!tag) console.log(`\n全部标签：${allTags().join(' ')}`)
console.log(`\n发私信：node bili.mjs dm --image "<名字>" --dry | --go`)
