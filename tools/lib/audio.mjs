// 只取音频 —— 2026-10-21 v0.6（本地 ASR 的地基）
//
// 为什么单独一条链路：本地转写只用得到声音，视频画面（几十上百 MB）纯属浪费带宽和时间。
// B站给了 dash 音频流（`playurl?fnval=16`），实测一条 20 分钟的视频 192k 音轨只有 ~11MB ✓
//
// 产出：
//   ~/.dsh/shots/audio/<BV>.m4a   原始音频（可留可删）
//   ~/.dsh/shots/audio/<BV>.wav   16kHz 单声道 PCM —— 喂给 ASR / 任何模型都用它
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { requireFfmpeg } from './ffmpeg.mjs'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const HOME = process.env.USERPROFILE || process.env.HOME || '.'
export const AUDIO_DIR = path.join(HOME, '.dsh', 'shots', 'audio')

const headersOf = (cred, referer) => ({
  'user-agent': UA,
  referer,
  accept: '*/*',
  cookie: `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}`,
})

async function jget(cred, url, referer) {
  const r = await fetch(url, { headers: headersOf(cred, referer) })
  const t = await r.text()
  try { return JSON.parse(t) } catch { return { code: -1, message: `非 JSON（HTTP ${r.status}）` } }
}

/** 视频元信息 + 可用的音频流（按码率从高到低）。 */
export async function audioStreams(cred, bvid) {
  const ref = `https://www.bilibili.com/video/${bvid}/`
  const view = await jget(cred, `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, ref)
  if (view?.code !== 0) return { ok: false, error: `view code=${view?.code} ${view?.message ?? ''}` }
  const d = view.data
  const p = await jget(cred, `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${d.cid}&fnval=16&fourk=1&platform=pc`, ref)
  const audios = p?.data?.dash?.audio ?? []
  if (p?.code !== 0 || !audios.length) {
    return { ok: false, error: `playurl code=${p?.code} ${p?.message ?? ''}（有些视频只给 durl 流）`, title: d.title, cid: d.cid, duration: d.duration }
  }
  const list = audios
    .map((a) => ({ id: a.id, bandwidth: a.bandwidth, url: a.baseUrl || a.base_url }))
    .filter((a) => a.url)
    .sort((a, b) => b.bandwidth - a.bandwidth)
  return { ok: true, cid: d.cid, aid: d.aid, title: d.title, up: d.owner?.name ?? '', duration: Number(d.duration ?? 0), streams: list }
}

/** 下载一条音频流（失败自动换下一条，最多试 2 条）。 */
export async function downloadAudio(cred, bvid, streams, { dir = AUDIO_DIR } = {}) {
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, `${bvid}.m4a`)
  let lastErr = ''
  for (const s of streams.slice(0, 2)) {
    try {
      const r = await fetch(s.url, { headers: headersOf(cred, `https://www.bilibili.com/video/${bvid}/`) })
      if (!r.ok) { lastErr = `HTTP ${r.status}`; continue }
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length < 10_000) { lastErr = `文件太小（${buf.length} 字节）`; continue }
      fs.writeFileSync(out, buf)
      return { ok: true, file: out, bytes: buf.length, quality: s.id, bandwidth: s.bandwidth }
    } catch (e) { lastErr = String(e?.message ?? e) }
  }
  return { ok: false, error: lastErr || '没有可用音频流' }
}

/** 转成 16kHz 单声道 wav（ASR 通用输入）。 */
export function toWav(m4a, { out } = {}) {
  const dest = out || m4a.replace(/\.m4a$/i, '.wav')
  const ff = requireFfmpeg()
  execFileSync(ff, ['-y', '-loglevel', 'error', '-i', m4a, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', dest], { timeout: 300_000 })
  const bytes = fs.statSync(dest).size
  return { ok: true, file: dest, bytes }
}

/**
 * 一条龙：拿流 → 下 192k → 转 16k wav。
 * 已经下过就直接复用（除非 force）。
 */
export async function ensureAudio(cred, bvid, { dir = AUDIO_DIR, wantWav = true, force = false } = {}) {
  const m4a = path.join(dir, `${bvid}.m4a`)
  const wav = path.join(dir, `${bvid}.wav`)
  const meta = await audioStreams(cred, bvid)
  if (!meta.ok) return meta

  let downloaded = null
  if (!force && fs.existsSync(m4a) && fs.statSync(m4a).size > 10_000) {
    downloaded = { ok: true, file: m4a, bytes: fs.statSync(m4a).size, cached: true }
  } else {
    downloaded = await downloadAudio(cred, bvid, meta.streams, { dir })
    if (!downloaded.ok) return { ...meta, ok: false, error: downloaded.error }
  }

  let wavInfo = null
  if (wantWav) {
    if (!force && fs.existsSync(wav) && fs.statSync(wav).size > 10_000) {
      wavInfo = { ok: true, file: wav, bytes: fs.statSync(wav).size, cached: true }
    } else {
      try { wavInfo = toWav(m4a, { out: wav }) } catch (e) { return { ...meta, ok: false, error: `ffmpeg 转 wav 失败：${String(e?.message ?? e).slice(0, 160)}` } }
    }
  }
  return { ...meta, ok: true, m4a: downloaded, wav: wavInfo }
}
