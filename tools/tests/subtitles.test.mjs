// 字幕轨道的安全测试（node --test）—— 2026-10-21
// 核心：**默认只信 WBI**。旧端点会返回别的视频的字幕（实测事故），必须有测试钉住。
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSubtitleTracks, pickTrack, bodyToLines, parseAsrTxt } from '../lib/subtitles.mjs'

const track = { lan: 'ai-zh', lan_doc: '中文', subtitle_url: 'https://example.com/sub.json' }

function fakeJget(map) {
  return async (url) => {
    for (const [k, v] of Object.entries(map)) if (String(url).includes(k)) return v
    return { code: -1 }
  }
}

test('默认只信 WBI：WBI 没轨道时，旧端点有也不采用', async () => {
  const jget = fakeJget({
    'wbi/v2': { data: { subtitle: { subtitles: [], ai_status: 0 } } },
    'player/v2': { data: { subtitle: { subtitles: [track] } } },
  })
  const r = await resolveSubtitleTracks({ jget, bvid: 'BV1', cid: 1, aid: 2, wbi: () => 'w=1', log: () => {} })
  assert.equal(r.tracks.length, 0, '旧端点的轨道不能被当成这条视频的字幕')
  assert.match(r.source, /无轨道/)
  assert.equal(r.fallback, false)
})

test('WBI 有轨道时直接采用（正常路径）', async () => {
  const jget = fakeJget({ 'wbi/v2': { data: { subtitle: { subtitles: [track], ai_status: 1 } } } })
  const r = await resolveSubtitleTracks({ jget, bvid: 'BV1', cid: 1, aid: 2, wbi: () => 'w=1', log: () => {} })
  assert.equal(r.tracks.length, 1)
  assert.equal(r.source, 'x/player/wbi/v2')
  assert.equal(r.fallback, false)
})

test('只有显式打开 WHALE_ALLOW_LEGACY_SUBS 才走旧端点，并且标明不可信', async () => {
  const jget = fakeJget({
    'wbi/v2': { data: { subtitle: { subtitles: [] } } },
    'player/v2': { data: { subtitle: { subtitles: [track] } } },
  })
  const old = process.env.WHALE_ALLOW_LEGACY_SUBS
  process.env.WHALE_ALLOW_LEGACY_SUBS = '1'
  try {
    const r = await resolveSubtitleTracks({ jget, bvid: 'BV1', cid: 1, aid: 2, wbi: () => 'w=1', log: () => {} })
    assert.equal(r.tracks.length, 1)
    assert.match(r.source, /不可信/)
    assert.equal(r.fallback, true)
  } finally {
    if (old === undefined) delete process.env.WHALE_ALLOW_LEGACY_SUBS
    else process.env.WHALE_ALLOW_LEGACY_SUBS = old
  }
})

test('pickTrack：优先 ai-zh，其次 zh-CN，最后第一条', () => {
  assert.equal(pickTrack([{ lan: 'en' }, { lan: 'ai-zh' }]).lan, 'ai-zh')
  assert.equal(pickTrack([{ lan: 'en' }, { lan: 'zh-CN' }]).lan, 'zh-CN')
  assert.equal(pickTrack([{ lan: 'en' }]).lan, 'en')
  assert.equal(pickTrack([]), null)
})

test('bodyToLines：带 [mm:ss] 且不丢行', () => {
  const lines = bodyToLines([{ from: 0, content: '甲' }, { from: 75, content: '乙' }])
  assert.deepEqual(lines, ['[00:00] 甲', '[01:15] 乙'])
})

test('parseAsrTxt：认识的两种时间戳都解析；认不出的行整行保留不丢字', () => {
  const body = parseAsrTxt('[00:01] 甲\n[01:02:03] 乙\n没有时间戳的一行\n\n')
  assert.equal(body.length, 3)
  assert.equal(body[0].from, 1)
  assert.equal(body[0].content, '甲')
  assert.equal(body[1].from, 3723, '1h2m3s')
  assert.equal(body[1].content, '乙')
  assert.equal(body[2].from, 0)
  assert.match(body[2].content, /没有时间戳/)
})
