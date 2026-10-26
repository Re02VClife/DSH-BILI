// 人设成长记录（persona）的测试 —— 2026-10-26
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.join(HERE, '..', 'commands', 'persona.mjs')

function run(dir, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DSH_HOME: dir, USERPROFILE: dir },
  })
  return { code: r.status ?? 1, out: String(r.stdout ?? '') + String(r.stderr ?? '') }
}

test('persona：追加成长记录，重复不写两遍，tail 只回最近 N 条', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-persona-'))
  try {
    assert.equal(run(dir, ['add', '短句更像我自己']).code, 0)
    assert.equal(run(dir, ['add', '短句更像我自己']).code, 0)   // 重复
    const f = path.join(dir, 'whale-persona-growth.md')
    const s = fs.readFileSync(f, 'utf8')
    assert.equal(s.split('\n').filter((l) => l.startsWith('- [')).length, 1, '同一句不该写两遍')
    assert.match(s, /- \[\d{4}-\d{2}-\d{2}\] 短句更像我自己/, '带日期')

    assert.equal(run(dir, ['add', '第二句']).code, 0)
    const tail = run(dir, ['tail', '1'])
    assert.match(tail.out, /第二句/)
    assert.doesNotMatch(tail.out, /短句更像我自己/, 'tail 1 只回最后一条')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('persona：空正文报错、退出码 2（不是静默成功）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-persona-'))
  try {
    const r = run(dir, ['add'])
    assert.equal(r.code, 2)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
