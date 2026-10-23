// 预算的纯函数测试（node --test）—— 2026-10-21 v0.4
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  estimateTokens, capText, planVideo, planWake, summarizeSpend, appendSpend, clampReplyTokens, FRAME_COST, SCREEN_COST,
} from '../lib/budget.mjs'

test('estimateTokens：中文按字、英文按 1/4 字算，且随长度单调递增', () => {
  assert.equal(estimateTokens(''), 0)
  assert.equal(estimateTokens('中文十个字啊啊啊啊'), 9)   // 9 个 CJK
  assert.equal(estimateTokens('abcd'), 1)                // 4 个 ASCII → 1
  assert.ok(estimateTokens('中文'.repeat(50)) > estimateTokens('中文'.repeat(10)))
  assert.ok(estimateTokens('混合 abc 中文') > 0)
})

test('capText：不超预算时原样返回', () => {
  const r = capText('短文本', 100)
  assert.equal(r.text, '短文本')
  assert.equal(r.cut, 0)
})

test('capText：超了要留头留尾、并且真的变短了', () => {
  const text = 'A'.repeat(200) + '中间内容' + 'B'.repeat(200)
  const r = capText(text, 100)
  assert.ok(r.cut > 0)
  assert.ok(r.text.length <= 100 + 60, '截断后不该比预算大太多（标记行除外）')
  assert.ok(r.text.startsWith('A'), '要留头')
  assert.ok(r.text.trimEnd().endsWith('B'), '要留尾 —— 结论常在最后')
  assert.match(r.text, /中间省略/)
})

test('planVideo：预算宽裕 → 抽帧 + 全部热评', () => {
  const p = planVideo({ subText: '字'.repeat(1000), commentText: '评'.repeat(300), wantFrames: true, budgetTokens: 60000, maxComments: 8 })
  assert.equal(p.frames, true)
  assert.equal(p.comments, 8)
  assert.equal(p.degraded.length, 0)
})

test('planVideo：预算紧 → 先砍抽帧，再砍热评/截字幕，并说明原因', () => {
  const p = planVideo({ subText: '字'.repeat(20000), commentText: '评'.repeat(2000), wantFrames: true, budgetTokens: 8000, maxComments: 8 })
  assert.equal(p.frames, false)
  assert.ok(p.degraded.some((s) => s.includes('抽帧')), '砍抽帧必须写明')
  assert.ok(p.degraded.some((s) => s.includes('字幕')), '截字幕必须写明')
  assert.ok(p.est <= 8000 * 1.3, `估算应落在预算附近，实际 ${p.est}`)
})

test('planVideo：--no-frames 时不会自己把帧加回来', () => {
  const p = planVideo({ subText: '字'.repeat(100), wantFrames: false, budgetTokens: 60000 })
  assert.equal(p.frames, false)
  assert.equal(p.degraded.length, 0, '自己关掉的不算降级，不用解释')
})

test('planWake：预算越大越能看；深读上限 3；至少筛一条', () => {
  const small = planWake({ wakeMaxTokens: 5000, videoMaxTokens: 12000 })
  const big = planWake({ wakeMaxTokens: 200000, videoMaxTokens: 12000 })
  assert.ok(small.deep <= big.deep)
  assert.ok(big.deep <= 3)
  assert.ok(small.screen >= 1 || small.deep === 0)
  assert.ok(big.est > small.est)
  assert.equal(typeof SCREEN_COST, 'number')
  assert.equal(typeof FRAME_COST, 'number')
})

test('summarizeSpend：只统计窗口内的，坏行跳过，按 kind 分开', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-spend-'))
  const file = path.join(dir, 'spend.jsonl')
  const now = new Date()
  fs.writeFileSync(file, [
    JSON.stringify({ at: now.toISOString(), kind: 'usage', input: 100, output: 20, cacheRead: 5 }),
    JSON.stringify({ at: now.toISOString(), kind: 'video', bv: 'BV1', est: 3000 }),
    JSON.stringify({ at: now.toISOString(), kind: 'clamp', cap: 1200 }),
    '{ 这不是 JSON',
    JSON.stringify({ at: new Date(Date.now() - 48 * 3600 * 1000).toISOString(), kind: 'usage', input: 999, output: 1 }),
    '',
  ].join('\n'))
  const s = summarizeSpend({ hours: 24, file })
  assert.equal(s.input, 100)
  assert.equal(s.output, 20)
  assert.equal(s.cacheRead, 5)
  assert.equal(s.est, 3000)
  assert.equal(s.videos, 1)
  assert.equal(s.calls, 1)
  assert.equal(s.clamps, 1, '硬顶下发要可审计')
  assert.ok(s.lastClampAt)
  assert.equal(s.byBv.BV1, 3000)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('appendSpend：目录不存在也能写（第一次用不该失败）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-spend2-'))
  const file = path.join(dir, 'nested', 'spend.jsonl')
  assert.equal(appendSpend({ kind: 'video', bv: 'BV2', est: 1234 }, file), true)
  const s = summarizeSpend({ hours: 1, file })
  assert.equal(s.est, 1234)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('clampReplyTokens：没设过就补上；设大了压回去；本来就小不抬（这是单条回复的硬顶）', () => {
  const cap = 1200
  assert.equal(clampReplyTokens({ provider: 'p', model: 'm' }, cap).maxTokens, cap, '没设过 → 补上')
  assert.equal(clampReplyTokens({ provider: 'p', model: 'm', maxTokens: 8000 }, cap).maxTokens, cap, '设大了 → 压到上限')
  const small = { provider: 'p', model: 'm', maxTokens: 500 }
  assert.equal(clampReplyTokens(small, cap), small, '本来就小 → 原样返回，不抬上去')
  assert.equal(clampReplyTokens(small, 0), small, '上限为 0（关掉预算）→ 不动')
  // 其它字段不能丢
  const out = clampReplyTokens({ provider: 'p', model: 'm', temperature: 0.3, stop: ['x'] }, cap)
  assert.equal(out.provider, 'p')
  assert.equal(out.temperature, 0.3)
  assert.deepEqual(out.stop, ['x'])
})
