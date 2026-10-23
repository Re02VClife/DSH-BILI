// 预算 CLI —— 2026-10-21 v0.4
//
// 用法:
//   node bili.mjs budget status [--hours 24]   看预算 + 最近实际用量 + 工具估算
//   node bili.mjs budget plan                 看「这一轮会怎么分配」（不联网）
//   node bili.mjs budget set wakeMaxTokens 40000
//   node bili.mjs budget reset --yes          清掉账单（只清 whale-spend.jsonl）
//
// ⚠️ 这里**不改**宿主下发的那条硬顶（那在插件里、由 agent/request 生效）；
//    这里改的是同一份配置里的数字，设置页保存后一样立刻生效。
import fs from 'node:fs'
import path from 'node:path'
import { config, configPath } from '../lib/config.mjs'
import { summarizeSpend, spendLine, planWake, spendFile, FRAME_COST, SCREEN_COST } from '../lib/budget.mjs'

const argv = process.argv.slice(2)
const cmd = argv[0]
const cfg = config()
const B = cfg.budget ?? {}

function readRaw() {
  // 同 watchlist：读不出来就停，绝不拿空对象去覆盖主人的配置 ✗
  if (!fs.existsSync(configPath)) return {}
  let text = ''
  try { text = fs.readFileSync(configPath, 'utf8') } catch (e) {
    console.error(`配置读不出来：${configPath}（${e.message}）`)
    process.exit(4)
  }
  try { return JSON.parse(text) } catch {
    console.error(`配置不是合法 JSON：${configPath}\n  先修好它，否则这条命令会把整份配置覆盖掉 ✗`)
    process.exit(4)
  }
}
function writeRaw(next) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  const tmp = `${configPath}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n')
  fs.renameSync(tmp, configPath)
}

if (cmd === 'status' || !cmd) {
  const hours = Number((argv.find((a) => a.startsWith('--hours=')) ?? '').split('=')[1] ?? 24)
  const s = summarizeSpend({ hours })
  const plan = planWake({ wakeMaxTokens: B.wakeMaxTokens, videoMaxTokens: B.videoMaxTokens })
  console.log('预算（估算口径，不是账单）')
  console.log(`  单条回复输出：${B.replyMaxTokens ?? 1200} token（宿主 maxTokens 硬顶 ✓）`)
  console.log(`  单次视频读入：${B.videoMaxTokens ?? 12000} token（读之前截字幕 / 少热评 / 必要时不抽帧）`)
  console.log(`  单次唤醒：${B.wakeMaxTokens ?? 60000} token（初筛 ${plan.screen} 条 + 深读 ${plan.deep} 条）`)
  console.log('\n最近 ' + hours + 'h：')
  console.log('  ' + spendLine(s, { wakeMaxTokens: B.wakeMaxTokens }))
  if (s.clamps) {
    console.log(`  硬顶下发过 ${s.clamps} 次，最近一次 ${String(s.lastClampAt).slice(11, 16)}（这就是「单条回复」真的被截断的证据）`)
  } else {
    console.log('  硬顶还没下发过 —— 她这 ' + hours + 'h 内没有模型调用，或宿主没提供 agent/request 瀑布')
  }
  if (s.videos) {
    const top = Object.entries(s.byBv).sort((a, b) => b[1] - a[1]).slice(0, 5)
    console.log('  最贵的几条（估算）：' + top.map(([bv, n]) => `${bv} ${Math.round(n)}`).join(' · '))
  }
  console.log('\n口径：抽帧按 ' + FRAME_COST + ' token 计；一次初筛按 ' + SCREEN_COST + ' token 计；')
  console.log('      真实 usage 来自宿主的 assistant/message（有就记，没有就只算估算）。')
  process.exit(0)
}

if (cmd === 'plan') {
  const plan = planWake({ wakeMaxTokens: B.wakeMaxTokens, videoMaxTokens: B.videoMaxTokens })
  console.log(`这一轮：初筛 ${plan.screen} 条（每条约 ${SCREEN_COST}）+ 深读 ${plan.deep} 条（每条 ≤ ${plan.perVideo}）`)
  console.log(`预计 ${plan.est} / 预算 ${plan.budget} token`)
  for (const n of plan.notes) console.log('  · ' + n)
  process.exit(0)
}

if (cmd === 'set') {
  const key = argv[1]
  const val = Number(argv[2])
  const ALLOWED = { replyMaxTokens: [256, 8000], videoMaxTokens: [2000, 120000], wakeMaxTokens: [5000, 400000] }
  if (!key || !(key in ALLOWED)) {
    console.error(`用法: budget set <${Object.keys(ALLOWED).join('|')}> <数字>`)
    process.exit(2)
  }
  if (!Number.isFinite(val)) { console.error('值要是数字'); process.exit(2) }
  const [lo, hi] = ALLOWED[key]
  const v = Math.round(Math.max(lo, Math.min(hi, val)))
  const raw = readRaw()
  raw.budget = { ...(raw.budget ?? {}), [key]: v }
  writeRaw(raw)
  console.log(`✓ ${key} = ${v}（${v !== val ? `原值 ${val} 超出范围，已夹到区间 ${lo}–${hi}` : '在合法区间内'}）`)
  console.log('  设置页保存的也是这份配置 —— 不用重启 ✓')
  process.exit(0)
}

if (cmd === 'reset') {
  if (!argv.includes('--yes')) {
    console.error(`会清空 ${spendFile()}（只清账，不动配置和日记）。确认请加 --yes`)
    process.exit(2)
  }
  try { fs.writeFileSync(spendFile(), '') ; console.log('✓ 账单已清空') } catch (e) { console.error('清空失败：' + e.message); process.exit(1) }
  process.exit(0)
}

console.error('用法: budget status [--hours N] | plan | set <key> <值> | reset --yes')
process.exit(2)
