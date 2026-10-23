#!/usr/bin/env node
// 统一入口：node bili.mjs <命令> [参数...]
// 只是把你转到 commands/ 或 verify/ 下的具体脚本，参数原样透传。
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const map = {
  // —— 读（不需要写操作，安全） ——
  session: ['verify/session.mjs', '确认凭据属于哪个号'],
  thread: ['verify/thread.mjs', '导出一条评论的完整楼中楼结构'],
  'check-comment': ['verify/comment-exists.mjs', '按 rpid 复核评论是否存在'],
  'check-dynamic': ['verify/dynamic-inspect.mjs', '看动态的结构化内容（类型/图片/节点）'],
  'check-mention': ['verify/mention-check.mjs', '确认动态里的 @ 是不是真提及（查 opus 页）'],
  watch: ['verify/watch-replies.mjs', '盯一条评论的楼中楼等新回复：--aid --root --bvid [--uid 只认某人] [--minutes]'],
  'comment-await': ['commands/comment-await.mjs', '评论版"叫我起床"：廉价进程守「回复我的」，命中即退出叫醒 agent（0 token）：--minutes --interval [--only-owner]'],
  'comment-digest': ['commands/comment-digest.mjs', '今天谁找过人家（回复+@ 两个收件箱汇总，只读）：--hours 24 --pages 2 [--only-unread]'],
  recon: ['verify/dryrun.mjs', '发评论前的侦查：BV→aid + 评论区状态 + WBI 材料'],
  video: ['commands/video-content.mjs', '不点开视频也能还原它讲什么（读文字：简介/字幕/弹幕/评论）'],
  subtitles: ['commands/subtitles.mjs', '拉官方字幕全文（WBI 签名，带时间戳）：<BV> [--lan ai-zh] [--print N] —— 看视频最省的一条腿'],
  'watch-video': ['commands/bili-watch.mjs', '真"看"视频：取直链 → 下载 → ffmpeg 抽帧拼九宫格 → 交给 read_image：<BV> [3x3|4x4] [--uniform]'],
  debrief: ['commands/debrief.mjs', '看懂一条视频（一条龙）：封面+简介+官方字幕+弹幕热区(对齐字幕)+热评+画面抽帧：<BV> [--bucket 30] [--top 5] [--grid 3x3] [--no-frames] [--budget 12000]'],
  feed: ['commands/feed.mjs', '选题器（只读）：偏好 + 热门/排行/关注 + 指定清单（★置顶），排除看过的/已评论过的：--n 6 --per 2'],
  watchlist: ['commands/watchlist.mjs', '指定清单（只读）：list / add up <mid|链接> [名字] / add video <BV|链接> [备注] / rm / fetch [--json]'],
  taste: ['commands/taste.mjs', '口味源（只读）：sync [--if-stale] 拉关注/收藏/历史 → ~/.bili-ai/taste.json；status 看现状'],
  audio: ['commands/audio.mjs', '只取音频（dash 192k → 16kHz wav）：<BV|链接> [--no-wav] [--force] [--json]'],
  asr: ['commands/asr.mjs', '本地转写（FunASR Paraformer-large + VAD + 标点 → txt/srt）：<BV> [--device cpu|cuda:0] [--hotword "词…"]'],
  outbox: ['commands/outbox.mjs', '私信收件箱（主人审/改/发评论）：list / add --text "…" / post <id> --go / reject / delete'],
  task: ['commands/tasks.mjs', '任务台（主人派的活：指定视频 + 评论格式）：list / add --bv BV [--format outline|timeline|opinion|banter|links] / take <id> / draft <id> --text-file …'],
  links: ['commands/links.mjs', '读简介里的链接：<BV> [--json] —— 短链展开 + 取网页标题（格式「读简介链接」用）'],
  intro: ['commands/intro.mjs', '自我介绍额度（别人问「你是谁」）：status / check [--text "…"] / record —— 默认一天只回一次'],
  'dm-reply': ['commands/dm-reply.mjs', '回复私信（只回先找她的人 · 默认关）：--list [--hours 72] / --to <mid> --msg "…" [--incoming "他的原话"] --dry|--go'],
  budget: ['commands/budget.mjs', '预算（估算口径）：status [--hours 24] / plan / set <key> <值> / reset --yes'],
  quota: ['commands/quota.mjs', '限额闸（B 档「限额自主」的代码强制部分）：status / check --auto|--share / record / set --daily N / allow <范围>'],
  likes: ['commands/likes.mjs', '谁赞了她（「收到的赞」通知流，含点赞者 mid/昵称）：--hours 24 [--owner] [--json]'],
  selftest: ['commands/selftest.mjs', '启动测试（装完先跑这个）：配置/凭据/登录态/目录/ffmpeg + 下一步两件事（未分组会话 · 完全权限）'],
  deps: ['commands/deps.mjs', '依赖体检（装完先跑它）：cookie / ffmpeg / Node / 数据目录；--json 给 agent 判断'],
  diary: ['commands/diary.mjs', '她的一天（可见性）：show 人读摘要 / log 记结构化事件 / tail 最近事件'],
  notify: ['commands/notify.mjs', '通知分发：把"自主发言后必须报备"落到代码里（后端 stdout/file/webhook/command，由 config.notify 决定）'],
  night: ['commands/whale-night.mjs', '生物钟：plan 掷骰子定今晚 / clock 到点退出叫醒她 / mark 兜底标记 / status 看计划'],
  search: ['commands/search.mjs', '按关键词搜视频（WBI 签名）：标题/UP/播放/简介/标签'],
  covers: ['diagnostics/fetch-covers.mjs', '抓视频元信息 + 封面图存到 covers/（供看图理解内容）'],
  whois: ['diagnostics/whois.mjs', '按 mid 查昵称（@ 人前先核准名字）'],
  // —— 写（会真的发出去；都必须显式 --dry 或 --go） ——
  'dm-await': ['commands/dm-await.mjs', '私信监听（只认主人；命中打印 DM_HIT）'],
  fav: ['commands/fav.mjs', '收藏（我想留着）：判据强制 · --list / --check / <BV> --reason … --dry|--go'],
  dm: ['commands/dm.mjs', '私信（专属通道）：一天 1 条 · 只发主人 · 必须互关（都写死）'],
  comment: ['commands/comment.mjs', '发一条视频评论；带 --root/--parent 就是二级回复；--emote "[笑哭]" 带表情'],
  emotes: ['commands/emotes.mjs', '评论表情库：sync 拉官方表情包 / list --tag 笑 / search 吃瓜 / pick --tag 无语 / show 笑哭'],
  stickers: ['commands/stickers.mjs', '贴纸库（自己的图）：sync --dir "…" / list / show 悠闲 —— 只能用于 dm --image 和 dynamic-image'],
  'reply-draft': ['commands/reply-draft.mjs', '待审回复（B 档：发前审核）：add 进队列 / list / drop / take'],
  'comment-del': ['commands/comment-del.mjs', '删除自己发的一条评论（x/v2/reply/del，只能删自己的）'],
  dynamic: ['commands/dynamic.mjs', '动态：post / rm / check'],
  'dynamic-image': ['commands/dynamic-image.mjs', '发图文动态（上传图片 + 可带 @节点）'],
  'dynamic-edit': ['commands/edit-dynamic.mjs', '编辑已存在的动态（文字/图片都能改，id 不变、评论与点赞保留）：<dyn_id> <文本文件> [--go]'],
  danmaku: ['commands/danmaku.mjs', '直播间弹幕：pre 预检 / send 发送 / history 回读 / live 实时流'],
  auto: ['commands/danmaku-auto.mjs', '直播间自动回复：进程内监听+判断+发送（不再依赖 agent 回合）'],
  await: ['commands/danmaku-await.mjs', '直播间"叫我起床"：出现该回的弹幕就退出，交给 agent 回（质量优先）'],
  // —— 排查 ——
  'dyn-keywords': ['diagnostics/dyn-detail-keywords.mjs', '在动态详情响应里搜关键词（定位文本去哪了）'],
  'dyn-page': ['diagnostics/dyn-page-keywords.mjs', '在动态页面 HTML 里搜关键词'],
}

const [cmd, ...rest] = process.argv.slice(2)
if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
  console.log('用法: node bili.mjs <命令> [参数...]\n')
  console.log('命令:')
  for (const [name, [, desc]] of Object.entries(map)) console.log(`  ${name.padEnd(16)} ${desc}`)
  console.log('\n安全约定（脚本里也强制）:')
  console.log('  · 写操作必须显式给 --dry（只打印请求）或 --go（真的发）')
  console.log('  · 先跑 session 确认是哪个号；写操作后一定用 check-*/thread/history 回读复核')
  console.log('  · 一次一条。批量、定时、多房间铺量不是这套工具的用途')
  process.exit(cmd ? 0 : 2)
}
const entry = map[cmd]
if (!entry) {
  console.error(`未知命令: ${cmd}\n跑 "node bili.mjs help" 看清单。`)
  process.exit(2)
}
const r = spawnSync(process.execPath, [path.join(here, entry[0]), ...rest], { stdio: 'inherit' })
process.exit(r.status ?? 1)
