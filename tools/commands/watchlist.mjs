// 指定清单 CLI —— 2026-10-21 v0.4
//
// 用法:
//   node bili.mjs watchlist list
//   node bili.mjs watchlist add up 123456 名字        （也收 space 链接）
//   node bili.mjs watchlist add video BV1xx411c7mD 备注
//   node bili.mjs watchlist rm 123456                  （mid 或 BV 都认）
//   node bili.mjs watchlist fetch [--per 8] [--json]   （真去拉一遍，看能不能取到）
//
// 只改 `watchlist` 这一块，其它配置原样保留（主人手改过的字段不能被我们抹掉 ✗）。
import fs from 'node:fs'
import path from 'node:path'
import { configPath } from '../lib/config.mjs'
import {
  normalizeWatchlist, parseUpLine, parseVideoLine, watchlistToText, resolveWatchlist, pickMid, pickBv, expandShortLink,
} from '../lib/watchlist.mjs'

const argv = process.argv.slice(2)
const cmd = argv[0]

function readRaw() {
  // ⚠️ 配置存在但读不出来时**必须停**：下一步是写回，拿 {} 覆盖会把主人的设置全抹掉 ✗
  if (!fs.existsSync(configPath)) return {}
  let text = ''
  try { text = fs.readFileSync(configPath, 'utf8') } catch (e) {
    console.error(`配置读不出来：${configPath}（${e.message}）`)
    process.exit(4)
  }
  try { return JSON.parse(text) } catch {
    console.error(`配置不是合法 JSON：${configPath}\n  先修好它，否则这条命令会把整份配置覆盖掉 ✗`)
    process.exit(4)
  }
}

function writeRaw(next) {
  const dir = path.dirname(configPath)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${configPath}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n')
  fs.renameSync(tmp, configPath)   // 先写临时文件再换名：写到一半断电也不会留下半份配置
}

if (cmd === 'list' || !cmd) {
  const raw = readRaw()
  const wl = normalizeWatchlist(raw.watchlist)
  console.log(`指定清单（${configPath}）`)
  console.log(`  指定 UP：${wl.ups.length} 个`)
  for (const u of wl.ups) console.log(`    · ${u.mid}${u.name ? '  ' + u.name : ''}`)
  console.log(`  指定视频：${wl.videos.length} 条`)
  for (const v of wl.videos) console.log(`    · ${v.bv}${v.note ? '  ' + v.note : ''}`)
  if (!wl.ups.length && !wl.videos.length) {
    console.log('\n（空 —— 加法：`watchlist add up 123456 名字` / `watchlist add video BV号 备注`）')
  }
  process.exit(0)
}

if (cmd === 'add') {
  const kind = argv[1]
  const rest = argv.slice(2)
  if (!kind || !rest.length) {
    console.error('用法: watchlist add up <mid|空间链接> [名字]  |  add video <BV|链接> [备注]')
    process.exit(2)
  }
  const raw = readRaw()
  const wl = normalizeWatchlist(raw.watchlist)
  // b23.tv 短链先展开再解析（设置页最常粘贴的就是它；CLI 也照办，口径一致 ✓）
  const line = await expandShortLink(rest.join(' '))

  if (kind === 'up') {
    const one = parseUpLine(line)
    if (!one) { console.error(`认不出 mid：${rest.join(' ')}（要 12 位数字 mid 或 space.bilibili.com/<mid> 链接）`); process.exit(2) }
    if (wl.ups.some((u) => u.mid === one.mid)) { console.log(`已经在清单里了：${one.mid}`); process.exit(0) }
    wl.ups.push(one)
    writeRaw({ ...raw, watchlist: wl })
    console.log(`✓ 已加指定 UP：${one.mid}${one.name ? '（' + one.name + '）' : '（没写名字 —— 空间接口不通时会取不到，建议补上）'}`)
  } else if (kind === 'video') {
    const one = parseVideoLine(line)
    if (!one) {
      console.error(`认不出 BV 号：${rest.join(' ')}`)
      console.error('  可贴：BV1xx411c7mD / https://www.bilibili.com/video/BV…/ / https://b23.tv/xxxx（会自动展开）')
      process.exit(2)
    }
    if (wl.videos.some((v) => v.bv === one.bv)) { console.log(`已经在清单里了：${one.bv}`); process.exit(0) }
    wl.videos.push(one)
    writeRaw({ ...raw, watchlist: wl })
    console.log(`✓ 已加指定视频：${one.bv}${one.note ? '（' + one.note + '）' : ''}`)
  } else {
    console.error(`未知类型 ${kind}（只有 up / video）`)
    process.exit(2)
  }
  process.exit(0)
}

if (cmd === 'rm') {
  const key = argv.slice(1).join(' ').trim()
  if (!key) { console.error('用法: watchlist rm <mid 或 BV>'); process.exit(2) }
  const raw = readRaw()
  const wl = normalizeWatchlist(raw.watchlist)
  const before = wl.ups.length + wl.videos.length
  // 给了 BV 就只删视频：BV 里也有数字（BV1xx411c7mD 的 411），不能拿它当 mid 去删 UP ✗
  const isBv = /BV[0-9A-Za-z]{10}/.test(key)
  const mid = isBv ? '' : pickMid(key)
  const bv = pickBv(key)
  const ups = mid ? wl.ups.filter((u) => u.mid !== mid) : wl.ups
  const videos = bv ? wl.videos.filter((v) => v.bv !== bv) : wl.videos
  if (ups.length + videos.length === before) { console.error(`清单里没有这一项：${key}`); process.exit(1) }
  writeRaw({ ...raw, watchlist: { ups, videos } })
  console.log(`✓ 已移除：${mid && ups.length < wl.ups.length ? 'UP ' + mid : '视频 ' + bv}`)
  process.exit(0)
}

if (cmd === 'fetch') {
  const per = Number((argv.find((a) => a.startsWith('--per=')) ?? '').split('=')[1] ?? 8)
  const asJson = argv.includes('--json')
  const raw = readRaw()
  const wl = normalizeWatchlist(raw.watchlist)
  if (!wl.ups.length && !wl.videos.length) {
    console.log('（清单是空的 —— 先 `watchlist add ...`）')
    process.exit(0)
  }
  let cred = {}
  try { cred = JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE || process.env.HOME || '.', '.bili-ai', 'credentials.json'), 'utf8')) } catch {
    console.error('读不到凭据（~/.bili-ai/credentials.json）—— 先去设置页填 cookie')
    process.exit(3)
  }
  const r = await resolveWatchlist(cred, wl, { perUp: per, log: (m) => console.error('  · ' + m) })
  if (asJson) { console.log(JSON.stringify(r.items, null, 2)); process.exit(0) }
  console.log(`取到 ${r.items.length} 条（UP ${r.counts.ups} / 视频 ${r.counts.videos}）`)
  for (const x of r.items) {
    const tag = x.kw === '指定视频' ? '视频' : 'UP'
    console.log(`  [${tag}] ${x.bv}  ${String(x.d).padStart(5)}s  播放 ${String(x.play).padStart(9)}  ${String(x.t).slice(0, 44)}  @${x.up}`)
  }
  if (r.errors.length) {
    console.log('\n有取不到的（这些不会静默失败，都会写进日记/日志）：')
    for (const e of r.errors) console.log('  ✗ ' + e)
  }
  console.log('\n（这是候选，不是已看。看它仍然是 `debrief <BV>` —— 预算由 budget 管 ✓）')
  process.exit(0)
}

console.error('用法: watchlist list | add up <mid|链接> [名字] | add video <BV|链接> [备注] | rm <mid|BV> | fetch [--per N] [--json]')
process.exit(2)
