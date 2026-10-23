// 回复私信的额度测试（node --test）—— 2026-10-22
import test from 'node:test'
import assert from 'node:assert/strict'
import { replyCfg, canReply, countToday, recordReply, dayOf, buildCostNote, withCostNote, hasCostNote } from '../lib/dm-reply.mjs'
import { todayUsage, fmtNum, readSpend } from '../lib/usage.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const cfgOn = { listen: { replyDm: true } }

test('replyCfg：默认关；额度 1；窗口 72h；坏值回落', () => {
  assert.equal(replyCfg({}).enabled, false, '默认必须是关的（对陌生人说话的口子）')
  const c = replyCfg({ listen: { replyDm: true, replyDmDaily: '2', replyDmHours: 9999 } })
  assert.equal(c.enabled, true)
  assert.equal(c.daily, 2)
  assert.equal(c.hours, 24 * 14, '窗口封顶 14 天')
  assert.equal(replyCfg({ listen: { replyDmDaily: 'abc' } }).daily, 1)
})

test('canReply：关着 / 没额度 / 不是他先发 / 太久 / 今天回过 / 30 天内回过', () => {
  // 固定一个"中午"的时刻：否则跑在凌晨时 now-1h 会跨天，测试自己就假失败 ✗
  const now = new Date('2026-10-24T12:00:00+08:00').getTime()
  const nowSec = Math.floor(now / 1000)
  const base = { cfg: cfgOn, ledger: [], mid: '123', lastFromThem: true, lastTs: nowSec, now }

  assert.equal(canReply({ ...base, cfg: {} }).why, 'disabled')
  assert.equal(canReply({ ...base, cfg: { listen: { replyDm: true, replyDmDaily: 0 } } }).why, 'no-daily')
  assert.equal(canReply({ ...base, lastFromThem: false }).why, 'not-them', '最后一条是我发的 = 追着发，不许')
  assert.equal(canReply({ ...base, lastTs: nowSec - 100 * 3600 }).why, 'stale')

  const old = new Date(now - 3600_000).toISOString()
  assert.equal(canReply({ ...base, ledger: [{ at: old, mid: '999' }] }).why, 'daily', '今天已经回过别人')

  const long = new Date(now - 10 * 86400_000).toISOString()
  assert.equal(canReply({ ...base, ledger: [{ at: long, mid: '123' }] }).why, 'person', '同一个人 10 天前刚回过')

  assert.equal(canReply({ ...base, ledger: [{ at: long, mid: '999' }] }).why, 'ok', '别人是别人')
  assert.equal(canReply(base).ok, true)
})

test('recordReply：只追加、截到 200 条、跨天计数分开', () => {
  let log = []
  for (let i = 0; i < 205; i += 1) log = recordReply(log, { mid: String(i), note: 'x' })
  assert.equal(log.length, 200)
  const today = new Date().toISOString()
  const y = new Date(Date.now() - 86400_000).toISOString()
  assert.equal(countToday([{ at: today }, { at: y }], dayOf(today)), 1)
})

test('buildCostNote：千分位、用完/还剩两种说法', () => {
  assert.equal(buildCostNote({ tokens: 9339, usedAfter: 1, limit: 1 }), '（本次消耗 9,339 token · 本日对话次数已用完）')
  assert.equal(buildCostNote({ tokens: 120, usedAfter: 1, limit: 3 }), '（本次消耗 120 token · 今日还可回 2 次）')
  assert.equal(buildCostNote({ tokens: 0, usedAfter: 0, limit: 1 }), '（本次消耗 0 token · 今日还可回 1 次）')
  assert.equal(buildCostNote({ tokens: -5, usedAfter: 9, limit: 1 }), '（本次消耗 0 token · 本日对话次数已用完）')
})

test('withCostNote：自动追加，但已有括号备注就不重复（免得叠两层）', () => {
  const note = { tokens: 9339, usedAfter: 1, limit: 1 }
  assert.equal(withCostNote('你好', note), '你好（本次消耗 9,339 token · 本日对话次数已用完）')
  assert.equal(hasCostNote('你好（本次消耗 1 token · 本日对话次数已用完）'), true)
  assert.equal(hasCostNote('你好（今日还可回 2 次）'), true)
  assert.equal(hasCostNote('你好（笑）'), false)
  const once = withCostNote('你好（本次消耗 1 token · 本日对话次数已用完）', note)
  assert.equal(once, '你好（本次消耗 1 token · 本日对话次数已用完）')
  assert.equal(withCostNote('', note), '')
})

test('todayUsage：只算今天的 usage，不含 cacheRead；坏行跳过', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spend-'))
  const file = path.join(dir, 'spend.jsonl')
  const today = new Date().toISOString()
  const y = new Date(Date.now() - 86400_000).toISOString()
  fs.writeFileSync(file, [
    JSON.stringify({ at: today, kind: 'usage', input: 100, output: 50, cacheRead: 9000 }),
    JSON.stringify({ at: today, kind: 'usage', input: 20, output: 5 }),
    JSON.stringify({ at: y, kind: 'usage', input: 999, output: 999 }),
    JSON.stringify({ at: today, kind: 'video', est: 6000 }),
    '{ 坏行',
  ].join('\n'))
  const u = todayUsage(file)
  assert.equal(u.input, 120)
  assert.equal(u.output, 55)
  assert.equal(u.total, 175)
  assert.equal(u.calls, 2)
  assert.equal(u.cacheRead, 9000)
  assert.equal(readSpend(file).length, 4, '坏行跳过，其余都读出来')
  assert.equal(fmtNum(9339), '9,339')
  fs.rmSync(dir, { recursive: true, force: true })
})
