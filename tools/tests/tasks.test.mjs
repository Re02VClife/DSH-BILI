// 任务台 + 简介链接的纯函数测试（node --test）—— 2026-10-21 v0.8
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  FORMATS, formatOf, emptyTasks, addTask, findTask, claimTask, linkDraft, setTaskStatus,
  staleIds, nextTodo, taskStats, prune, buildTaskPrompt, clampChars, syncFromDraft,
  saveTasks, loadTasks, MAX_TASKS,
} from '../lib/tasks.mjs'
import { extractLinks, pickTitle, isShortLink } from '../lib/links.mjs'

test('FORMATS：id 唯一、每种都有 spec 和反例（格式是这个功能的价值，不能是空壳）', () => {
  const ids = FORMATS.map((f) => f.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const f of FORMATS) {
    assert.ok(f.label && f.hint, `${f.id} 缺 label/hint`)
    assert.ok(f.spec.length >= 3, `${f.id} 的结构要求太少`)
    assert.ok(f.bad && f.bad.length > 8, `${f.id} 缺反例`)
    assert.ok(f.chars >= 20 && f.chars <= 1000, `${f.id} 字数越界`)
  }
  assert.equal(formatOf('timeline').id, 'timeline')
  assert.equal(formatOf('不存在').id, FORMATS[0].id, '认不出的格式落回第一个，不炸')
})

test('addTask：没有 BV 就报错（不是"提交成功但列表空着"）；从链接里抠 BV；字数夹区间', () => {
  const d = emptyTasks()
  const bad = addTask(d, { bv: '没有视频', format: 'outline' })
  assert.equal(bad.task, null)
  assert.match(bad.error, /BV/)

  const { task } = addTask(d, { bv: '看 https://www.bilibili.com/video/BV1x3nw6KEj2/?p=1 这条', format: 'timeline', chars: 9999 })
  assert.equal(task.bv, 'BV1x3nw6KEj2')
  assert.equal(task.format, 'timeline')
  assert.equal(task.chars, 1000, '字数封顶到 B站 评论上限')
  assert.equal(task.status, 'todo')
  assert.equal(clampChars(3), 20)
  assert.equal(clampChars('abc', 240), 240)
})

test('addTask：同一条视频 + 同一个格式还在排队/在做 → 不重复派；换个格式可以', () => {
  const d = emptyTasks()
  const a = addTask(d, { bv: 'BV1x3nw6KEj2', format: 'outline' })
  assert.equal(a.created, true)
  const b = addTask(d, { bv: 'BV1x3nw6KEj2', format: 'outline' })
  assert.equal(b.created, false)
  assert.equal(b.task.id, a.task.id)
  assert.equal(d.tasks.length, 1)
  const c = addTask(d, { bv: 'BV1x3nw6KEj2', format: 'banter' })
  assert.equal(c.created, true, '不同格式是两条活')
  // 做完之后可以再派同一条
  setTaskStatus(d, b.task.id, 'posted')
  const e = addTask(d, { bv: 'BV1x3nw6KEj2', format: 'outline' })
  assert.equal(e.created, true)
})

test('claimTask：todo → running（记次数）；已经发过的不给领', () => {
  const d = emptyTasks()
  const { task } = addTask(d, { bv: 'BV1x3nw6KEj2', format: 'opinion' })
  const c1 = claimTask(d, task.id)
  assert.equal(c1.status, 'running')
  assert.equal(c1.attempts, 1)
  assert.ok(c1.startedAt)
  const c2 = claimTask(d, task.id)
  assert.equal(c2.attempts, 2, '重做要能再领（她可能崩了）')
  setTaskStatus(d, task.id, 'posted')
  assert.equal(claimTask(d, task.id), null, '发过的不能再领')
  assert.equal(claimTask(d, '不存在'), null)
})

test('linkDraft：交稿 → drafted + 挂上草稿 id（正文在 outbox，这里只存引用）', () => {
  const d = emptyTasks()
  const { task } = addTask(d, { bv: 'BV1x3nw6KEj2', format: 'links' })
  const t = linkDraft(d, task.id, 'ob_abc')
  assert.equal(t.status, 'drafted')
  assert.equal(t.draftId, 'ob_abc')
  assert.ok(t.doneAt)
  assert.equal(linkDraft(d, '不存在', 'x'), null)
})

test('staleIds：只看「running 超过 30 分钟」的，只报告不改状态', () => {
  const d = emptyTasks()
  const { task } = addTask(d, { bv: 'BV1x3nw6KEj2', format: 'outline' })
  claimTask(d, task.id)
  const old = Date.now() + 31 * 60 * 1000
  assert.deepEqual(staleIds(d, old), [task.id])
  assert.equal(findTask(d, task.id).status, 'running', '读操作不该偷偷改状态')
  assert.deepEqual(staleIds(d, Date.now()), [])
})

test('nextTodo：最老的排队先做；做完了就让位', () => {
  const d = emptyTasks()
  // addTask 是头插，手工把时间拉开
  const a = addTask(d, { bv: 'BV1aaaaaaaaa', format: 'outline' }).task
  const b = addTask(d, { bv: 'BV1bbbbbbbbb', format: 'outline' }).task
  a.at = new Date(Date.now() - 60_000).toISOString()
  assert.equal(nextTodo(d).id, a.id)
  setTaskStatus(d, a.id, 'cancelled')
  assert.equal(nextTodo(d).id, b.id)
})

test('taskStats / prune：计数分状态；排队中的永远不删，结束的 30 天后回收', () => {
  const old = Date.now() - 40 * 86400000
  const d = emptyTasks()
  const a = addTask(d, { bv: 'BV1aaaaaaaaa', format: 'outline' }).task
  const b = addTask(d, { bv: 'BV1bbbbbbbbb', format: 'outline' }).task
  a.at = new Date(old).toISOString()
  b.at = new Date(old).toISOString()
  setTaskStatus(d, b.id, 'posted')
  prune(d)
  assert.ok(findTask(d, a.id), '排队中的旧任务不删')
  assert.equal(findTask(d, b.id), null, '已完成的旧任务回收')
  assert.deepEqual(
    Object.fromEntries(Object.entries(taskStats(d)).filter(([, v]) => v > 0)),
    { total: 1, todo: 1 },
  )

  const d2 = emptyTasks()
  for (let i = 0; i < MAX_TASKS + 10; i += 1) addTask(d2, { bv: 'BV1' + String(i).padStart(9, '0'), format: 'outline' })
  assert.equal(d2.tasks.length, MAX_TASKS)
})

test('buildTaskPrompt：把格式/字数/@/表情/交稿命令都说清，且明写"不要自己发评论"', () => {
  const d = emptyTasks()
  const { task } = addTask(d, { bv: 'BV1x3nw6KEj2', format: 'timeline', chars: 240, emote: true, mentionOwner: true, instruction: '别用感叹号' })
  task.title = '一个标题'
  const text = buildTaskPrompt(task, { ownerName: '主人昵称' })
  assert.match(text, /BV1x3nw6KEj2/)
  assert.match(text, /时间轴/)
  assert.match(text, /别用感叹号/)
  assert.match(text, /≤240 字/)
  assert.match(text, /emotes pick/, '开了表情要给出表情命令')
  assert.match(text, /最多 3 个/, '表情上限跟代码一致（3 个）')
  assert.match(text, /@主人昵称/)
  assert.match(text, /task draft tk_/, '必须给出交稿命令')
  assert.match(text, /不要自己发评论/)
  assert.match(text, /debrief BV1x3nw6KEj2/)
  assert.ok(text.includes('⚠️'), '风险提示要扎眼')

  const plain = buildTaskPrompt(addTask(emptyTasks(), { bv: 'BV1x3nw6KEj2', format: 'outline' }).task)
  assert.match(plain, /不要带/, '没勾表情就明说不要带')
  assert.match(plain, /谁都不 @/, '没点人就不该 @ 任何人')
  assert.doesNotMatch(plain, /emotes pick/, '没勾表情就不要教她带表情')
  assert.equal(buildTaskPrompt(null), '')
})

test('buildTaskPrompt：主人指定了表情 → 从"随你挑"变成"必须用这几个"', () => {
  const { task } = addTask(emptyTasks(), { bv: 'BV1x3nw6KEj2', format: 'banter', emotes: ['doge', '大哭'] })
  assert.deepEqual(task.emotes, ['doge', '大哭'])
  const text = buildTaskPrompt(task)
  assert.match(text, /必须用这几个/)
  assert.match(text, /\[doge\]\s*\[大哭\]/)
  assert.doesNotMatch(text, /emotes pick/, '指定了就不该再让她自己挑')
  assert.doesNotMatch(text, /不要带/, '指定了就不是"不要带"')
})

test('buildTaskPrompt：指定自己的表情包（贴纸）→ 告诉她发布时作为评论图片附上', () => {
  const { task } = addTask(emptyTasks(), { bv: 'BV1x3nw6KEj2', format: 'banter', stickers: ['悠闲', '杂鱼'] })
  assert.deepEqual(task.stickers, ['悠闲', '杂鱼'])
  const text = buildTaskPrompt(task)
  assert.match(text, /配图/)
  assert.match(text, /评论图片/)
  assert.match(text, /不用.*写进正文/, '图片不走正文转义符（那是表情/metadata 的老路）')
})

test('buildTaskPrompt：@ 指定用户（多个）写进"正文最前面"，并提醒名字要对', () => {
  const d = emptyTasks()
  const { task } = addTask(d, { bv: 'BV1x3nw6KEj2', format: 'banter', mentions: ['@张三', '李四'] })
  assert.deepEqual(task.mentions, ['张三', '李四'], '名字去 @ 后存')
  const text = buildTaskPrompt(task, { ownerName: '主人' })
  assert.match(text, /@张三 @李四/)
  assert.match(text, /正文最前面/)
  assert.match(text, /一个字不差/)
  assert.doesNotMatch(text, /@主人/, '没勾 @ 我 就不该带上主人')
})

test('syncFromDraft：主人在窗口里否掉/删掉草稿，任务状态跟着改（两边不打架）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-sync-'))
  const file = path.join(dir, 'tasks.json')
  const d = emptyTasks()
  const { task } = addTask(d, { bv: 'BV1x3nw6KEj2', format: 'outline' })
  linkDraft(d, task.id, 'ob_1')
  saveTasks(d, file)

  // 不在 drafted 状态的不动（比如已经发了）
  assert.equal(syncFromDraft({ taskId: task.id, id: 'x' }, 'rejected'), null)
  const posted = loadTasks(file)
  posted.tasks[0].status = 'posted'
  saveTasks(posted, file)
  assert.equal(syncFromDraft({ taskId: task.id }, 'rejected', file), null)

  // 回到 drafted 再试
  const d2 = loadTasks(file)
  d2.tasks[0].status = 'drafted'
  saveTasks(d2, file)
  const cancelled = syncFromDraft({ taskId: task.id }, 'rejected', file)
  assert.equal(cancelled.status, 'cancelled')
  assert.match(cancelled.error, /否掉/)

  const d3 = loadTasks(file)
  d3.tasks[0].status = 'drafted'
  saveTasks(d3, file)
  const back = syncFromDraft({ taskId: task.id }, 'deleted', file)
  assert.equal(back.status, 'todo')
  assert.equal(back.draftId, null, '草稿删了要清指针，别留点不开的「看草稿」')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('saveTasks / loadTasks：原子写；坏文件当空的不覆盖', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-'))
  const file = path.join(dir, 'tasks.json')
  const d = emptyTasks()
  addTask(d, { bv: 'BV1x3nw6KEj2', format: 'outline' })
  saveTasks(d, file)
  assert.equal(loadTasks(file).tasks.length, 1)
  fs.writeFileSync(file, '{ 坏 JSON')
  assert.deepEqual(loadTasks(file), { version: 1, tasks: [] })
  fs.rmSync(dir, { recursive: true, force: true })
})

test('extractLinks：完整 URL / b23 短链 / 裸 BV / av 号都能抠出来，去重且剥掉尾部标点', () => {
  const desc = [
    '参考：https://example.com/a?b=1，还有个短链 b23.tv/AbCd12',
    '以及 https://example.com/a?b=1 重复一次',
    '旧视频 BV1x3nw6KEj2 和 av170001。',
    '邮箱不算：foo@bar.com',
  ].join('\n')
  const links = extractLinks(desc)
  assert.deepEqual(links, [
    'https://example.com/a?b=1',
    'https://b23.tv/AbCd12',
    'https://www.bilibili.com/video/BV1x3nw6KEj2',
    'https://www.bilibili.com/video/av170001',
  ])
  assert.equal(extractLinks(desc, { max: 2 }).length, 2)
  assert.deepEqual(extractLinks('没有链接'), [])
  assert.equal(isShortLink('https://b23.tv/x'), true)
  assert.equal(isShortLink('https://example.com/x'), false)
})

test('pickTitle：从 <title> 取标题、解实体、压空白；没有就空串（不炸）', () => {
  assert.equal(pickTitle('<html><head><title>\n 一个 &amp; 标题 \n</title></head>'), '一个 & 标题')
  assert.equal(pickTitle('<html><body>no title</body></html>'), '')
  assert.equal(pickTitle(null), '')
})
