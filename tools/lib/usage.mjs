// 今日 token 用量（2026-10-24）—— 给"私信末尾的括号备注"用
//
// 数据源：`~/.dsh/whale-spend.jsonl`（插件宿主在 `session/event` 里记的真实 usage）
//   { at, kind: 'usage', input, output, cacheRead, cacheWrite }
// 口径：**input + output**（不含 cacheRead —— 缓存读取便宜一个数量级，混进来会吓人）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const SPEND_FILE = path.join(
  process.env.DSH_HOME || path.join(process.env.USERPROFILE || os.homedir(), '.dsh'),
  'whale-spend.jsonl',
)

export const dayOf = (at) => new Date(at).toLocaleDateString('sv-SE')

/** 读账本（坏行跳过，不抛） */
export function readSpend(file = SPEND_FILE) {
  let raw = ''
  try { raw = fs.readFileSync(file, 'utf8') } catch { return [] }
  const out = []
  for (const line of raw.split('\n')) {
    const s = line.trim()
    if (!s) continue
    try {
      const j = JSON.parse(s)
      if (j && j.at) out.push(j)
    } catch { /* 坏行跳过 */ }
  }
  return out
}

/** 今天的真实用量：{ input, output, total, calls, cacheRead, lastTotal }
 *  lastTotal = **最近一次**模型调用的 input+output（今天还没跑过时拿它兜底，
 *  否则早上第一条私信会写成「本次消耗 0 token」，看着像 bug ✗） */
export function todayUsage(file = SPEND_FILE, day = dayOf(Date.now())) {
  const all = readSpend(file).filter((x) => x.kind === 'usage')
  const rows = all.filter((x) => dayOf(x.at) === day)
  const sum = (arr, k) => arr.reduce((n, x) => n + (Number(x[k]) || 0), 0)
  const input = sum(rows, 'input')
  const output = sum(rows, 'output')
  const last = all[all.length - 1]
  return {
    input,
    output,
    total: input + output,
    calls: rows.length,
    cacheRead: sum(rows, 'cacheRead'),
    lastTotal: last ? (Number(last.input) || 0) + (Number(last.output) || 0) : 0,
  }
}

/** 千分位，别写 9339 让对面数零 */
export const fmtNum = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
