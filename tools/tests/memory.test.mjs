// 记忆库（文件化 + 按需检索）的测试 —— 2026-10-26 v0.14
// 全是文件操作，所以用「临时目录 + 真跑 CLI」的方式测：比 mock fs 更接近真实用法。
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.join(HERE, '..', 'commands', 'memory.mjs')

function run(dir, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, WHALE_MEMORY_DIR: dir },
  })
  return { code: r.status ?? 1, out: String(r.stdout ?? '') + String(r.stderr ?? '') }
}

// 用「今天」而不是写死的日期：索引只收最近 7 天的事实，
// 写死的日期过一周就会让这条测试变红（2026-11-06 修 ✓）。
function today() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

test('memory：事实/人际/未完成三类入库，索引自动汇总，重复不写两遍', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-mem-'))
  const DAY = today()
  try {
    assert.equal(run(dir, ['add', 'fact', '测试事实', '--tag', 'AI', '--date', DAY]).code, 0)
    assert.equal(run(dir, ['add', 'fact', '测试事实', '--tag', 'AI', '--date', DAY]).code, 0)
    const facts = fs.readFileSync(path.join(dir, 'facts.md'), 'utf8')
    assert.equal(facts.split('\n').filter((l) => l.startsWith('- [')).length, 1, '同一行不该写两遍')
    assert.match(facts, new RegExp(`- \\[${DAY}\\] 测试事实 #AI`))

    assert.equal(run(dir, ['add', 'person', '甲', '说了句话', '--uid', '42']).code, 0)
    assert.match(fs.readFileSync(path.join(dir, 'people.md'), 'utf8'), /## 甲（UID 42）/)

    assert.equal(run(dir, ['add', 'loop', '待办 A', '--date', DAY]).code, 0)
    const idx = fs.readFileSync(path.join(dir, 'index.md'), 'utf8')
    assert.match(idx, /测试事实/, '事实要进索引')
    assert.match(idx, /待办 A/, '未完成要进索引')
    assert.match(idx, /甲（UID 42）：1 条/, '人际计数要进索引')

    // 做完：保留原日期，改成 [x]
    assert.equal(run(dir, ['done', '待办 A']).code, 0)
    assert.match(fs.readFileSync(path.join(dir, 'open-loops.md'), 'utf8'), new RegExp(`- \\[x\\] \\[${DAY}\\] 待办 A`))

    // 检索：三份库都能搜到
    const s = run(dir, ['search', '测试事实'])
    assert.match(s.out, /\[fact\]/)
    const p = run(dir, ['search', '甲'])
    assert.match(p.out, /\[person\]/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('memory：done 找不到时不改文件、返回 3（不是静默成功）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-mem-'))
  try {
    run(dir, ['add', 'loop', '只此一条'])
    const before = fs.readFileSync(path.join(dir, 'open-loops.md'), 'utf8')
    const r = run(dir, ['done', '不存在的关键词'])
    assert.equal(r.code, 3)
    assert.equal(fs.readFileSync(path.join(dir, 'open-loops.md'), 'utf8'), before)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
