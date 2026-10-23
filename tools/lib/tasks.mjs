// 任务台（task board）—— 2026-10-21 v0.8
//
// 主人原话：「能在这个板块中发布任务吗？比如观看指定的视频，按要求的格式写评论
//   （如总结大纲、写时间轴、提出观点、活跃气氛、读简介中的链接等）」
//
// 三个东西的分工（别混）：
//   · 任务台（本文件）   = 主人**下指令**：看哪条 + 用什么格式 + 多少字 + 额外要求
//   · 唤醒提示词         = 她**领活**的地方（`task take <id>` 打印的说明就是本文件拼的）
//   · 私信窗口（outbox）= 她**交稿**的地方：写完进「待审」，主人改完自己点「发到评论区」
//
// ⚠️ 铁律：任务**永远不直接发评论**。她只能交草稿（task draft → outbox pending），
//   发不发是主人的手。这条不是"默认关闭的开关"，是流程里没有那条路 ✓
import fs from 'node:fs'
import path from 'node:path'
import { normalizeBv, normalizeMentions, normalizeEmotes, normalizeStickers } from './outbox.mjs'

const HOME = process.env.USERPROFILE || process.env.HOME || '.'
export const TASKS_FILE = path.join(HOME, '.bili-ai', 'tasks.json')
export const MAX_TASKS = 200
export const MIN_CHARS = 20
export const MAX_CHARS = 1000          // B站 评论上限
const DEDUPE_MS = 10 * 60 * 1000       // 同一条视频 + 同一个格式，10 分钟内不重复排队

export const STATUSES = ['todo', 'running', 'drafted', 'posted', 'failed', 'cancelled']

export const STATUS_LABEL = {
  todo: '排队中',
  running: '她在看',
  drafted: '写成草稿',
  posted: '已发评论',
  failed: '没做成',
  cancelled: '已取消',
}

// ── 评论格式（这是这个功能的**价值本身**：不是"随便写一句"，是"按这个结构写"）──
//   spec：交给她的结构要求；bad：最容易写成的那种废话（反例比正例有用 ✓）
//   chars：默认目标字数（可以按任务改）
export const FORMATS = [
  {
    id: 'outline',
    label: '总结大纲',
    hint: '一句说清讲什么 + 3–5 个要点（按片子的推进顺序）',
    chars: 280,
    spec: [
      '第一句：这条视频到底在讲什么 —— 要具体（谁 / 什么问题 / 什么结论），别用「介绍了…」「分享了…」这种空壳',
      '中间 3–5 行：按**片子推进的顺序**列要点，一行一个；每行都必须带片子里的具体信息（数字 / 做法 / 结论 / 时间点），不是你的感想',
      '最后一句：看完之后的判断（值不值得看，或者它最适合谁看）',
      '排版：要点用「·」或者空行分隔。**不要**写「一、二、三」加小标题 —— 评论区不看目录',
    ],
    bad: '「UP 主讲得很好，内容丰富，条理清晰，值得一看」—— 这种谁都能说的句子，一句都不要',
  },
  {
    id: 'timeline',
    label: '时间轴',
    hint: '4–8 个时间点，标出转折 / 结论 / 名场面（空降指南）',
    chars: 240,
    spec: [
      '开头一行：这条的看点是什么（一句），然后空一行',
      '下面 4–8 行，每行 `mm:ss 一句话`；只标**有信息量的节点**：抛出问题、给出结论、转折、名场面',
      '时间点必须来自字幕 / 本地转写里**真实出现的时间戳**；不确定的那一条就删掉（宁少不错）',
      '每行 ≤25 字，说的是「这里发生了什么」，不是「这里讲了 XX 很重要」',
      '⚠️ 时间轴要真、要能空降：写完自己对着字幕回看一遍，时间点对不上就改',
    ],
    bad: '00:30 / 01:00 / 01:30 这样平均切 —— 那是凑数，不是时间轴',
  },
  {
    id: 'opinion',
    label: '提出观点',
    hint: '一句站队 + 片中的证据 + 你预料的反驳',
    chars: 260,
    spec: [
      '第一句：你的判断（同意 / 不同意 / 部分同意）—— **必须站一边**，不许「各有道理」',
      '第二句：片子里的具体证据（引一句原话，或者给一个时间点）—— 这是你的理由，不是复述剧情',
      '第三句：预料会有人怎么反驳你，你怎么答；哪一点确实说服不了你，就承认',
      '语气：对观点不对人。可以反驳 UP 的结论，但**不许**嘲讽 UP 本人；除非片中有据，**不许**断言「这是假的 / 摆拍」',
    ],
    bad: '「我觉得挺好的，见仁见智吧」—— 没站队就等于什么都没说',
  },
  {
    id: 'banter',
    label: '活跃气氛',
    hint: '一句贴着片子的吐槽 + 一个能让人接话的问题',
    chars: 80,
    spec: [
      '一句吐槽或梗，必须**贴着片子里真实出现的东西**（某个画面 / 某句台词 / 某个数字），不是通用段子',
      '加一个具体的、能让人接话的问题 —— 不是「大家怎么看」这种没人接的',
      '不剧透关键结论和结局；不刷「来了」「前排」「第一」',
      '越短越好：80 字以内。梗比表情有用，能不带表情就不带',
    ],
    bad: '「哈哈哈哈哈笑死我了 UP 主太有意思了」—— 没说这条片子里的任何东西',
  },
  {
    id: 'links',
    label: '读简介链接',
    hint: '把简介里的链接读出来：是什么、值不值得点',
    chars: 240,
    spec: [
      '先跑 `node bili.mjs links <BV>`：简介里的链接会被展开（短链 → 真地址），并取到网页标题',
      '每条链接一句：**这是什么** + 对看这条视频的人有什么用（不是把标题抄一遍）',
      '打不开 / 是广告 / 是推广 → 直说（「简介里那个 xx 已经失效了」也是有用的信息），**不许编内容**',
      '最后一句：值不值得点，或者哪一条最值得点',
    ],
    bad: '「简介里有链接，大家可以去看看」—— 等于没读',
  },
  {
    id: 'custom',
    label: '自定义',
    hint: '完全按你写的来；她先复述一遍再动手',
    chars: 300,
    spec: [
      '**先复述**：用一行写清你理解的交付物（写什么 / 给谁看 / 多少字），然后再写正文',
      '然后严格按主人的要求写；要求之间有冲突时，按「不要做什么」那一条优先',
      '主人没说的部分自己补，但**不要**自作主张改格式',
    ],
    bad: '把主人给的要求原样抄一遍当正文 ✗',
  },
]

export const formatOf = (id) => FORMATS.find((f) => f.id === id) ?? FORMATS[0]

export const emptyTasks = () => ({ version: 1, tasks: [] })

/** 坏文件当空的（窗口打不开比丢一条更糟），但**不覆盖**它 —— 下次 save 才写。 */
export function loadTasks(file = TASKS_FILE) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    return { version: 1, tasks: Array.isArray(j?.tasks) ? j.tasks : [] }
  } catch { return emptyTasks() }
}

export function saveTasks(data, file = TASKS_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n')
  fs.renameSync(tmp, file)
}

export function newTaskId(now = Date.now()) {
  return `tk_${now.toString(36)}_${Math.random().toString(36).slice(2, 5)}`
}

export function clampChars(v, dft = 280) {
  const n = Number(v)
  if (!Number.isFinite(n)) return dft
  return Math.round(Math.min(MAX_CHARS, Math.max(MIN_CHARS, n)))
}

/**
 * 派活。返回 { task, created, error }：
 *   · 没有 BV → error（窗口里当场能看见，不是"提交成功但列表空着" ✗）
 *   · 同一条视频 + 同一个格式，还没做完 → 不重复排队（返回旧的那条，created=false）
 */
export function addTask(data, input = {}) {
  const bv = normalizeBv(input.bv)
  if (!bv) return { task: null, created: false, error: '没有视频：贴 BV 号或者视频链接' }
  const f = formatOf(String(input.format ?? ''))
  const dup = (data.tasks ?? []).find(
    (t) => t.bv === bv && t.format === f.id && (t.status === 'todo' || t.status === 'running'),
  )
  if (dup) return { task: dup, created: false, error: null }
  const now = Date.now()
  const task = {
    id: newTaskId(now),
    at: new Date(now).toISOString(),
    bv,
    title: String(input.title ?? '').replace(/\s+/g, ' ').slice(0, 120),
    format: f.id,
    chars: clampChars(input.chars, f.chars),
    emote: Boolean(input.emote),
    // 2026-10-22：**指定**表情（不是"允许她挑"）—— 有值就按这几个写，没值才看她心情 ✓
    emotes: normalizeEmotes(input.emotes),
    // 自己的表情包（贴纸）：评论里当"大表情"发（实验）—— 交稿时跟着草稿走
    stickers: normalizeStickers(input.stickers),
    mentionOwner: Boolean(input.mentionOwner),
    // 2026-10-21 v0.9：除了 @ 主人，也能 @ 指定的人（名字 → 正文里的 `@昵称`）
    mentions: normalizeMentions(input.mentions),
    instruction: String(input.instruction ?? '').replace(/\r\n/g, '\n').trim().slice(0, 600),
    status: 'todo',
    attempts: 0,
    startedAt: null,
    doneAt: null,
    draftId: null,
    error: null,
  }
  data.tasks = [task, ...(data.tasks ?? [])]
  prune(data, now)
  return { task, created: true, error: null }
}

export function findTask(data, id) {
  return (data.tasks ?? []).find((x) => x.id === id) ?? null
}

export function setTaskStatus(data, id, status, extra = {}) {
  if (!STATUSES.includes(status)) return null
  const task = findTask(data, id)
  if (!task) return null
  task.status = status
  if (status === 'running') { task.startedAt = new Date().toISOString(); task.error = null }
  if (status === 'drafted' || status === 'posted' || status === 'failed') task.doneAt = new Date().toISOString()
  if (extra.draftId) task.draftId = extra.draftId
  if (typeof extra.error === 'string') task.error = extra.error.slice(0, 300)
  return task
}

/**
 * 领活：todo（或卡住的 running）→ running，attempts+1。
 * 为什么允许从 running 再领一次：她可能崩了/被关了，任务不能永远"她在看" ✗
 */
export function claimTask(data, id) {
  const task = findTask(data, id)
  if (!task) return null
  if (task.status === 'posted') return null
  task.status = 'running'
  task.attempts = Number(task.attempts ?? 0) + 1
  task.startedAt = new Date().toISOString()
  task.doneAt = null
  task.error = null
  return task
}

/** 交稿：把草稿 id 挂到任务上（正文在 outbox 里，主人改的是那一份 ✓）。 */
export function linkDraft(data, id, draftId) {
  const task = findTask(data, id)
  if (!task) return null
  task.draftId = draftId
  return setTaskStatus(data, id, 'drafted', { draftId })
}

/**
 * 主人在私信窗口里对**任务草稿**动了手 → 任务那边的状态也跟着变（两边不打架 ✓）。
 *   rejected：不同意这么发 → 任务「已取消」（她重写也没意义，除非主人重新派）
 *   deleted ：草稿删了 → 任务退回「排队中」，草稿指针清掉（不然「看草稿」点开是空的 ✗）
 * 只处理还在「写成草稿」的，已经发出去/取消的别去动它。
 */
export function syncFromDraft(item, action, file = TASKS_FILE) {
  if (!item?.taskId) return null
  const data = loadTasks(file)
  const task = findTask(data, item.taskId)
  if (!task || task.status !== 'drafted') return null
  if (action === 'rejected') {
    setTaskStatus(data, task.id, 'cancelled', { error: '草稿被否掉了（主人没同意这么发）' })
  } else if (action === 'deleted') {
    task.draftId = null
    setTaskStatus(data, task.id, 'todo', { error: '草稿被删了，可以重写' })
  } else return null
  saveTasks(data, file)
  return task
}

/** 「她在看」超过 staleMs 的任务 —— 只**报告**卡住，不偷偷改状态（读操作不该写文件 ✓）。 */
export function staleIds(data, now = Date.now(), staleMs = 30 * 60 * 1000) {
  return (data.tasks ?? [])
    .filter((t) => t.status === 'running' && now - new Date(t.startedAt ?? t.at).getTime() > staleMs)
    .map((t) => t.id)
}

/** 下一个该做的（排队中，最老的先做）—— 给 wake 提示和 CLI 用。 */
export function nextTodo(data) {
  return (data.tasks ?? []).filter((t) => t.status === 'todo').sort((a, b) => new Date(a.at) - new Date(b.at))[0] ?? null
}

export function taskStats(data) {
  const ts = data.tasks ?? []
  const n = (s) => ts.filter((x) => x.status === s).length
  return {
    total: ts.length,
    todo: n('todo'),
    running: n('running'),
    drafted: n('drafted'),
    posted: n('posted'),
    failed: n('failed'),
    cancelled: n('cancelled'),
  }
}

/** 留最近 MAX_TASKS；已结束的再按 30 天清一批（排队中的永远不删 ✓）。 */
export function prune(data, now = Date.now()) {
  const keep = []
  for (const t of data.tasks ?? []) {
    const old = now - new Date(t.at).getTime() > 30 * 86400000
    if (old && t.status !== 'todo' && t.status !== 'running') continue
    keep.push(t)
  }
  data.tasks = keep.slice(0, MAX_TASKS)
  return data
}

/**
 * 拼出「这条任务怎么干」的说明 —— `task take <id>` 打印的就是它，
 * 宿主「现在就做」也是把同一段塞进她的会话（两条路径同一份口径 ✓）。
 */
export function buildTaskPrompt(task, opts = {}) {
  if (!task) return ''
  const f = formatOf(task.format)
  const bv = normalizeBv(task.bv) || String(task.bv ?? '')
  const ownerName = String(opts.ownerName ?? '').trim()
  const lines = []
  lines.push(`［主人派的活］${task.id} —— ${bv}${task.title ? `《${task.title}》` : ''}`)
  lines.push(`格式「${f.label}」：${f.hint}`)
  if (task.instruction) lines.push(`主人额外要求：${task.instruction}`)
  lines.push('')
  lines.push('怎么干（做完就收住，别顺手多发 ✓）：')
  let n = 1
  lines.push(`${n++}) 先看懂：\`node bili.mjs debrief ${bv}\``)
  lines.push('   · 说「无字幕」→ `node bili.mjs asr ' + bv + '` → `debrief ' + bv + ' --asr`（本机转写，几分钟，音频不出本机）')
  lines.push('   · 字幕 / 转写要看全（要点和转折常在后半段；转写的 txt 也带时间戳 ✓）')
  if (f.id === 'links') {
    lines.push(`${n++}) 读简介里的链接：\`node bili.mjs links ${bv}\`（短链会展开、会取网页标题；打不开就直说）`)
  }
  lines.push('')
  lines.push(`${n++}) 按这个结构写（「${f.label}」）：`)
  for (const s of f.spec) lines.push(`   · ${s}`)
  lines.push(`   反例（这样写等于白写）：${f.bad}`)
  lines.push('')
  lines.push(`字数：≤${task.chars} 字（超了先砍形容词和铺垫，**别砍信息**）`)
  // 2026-10-21 v0.8：表情要两份 —— 正文里 `[笑哭]` + 交稿时 --emote 笑哭
  //   （只给一份，服务端就当成纯文本，评论里会出现一对孤零零的方括号 ✗）
  //   2026-10-21 v0.9：最多 3 个（B站 本身允许；以前我们收窄成 1 个 ✗）
  // 2026-10-22：主人**指定**了表情 → 必须用这几个（不是"随你挑"）
  if ((task.emotes ?? []).length) {
    lines.push(`表情：**必须用这几个** —— ${task.emotes.map((e) => `[${e}]`).join(' ')}（放在你想让它出现的位置）。`)
    lines.push('   · 不许换成别的表情、也不许多加；挑不到合适的就原样用这几个')
  } else {
    lines.push(
      task.emote
        ? '表情：最多 3 个 —— `node bili.mjs emotes pick --tag 笑 --n 3` 挑，把 `[笑哭]` 写进正文（放你想让它出现的位置），'
          + `交稿时每个都带 \`--emote 笑哭\`。两份都要给（只给一份会变成纯文本 ✗）；挑不到合适的就不带 ✓`
        : '表情：**不要带**（主人这条没要表情）',
    )
  }
  // 2026-10-22：主人指定了自己的表情包（贴纸）→ 作为**评论图片**附上（content.pictures）
  if ((task.stickers ?? []).length) {
    lines.push(`配图：主人指定了 ${task.stickers.length} 张自己的表情包（发布时自动作为评论图片附上，你不用管）`)
    lines.push('   · **不用**把图片名字写进正文（那是两套东西：正文是字，图片走 pictures 字段）')
    lines.push('   · 正文照格式写就行；配图会显示在评论下方')
  }
  // 2026-10-21 v0.9：@ 从"只有主人"放开到**任意人**（评论接口没有 at 参数，@ 就是正文文字）
  const who = [
    ...(task.mentionOwner ? [ownerName || '主人的昵称'] : []),
    ...((task.mentions ?? []).filter(Boolean)),
  ]
  if (who.length) {
    lines.push(`@ 谁：**正文最前面**写「${who.map((n) => '@' + n).join(' ')} 」，空一格再说话`)
    lines.push('   · B站 评论的 @ 就是正文里的文字，**名字要和对方现在的昵称一个字不差**（改名就 @ 不到）')
    lines.push(`   · 拿不准名字先核一下：\`node bili.mjs whois <mid>\`；确认不了就别硬写（写成普通文字很难看 ✗）`)
  } else {
    lines.push('@ 谁：**谁都不 @**（主人这条没点人）')
  }
  lines.push('')
  lines.push(`${n++}) 交稿 —— **只交草稿，绝对不要自己发评论** ✗`)
  lines.push('   把正文写进一个临时文件（UTF-8），例如 `~/.dsh/shots/' + task.id + '.txt`（用 write 工具直接写最省事）')
  lines.push(`   \`node bili.mjs task draft ${task.id} --text-file "那个文件"\``)
  if ((task.emotes ?? []).length) {
    lines.push('   （指定的表情我已经记在任务上，交稿时自动带上 —— 你只要保证正文里那几个 `[名字]` 都在 ✓）')
  } else if (task.emote) {
    lines.push(`   带了表情的话：\`task draft ${task.id} --text-file "…" --emote 名字1 --emote 名字2\`（每个都要给；不给也行 —— 交稿时我会从正文里自动认库里有 ✓）`)
  }
  lines.push('   → 状态变「写成草稿」，DSH「鱼的私信」窗口里主人能看见、能改、能决定发不发')
  lines.push('   ⚠️ 不要跑 `comment … --go`、不要用 `dm` 把它发出去 —— 那是主人点按钮才发生的事')
  lines.push('   ⚠️ 这是**公开评论**的口吻：不写私事、不写账号/路径、不替主人表态')
  lines.push(`${n++}) 收工：\`node bili.mjs diary log task-done --note "${task.id} ${f.label} ${task.chars}字"\`（记一笔就行，不用 notify）`)
  return lines.join('\n')
}
