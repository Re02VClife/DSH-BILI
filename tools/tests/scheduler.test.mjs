// 唤醒提示词的测试（node --test）—— 2026-10-21 v0.4
// 目的不是测文案好不好，而是钉住两件事：
//   ① 指定清单必须排在 feed 之前（否则等于没加）
//   ② 条数必须来自预算（不是写死的 5 / 2–3）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { wakePrompt, taskLinesFor } from '../../lib/scheduler.js'

function withCfg(cfg, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-cfg-'))
  const file = path.join(dir, 'bili-whale.config.json')
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2))
  const old = process.env.WHALE_CFG
  process.env.WHALE_CFG = file
  try { return fn() } finally {
    if (old === undefined) delete process.env.WHALE_CFG
    else process.env.WHALE_CFG = old
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('wakePrompt：指定清单排在 feed 之前', () => {
  const text = withCfg({ budget: { wakeMaxTokens: 60000, videoMaxTokens: 12000 } }, () => wakePrompt({ atText: '20:00' }))
  const iWl = text.indexOf('watchlist fetch')
  const iFeed = text.indexOf('`feed` 补')
  assert.ok(iWl > 0, '提示里必须有 watchlist fetch')
  assert.ok(iFeed > iWl, 'watchlist 必须排在 feed 前面')
})

test('wakePrompt：条数跟着预算走（30000/8000 → 初筛 2、深读 3）', () => {
  const text = withCfg({ budget: { wakeMaxTokens: 30000, videoMaxTokens: 8000 } }, () => wakePrompt({}))
  assert.match(text, /初筛 ≤2 条/)
  assert.match(text, /深读 ≤3 条/)
  assert.match(text, /本轮约 30000 token/)
})

test('wakePrompt：预算不够深读时明说「不深读」，不留模糊指令', () => {
  const text = withCfg({ budget: { wakeMaxTokens: 5000, videoMaxTokens: 20000 } }, () => wakePrompt({}))
  assert.match(text, /不深读/)
})

test('wakePrompt：配置缺失也不炸（用默认值）', () => {
  const old = process.env.WHALE_CFG
  process.env.WHALE_CFG = path.join(os.tmpdir(), 'definitely-not-here', 'none.json')
  try {
    const text = wakePrompt({})
    assert.ok(text.includes('watchlist fetch'))
    assert.ok(text.length > 100)
  } finally {
    if (old === undefined) delete process.env.WHALE_CFG
    else process.env.WHALE_CFG = old
  }
})

test('taskLinesFor：有排队中的任务就要她先做，且明写"只交草稿不发评论"', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tasks-'))
  const file = path.join(dir, 'tasks.json')
  // 空 / 不存在 → 不加戏
  assert.deepEqual(taskLinesFor(file), [])
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    tasks: [
      { id: 'tk_1', bv: 'BV1x3nw6KEj2', format: 'timeline', status: 'todo' },
      { id: 'tk_2', bv: 'BV1aaaaaaaaa', format: 'outline', status: 'posted' },
    ],
  }))
  const lines = taskLinesFor(file)
  const text = lines.join('\n')
  assert.match(text, /有 1 个主人派的活/)
  assert.match(text, /BV1x3nw6KEj2·时间轴/, '格式要说人话（不是 id）')
  assert.doesNotMatch(text, /BV1aaaaaaaaa/, '已发的不该出现在"待做"里')
  assert.match(text, /task take/)
  assert.match(text, /不要自己发评论/)
  fs.rmSync(dir, { recursive: true, force: true })
})
