// 表情库 —— 把 B 站评论区能用的官方表情同步到本地，打上语义标签，供她按语境挑。
//
// 为什么需要这一层：
//   B 站评论的"表情"不是图片上传，而是 **正文里的转义符**（如 `[笑哭]`）+ **接口的 emote 字段**
//   （告诉服务端这个转义符对应哪个 id/package/url）。转义符写错一个字，服务端就不认，
//   评论里只剩一行字面量 `[笑哭]` ✗ —— 所以"用什么表情"本质上是一张**受控词表**。
//
// 库文件：$WHALE_EMOTES 或 ~/.dsh/whale-emotes.json（人可读、可手改标签）
// 同步：node bili.mjs emotes sync（重新拉一遍包；B 站上新表情后跑一次）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const HOME = process.env.USERPROFILE || os.homedir() || '.'
export const LIB_PATH = process.env.WHALE_EMOTES || path.join(HOME, '.dsh', 'whale-emotes.json')
export const CRED_PATH = path.join(HOME, '.bili-ai', 'credentials.json')
const PANEL = 'https://api.bilibili.com/x/emote/user/panel?business=reply'

// 语义标签：按表情名/别名/所在包打。粗糙但够用 —— 真正的取舍交给写评论的人。
// 规则顺序有意义：先匹配到的先入标签，同一个表情可以有多个标签。
export const TAG_RULES = [
  ['笑', /笑|哈哈|呲牙|滑稽|doge|偷笑|坏笑|喜|妙|嘿嘿|乐|绷|草/],
  ['哭', /哭|泪|委屈|破防|抽泣|呜呜|悲/],
  ['惊', /惊|震惊|呆|愣|问号|啊|what|震撼|瞳孔/],
  ['怒', /怒|生气|掀桌|气|发火|怒|拍桌/],
  ['赞', /赞|good|ok|okk|打call|鼓掌|强|牛|厉害|支持|顶|一键三连/],
  ['爱', /爱心|喜欢|亲|抱|贴贴|星星眼|太爱|心|mua|比心/],
  ['无语', /无语|汗|尴尬|白眼|裂开|流汗|无奈|沉默|醉了/],
  ['困', /困|累|睡|躺|摆烂|眯|哈欠|下班/],
  ['吃', /吃|瓜|饭|茶|奶茶|零食|啃|饱/],
  ['害羞', /害羞|脸红|捂脸|娇羞|羞/],
  ['酷', /酷|墨镜|帅|得意|自信|doge_金箍/],
  ['怂', /怂|害怕|发抖|躲|慌|救命/],
  ['馋', /馋|口水|馋|想吃/],
]

/** 按名字猜标签（去括号、带别名，命中多条就全给）。 */
export function tagOf(text, alias = '', pkgName = '') {
  const s = `${String(text).replace(/[[\]]/g, '')} ${alias} ${pkgName}`.toLowerCase()
  const tags = new Set()
  for (const [tag, re] of TAG_RULES) if (re.test(s)) tags.add(tag)
  if (pkgName) tags.add(pkgName)
  return [...tags]
}

function readCred() {
  const c = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'))
  return { sessdata: c.sessdata, bili_jct: c.bili_jct, buvid3: c.buvid3 }
}

/**
 * 从 B 站拉一遍当前账号能用的评论表情包，写成本地库。
 * @returns {Promise<{packages:number, emotes:number, path:string}>}
 */
export async function sync() {
  const c = readCred()
  const r = await fetch(PANEL, {
    headers: {
      cookie: `SESSDATA=${c.sessdata}; bili_jct=${c.bili_jct}; buvid3=${c.buvid3}`,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      referer: 'https://www.bilibili.com/',
      accept: 'application/json, text/plain, */*',
    },
  })
  const j = await r.json()
  if (j.code !== 0) throw new Error(`表情包拉取失败 code=${j.code} ${j.message ?? ''}`)
  const packages = (j.data?.packages ?? []).map((p) => ({ id: p.id, text: p.text, n: (p.emote ?? []).length }))
  const emotes = []
  for (const p of j.data?.packages ?? []) {
    for (const e of p.emote ?? []) {
      emotes.push({
        text: e.text,
        id: e.id,
        package_id: e.package_id ?? p.id,
        type: e.type,
        url: e.url,
        meta: e.meta ?? {},
        mtime: e.mtime,
        tags: tagOf(e.text, e.meta?.alias ?? '', p.text),
      })
    }
  }
  const lib = { syncedAt: new Date().toISOString(), source: PANEL, packages, emotes }
  fs.mkdirSync(path.dirname(LIB_PATH), { recursive: true })
  fs.writeFileSync(LIB_PATH, JSON.stringify(lib, null, 2) + '\n')
  return { packages: packages.length, emotes: emotes.length, path: LIB_PATH }
}

/** 读本地库（没有就返回 null，让调用方决定要不要先 sync）。 */
export function load() {
  try { return JSON.parse(fs.readFileSync(LIB_PATH, 'utf8')) } catch { return null }
}

/** 按转义符精确找（`笑哭` 或 `[笑哭]` 都认）。 */
export function findByText(text) {
  const want = `[${String(text).replace(/^\[|\]$/g, '')}]`
  return (load()?.emotes ?? []).find((e) => e.text === want) ?? null
}

/** 模糊搜：名字/别名/标签都搜。 */
export function search(keyword) {
  const k = String(keyword).toLowerCase()
  return (load()?.emotes ?? []).filter((e) =>
    e.text.toLowerCase().includes(k) || (e.tags ?? []).some((t) => t.toLowerCase().includes(k)))
}

/** 按标签随机挑 n 个（给"这条评论想表达什么"用）。 */
export function pick(tag, n = 3) {
  const pool = search(tag)
  const shuffled = pool.sort(() => Math.random() - 0.5)
  return shuffled.slice(0, Math.max(1, n))
}

/** 评论接口要的 emote 字段：转义符 → 表情元数据。 */
export function apiMap(emotes) {
  const out = {}
  for (const e of emotes) {
    out[e.text] = {
      id: e.id,
      package_id: e.package_id,
      state: 0,
      type: e.type,
      text: e.text,
      url: e.url,
      meta: e.meta ?? {},
      mtime: e.mtime,
    }
  }
  return out
}

/**
 * 2026-10-21 v0.9：从正文里认出「库里有」的表情（`[笑哭]` → `笑哭`）。
 * 为什么要有它：表情必须**两份**（正文里的转义符 + 接口元数据），
 *   漏了元数据就只剩一对字面上的方括号 ✗ —— 而方括号是写正文时最自然会被写进去的东西。
 *   所以交稿/发布时**自动补一次**，作者不用记着再传一遍参数 ✓
 * 只认库里真有的（写 `[随便什么]` 不会被当成表情，避免把正文搞坏）。
 */
export function detect(text, max = 3) {
  const lib = load()
  if (!lib) return []
  const known = new Set((lib.emotes ?? []).map((e) => e.text))
  const out = []
  for (const m of String(text ?? '').matchAll(/\[[^\]\n]{1,24}\]/g)) {
    if (known.has(m[0]) && !out.includes(m[0].slice(1, -1))) out.push(m[0].slice(1, -1))
    if (out.length >= max) break
  }
  return out
}
