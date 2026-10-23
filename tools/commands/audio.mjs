// 只取音频 CLI —— 2026-10-21 v0.6
//
// 用法: node bili.mjs audio <BV|视频链接> [--out 目录] [--no-wav] [--force] [--json]
//
// 干什么：走 dash 音频流（192k 优先）→ 存 <BV>.m4a → ffmpeg 转 16kHz 单声道 wav。
// 为什么：本地 ASR 只要声音。一条 20 分钟的视频，音频 ~11MB，视频却要上百 MB。
import fs from 'node:fs'
import path from 'node:path'
import { ensureAudio, AUDIO_DIR } from '../lib/audio.mjs'
import { pickBv } from '../lib/watchlist.mjs'

const argv = process.argv.slice(2)
const raw = argv.find((a) => !a.startsWith('--')) ?? ''
const opt = {}
for (let i = 0; i < argv.length; i += 1) {
  if (!argv[i].startsWith('--')) continue
  const key = argv[i].slice(2)
  const next = argv[i + 1]
  if (next === undefined || String(next).startsWith('--')) { opt[key] = true; continue }
  opt[key] = next
  i += 1
}

const bvid = pickBv(raw)
if (!bvid) {
  console.error('用法: audio <BV|视频链接> [--out 目录] [--no-wav] [--force] [--json]')
  process.exit(2)
}

const HOME = process.env.USERPROFILE || process.env.HOME || '.'
let cred
try { cred = JSON.parse(fs.readFileSync(path.join(HOME, '.bili-ai', 'credentials.json'), 'utf8')) } catch {
  console.error('读不到凭据（~/.bili-ai/credentials.json）—— 先去设置页填 cookie')
  process.exit(3)
}

const dir = typeof opt.out === 'string' ? opt.out : AUDIO_DIR
const r = await ensureAudio(cred, bvid, { dir, wantWav: !opt['no-wav'], force: !!opt.force })
if (!r.ok) {
  console.error(`取音频失败：${r.error ?? '未知原因'}`)
  process.exit(4)
}

const kb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`
if (opt.json) {
  console.log(JSON.stringify({
    bv: bvid, title: r.title, up: r.up, duration: r.duration,
    m4a: r.m4a?.file, wav: r.wav?.file, bytes: r.m4a?.bytes, quality: r.m4a?.quality,
  }, null, 2))
  process.exit(0)
}

console.log(`标题: ${r.title}`)
console.log(`UP: ${r.up}   时长: ${Math.floor(r.duration / 60)}:${String(r.duration % 60).padStart(2, '0')}`)
console.log(`音频: ${r.m4a.file}（${kb(r.m4a.bytes)}${r.m4a.cached ? '，复用' : ''}，id=${r.m4a.quality ?? '-'}）`)
if (r.wav) console.log(`WAV : ${r.wav.file}（${kb(r.wav.bytes)}，16kHz 单声道${r.wav.cached ? '，复用' : ''}）`)
console.log('\n（下一步：node bili.mjs asr ' + bvid + ' —— 本地转写）')
