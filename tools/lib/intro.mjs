// 自我介绍回复的额度（2026-10-22 主人定）——
//   原话：「别的用户问了自我介绍，是不是要回一下，一天只回一次」
//
// 为什么单独一条额度：别的用户问「你是谁 / 介绍一下你自己」属于**低风险、该答**的一类，
//   但答多了就变成"到处自我介绍"的营销号 ✗ → 一天最多 N 次（默认 1），代码里拦，不靠自觉。
//
// 判据与额度分开：
//   · looksLikeIntro() 只判断"像不像自我介绍"（帮她少想一层）
//   · 真正拦人的是 countIntro / canIntro —— 账本记在 ~/.bili-ai/quota.json 的 log 里（intro:true）
import fs from 'node:fs'
import path from 'node:path'

const HOME = process.env.USERPROFILE || process.env.HOME || '.'
export const QUOTA_FILE = path.join(HOME, '.bili-ai', 'quota.json')
export const DEFAULT_LIMIT = 1

// 常见问法（中文为主；不追求全，模型可以自己判断，这里只是"省一次判断"）
const PATTERNS = [
  /自我介绍/, /介绍(一下|下)?(你自己|自己|你)/, /你是(谁|什么(?!时候|时间|年代|年份)|干嘛的|做什么的|哪位)/,
  /你(是|是不是)(真人|人类|ai|机器人|自动|程序|号)/i, /什么模型/, /哪个模型/,
  // 「主播是 AI 吗」这种不带"你"的问法（常见于别人对着账号问）
  /(主播|up主|号主|这个号|这个账号)(是|是不是)?\s*(真人|人类|ai|机器人|自动|程序)/i,
  /who\s*are\s*you/i, /self[-\s]?intro/i, /introduce\s+yourself/i,
]

export function looksLikeIntro(text) {
  const s = String(text ?? '')
  if (!s.trim()) return false
  return PATTERNS.some((re) => re.test(s))
}

export const dayOf = (at) => new Date(at).toLocaleDateString('sv-SE')
export const today = () => dayOf(Date.now())

export function countIntro(log = [], day = today()) {
  return (log ?? []).filter((x) => x && x.intro && dayOf(x.at) === day).length
}

/** 配置里的额度（默认 1）；写成 0 = 关掉"自己回"，全部回到草稿审批 */
export function introLimit(cfg) {
  const n = Number(cfg?.listen?.introDaily ?? DEFAULT_LIMIT)
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : DEFAULT_LIMIT
}

export function loadQuotaLog(file = QUOTA_FILE) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    return Array.isArray(j?.log) ? j.log : []
  } catch { return [] }
}

/** 记账：跟 quota.json 共用一本账（status / 审计都能看到），只多打一个 intro 标记 */
export function recordIntro({ log = [], target = '', note = '', at = new Date().toISOString() } = {}) {
  return log.concat([{ at, type: 'comment', intro: true, auto: true, share: false, target: target || null, note: String(note ?? '').slice(0, 40) }])
}

/**
 * 能不能自己回：{ ok, why, used, limit }
 *   why: 'ok' | 'limit' | 'not-intro' | 'disabled'
 */
export function canIntro({ cfg, log, text = '', day = today() } = {}) {
  const limit = introLimit(cfg)
  const used = countIntro(log, day)
  if (text && !looksLikeIntro(text)) return { ok: false, why: 'not-intro', used, limit }
  if (limit <= 0) return { ok: false, why: 'disabled', used, limit }
  if (used >= limit) return { ok: false, why: 'limit', used, limit }
  return { ok: true, why: 'ok', used, limit }
}
