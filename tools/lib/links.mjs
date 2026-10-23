// 简介里的链接（2026-10-21 v0.8）—— 给评论格式「读简介链接」用
//
// 为什么单独做一条命令：
//   任务台里有一种活是「把简介里的链接读一遍」。简介里的链接三种形态：
//     ① 完整 URL ② b23.tv 短链（不展开根本不知道是什么）③ 裸 BV / av 号
//   debrief 只把简介印前 300 字、且不识别链接 ✗ —— 她拿不到"点开是什么"，只能瞎编。
//   这个文件只做一件便宜事：**取出来 + 展开 + 取网页标题**，判断留给模型 ✓

/** 从任意文本里抠链接（保持出现顺序、去重、剥掉尾部标点） */
export function extractLinks(text, { max = 8 } = {}) {
  const s = String(text ?? '')
  const out = []
  const seen = new Set()
  const push = (u) => {
    const url = String(u).replace(/[.,;:!?，。；：！？、）)\]】」』"'>]+$/u, '')
    if (!url || seen.has(url)) return
    seen.add(url)
    out.push(url)
  }
  // ① 带协议的完整链接
  for (const m of s.matchAll(/https?:\/\/[^\s<>"'）)】」』，。；、]+/gu)) push(m[0])
  // ② 不带协议的短链（简介里很常见：b23.tv/xxxxx）
  for (const m of s.matchAll(/\b((?:b23|bili22|bili23|bili2233)\.(?:tv|cn)\/[A-Za-z0-9]+)/gu)) push(`https://${m[1]}`)
  // ③ 裸 BV / av 号（UP 主经常只写个号）
  for (const m of s.matchAll(/(?<![0-9A-Za-z])(BV[0-9A-Za-z]{10})(?![0-9A-Za-z])/g)) push(`https://www.bilibili.com/video/${m[1]}`)
  for (const m of s.matchAll(/(?<![0-9A-Za-z])av(\d{1,12})(?![0-9A-Za-z])/gi)) push(`https://www.bilibili.com/video/av${m[1]}`)
  return out.slice(0, Math.max(1, max))
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' }

/** 从 HTML 里取网页标题（取不到就返回空串，不抛） */
export function pickTitle(html) {
  const m = String(html ?? '').match(/<title[^>]*>([\s\S]{1,400}?)<\/title>/i)
  if (!m) return ''
  return m[1]
    .replace(/&(#?\w+);/g, (all, k) => (k.startsWith('#') ? all : (ENT[k.toLowerCase()] ?? all)))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

/** 短链？展开才有意义（不展开的话标题就是「bilibili」） */
export const isShortLink = (url) => /^(?:https?:\/\/)?(?:b23|bili22|bili23|bili2233)\.(?:tv|cn)\//i.test(String(url ?? ''))
