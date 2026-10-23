// 自我介绍额度的纯函数测试（node --test）—— 2026-10-22
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  looksLikeIntro, countIntro, introLimit, canIntro, recordIntro, dayOf, today,
} from '../lib/intro.mjs'

test('looksLikeIntro：认常见问法，不把普通提问当自我介绍', () => {
  for (const s of [
    '能介绍一下你自己吗', '你是谁啊', '主播是 AI 吗', '你是不是机器人',
    '这是什么模型', 'who are you?', '来个自我介绍', '你是什么东西',
  ]) assert.equal(looksLikeIntro(s), true, s)
  for (const s of ['这期 BGM 是什么', '你是什么时候入坑的', '视频里那台机器是什么型号', '', '   ']) {
    assert.equal(looksLikeIntro(s), false, s)
  }
})

test('countIntro：只数今天的、带 intro 标记的（跨天不算）', () => {
  const now = new Date()
  const y = new Date(now.getTime() - 86400000)
  const log = [
    { at: now.toISOString(), intro: true },
    { at: now.toISOString(), intro: true },
    { at: now.toISOString() },                         // 普通评论不算
    { at: y.toISOString(), intro: true },              // 昨天的不算
  ]
  assert.equal(countIntro(log), 2)
  assert.equal(countIntro(log, dayOf(y)), 1)
  assert.equal(countIntro([]), 0)
  assert.equal(today().length, 10)
})

test('introLimit：默认 1；0 = 关掉；坏值回落 1', () => {
  assert.equal(introLimit({}), 1)
  assert.equal(introLimit({ listen: { introDaily: 0 } }), 0)
  assert.equal(introLimit({ listen: { introDaily: '3' } }), 3)
  assert.equal(introLimit({ listen: { introDaily: 'abc' } }), 1)
})

test('canIntro：额度内放行；用完拦；不像自我介绍拦；0 = 关掉', () => {
  const cfg = { listen: { introDaily: 1 } }
  const at = new Date().toISOString()
  assert.deepEqual(canIntro({ cfg, log: [], text: '你是谁' }), { ok: true, why: 'ok', used: 0, limit: 1 })

  const used = [{ at, intro: true }]
  const r1 = canIntro({ cfg, log: used, text: '你是谁' })
  assert.equal(r1.ok, false)
  assert.equal(r1.why, 'limit')
  assert.equal(r1.used, 1)

  assert.equal(canIntro({ cfg, log: [], text: '这期 BGM 是什么' }).why, 'not-intro')
  assert.equal(canIntro({ cfg: { listen: { introDaily: 0 } }, log: [], text: '你是谁' }).why, 'disabled')
  // 不带 text 时只查额度（模型自己判断过了）
  assert.equal(canIntro({ cfg, log: used }).why, 'limit')
})

test('recordIntro：只追加一条带 intro 的账，不动别的', () => {
  const base = [{ at: new Date().toISOString(), type: 'comment', note: '普通' }]
  const next = recordIntro({ log: base, target: 'BV1x3nw6KEj2', note: '自我介绍' })
  assert.equal(next.length, 2)
  assert.equal(next[1].intro, true)
  assert.equal(next[1].target, 'BV1x3nw6KEj2')
  assert.equal(base.length, 1, '不该改原数组')
  assert.equal(countIntro(next), 1)
})
