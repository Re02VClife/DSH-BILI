// 回复私信的额度与判据（2026-10-22）
//
// 背景：`dm` 是**写死只发主人**的（唯一收信人 + 一天锁定），所以别人私信她时她根本没法回。
//   可现实里会有「他先跟我打招呼 / 问我是谁」这种情况 —— 完全不回不礼貌，放开又容易变成骚扰号。
//   这里给它开一条**很窄**的口子，规则全在代码里：
//     ① 设置页 `listen.replyDm` 必须打开（默认关）
//     ② 对方必须**先给她发过私信**（会话最后一条是他发的），且在 N 小时内（默认 72）
//     ③ 必须互关（B站私信本来也要求）
//     ④ 一天最多 N 条（默认 1）
//     ⑤ 同一个人 30 天只回一次
//   提示词另加一条：只写自己的事，不提主人任何信息。
import fs from 'node:fs'
import path from 'node:path'

export const DEFAULT_DAILY = 1
export const DEFAULT_HOURS = 72
export const PER_PERSON_DAYS = 30

const clamp = (v, lo, hi, dft) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return dft
  return Math.min(hi, Math.max(lo, Math.round(n)))
}

export function replyCfg(cfg) {
  const l = cfg?.listen ?? {}
  return {
    enabled: l.replyDm === true,
    daily: clamp(l.replyDmDaily ?? DEFAULT_DAILY, 0, 5, DEFAULT_DAILY),
    hours: clamp(l.replyDmHours ?? DEFAULT_HOURS, 1, 24 * 14, DEFAULT_HOURS),
  }
}

export const dayOf = (at) => new Date(at).toLocaleDateString('sv-SE')
export const today = () => dayOf(Date.now())

export function loadLedger(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    return Array.isArray(j?.log) ? j.log : []
  } catch { return [] }
}

export function countToday(ledger = [], day = today()) {
  return (ledger ?? []).filter((x) => x && dayOf(x.at) === day).length
}

/**
 * @param {{cfg:any, ledger:any[], mid:string, lastFromThem:boolean, lastTs:number, now?:number}} o
 *   lastTs 是**秒**（B站会话给的是秒）
 * @returns {{ok:boolean, why:string, used:number, limit:number}}
 *   why: ok | disabled | no-daily | daily | person | stale | not-them
 */
export function canReply({ cfg, ledger = [], mid, lastFromThem = false, lastTs = 0, now = Date.now() } = {}) {
  const c = replyCfg(cfg)
  // "今天"按传入的 now 算（测试要能控制时间；线上 now 就是当前时刻 ✓）
  const used = countToday(ledger, dayOf(now))
  const base = { used, limit: c.daily }
  if (!c.enabled) return { ok: false, why: 'disabled', ...base }
  if (c.daily <= 0) return { ok: false, why: 'no-daily', ...base }
  if (!lastFromThem) return { ok: false, why: 'not-them', ...base }
  if (lastTs) {
    const ageH = (now - Number(lastTs) * 1000) / 3_600_000
    if (ageH > c.hours) return { ok: false, why: 'stale', ...base }
    if (ageH < -0.2) return { ok: false, why: 'stale', ...base }   // 时间在未来 = 时钟不对，别发
  }
  if (used >= c.daily) return { ok: false, why: 'daily', ...base }
  const mine = (ledger ?? []).filter((x) => x && String(x.mid) === String(mid))
  const last = mine[mine.length - 1]
  if (last && now - new Date(last.at).getTime() < PER_PERSON_DAYS * 86_400_000) {
    return { ok: false, why: 'person', ...base }
  }
  return { ok: true, why: 'ok', ...base }
}

/** 记账：{ at, mid, name, note }，只留最近 200 条 */
export function recordReply(ledger = [], { mid, name = '', note = '', at = new Date().toISOString() } = {}) {
  const next = ledger.concat([{ at, mid: String(mid), name: String(name).slice(0, 40), note: String(note).slice(0, 80) }])
  return next.slice(-200)
}

/**
 * 疑似"关注自动回复"（感谢关注 / 加群 / 群号）—— 这种不是人写的，
 * 回一句"你好"只会变成两个机器人互相打招呼 ✗（她关注 100 个人，会收到一堆这种）
 */
const AUTO_PATTERNS = [
  /感谢(你的|您的)?关注/, /感谢有(你|您)们/, /感谢支持/,
  /加入.{0,6}群/, /扣群/, /群号/, /QQ群/i, /\b\d{6,12}\b/,
]
export function looksLikeAutoGreeting(text) {
  const s = String(text ?? '')
  if (!s.trim()) return false
  return AUTO_PATTERNS.some((re) => re.test(s))
}

// ── 末尾的「消耗/额度」括号备注（2026-10-24 主人定：做成自动的 + 可开关）────
//   主人原话：「句末带个括号提示本次消耗的token以及提示本日对话次数已用完」
//   算不算得准不重要，**别让对面数零**才重要：数字带千分位，句子短。
export const COST_NOTE_RE = /[（(]\s*(本次|今日)[^）)]*[）)]\s*$/

/** 已经自带括号备注了？带了就不再追加（免得两个括号叠一起） */
export const hasCostNote = (text) => COST_NOTE_RE.test(String(text ?? '').trim())

/**
 * @param {{tokens:number, usedAfter:number, limit:number}} o
 *   usedAfter = **这条发出去之后**今天已回几条（决定说"已用完"还是"还可回 N 次"）
 * @returns {string} 形如 `（本次消耗 9,339 token · 本日对话次数已用完）`
 */
export function buildCostNote({ tokens = 0, usedAfter = 1, limit = 1 } = {}) {
  const n = Math.max(0, Math.round(Number(tokens) || 0))
  const left = Math.max(0, Math.round(Number(limit) || 0) - Math.max(0, Math.round(Number(usedAfter) || 0)))
  const tail = left > 0 ? `今日还可回 ${left} 次` : '本日对话次数已用完'
  const num = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `（本次消耗 ${num} token · ${tail}）`
}

/** 拼到正文末尾：自动带括号，且不重复加 */
export function withCostNote(text, opts) {
  const body = String(text ?? '').trim()
  if (!body || hasCostNote(body)) return body
  return `${body}${buildCostNote(opts)}`
}
