// 贴纸库 —— 把本地的表情包图片编成一份索引，供私信发图时按名字挑。
//
// 为什么不做成"评论表情"：B 站评论的"表情"只认官方表情包转义符；自己的图走 `pictures` 字段（v0.11 起支持）
// 图片能去的地方只有两个：**动态**（已有 dynamic-image）和**私信**（这套）。
//
// 库文件：$WHALE_STICKERS 或 ~/.dsh/whale-stickers.json
// 同步：node bili.mjs stickers sync --dir "…\\表情包"
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const HOME = process.env.USERPROFILE || os.homedir() || '.'
export const LIB_PATH = process.env.WHALE_STICKERS || path.join(HOME, '.dsh', 'whale-stickers.json')
const EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif'])

/** 只认 png/jpg/gif（B 站上传接口收这三种）。 */
export function kindOf(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'png'
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.length > 6 && buf.toString('latin1', 0, 3) === 'GIF') return 'gif'
  return 'unknown'
}

/** 从文件头读宽高（不引第三方库）。 */
export function dimsOf(buf, kind) {
  try {
    if (kind === 'png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
    if (kind === 'gif') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
    if (kind === 'jpg') {
      let i = 2
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i += 1; continue }
        const m = buf[i + 1]
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
        }
        i += 2 + buf.readUInt16BE(i + 2)
      }
    }
  } catch {}
  return null
}

/** 扫一个目录，写成索引。tags/desc 会从旧库或 --tags 文件里继承（重扫不丢标注）。 */
export function scan(dir, tagFile = '') {
  const abs = path.resolve(dir)
  if (!fs.existsSync(abs)) throw new Error(`目录不存在：${abs}`)
  const prev = load()
  const prevByFile = new Map((prev?.stickers ?? []).map((s) => [s.file, s]))
  let extra = {}
  if (tagFile) {
    if (!fs.existsSync(tagFile)) throw new Error(`标签文件不存在：${tagFile}`)
    extra = JSON.parse(fs.readFileSync(tagFile, 'utf8'))
  }
  const stickers = []
  for (const name of fs.readdirSync(abs)) {
    const full = path.join(abs, name)
    if (!fs.statSync(full).isFile()) continue
    if (!EXTS.has(path.extname(name).toLowerCase())) continue
    const buf = fs.readFileSync(full)
    const kind = kindOf(buf)
    if (kind === 'unknown') continue
    const dims = dimsOf(buf, kind)
    const meta = extra[name] ?? {}
    const old = prevByFile.get(name) ?? {}
    stickers.push({
      name: path.basename(name, path.extname(name)),
      file: name,
      path: full,
      type: kind,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      bytes: buf.length,
      tags: meta.tags ?? old.tags ?? [],
      desc: meta.desc ?? old.desc ?? '',
    })
  }
  stickers.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  const lib = { updatedAt: new Date().toISOString(), dir: abs, stickers }
  fs.mkdirSync(path.dirname(LIB_PATH), { recursive: true })
  fs.writeFileSync(LIB_PATH, JSON.stringify(lib, null, 2) + '\n')
  return lib
}

export function load() {
  try { return JSON.parse(fs.readFileSync(LIB_PATH, 'utf8')) } catch { return null }
}

/** 按名字（或直接给路径）找一张贴纸。 */export function find(nameOrPath) {
  const s = String(nameOrPath)
  if (/[\\/]/.test(s) && fs.existsSync(s)) {
    const buf = fs.readFileSync(s)
    const kind = kindOf(buf)
    const dims = dimsOf(buf, kind)
    return { name: path.basename(s, path.extname(s)), file: path.basename(s), path: path.resolve(s), type: kind, width: dims?.width ?? null, height: dims?.height ?? null, bytes: buf.length }
  }
  const want = s.replace(/\.(png|jpe?g|gif)$/i, '')
  return (load()?.stickers ?? []).find((x) => x.name === want) ?? null
}

/** 按标签挑（名字或描述里也搜，方便"这条回复该配哪张"）。 */
export function byTag(keyword) {
  const k = String(keyword).toLowerCase()
  return (load()?.stickers ?? []).filter((s) =>
    (s.tags ?? []).some((t) => t.toLowerCase().includes(k))
    || s.name.toLowerCase().includes(k)
    || String(s.desc ?? '').toLowerCase().includes(k))
}

/** 库里出现过的全部标签。 */
export function allTags() {
  const set = new Set()
  for (const s of load()?.stickers ?? []) for (const t of s.tags ?? []) set.add(t)
  return [...set]
}

/** 改一张贴纸的标签/描述，直接写回库文件。 */
export function setTags(name, tags, desc) {
  const lib = load()
  if (!lib) throw new Error('还没有贴纸库')
  const s = lib.stickers.find((x) => x.name === name)
  if (!s) throw new Error(`没有叫「${name}」的贴纸`)
  if (tags) s.tags = tags
  if (desc !== undefined) s.desc = desc
  fs.writeFileSync(LIB_PATH, JSON.stringify(lib, null, 2) + '\n')
  return s
}
