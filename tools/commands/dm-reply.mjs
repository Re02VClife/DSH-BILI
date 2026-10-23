// 回复私信（2026-10-22）—— 唯一一个"对陌生人说话"的口子，默认关
//
// 为什么要有它：`dm` 写死只发主人，别人私信她时她完全没法回（连"你好"都发不出去）。
//   但现实里会有人先来打招呼 / 问「你是谁」—— 完全不回不礼貌，放开又容易变成骚扰号。
// 所以规则全部写死在代码里（`tools/lib/dm-reply.mjs`）：
//   开关要在设置页打开 · 对方必须**先**给她发私信（72h 内）· 必须互关 ·
//   一天最多 1 条 · 同一个人 30 天一次 · 正文 ≤200 字
//
// 用法:
//   node dm-reply.mjs --list [--hours 72] [--json]        看"谁先找过她"
//   node dm-reply.mjs --to <mid> --msg "…" [--incoming "他的原话"] --dry|--go
//
// --incoming：把对方原话带进来 → 如果是「自我介绍」类，会**同时消耗自我介绍额度**（一天 1 次）
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { config } from '../lib/config.mjs'
import { canReply, recordReply, loadLedger, countToday, replyCfg, looksLikeAutoGreeting, withCostNote, PER_PERSON_DAYS } from '../lib/dm-reply.mjs'
import { todayUsage } from '../lib/usage.mjs'
import { looksLikeIntro, canIntro, countIntro, recordIntro, loadQuotaLog, introLimit, QUOTA_FILE } from '../lib/intro.mjs'

const argv = process.argv.slice(2)
const opt = {}
for (let i = 0; i < argv.length; i += 1) {
  if (!argv[i].startsWith('--')) continue
  const v = argv[i + 1]
  if (v === undefined || v.startsWith('--')) opt[argv[i].slice(2)] = true
  else { opt[argv[i].slice(2)] = v; i += 1 }
}

const HOME = process.env.USERPROFILE || process.env.HOME || '.'
const LEDGER = path.join(HOME, '.bili-ai', 'dm-reply.json')
const cred = JSON.parse(fs.readFileSync(path.join(HOME, '.bili-ai', 'credentials.json'), 'utf8'))
const cfg = config()
const c = replyCfg(cfg)
const H = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  referer: 'https://www.bilibili.com/',
  cookie: `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}`,
}
const parsed = (content) => {
  try { const j = JSON.parse(String(content)); return String(j.content ?? j.text ?? content) } catch { return String(content ?? '') }
}
const saveLedger = (log) => {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true })
  fs.writeFileSync(LEDGER, JSON.stringify({ log }, null, 2) + '\n')
}

async function sessions(myMid) {
  const u = 'https://api.vc.bilibili.com/session_svr/v1/session_svr/get_sessions?session_type=1&group_id=0&count=30&mobi_app=web'
  const r = await fetch(u, { headers: H })
  const j = await r.json().catch(() => ({}))
  if (j.code !== 0) throw new Error(`get_sessions code=${j.code} ${j.message ?? ''}`)
  return (j.data?.session_list ?? []).map((s) => {
    const last = s.last_msg ?? {}
    const senderUid = String(last.sender_uid ?? '')
    return {
      mid: String(s.talker_id ?? ''),
      name: String(s.talker_info?.uname ?? s.account_info?.uname ?? ''),
      ts: Number(last.timestamp ?? 0),
      text: parsed(last.content),
      unread: Number(s.unread_count ?? 0),
      senderUid,
      // "他先找她"要求最后一条是他发的（不是我）
      fromThem: !!senderUid && senderUid !== String(myMid),
    }
  }).filter((s) => s.mid)
}

async function me() {
  const j = await (await fetch('https://api.bilibili.com/x/web-interface/nav', { headers: H })).json()
  if (!j.data?.isLogin) throw new Error('cookie 失效')
  return { mid: String(j.data.mid), uname: j.data.uname }
}

async function mutual(mid) {
  const j = await (await fetch(`https://api.bilibili.com/x/relation?fid=${mid}`, { headers: H })).json()
  return j.code === 0 ? Number(j.data?.attribute ?? -1) === 6 : false
}

async function send(toMid, text) {
  const info = await me()
  const body = new URLSearchParams()
  body.set('msg[sender_uid]', info.mid)
  body.set('msg[receiver_id]', String(toMid))
  body.set('msg[receiver_type]', '1')
  body.set('msg[msg_type]', '1')
  body.set('msg[msg_status]', '0')
  body.set('msg[timestamp]', String(Math.floor(Date.now() / 1000)))
  body.set('msg[dev_id]', 'WEB-' + crypto.randomUUID().toUpperCase())
  body.set('msg[content]', JSON.stringify({ content: text }))
  body.set('csrf', String(cred.bili_jct))
  const r = await fetch('https://api.vc.bilibili.com/web_im/v1/web_im/send_msg', {
    method: 'POST',
    headers: { ...H, 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const j = await r.json().catch(() => ({}))
  return { http: r.status, code: j.code, message: j.message, data: j.data }
}

// ── list ────────────────────────────────────────────────────────────
if (opt.list) {
  const hours = Number(opt.hours ?? c.hours)
  const info = await me()
  const list = (await sessions(info.mid)).filter((s) => s.fromThem && s.ts && (Date.now() / 1000 - s.ts) / 3600 <= hours)
  list.sort((a, b) => b.ts - a.ts)
  if (opt.json) { console.log(JSON.stringify({ enabled: c.enabled, daily: c.daily, used: countToday(loadLedger(LEDGER)), items: list }, null, 2)); process.exit(0) }
  console.log(`回复私信：${c.enabled ? '开' : '关（设置页 → 全天监听 → 允许回复私信）'} · 今天已回 ${countToday(loadLedger(LEDGER))}/${c.daily} · 窗口 ${hours}h`)
  if (!list.length) console.log('（最近没有人先给她发私信）')
  for (const s of list) {
    const ageH = ((Date.now() / 1000 - s.ts) / 3600).toFixed(0)
    const auto = looksLikeAutoGreeting(s.text)
    console.log(`  ${new Date(s.ts * 1000).toLocaleString('zh-CN', { hour12: false })}（${ageH}h 前）  mid ${s.mid}${s.name ? ' ' + s.name : ''}${s.unread ? ' 未读' + s.unread : ''}${auto ? '  ⚠️ 疑似自动回复（别回）' : ''}`)
    console.log(`     ${String(s.text).replace(/\s+/g, ' ').slice(0, 80)}`)
  }
  process.exit(0)
}

// ── reply ───────────────────────────────────────────────────────────
const to = String(opt.to ?? '').trim()
const msg = String(opt.msg ?? '').trim()
if (!to || !msg) { console.error('用法: dm-reply --list | dm-reply --to <mid> --msg "…" [--incoming "他的原话"] --dry|--go'); process.exit(2) }
if (!opt.dry && !opt.go) { console.error('必须显式 --dry 或 --go'); process.exit(2) }

const info = await me()
const all = await sessions(info.mid)
const target = all.find((s) => s.mid === to)
if (!target) { console.error(`✗ 会话列表里没有 ${to}（对方得先给你发过私信）`); process.exit(3) }

const verdict = canReply({ cfg, ledger: loadLedger(LEDGER), mid: to, lastFromThem: target.fromThem, lastTs: target.ts })
const whyText = {
  disabled: '设置页「允许回复私信」没开 —— 这是唯一对陌生人说话的口子，默认关',
  'no-daily': '每天额度是 0（设置页 replyDmDaily）',
  daily: `今天已经回过 ${verdict.used} 条了（上限 ${verdict.limit}）`,
  person: `同一个人 ${PER_PERSON_DAYS} 天内只回一次`,
  stale: `他最后那条消息不在时间窗里（${c.hours}h）`,
  'not-them': '最后一条是**你**发的 —— 他不回你，你别追着发',
}
if (!verdict.ok) { console.error(`✗ 不能回：${whyText[verdict.why] ?? verdict.why}`); process.exit(2) }
if (!(await mutual(to))) { console.error('✗ 你俩不是互关 —— B站私信发不出去'); process.exit(2) }
// 关注自动回复（感谢关注 / 加群）不是人写的 —— 回它等于两个机器人打招呼
if (looksLikeAutoGreeting(target.text)) {
  console.error('✗ 对方那条像「关注自动回复」（感谢关注 / 加群 / 群号）—— 别回它，回真人写的那些')
  process.exit(2)
}

// 自我介绍类：同时吃自我介绍额度（一天 1 次），和评论区那条共用一个账本
const incoming = typeof opt.incoming === 'string' ? opt.incoming : target.text
const isIntro = looksLikeIntro(incoming)
if (isIntro) {
  const r = canIntro({ cfg, log: loadQuotaLog(), text: incoming })
  if (!r.ok) {
    console.error(`✗ 这是自我介绍类，但今天已经回过了（${r.used}/${r.limit}）→ 明天再说，或者让主人自己回`)
    process.exit(2)
  }
}

// 末尾的「消耗 / 额度」括号备注（2026-10-24 主人定：自动 + 可开关）
//   开关：设置页 listen.dmCostNote（默认开）；命令行 `--no-cost-note` 单条关掉
//   数字：今天**真实**用量（whale-spend.jsonl 的 input+output），不是猜的 ✓
const noteOn = cfg.listen?.dmCostNote !== false && !opt['no-cost-note']
const usage = todayUsage()
// 今天还没跑过模型 → 用最近一次的用量兜底（写 0 token 会像 bug）
const noteTokens = usage.total > 0 ? usage.total : usage.lastTotal
const usedAfter = countToday(loadLedger(LEDGER)) + 1
const finalMsg = noteOn
  ? withCostNote(msg, { tokens: noteTokens, usedAfter, limit: c.daily })
  : msg
if (finalMsg.length > 200) { console.error(`✗ 太长（${finalMsg.length} > 200 字）：私信不是评论区，一两句就够`); process.exit(2) }

console.log(`→ 回给 ${target.mid}${target.name ? ' ' + target.name : ''}（他最后一条：${String(target.text).replace(/\s+/g, ' ').slice(0, 60)}）`)
console.log(`  正文 ${finalMsg.length} 字${isIntro ? '（自我介绍类，会记一次自我介绍额度）' : ''}${noteOn ? `（已带备注：今日 ${usage.total} token）` : '（未带备注）'}`)
if (opt.dry) { console.log(`\n${finalMsg}\n\n[dry] 未发送。确认后把 --dry 换成 --go。`); process.exit(0) }

const out = await send(to, finalMsg)
console.log(`  HTTP ${out.http}  code=${out.code} ${out.message ?? ''}`)
if (out.code !== 0) { console.error('✗ 没发出去（额度没动）'); process.exit(4) }

const ledger = recordReply(loadLedger(LEDGER), { mid: to, name: target.name, note: finalMsg.slice(0, 40) })
saveLedger(ledger)
if (isIntro) {
  const next = recordIntro({ log: loadQuotaLog(), target: `dm:${to}`, note: '私信自我介绍' })
  fs.writeFileSync(QUOTA_FILE, JSON.stringify({ log: next }, null, 2) + '\n')
}
console.log(`✓ 已发出${isIntro ? `（自我介绍 ${countIntro(loadQuotaLog())}/${introLimit(cfg)}）` : ''}${noteOn ? ' · 已带消耗备注' : ''}`)
process.exit(0)
