// 口味源的纯函数测试（node --test）—— 2026-10-21 v0.5
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  topicTokens, tasteIndex, tasteBoost, tasteExcluded, tasteSummary, tasteAgeHours, saveTaste, loadTaste,
} from '../lib/taste.mjs'

test('topicTokens：拉丁词 + 中文 2~3 字，停用词不进', () => {
  const toks = topicTokens('GitHub 上这个 机械臂 项目')
  assert.ok(toks.includes('github'))
  assert.ok(toks.includes('机械臂'))
  assert.ok(toks.includes('机械'))
  assert.ok(!toks.includes('这个'), '停用词要滤掉')
  assert.ok(!topicTokens('这个那个').includes('这个'))
})

test('tasteIndex：文件夹名权重高但**不随条目数放大**；弱标题词被阈值滤掉', () => {
  const idx = tasteIndex({
    meta: { selfWeight: 0.5 },
    owner: {
      following: [{ mid: '1', name: '甲' }],
      folders: [{ id: 1, title: '机械臂', count: 102 }],
      favorites: [
        { bv: 'BV1', title: '机械臂 抓取 演示' },
        { bv: 'BV2', title: '硬件 测评' },
      ],
      history: [],
    },
  })
  assert.ok(idx.followMids.has('1'))
  assert.ok(idx.favoriteBvs.has('BV1') && idx.favoriteBvs.has('BV2'))
  assert.equal(idx.topicWeights.get('机械臂'), 7, '文件夹 6 + 标题 1')
  assert.equal(idx.topicWeights.get('机械'), 7)
  assert.ok(!idx.topicWeights.has('硬件'), '只出现一次的词达不到阈值（1.5）')
})

test('tasteIndex：self 的权重按 selfWeight 缩放', () => {
  const idx = tasteIndex({
    meta: { selfWeight: 0.5 },
    self: { folders: [{ title: '动漫' }], favorites: [{ bv: 'BV9', title: '动漫 剪辑' }] },
  })
  assert.equal(idx.topicWeights.get('动漫'), 3 + 0.5, '文件夹 6×0.5 + 标题 1×0.5')
})

test('tasteBoost：关注的人加分；口味词命中封顶 2N', () => {
  const idx = tasteIndex({
    owner: {
      following: [{ mid: '7' }],
      folders: [{ title: '机械臂 硬件 视觉 抓取' }],
      favorites: [],
    },
  })
  const cfg = { boostFollow: 6, boostTopic: 3 }
  assert.equal(tasteBoost({ mid: '7', t: '完全无关的标题' }, idx, cfg), 6, '只拿关注分')
  const s = tasteBoost({ mid: '9', t: '机械臂 硬件 视觉 抓取' }, idx, cfg)
  assert.ok(s > 0 && s <= 6, `口味词封顶 2N=6，实际 ${s}`)
  assert.equal(tasteBoost({}, idx, cfg), 0)
})

test('tasteExcluded：收藏/历史可分别开关', () => {
  const idx = tasteIndex({ owner: { favorites: [{ bv: 'BV1' }], history: [{ bv: 'BV2', title: 'x' }] } })
  assert.equal(tasteExcluded({ bv: 'BV1' }, idx, {}), true)
  assert.equal(tasteExcluded({ bv: 'BV2' }, idx, {}), true)
  assert.equal(tasteExcluded({ bv: 'BV1' }, idx, { excludeFavorites: false }), false)
  assert.equal(tasteExcluded({ bv: 'BV3' }, idx, {}), false)
})

test('tasteSummary / tasteAgeHours：没有档案与刚同步都要说清楚', () => {
  assert.match(tasteSummary(null), /还没有口味档案/)
  const now = Date.now()
  const t = { syncedAt: now, owner: { following: [1, 2], favorites: [1] }, index: { topics: [['a', 1]] } }
  assert.match(tasteSummary(t), /主人 关注 2 \/ 收藏 1/)
  assert.ok(tasteAgeHours(t) < 0.01)
  assert.equal(tasteAgeHours({}), null)
})

test('saveTaste / loadTaste：原子写 + 坏文件返回 null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taste-'))
  const file = path.join(dir, 'taste.json')
  saveTaste({ syncedAt: 1, owner: { following: [] } }, file)
  assert.equal(loadTaste(file).syncedAt, 1)
  fs.writeFileSync(file, '{ 坏 JSON')
  assert.equal(loadTaste(file), null)
  fs.rmSync(dir, { recursive: true, force: true })
})
