// 私信收件箱 / 发布台（outbox）—— 2026-10-21 v0.7
//
// 主人原话：「将 AI 发给我的私信显示在 DSH 里，经过我审批、修改后可以选择是否发布到评论区」。
//
// 设计：
//   · 她发给主人的**每一条私信**，除了真的发到 B站，还在本地留一份（本文件）→
//     DSH 里会出现一个「鱼的私信」窗口，主人看得见、改得动。
//   · 状态机只有四个：pending（待你过目）→ posted（已发评论）/ rejected（你否了）/ archived（归档）
//   · **发评论只能由主人在窗口里点**：这里不自动发、不预演成"好像发了" ✗
//   · 评论走 `comment`（无 --auto）：这是**主人授权**的发言，不占"她自主发言"的每日额度 ✓
//
// 隐私：正文只落本机 `~/.bili-ai/outbox.json`，不上传、不进日记。
import fs from 'node:fs'
import path from 'node:path'

const HOME = process.env.USERPROFILE || process.env.HOME || '.'
export const OUTBOX_FILE = path.join(HOME, '.bili-ai', 'outbox.json')
export const MAX_ITEMS = 300
export const MAX_TEXT = 1000          // B站评论上限
const DEDUPE_MS = 10 * 60 * 1000      // 10 分钟内同一条私信不重复入箱

export const STATUSES = ['pending', 'posted', 'rejected', 'archived']

export const emptyOutbox = () => ({ version: 1, items: [] })

/** 坏文件当作空的（不让窗口打不开），但**不覆盖**它 —— 下次 save 才写。 */
export function loadOutbox(file = OUTBOX_FILE) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    return { version: 1, items: Array.isArray(j?.items) ? j.items : [] }
  } catch { return emptyOutbox() }
}

export function saveOutbox(data, file = OUTBOX_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n')
  fs.renameSync(tmp, file)
}

export function newId(now = Date.now()) {
  return `ob_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

export function normalizeBv(text) {
  const m = String(text ?? '').match(/BV[0-9A-Za-z]{10}/)
  return m ? m[0] : ''
}

export function clampText(text, max = MAX_TEXT) {
  const s = String(text ?? '').replace(/\r\n/g, '\n').trim()
  return s.length > max ? s.slice(0, max) : s
}

/**
 * 评论表情（v0.8）：B站 的表情要**两份**才对得上 —— 正文里有转义符 `[笑哭]`，
 * 请求里还要带 emote 元数据。所以窗口/任务要单独记一个"表情名"，
 * 发的时候由 outbox post 补 `--emote "[笑哭]"` ✓
 * 2026-10-21 v0.9：从「最多 1 个」放开到**一条评论最多 3 个**（B站 本身就允许，是以前我们收窄了 ✗）
 * 这里只存名字（不带方括号）。
 */
export function normalizeEmote(v) {
  const s = String(v ?? '').replace(/[[\]]/g, '').replace(/\s+/g, '').trim()
  return s.slice(0, 24)
}

export const MAX_EMOTES = 3

/** 表情列表：认得字符串 / 数组 / 旧字段 `emote`；去重、截断到 MAX_EMOTES。 */
export function normalizeEmotes(v) {
  const arr = Array.isArray(v) ? v : (v == null || v === '' ? [] : [v])
  const out = []
  for (const x of arr) {
    const e = normalizeEmote(typeof x === 'object' && x ? x.text ?? x.emote : x)
    if (e && !out.includes(e)) out.push(e)
  }
  return out.slice(0, MAX_EMOTES)
}

/** 条目要发的表情（兼容 v0.8 只有单个 `emote` 字段的旧数据 ✓）。 */
export function emotesOf(item) {
  if (!item) return []
  return normalizeEmotes(Array.isArray(item.emotes) ? item.emotes : item.emote)
}

/**
 * 贴纸（自己的表情包图片）—— 2026-10-22。
 * ⚠️ 评论接口没有图片字段，所以这里只是"想在评论里当大表情发"的**实验**：
 *   发之前把图传到 B站 CDN，再把 URL 塞进 emote 元数据；服务端认不认由发完回读决定。
 */
export const MAX_STICKERS = 2

export function normalizeStickers(v) {
  const arr = Array.isArray(v) ? v : String(v ?? '').split(/[,，]/)
  const out = []
  for (const x of arr) {
    const n = String(x ?? '').replace(/\.(png|jpe?g|gif)$/i, '').trim().slice(0, 60)
    if (n && !out.includes(n)) out.push(n)
  }
  return out.slice(0, MAX_STICKERS)
}

/**
 * @ 谁（v0.9）：B站 评论接口**没有 @ 参数** —— @ 就是正文里的 `@昵称`，
 * 名字必须和对方现在的昵称一个字不差（改名就 @ 不到了）。这里只存名字（不带 @）。
 */
export function normalizeMentions(v) {
  const arr = Array.isArray(v) ? v : String(v ?? '').split(/[,，、\s]+/)
  const out = []
  for (const x of arr) {
    const n = String(x ?? '').replace(/^@+/, '').replace(/\s+/g, '').trim().slice(0, 30)
    if (n && !out.includes(n)) out.push(n)
  }
  return out.slice(0, 5)
}

/**
 * 入箱。返回 { item, created }（重复时不新建，把旧的 at 更新一下）。
 * 去重规则：**同样正文 + 10 分钟内** → 视为同一条（她一次醒来自言自语两条一样的，不该出现两行）。
 */
export function addItem(data, { text, bv = '', title = '', kind = 'dm', note = '', at = Date.now(), taskId = '', dedupe = true, emote = '', emotes = null, mentions = [], stickers = null }) {
  const body = clampText(text)
  if (!body) return { item: null, created: false }
  const bvid = normalizeBv(bv)
  // 任务草稿（kind='task'）不走去重：两条任务写出同一句正文，是两条活，不能合成一行 ✗
  const hit = dedupe
    ? (data.items ?? []).find((x) => x.status === 'pending' && x.text === body && at - new Date(x.at).getTime() < DEDUPE_MS)
    : null
  if (hit) {
    hit.at = new Date(at).toISOString()
    return { item: hit, created: false }
  }
  const item = {
    id: newId(at),
    at: new Date(at).toISOString(),
    kind: String(kind || 'dm'),
    text: body,
    edited: '',
    bv: bvid,
    title: clampText(title, 120),
    note: clampText(note, 200),
    taskId: String(taskId || '') || null,
    emotes: normalizeEmotes(emotes ?? emote),
    mentions: normalizeMentions(mentions),
    stickers: normalizeStickers(stickers),
    status: 'pending',
    postedAt: null,
    rpid: null,
    error: null,
  }
  data.items = [item, ...(data.items ?? [])]
  prune(data)
  return { item, created: true }
}

/** 只允许改这几项（正文/视频/标题/备注/表情），状态由 setStatus 管。 */
export function patchItem(data, id, patch = {}) {
  const item = (data.items ?? []).find((x) => x.id === id)
  if (!item) return null
  if (typeof patch.text === 'string') item.edited = clampText(patch.text)
  if (typeof patch.bv === 'string') item.bv = normalizeBv(patch.bv)
  if (typeof patch.title === 'string') item.title = clampText(patch.title, 120)
  if (typeof patch.note === 'string') item.note = clampText(patch.note, 200)
  if (patch.emotes !== undefined) item.emotes = normalizeEmotes(patch.emotes)
  else if (typeof patch.emote === 'string') item.emotes = normalizeEmotes(patch.emote)
  if (patch.mentions !== undefined) item.mentions = normalizeMentions(patch.mentions)
  if (patch.stickers !== undefined) item.stickers = normalizeStickers(patch.stickers)
  item.updatedAt = new Date().toISOString()
  return item
}

export function setStatus(data, id, status, extra = {}) {
  if (!STATUSES.includes(status)) return null
  const item = (data.items ?? []).find((x) => x.id === id)
  if (!item) return null
  item.status = status
  if (status === 'posted') {
    item.postedAt = extra.postedAt ?? new Date().toISOString()
    item.rpid = extra.rpid ?? item.rpid ?? null
    item.error = null
  }
  if (extra.error) item.error = clampText(extra.error, 300)
  return item
}

export function findItem(data, id) {
  return (data.items ?? []).find((x) => x.id === id) ?? null
}

/** 要发出去的正文：主人改过就用改的，没改就用原文。 */
export function effectiveText(item) {
  if (!item) return ''
  return clampText(item.edited || item.text)
}

export function stats(data) {
  const items = data.items ?? []
  return {
    total: items.length,
    pending: items.filter((x) => x.status === 'pending').length,
    posted: items.filter((x) => x.status === 'posted').length,
    rejected: items.filter((x) => x.status === 'rejected').length,
  }
}

/** 留最近 MAX_ITEMS 条；已处理的再按 30 天清一批（待审的永远不删 ✓）。 */
export function prune(data, now = Date.now()) {
  const items = data.items ?? []
  const keep = []
  for (const x of items) {
    const old = now - new Date(x.at).getTime() > 30 * 86400000
    if (old && x.status !== 'pending') continue
    keep.push(x)
  }
  data.items = keep.slice(0, MAX_ITEMS)
  return data
}
