// 指定清单（watchlist）—— 2026-10-21 v0.4
//
// 主人原话：「观看我指定的 UP 主或指定的视频」。
// v0.3 之前没有这个概念：选题只有「偏好关键词 + 热门 + 排行 + 关注流」四路，
// 关注了 ≠ 一定会看（还要跟热门一起抢那 5 个名额）。这里补的就是「点名」。
//
// 本文件只做两件事：
//   ① 纯函数：把「人写的一行」解析成结构化条目（设置页 / CLI / 配置读写都走它，一处口径）
//   ② 取数：按 mid 拉最新投稿、按 BV 拉元信息 —— 失败自动降级并**说清降到了哪一路**
//
// ⚠️ 取数不在这里判断「值不值得看」，也不发任何评论：它只把候选交回去。
import crypto from 'node:crypto'

export const MAX_UPS = 50
export const MAX_VIDEOS = 200

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

// ── ① 解析（纯函数，测试覆盖）────────────────────────────────────────────

/** 从任意输入里抠出 BV 号（支持裸 BV / 完整链接 / 带参数的链接）。 */
export function pickBv(text) {
  const m = String(text ?? '').match(/BV[0-9A-Za-z]{10}/)
  return m ? m[0] : ''
}

/** 从任意输入里抠出 mid（支持裸数字 / 空间链接 / 带 ?from= 的空间链接 / `123456 名字`）。 */
export function pickMid(text) {
  const s = String(text ?? '').trim()
  const direct = s.match(/^\d{3,12}$/)
  if (direct) return direct[0]
  const space = s.match(/space\.bilibili\.com\/(\d+)/i)
  if (space) return space[1]
  // 兜底：link 里可能带 mid 参数
  const q = s.match(/[?&](?:mid|uid|vmid)=(\d+)/i)
  if (q) return q[1]
  // 再兜底：`123456 名字` 这种「数字打头」的行（设置页最常这么写）
  const loose = s.match(/(?:^|[^\d])(\d{3,12})(?!\d)/)
  return loose ? loose[1] : ''
}

/**
 * 解析「指定 UP」的一行。
 * 认：`123456 名字` / `123456` / `https://space.bilibili.com/123456`（后面可跟名字）
 */
export function parseUpLine(line) {
  const raw = String(line ?? '').trim()
  if (!raw || raw.startsWith('#')) return null
  const mid = pickMid(raw)
  if (!mid) return null
  // 名字：去掉链接/数字后剩下的那段
  let name = raw
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(new RegExp(mid, 'g'), ' ')
    .replace(/[|,，、\t]+/g, ' ')
    .trim()
    .slice(0, 40)
  return { mid, name }
}

/**
 * 解析「指定视频」的一行。
 * 认：`BV1xx411c7mD` / `BV1xx411c7mD 备注` / `https://www.bilibili.com/video/BV1xx411c7mD/`
 */
export function parseVideoLine(line) {
  const raw = String(line ?? '').trim()
  if (!raw || raw.startsWith('#')) return null
  const bv = pickBv(raw)
  if (!bv) return null
  const note = raw
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(new RegExp(bv, 'g'), ' ')
    .replace(/[|,，、\t]+/g, ' ')
    .trim()
    .slice(0, 60)
  return { bv, note }
}

/**
 * 归一化 + **回报被丢掉的行**（2026-10-21 修：设置页"填了保存不了"的真凶）。
 * 以前只返回 { ups, videos }，认不出的行被静默丢掉 → 保存 200、界面清空，看起来像"没保存" ✗
 * 现在 rejected 里逐行回话，宿主会把它当 warn 返回给设置页。
 */
export function parseWatchlist(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const upsIn = Array.isArray(src.ups) ? src.ups : (typeof src.upsText === 'string' ? src.upsText.split('\n') : [])
  const videosIn = Array.isArray(src.videos) ? src.videos : (typeof src.videosText === 'string' ? src.videosText.split('\n') : [])

  const rejected = []
  const ups = []
  const seenMid = new Set()
  for (const item of upsIn) {
    const one = typeof item === 'string' ? parseUpLine(item) : (item && pickMid(item.mid ?? item.url) ? { mid: String(pickMid(item.mid ?? item.url)), name: String(item.name ?? '').slice(0, 40) } : null)
    if (!one) { pushReject(rejected, item); continue }
    if (seenMid.has(one.mid)) continue
    seenMid.add(one.mid)
    ups.push(one)
    if (ups.length >= MAX_UPS) break
  }

  const videos = []
  const seenBv = new Set()
  for (const item of videosIn) {
    const one = typeof item === 'string' ? parseVideoLine(item) : (item && pickBv(item.bv ?? item.url) ? { bv: pickBv(item.bv ?? item.url), note: String(item.note ?? '').slice(0, 60) } : null)
    if (!one) { pushReject(rejected, item); continue }
    if (seenBv.has(one.bv)) continue
    seenBv.add(one.bv)
    videos.push(one)
    if (videos.length >= MAX_VIDEOS) break
  }
  return { ups, videos, rejected }
}

function pushReject(list, item) {
  const text = typeof item === 'string' ? item.trim() : (item ? `（对象）${JSON.stringify(item)}` : '')
  if (!text) return
  list.push(text.length > 80 ? text.slice(0, 80) + '…' : text)
}

/** 只要结果、不要 rejected 时的轻量版（历史调用方都走它）。 */
export function normalizeWatchlist(raw) {
  const { ups, videos } = parseWatchlist(raw)
  return { ups, videos }
}

// ── 短链展开（b23.tv）：设置页最常粘贴的就是它，必须认 ─────────────────────
// 只对含 b23.tv 的行发请求；一次保存最多展开 5 条；失败原样返回（交给 rejected 报告）。
const SHORT_LINK = /https?:\/\/b23\.tv\/[A-Za-z0-9]+/i

export async function expandShortLink(text, { timeoutMs = 4000 } = {}) {
  const m = String(text ?? '').match(SHORT_LINK)
  if (!m) return String(text ?? '')
  try {
    const r = await fetch(m[0], {
      redirect: 'follow',
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(timeoutMs),
    })
    const finalUrl = String(r.url ?? '')
    if (!pickBv(finalUrl)) return String(text ?? '')
    return String(text).replace(SHORT_LINK, finalUrl)
  } catch {
    return String(text ?? '')
  }
}

/** 把 watchlist 里的短链批量展开（不认识的保持原样）。 */
export async function expandWatchlistLinks(raw, { limit = 5 } = {}) {
  const src = raw && typeof raw === 'object' ? raw : {}
  let budget = limit
  const map = async (arr) => {
    if (!Array.isArray(arr)) return arr
    const out = []
    for (const item of arr) {
      if (typeof item === 'string' && SHORT_LINK.test(item) && budget > 0) {
        budget -= 1
        out.push(await expandShortLink(item))
      } else out.push(item)
    }
    return out
  }
  return { ...src, ups: await map(src.ups), videos: await map(src.videos) }
}

/** 回写成设置页的两段多行文本（保存后仍可读 ✓）。 */
export function watchlistToText(wl) {
  const w = normalizeWatchlist(wl)
  return {
    upsText: w.ups.map((u) => (u.name ? `${u.mid} ${u.name}` : u.mid)).join('\n'),
    videosText: w.videos.map((v) => (v.note ? `${v.bv} ${v.note}` : v.bv)).join('\n'),
  }
}

/** 排序：指定清单永远排在候选池最前面（保持各自原有顺序）。 */
export function prioritize(candidates) {
  const forced = candidates.filter((x) => x && x._forced)
  const rest = candidates.filter((x) => !x || !x._forced)
  return [...forced, ...rest]
}

export const isForced = (x) => Boolean(x && x._forced)

// ── ② WBI 签名（与仓库里其它脚本同一套；新代码只在这份里）────────────────

const MIXIN_TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52]
const keyOf = (u) => String(u ?? '').slice(String(u ?? '').lastIndexOf('/') + 1, String(u ?? '').lastIndexOf('.'))
const clean = (v) => String(v).replace(/[!'()*]/g, '')

function headersOf(cred, referer) {
  const c = cred ?? {}
  return {
    'user-agent': UA,
    referer,
    cookie: `SESSDATA=${c.sessdata ?? ''}; bili_jct=${c.bili_jct ?? ''}; buvid3=${c.buvid3 ?? ''}`,
  }
}

async function jget(url, headers) {
  const r = await fetch(url, { headers })
  const t = await r.text()
  try { return JSON.parse(t) } catch { return { code: -1, message: `非 JSON（HTTP ${r.status}）`.slice(0, 80) } }
}

/** 拿一次 WBI mixin key（每次进程内只取一次）。 */
function makeWbi(mixin) {
  return (params) => {
    const wts = Math.round(Date.now() / 1000)
    const all = { ...params, wts }
    const q = Object.keys(all).sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(clean(k === 'wts' ? wts : all[k]))}`).join('&')
    return `${q}&w_rid=${crypto.createHash('md5').update(q + mixin).digest('hex')}`
  }
}

async function getWbi(cred) {
  const nav = await jget('https://api.bilibili.com/x/web-interface/nav', headersOf(cred, 'https://www.bilibili.com/'))
  const raw = keyOf(nav?.data?.wbi_img?.img_url) + keyOf(nav?.data?.wbi_img?.sub_url)
  const mixin = MIXIN_TAB.map((i) => raw[i]).join('').slice(0, 32)
  return mixin.length === 32 ? makeWbi(mixin) : null
}

const parseDur = (s) => {
  if (typeof s === 'number') return s
  const p = String(s ?? '').split(':').map(Number)
  if (p.some((x) => !Number.isFinite(x))) return 0
  return p.length === 2 ? p[0] * 60 + p[1] : p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : 0
}

// ── ③ 取数（网络；每一步失败都要能说清原因）──────────────────────────────

/**
 * 一个 UP 的最新投稿。
 * 三条路，按可靠性依次降级：
 *   ① 空间投稿页（wbi 签名）—— 最全，但空间接口风控最凶
 *   ② 搜索（按 UP 名）→ 用结果里的 mid 过滤 —— 名字准的话够用
 *   ③ 关注流（由 feed 那边负责，这里不重复）
 * 返回 { items, source, error? }：source 就是"这次走的哪条路"，会打进日志。
 */
export async function fetchUpVideos(cred, up, { ps = 10, wbi = null } = {}) {
  const { mid, name } = up
  const referer = `https://space.bilibili.com/${mid}/video`

  // ① 空间投稿
  if (wbi) {
    try {
      const q = wbi({
        mid, ps, pn: 1, order: 'pubdate', platform: 'web', web_location: 1550101,
        dm_img_list: '[]',
        dm_img_str: 'V2ViR0wgMS4wIChPcGVuR0wgRVMgMi4wIENocm9taXVtKQ',
        dm_cover_img_str: 'QU5HTEUgKEludGVsLCBJbnRlbChSKSBVSEQgR3JhcGhpY3MgNjMwICgweDAwMDAzRTlCKSBEaXJlY3QzRDExIHZzXzVfMCBwc181XzApLCBvciBzaW1pbGFy',
        dm_img_inter: '{"ds":[],"wh":[0,0,0],"of":[0,0,0]}',
      })
      const j = await jget(`https://api.bilibili.com/x/space/wbi/arc/search?${q}`, headersOf(cred, referer))
      if (j?.code === 0) {
        const list = j?.data?.list?.vlist ?? []
        return {
          source: 'space',
          items: list.map((it) => ({
            bv: it.bvid, t: String(it.title ?? '').replace(/<[^>]+>/g, ''), d: parseDur(it.length),
            up: it.author ?? name ?? '', mid, play: Number(it.play ?? 0), pubdate: Number(it.created ?? it.pubdate ?? 0),
          })).filter((x) => x.bv),
        }
      }
      // 风控/未开门：记下码，继续降级
      if (j?.code !== 0) {
        const fallback = await bySearch(cred, up)
        if (fallback.items.length) return { ...fallback, error: `空间接口 code=${j?.code}，已降级到搜索` }
        return { source: 'none', items: [], error: `空间接口 code=${j?.code}；搜索也没命中（${fallback.error ?? '无结果'}）` }
      }
    } catch (e) {
      const fallback = await bySearch(cred, up)
      if (fallback.items.length) return { ...fallback, error: `空间接口异常（${String(e.message).slice(0, 60)}），已降级到搜索` }
      return { source: 'none', items: [], error: `空间接口异常：${String(e.message).slice(0, 80)}` }
    }
  }
  return bySearch(cred, up)
}

/** 按 UP 名搜视频，再用结果里的 mid 过滤（名字不准就空手而归，不瞎猜）。 */
async function bySearch(cred, up) {
  const { mid, name } = up
  if (!name) return { source: 'none', items: [], error: '没有名字可搜（只填了 mid，空间接口又没开门）' }
  try {
    const wbi = await getWbi(cred)
    if (!wbi) return { source: 'none', items: [], error: '拿不到 WBI 材料' }
    const q = wbi({ search_type: 'video', keyword: name, order: 'pubdate', page: 1 })
    const j = await jget(`https://api.bilibili.com/x/web-interface/wbi/search/type?${q}`, headersOf(cred, 'https://search.bilibili.com/'))
    const list = (j?.data?.result ?? []).filter((it) => String(it.mid ?? '') === String(mid))
    return {
      source: 'search',
      items: list.map((it) => ({
        bv: it.bvid, t: String(it.title ?? '').replace(/<[^>]+>/g, ''), d: parseDur(it.duration),
        up: it.author ?? name, mid, play: Number(it.play ?? 0), pubdate: Number(it.pubdate ?? 0),
      })).filter((x) => x.bv),
      error: list.length ? undefined : '搜索里没有这个 mid 的投稿（名字可能填得不对）',
    }
  } catch (e) {
    return { source: 'none', items: [], error: `搜索失败：${String(e.message).slice(0, 80)}` }
  }
}

/** 一条指定视频的元信息（只读）。 */
export async function fetchVideoMeta(cred, bv) {
  try {
    const j = await jget(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bv)}`, headersOf(cred, `https://www.bilibili.com/video/${bv}/`))
    if (j?.code !== 0 || !j?.data) return { ok: false, error: `code=${j?.code} ${j?.message ?? ''}`.slice(0, 80) }
    const d = j.data
    return {
      ok: true,
      item: {
        bv: d.bvid, t: String(d.title ?? ''), d: Number(d.duration ?? 0),
        up: d.owner?.name ?? '', mid: String(d.owner?.mid ?? ''), play: Number(d.stat?.view ?? 0), pubdate: Number(d.pubdate ?? 0),
      },
    }
  } catch (e) {
    return { ok: false, error: String(e.message).slice(0, 80) }
  }
}

/** 给 CLI / feed 共用：把整份 watchlist 变成候选（并标 `_forced`）。 */
export async function resolveWatchlist(cred, wl, { perUp = 8, log = () => {} } = {}) {
  const w = normalizeWatchlist(wl)
  const items = []
  const errors = []
  let wbi = null
  // 只有配了 UP 才需要 WBI 材料（视频元信息接口不用签名 —— 少一次请求就少一分风控）
  if (w.ups.length) {
    try { wbi = await getWbi(cred) } catch (e) { log(`WBI 材料取不到：${String(e.message).slice(0, 60)}（空间接口会跳过）`) }
  }

  for (const v of w.videos) {
    const r = await fetchVideoMeta(cred, v.bv)
    if (r.ok) items.push({ ...r.item, kw: '指定视频', note: v.note, _forced: true })
    else { errors.push(`指定视频 ${v.bv} 取不到：${r.error}`); log(errors.at(-1)) }
  }

  for (const u of w.ups) {
    const r = await fetchUpVideos(cred, u, { ps: perUp, wbi })
    if (r.error) { errors.push(`指定 UP ${u.mid}：${r.error}`); log(errors.at(-1)) }
    for (const it of r.items.slice(0, perUp)) items.push({ ...it, kw: '指定UP', source: r.source, _forced: true })
  }
  return { items, errors, counts: { ups: w.ups.length, videos: w.videos.length } }
}
