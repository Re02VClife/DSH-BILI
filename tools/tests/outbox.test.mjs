// 私信收件箱的纯函数测试（node --test）—— 2026-10-21 v0.7
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  emptyOutbox, addItem, patchItem, setStatus, findItem, effectiveText, stats, prune,
  normalizeBv, clampText, normalizeEmote, normalizeEmotes, emotesOf, normalizeMentions, normalizeStickers,
  saveOutbox, loadOutbox, MAX_ITEMS,
} from '../lib/outbox.mjs'

test('normalizeBv / clampText：BV 从任意文本里抠；正文裁到评论上限', () => {
  assert.equal(normalizeBv('看 https://www.bilibili.com/video/BV1x3nw6KEj2/ 这条'), 'BV1x3nw6KEj2')
  assert.equal(normalizeBv('没有'), '')
  assert.equal(clampText('  a\r\nb  '), 'a\nb')
  assert.equal(clampText('字'.repeat(1500)).length, 1000)
})

test('addItem：空正文不入箱；10 分钟内同一条只留一行', () => {
  const d = emptyOutbox()
  assert.equal(addItem(d, { text: '   ' }).item, null)
  const t0 = Date.now()
  const a = addItem(d, { text: '今天看到一条挺好的', bv: 'BV1x3nw6KEj2', title: '牌子', at: t0 })
  assert.equal(a.created, true)
  assert.equal(a.item.bv, 'BV1x3nw6KEj2')
  const b = addItem(d, { text: '今天看到一条挺好的', at: t0 + 60_000 })
  assert.equal(b.created, false, '10 分钟内重复不入箱')
  assert.equal(d.items.length, 1)
  const c = addItem(d, { text: '今天看到一条挺好的', at: t0 + 11 * 60_000 })
  assert.equal(c.created, true, '超过 10 分钟算新的一条')
  assert.equal(d.items.length, 2)
})

test('patchItem：只改 edited，不动原文；effectiveText 优先用改过的', () => {
  const d = emptyOutbox()
  const { item } = addItem(d, { text: '原文' })
  patchItem(d, item.id, { text: '改过的', bv: 'BV1x3nw6KEj2' })
  const it = findItem(d, item.id)
  assert.equal(it.text, '原文', '原文必须留着')
  assert.equal(it.edited, '改过的')
  assert.equal(it.bv, 'BV1x3nw6KEj2')
  assert.equal(effectiveText(it), '改过的')
  assert.equal(patchItem(d, '不存在', { text: 'x' }), null)
})

test('setStatus：待审 → 已发（带 rpid）；非法状态不认', () => {
  const d = emptyOutbox()
  const { item } = addItem(d, { text: 'x' })
  assert.equal(setStatus(d, item.id, 'flying'), null)
  const p = setStatus(d, item.id, 'posted', { rpid: '123' })
  assert.equal(p.status, 'posted')
  assert.equal(p.rpid, '123')
  assert.ok(p.postedAt)
  assert.equal(stats(d).posted, 1)
  assert.equal(stats(d).pending, 0)
})

test('prune：只回收 30 天前**已处理**的；待审的永远保留；总数封顶', () => {
  const old = Date.now() - 40 * 86400000
  const d = emptyOutbox()
  const a = addItem(d, { text: '待审的旧条目', at: old }).item
  const b = addItem(d, { text: '已发的旧条目', at: old }).item
  setStatus(d, b.id, 'posted', { rpid: '1' })
  prune(d)
  assert.ok(findItem(d, a.id), '待审的不删')
  assert.equal(findItem(d, b.id), null, '已处理的旧条目回收')

  const d2 = emptyOutbox()
  for (let i = 0; i < MAX_ITEMS + 20; i += 1) addItem(d2, { text: `第 ${i} 条` })
  assert.equal(d2.items.length, MAX_ITEMS)
})

test('表情：存名字（去方括号）、最多 3 个、去重；patch 不清空原值', () => {
  assert.equal(normalizeEmote('[笑哭]'), '笑哭')
  assert.equal(normalizeEmote(' 笑 哭 '), '笑哭')
  assert.equal(normalizeEmote(undefined), '')
  assert.deepEqual(normalizeEmotes(['[doge]', 'doge', '羞', 'x', 'y']), ['doge', '羞', 'x'], '去重 + 封顶 3 个')
  const d = emptyOutbox()
  const { item } = addItem(d, { text: '带表情', emotes: ['doge', '笑哭'] })
  assert.deepEqual(item.emotes, ['doge', '笑哭'])
  patchItem(d, item.id, { text: '改了正文' })
  assert.deepEqual(findItem(d, item.id).emotes, ['doge', '笑哭'], '不传 emotes 不该把已有的抹掉')
  patchItem(d, item.id, { emotes: [] })
  assert.deepEqual(findItem(d, item.id).emotes, [])
  // v0.8 的旧数据只有单个 emote 字段 → 读出来要能当数组用
  const legacy = addItem(d, { text: '旧的', emote: '旧表情' }).item
  assert.deepEqual(emotesOf(legacy), ['旧表情'])
})

test('贴纸：存名字（去扩展名）、最多 2 张、去重；patch 不清空原值', () => {
  assert.deepEqual(normalizeStickers(['a.png', 'a', 'b', 'c']), ['a', 'b'], '去重 + 封顶 2 张')
  assert.deepEqual(normalizeStickers('x.jpg, y.gif'), ['x', 'y'])
  assert.deepEqual(normalizeStickers(''), [])
  const d = emptyOutbox()
  const { item } = addItem(d, { text: '配图', stickers: ['悠闲'] })
  assert.deepEqual(item.stickers, ['悠闲'])
  patchItem(d, item.id, { text: '只改正文' })
  assert.deepEqual(findItem(d, item.id).stickers, ['悠闲'], '只改正文不该把配图抹掉')
})

test('@ 谁：名字去 @、去空、最多 5 个；addItem/patch 都能存', () => {
  assert.deepEqual(normalizeMentions('@张三, 李四、王五'), ['张三', '李四', '王五'])
  assert.deepEqual(normalizeMentions('a b c d e f g'), ['a', 'b', 'c', 'd', 'e'], '封顶 5 个')
  assert.deepEqual(normalizeMentions(''), [])
  const d = emptyOutbox()
  const { item } = addItem(d, { text: '正文', mentions: ['@张三'] })
  assert.deepEqual(item.mentions, ['张三'])
  patchItem(d, item.id, { mentions: '李四' })
  assert.deepEqual(findItem(d, item.id).mentions, ['李四'])
  patchItem(d, item.id, { text: '只改正文' })
  assert.deepEqual(findItem(d, item.id).mentions, ['李四'], '只改正文不该把 @ 抹掉')
})

test('saveOutbox / loadOutbox：原子写；坏文件当空的不覆盖', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outbox-'))
  const file = path.join(dir, 'outbox.json')
  const d = emptyOutbox()
  addItem(d, { text: '一条' })
  saveOutbox(d, file)
  assert.equal(loadOutbox(file).items.length, 1)
  fs.writeFileSync(file, '{ 坏 JSON')
  assert.deepEqual(loadOutbox(file), { version: 1, items: [] })
  fs.rmSync(dir, { recursive: true, force: true })
})
