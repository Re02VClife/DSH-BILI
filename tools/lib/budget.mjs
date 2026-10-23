// 预算（budget）—— 2026-10-21 v0.4
//
// 主人原话：「限制单个回复、单次视频的最大 token 开销」。
//
// ⚠️ 先把话说清楚（这也是本文件存在的理由）：
//   · 「单个回复」是**真硬顶**：宿主 `agent/request` 瀑布能改 `LlmCallConfig.maxTokens`，
//     这一层由 lib/index.js 直接下发，不是估算、不是嘱咐 ✓
//   · 「单次视频」**没法**在宿主侧硬顶 —— 模型读多少，取决于工具吐了多少字。
//     所以这一层做的是「读之前先算账」：字幕文件截断、热评条数、要不要抽帧，
//     全部在生成的**那一刻**就按预算裁好 ✓ 是"把水龙头拧小"，不是"事后记账"。
//   · 估算用**保守上限**：中文 1 字≈1 token（实际通常 0.6–0.8），宁可早停，
//     也别让一次深读吃掉一晚上的额度。所有数字都标「估算」，不冒充账单。
//
// 账单（whale-spend.jsonl）只有两类：工具的 `est`（估算，读之前就写）和
// 宿主的 `usage`（真实 usage，assistant/message 带回来的）——后者以宿主为准。
import fs from 'node:fs'
import path from 'node:path'

/** 一张 3x3 九宫格按 600 token/图 保守算（服务商不同会有出入，宁高勿低）。 */
export const FRAME_COST = 5400
/** 一次「只读文字」的初筛大致开销（标题 + 简介 + 字幕头尾 + 热评几条）。 */
export const SCREEN_COST = 2500

/** 保守估算 token：CJK 1/字，ASCII 1/4 字，其它 1/2 字。 */
export function estimateTokens(text) {
  const s = String(text ?? '')
  if (!s) return 0
  let cjk = 0, ascii = 0, other = 0
  for (const ch of s) {
    const c = ch.codePointAt(0)
    if ((c >= 0x3400 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff)) cjk += 1
    else if (c < 0x80) ascii += 1
    else other += 1
  }
  return Math.ceil(cjk + ascii / 4 + other / 2)
}

/**
 * 截断到预算字数：留头（70%）+ 尾（25%），中间打一行标记。
 * 为什么留尾：视频结论、反转、彩蛋常在最后几分钟；只砍尾会把"为什么值得看"砍没了。
 */
export function capText(text, maxChars) {
  const s = String(text ?? '')
  const cap = Math.max(80, Math.floor(Number(maxChars) || 0))
  if (s.length <= cap) return { text: s, cut: 0 }
  const head = Math.floor(cap * 0.7)
  const tail = Math.floor(cap * 0.25)
  const cut = s.length - head - tail
  return {
    text: s.slice(0, head) + `\n…〔预算所限，中间省略 ${cut} 字〕…\n` + s.slice(s.length - tail),
    cut,
  }
}

/**
 * 一条视频的读入方案（**读之前**就定好）。
 * @returns {{frames:boolean, subCap:number, comments:number, est:number, degraded:string[]}}
 */
export function planVideo({ subText = '', commentText = '', wantFrames = true, budgetTokens = 12000, maxComments = 8 } = {}) {
  const budget = Math.max(1000, Math.min(300000, Number(budgetTokens) || 12000))
  const degraded = []
  const subTok = estimateTokens(subText)
  const cmtTok = estimateTokens(commentText)
  const textTok = subTok + cmtTok

  // ① 先决定要不要抽帧：抽帧是固定的大头，挤掉了就没钱读字
  let frames = Boolean(wantFrames)
  if (frames && textTok + FRAME_COST > budget) {
    frames = false
    degraded.push(`字幕+热评约 ${textTok} token，加上抽帧 ${FRAME_COST} 会超 ${budget} → 这一条不抽帧`)
  }

  // ② 剩下的额度全给文字：字幕占 75%，热评占 25%
  const avail = Math.max(200, budget - (frames ? FRAME_COST : 0))
  const subBudget = Math.floor(avail * 0.75)
  const cmtBudget = Math.max(0, avail - subBudget)

  const { text: sub, cut } = capText(subText, subBudget)
  if (cut > 0) degraded.push(`字幕截掉 ${cut} 字（约 ${subTok - subBudget} token）`)

  // 热评：一条按上限 160 字算，超出预算就少给条数
  const perComment = 160
  let comments = Math.min(maxComments, Math.max(0, Math.floor(cmtBudget / perComment)))
  if (comments < maxComments && maxComments > 0) degraded.push(`热评 ${maxComments} 条 → ${comments} 条`)

  const est = (frames ? FRAME_COST : 0) + estimateTokens(sub) + comments * perComment * 0.8
  return { frames, subCap: subBudget, comments, est: Math.round(est), subText: sub, degraded }
}

/**
 * 一轮醒来怎么分配（喂给 wakePrompt 的"今天看几条"）。
 * 原则：先保底一条"看得懂"，剩下的钱才拿去多筛几条。
 */
export function planWake({ wakeMaxTokens = 60000, videoMaxTokens = 12000 } = {}) {
  const budget = Math.max(5000, Math.min(400000, Number(wakeMaxTokens) || 60000))
  const perVideo = Math.max(2000, Math.min(120000, Number(videoMaxTokens) || 12000))
  const notes = []

  let deep = Math.min(3, Math.floor(budget / (perVideo * 1.15)))
  if (deep < 1) {
    deep = 0
    notes.push(`预算 ${budget} < 一条深读（约 ${Math.round(perVideo * 1.15)}），这一轮只看不深读`)
  }
  let screen = Math.min(5, Math.floor((budget - deep * perVideo) / SCREEN_COST))
  if (screen < 1 && budget >= SCREEN_COST) screen = 1
  // 一条深读都没有时，也要至少筛一条（否则这一轮等于白醒）
  if (screen < 1 && deep < 1) {
    screen = 1
    notes.push('预算很紧：只筛一条，不深读')
  }
  // 初筛条数不必追平深读：深读是**上限**，不是义务（筛 2 条也能深读 2 条）
  if (deep > 0 && screen < deep) notes.push(`初筛只够 ${screen} 条（深读上限 ${deep} 条，看多少算多少）`)
  const plan = { screen, deep, perVideo, budget, est: screen * SCREEN_COST + deep * perVideo, notes }
  return plan
}

// ── 账单（估算 + 宿主真实 usage 都记这里，一行一条 JSONL）──────────────────

export function spendFile(home = (process.env.USERPROFILE || process.env.HOME || '.')) {
  // 跟插件侧同一份：优先 DSH_HOME（宿主进程里它才是真理），否则 ~/.dsh
  return path.join(process.env.DSH_HOME || path.join(home, '.dsh'), 'whale-spend.jsonl')
}

/** 追加一条。kind: 'video'（工具估算，读之前）| 'usage'（宿主真实，assistant/message） */
export function appendSpend(entry, file = spendFile()) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n')
    return true
  } catch { return false }
}

/** 读最近 N 小时的账，按 kind 汇总。坏行跳过（手改坏了也不该让预算脚本崩）。 */
export function summarizeSpend({ hours = 24, file = spendFile() } = {}) {
  const since = Date.now() - Math.max(1, Number(hours) || 24) * 3600 * 1000
  const out = { est: 0, input: 0, output: 0, cacheRead: 0, videos: 0, calls: 0, clamps: 0, lastClampAt: null, byBv: {} }
  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch { return out }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let e
    try { e = JSON.parse(line) } catch { continue }
    const t = new Date(e.at).getTime()
    if (!Number.isFinite(t) || t < since) continue
    if (e.kind === 'usage') {
      out.input += Number(e.input ?? 0)
      out.output += Number(e.output ?? 0)
      out.cacheRead += Number(e.cacheRead ?? 0)
      out.calls += 1
    } else if (e.kind === 'video') {
      out.est += Number(e.est ?? 0)
      out.videos += 1
      if (e.bv) out.byBv[e.bv] = (out.byBv[e.bv] ?? 0) + Number(e.est ?? 0)
    } else if (e.kind === 'clamp') {
      // 硬顶真的下发过（不是"配置里写了"）：这条是事后可审计的证据 ✓
      out.clamps += 1
      out.lastClampAt = e.at
    }
  }
  return out
}

/** 一行给人看的账。 */
export function spendLine(s, { wakeMaxTokens = 0 } = {}) {
  const actual = s.input + s.output
  const head = `近 24h：真实 ${actual} token（入 ${s.input} / 出 ${s.output} / 缓存读 ${s.cacheRead}，${s.calls} 次调用）`
  const tail = `工具估算 ${s.est} token（${s.videos} 条视频）`
  const cap = wakeMaxTokens ? ` · 单轮预算 ${wakeMaxTokens}` : ''
  return `${head}；${tail}${cap}`
}

/**
 * 把宿主要的 LlmCallConfig 夹到「单条回复上限」以内（纯函数，宿主侧直接拿去用）。
 * 三种情况：没设过 maxTokens → 补上；设得比上限大 → 压到上限；本来就小 → 原样返回（不抬）。
 */
export function clampReplyTokens(conf, capTokens) {
  const cap = Math.max(0, Math.floor(Number(capTokens) || 0))
  if (!cap || !conf || typeof conf !== 'object') return conf
  const cur = Number(conf.maxTokens)
  if (!Number.isFinite(cur) || cur > cap) return { ...conf, maxTokens: cap }
  return conf
}
