// 指定清单的纯函数测试（node --test）—— 2026-10-21 v0.4
// 只测不联网的那部分：解析、归一化、排序。取数靠 `watchlist fetch` 现场验。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  pickBv, pickMid, parseUpLine, parseVideoLine, normalizeWatchlist, parseWatchlist, prioritize, watchlistToText, expandShortLink,
} from '../lib/watchlist.mjs'

test('pickBv：裸 BV / 带参数链接都能抠出来', () => {
  assert.equal(pickBv('BV1xx411c7mD'), 'BV1xx411c7mD')
  assert.equal(pickBv('https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333.999'), 'BV1xx411c7mD')
  assert.equal(pickBv('https://www.bilibili.com/video/BV1xx411c7mD'), 'BV1xx411c7mD')
  assert.equal(pickBv('没有'), '')
})

test('pickMid：裸数字 / 空间链接 / 查询参数都认', () => {
  assert.equal(pickMid('1234567'), '1234567')
  assert.equal(pickMid('https://space.bilibili.com/1234567?spm=1'), '1234567')
  assert.equal(pickMid('https://space.bilibili.com/1234567/video'), '1234567')
  assert.equal(pickMid('https://x.com/?mid=123456'), '123456')
  assert.equal(pickMid('名字'), '')
})

test('parseUpLine：mid + 名字；只有链接时名字为空', () => {
  assert.deepEqual(parseUpLine('123456 大肥鱼'), { mid: '123456', name: '大肥鱼' })
  assert.deepEqual(parseUpLine('https://space.bilibili.com/123456 大肥鱼'), { mid: '123456', name: '大肥鱼' })
  assert.deepEqual(parseUpLine('123456'), { mid: '123456', name: '' })
  assert.equal(parseUpLine('# 注释行'), null)
  assert.equal(parseUpLine(''), null)
})

test('parseVideoLine：BV + 备注；链接也能认', () => {
  assert.deepEqual(parseVideoLine('BV1xx411c7mD 想再看一遍'), { bv: 'BV1xx411c7mD', note: '想再看一遍' })
  assert.deepEqual(parseVideoLine('https://www.bilibili.com/video/BV1xx411c7mD/ 备注'), { bv: 'BV1xx411c7mD', note: '备注' })
  assert.equal(parseVideoLine('随便写点'), null)
})

test('normalizeWatchlist：去重、兼容字符串数组、空值不炸', () => {
  const wl = normalizeWatchlist({
    ups: ['123 甲', '123 甲（重复）', { mid: '456', name: '乙' }],
    videos: ['BV1xx411c7mD a', 'BV1xx411c7mD b', 'https://www.bilibili.com/video/BV1yy411c7mE/'],
  })
  assert.equal(wl.ups.length, 2)
  assert.equal(wl.ups[0].mid, '123')
  assert.equal(wl.ups[1].mid, '456')
  assert.equal(wl.videos.length, 2)
  assert.equal(wl.videos[0].bv, 'BV1xx411c7mD')
  assert.deepEqual(normalizeWatchlist(undefined), { ups: [], videos: [] })
  assert.deepEqual(normalizeWatchlist({ ups: '不是数组' }), { ups: [], videos: [] })
})

test('watchlistToText：回写成设置页能吃的两段文本（再解析回来不丢）', () => {
  const src = { ups: [{ mid: '123', name: '甲' }, { mid: '456', name: '' }], videos: [{ bv: 'BV1xx411c7mD', note: '备注' }] }
  const txt = watchlistToText(src)
  assert.equal(txt.upsText, '123 甲\n456')
  assert.equal(txt.videosText, 'BV1xx411c7mD 备注')
  const back = normalizeWatchlist({ ups: txt.upsText.split('\n'), videos: txt.videosText.split('\n') })
  assert.deepEqual(back.ups.map((u) => u.mid), ['123', '456'])
  assert.equal(back.videos[0].bv, 'BV1xx411c7mD')
})

test('prioritize：点名的排最前，各自顺序不变', () => {
  const list = [{ bv: 'A' }, { bv: 'B', _forced: true }, { bv: 'C' }, { bv: 'D', _forced: true }]
  assert.deepEqual(prioritize(list).map((x) => x.bv), ['B', 'D', 'A', 'C'])
})

test('parseWatchlist：认不出的行必须回报（保存不能静默吞掉）', () => {
  const r = parseWatchlist({
    ups: ['不是 mid 的一行'],
    videos: ['BV1x3nw6KEj2 备注', '这个视频不错', 'https://b23.tv/AbCdEfG'],
  })
  assert.equal(r.videos.length, 1, '只有那条真 BV 应被收下')
  assert.equal(r.videos[0].bv, 'BV1x3nw6KEj2')
  assert.equal(r.ups.length, 0)
  assert.equal(r.rejected.length, 3, '两行视频 + 一行 UP 都要报')
  assert.ok(r.rejected.some((x) => x.includes('b23.tv')), '短链在展开失败时要如实说')
  // 空行不当作错误（设置页末尾常多一个空行）
  assert.equal(parseWatchlist({ videos: ['BV1x3nw6KEj2', '', '  '] }).rejected.length, 0)
})

test('expandShortLink：不含短链时原样返回（不发请求）', async () => {
  const line = 'BV1x3nw6KEj2 备注'
  assert.equal(await expandShortLink(line), line)
  assert.equal(await expandShortLink(''), '')
})
