// 自我介绍回复（2026-10-22 主人定：别的用户问「你是谁」，该答 —— 但一天只回一次）
//
// 用法:
//   node bili.mjs intro                       # 看今天回过几次 / 额度
//   node bili.mjs intro check [--text "他说的原话"]
//        → 退出码 0 = 可以自己回；2 = 额度用完/关掉了；3 = 这条不像自我介绍（按老规则写草稿）
//   node bili.mjs intro record [--target BV…] [--note "…"]
//
// 为什么 check 要带 --text：它同时判断"像不像自我介绍"。模型可以只凭原话让代码先过一遍，
//   免得把"你是什么时候入坑的"当成自我介绍 ✗
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../lib/config.mjs'
import {
  QUOTA_FILE, looksLikeIntro, countIntro, introLimit, loadQuotaLog, recordIntro, canIntro, today,
} from '../lib/intro.mjs'

const argv = process.argv.slice(2)
const cmd = argv[0] ?? 'status'
const opt = {}
for (let i = 1; i < argv.length; i += 1) {
  if (!argv[i].startsWith('--')) continue
  const key = argv[i].slice(2)
  const next = argv[i + 1]
  if (next === undefined || String(next).startsWith('--')) { opt[key] = true; continue }
  opt[key] = next
  i += 1
}

const log = loadQuotaLog()
const limit = introLimit(config())
const used = countIntro(log)

if (cmd === 'status') {
  const last = [...log].reverse().find((x) => x && x.intro)
  console.log(`自我介绍额度：今天 ${used}/${limit}${limit === 0 ? '（已关掉：一律写草稿）' : ''}   日期 ${today()}`)
  if (last) console.log(`  上一次：${last.at}${last.target ? ' → ' + last.target : ''}${last.note ? ' · ' + last.note : ''}`)
  console.log('  规则：别人问「你是谁 / 介绍一下你自己」→ 可以自己回（一次一两句，不透露主人隐私）；额度用完 → 写草稿给主人审')
  process.exit(0)
}

if (cmd === 'check') {
  const text = typeof opt.text === 'string' ? opt.text : ''
  const r = canIntro({ cfg: config(), log, text })
  if (r.ok) {
    console.log(`✓ 可以自己回（今天 ${r.used}/${r.limit}${text ? '，这句像自我介绍' : ''}）`)
    console.log('  回完记得记账：node bili.mjs intro record --target BV… --note "…"')
    process.exit(0)
  }
  if (r.why === 'not-intro') {
    console.log('✗ 这条不像自我介绍 —— 按老规则：写草稿给主人审（reply-draft add）')
    process.exit(3)
  }
  if (r.why === 'disabled') {
    console.log('✗ 自我介绍自动回复被关掉了（设置页 listen.introDaily = 0）→ 写草稿给主人审')
    process.exit(2)
  }
  console.log(`✗ 今天已经自己回过 ${r.used} 次了（上限 ${r.limit}）→ 这一条写草稿给主人审，别再自己发`)
  process.exit(2)
}

if (cmd === 'record') {
  const next = recordIntro({ log, target: typeof opt.target === 'string' ? opt.target : '', note: typeof opt.note === 'string' ? opt.note : '' })
  try {
    fs.mkdirSync(path.dirname(QUOTA_FILE), { recursive: true })
    fs.writeFileSync(QUOTA_FILE, JSON.stringify({ log: next }, null, 2) + '\n')
  } catch (e) { console.error(`写账本失败：${e.message}`); process.exit(4) }
  console.log(`✓ 已记账：今天自我介绍 ${countIntro(next)}/${limit}`)
  process.exit(0)
}

console.error('用法: intro [status] | intro check [--text "…"] | intro record [--target BV…] [--note "…"]')
process.exit(2)
