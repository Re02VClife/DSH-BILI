// 本地转写 CLI —— 2026-10-21 v0.6
//
// 用法: node bili.mjs asr <BV|视频链接> [--device cpu|cuda:0] [--hotword "词1 词2"] [--json]
//
// 流程：音频（dash 192k）→ 16kHz wav → FunASR Paraformer-large + VAD + 标点 → [mm:ss] txt + srt
// 全部在本机：不上传音频，不调任何云服务。
//
// 依赖（一次性）：~/.bili-ai/asr-venv（torch CPU + funasr），见 README「本地转写」。
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ensureAudio } from '../lib/audio.mjs'
import { pickBv } from '../lib/watchlist.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PY_SCRIPT = path.join(HERE, '..', 'lib', 'asr.py')
const HOME = process.env.USERPROFILE || process.env.HOME || '.'
const VENV_PY = path.join(HOME, '.bili-ai', 'asr-venv', 'Scripts', 'python.exe')

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
  console.error('用法: asr <BV|视频链接> [--device cpu|cuda:0] [--hotword "词1 词2"] [--json]')
  process.exit(2)
}

if (!fs.existsSync(VENV_PY)) {
  console.error('还没装本地转写环境。一次性安装：')
  console.error('  powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\\.bili-ai\\asr-install.ps1"')
  console.error('（脚本会建 ~/.bili-ai/asr-venv 并装 torch CPU + funasr；模型首次运行时自动下载到 ~/.bili-ai/asr-models）')
  process.exit(3)
}

let cred
try { cred = JSON.parse(fs.readFileSync(path.join(HOME, '.bili-ai', 'credentials.json'), 'utf8')) } catch {
  console.error('读不到凭据（~/.bili-ai/credentials.json）—— 先去设置页填 cookie')
  process.exit(3)
}

console.log(`[1/2] 取音频 ${bvid} …`)
const a = await ensureAudio(cred, bvid, { wantWav: true })
if (!a.ok || !a.wav) {
  console.error(`取音频失败：${a.error ?? '没有 wav'}`)
  process.exit(4)
}
console.log(`      ${a.wav.file}（${(a.wav.bytes / 1024 / 1024).toFixed(1)} MB）  视频 ${Math.floor(a.duration / 60)}:${String(a.duration % 60).padStart(2, '0')}`)

const outPrefix = path.join(HOME, '.dsh', 'shots', 'subs', `${bvid}-asr`)
const args = [PY_SCRIPT, a.wav.file, '--out-prefix', outPrefix, '--device', String(opt.device || 'cpu')]
if (typeof opt.hotword === 'string' && opt.hotword.trim()) args.push('--hotword', opt.hotword.trim())

console.log(`[2/2] 本地转写（Paraformer-large，device=${opt.device || 'cpu'}）… 首次会下载模型`)
const r = spawnSync(VENV_PY, args, {
  stdio: 'inherit',
  env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  timeout: 3 * 3600 * 1000,
})
if (r.status !== 0) {
  console.error(`转写失败（exit=${r.status}${r.error ? '，' + r.error.message : ''}）`)
  process.exit(5)
}

const txt = outPrefix + '.txt'
const lines = fs.existsSync(txt) ? fs.readFileSync(txt, 'utf8').trim().split('\n') : []
if (opt.json) {
  console.log(JSON.stringify({ bv: bvid, title: a.title, wav: a.wav.file, txt, srt: outPrefix + '.srt', lines: lines.length }, null, 2))
  process.exit(0)
}
console.log(`\n完成：${lines.length} 句`)
console.log(`  TXT ${txt}`)
console.log(`  SRT ${outPrefix}.srt`)
console.log('\n（接下来：node bili.mjs debrief ' + bvid + ' --asr —— 用这份转写当字幕读）')
