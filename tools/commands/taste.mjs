// 口味源 CLI —— 2026-10-21 v0.5
//
// 用法:
//   node bili.mjs taste sync            拉一遍：关注 + 收藏 + 历史 → ~/.bili-ai/taste.json
//   node bili.mjs taste sync --if-stale 超过 N 小时才拉（默认 24h；唤醒流程用这个，省请求）
//   node bili.mjs taste status          看现在手里有什么（不联网）
//
// 只读：不点赞、不收藏、不改任何东西。历史只有**登录账号自己**能读（B站限制）。
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../lib/config.mjs'
import { TASTE_FILE, syncTaste, loadTaste, saveTaste, tasteSummary, tasteIndex, tasteAgeHours } from '../lib/taste.mjs'

const argv = process.argv.slice(2)
const cmd = argv[0]
const opt = {}
for (let i = 1; i < argv.length; i += 1) {
  if (!argv[i].startsWith('--')) continue
  const key = argv[i].slice(2)
  const next = argv[i + 1]
  if (next === undefined || String(next).startsWith('--')) { opt[key] = true; continue }
  opt[key] = next
  i += 1
}

const HOME = process.env.USERPROFILE || process.env.HOME || '.'

function readCred() {
  try { return JSON.parse(fs.readFileSync(path.join(HOME, '.bili-ai', 'credentials.json'), 'utf8')) } catch {
    console.error('读不到凭据（~/.bili-ai/credentials.json）—— 先去设置页填 cookie')
    process.exit(3)
  }
}

async function navMid(cred) {
  try {
    const r = await fetch('https://api.bilibili.com/x/web-interface/nav', {
      headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://www.bilibili.com/', cookie: `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}` },
    })
    const j = await r.json()
    return j?.data?.isLogin ? { mid: String(j.data.mid), name: String(j.data.uname ?? '') } : null
  } catch { return null }
}

if (cmd === 'status' || !cmd) {
  const t = loadTaste()
  console.log('口味源：' + tasteSummary(t))
  if (t) {
    const o = t.owner ?? {}, s = t.self ?? {}
    console.log(`  档案：${TASTE_FILE}`)
    if (o.folders?.length) console.log('  主人收藏夹：' + o.folders.slice(0, 8).map((f) => `${f.title}(${f.count})`).join(' · ') + (o.folders.length > 8 ? ' …' : ''))
    const topics = (t.index?.topics ?? []).slice(0, 12)
    if (topics.length) console.log('  学到的口味词：' + topics.map(([k, v]) => `${k}·${v.toFixed(1)}`).join(' · '))
    if (t.errors?.length) console.log('  上次同步的失败项：\n    ' + t.errors.join('\n    '))
  }
  process.exit(0)
}

if (cmd === 'sync') {
  const cfg = config().taste ?? {}
  if (cfg.enabled === false) { console.log('（口味源关着 —— 设置页「口味源」打开，或把 config.taste.enabled 设 true）'); process.exit(0) }

  const staleH = Number(opt.hours ?? 24)
  const old = loadTaste()
  if (opt['if-stale'] && old) {
    const age = tasteAgeHours(old)
    if (age !== null && age < staleH && old.index) {
      console.log(`（口味档案 ${age.toFixed(1)} 小时前刚同步过，跳过；要强制就跑 taste sync）`)
      console.log('口味源：' + tasteSummary(old))
      process.exit(0)
    }
  }

  const cred = readCred()
  const me = await navMid(cred)
  const selfMid = me?.mid ?? String(config().self?.mid ?? '')
  const ownerMid = String(cfg.ownerMid || config().owner?.mid || '')
  if (!selfMid) { console.error('认不出登录账号 mid —— 先跑 `node bili.mjs session`'); process.exit(3) }
  console.log(`登录账号：${me?.name ?? '?'}（${selfMid}）`)
  console.log(`主人账号：${ownerMid || '（没配 owner.mid）'}`)
  console.log('开始同步（只读；每步之间有 300ms 间隔，别急）…')

  const t = await syncTaste({ cred, selfMid, ownerMid, cfg })
  saveTaste(t)
  console.log('')
  console.log('口味源：' + tasteSummary(t))
  const idx = tasteIndex(t)
  console.log(`  关注 ${idx.followMids.size} 人 · 收藏 ${idx.favoriteBvs.size} 条 BV · 历史 ${idx.historyBvs.size} 条 BV · 口味词 ${idx.topicWeights.size} 个`)
  if (opt.json) console.log(JSON.stringify(t.index, null, 2))
  if (t.errors?.length) {
    console.log('\n部分失败（不影响已拿到的部分）：')
    for (const e of t.errors) console.log('  ✗ ' + e)
  }
  console.log(`\n→ ${TASTE_FILE}`)
  process.exit(0)
}

console.error('用法: taste sync [--if-stale] [--hours 24] [--json] | taste status')
process.exit(2)

