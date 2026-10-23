// 宿主路由的接线测试（node --test）—— 2026-10-21 v0.8
//
// 为什么要有它：宿主的五条新路由（任务台/收件箱）只有**重启 DSH 之后**才会被加载，
//   写错了要等主人重启才发现（"窗口打不开"这种反馈最贵 ✗）。
//   这里用一个假的 ctx 把 apply() 挂起来，然后直接拿假 req/res 打路由：
//   不连 DSH、不连 B站、不写真实数据目录（USERPROFILE 指向临时目录 ✓）。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

function makeCtx() {
  const routes = new Map()
  const disposers = []
  const prompts = []
  const ctx = {
    webServer: { register({ path: p, handler }) { routes.set(p, handler) } },
    connection: { requestRejection: () => undefined },   // 栅栏放行（本机回环本来就是它放行的）
    get(name) { return this[name] },
    on() {},
    effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d) },
    sessionController: {
      create: async () => { throw new Error('exists') },
      prompt: async (p) => { prompts.push(p) },
    },
  }
  return { ctx, routes, disposers, prompts }
}

function call(routes, method, p, body) {
  return callRaw(routes, method, p, body).then((r) => ({ code: r.code, json: JSON.parse(r.body ?? '{}') }))
}

/** 二进制响应（贴纸图）用这个：不 JSON.parse */
function callRaw(routes, method, p, body) {
  const pathOnly = String(p).split('?')[0]
  const handler = routes.get(pathOnly)
  if (!handler) return Promise.reject(new Error(`没有这条路由：${p}`))
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  req.method = method
  req.url = p                       // 带 ?tag=… 的查询串要走这里（表情库/贴纸路由用）
  req.headers = { host: '127.0.0.1:57870', 'content-type': 'application/json' }
  const res = {
    statusCode: 0,
    headers: null,
    writeHead(code, hdrs) { this.statusCode = code; this.headers = hdrs ?? null },
    end(s) { this.body = s ?? '' },
  }
  return Promise.resolve(handler(req, res)).then(() => ({ code: res.statusCode, body: res.body, headers: res.headers }))
}

test('宿主路由：任务台 派活/立刻做/取消/删除 + 收件箱，全程不碰真实数据', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-host-'))
  fs.mkdirSync(path.join(dir, '.bili-ai'), { recursive: true })
  fs.mkdirSync(path.join(dir, '.dsh'), { recursive: true })
  // 假的本地表情库（真实环境由 `emotes sync` 拉）；窗口的"打开表情库"读的就是它
  fs.writeFileSync(path.join(dir, '.dsh', 'whale-emotes.json'), JSON.stringify({
    syncedAt: '2026-10-21T00:00:00.000Z',
    emotes: [
      { text: '[doge]', url: 'https://i0.hdslb.com/bfs/emote/a.png', tags: ['笑', '赞'], package_id: 1 },
      { text: '[大哭]', url: 'https://i0.hdslb.com/bfs/emote/b.png', tags: ['哭'], package_id: 2 },
    ],
  }))
  // 2026-10-22：假的贴纸库（真实环境由 `stickers sync --dir "…\表情包"` 建）
  const stkFile = path.join(dir, 'stk.png')
  fs.writeFileSync(stkFile, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  fs.writeFileSync(path.join(dir, '.dsh', 'whale-stickers.json'), JSON.stringify({
    dir,
    stickers: [{ name: '测试图', file: 'stk.png', path: stkFile, type: 'png', tags: ['测试'], desc: '一张测试图' }],
  }))
  const oldUser = process.env.USERPROFILE
  const oldHome = process.env.DSH_HOME
  const oldCfg = process.env.WHALE_CFG
  process.env.USERPROFILE = dir
  process.env.DSH_HOME = path.join(dir, '.dsh')
  delete process.env.WHALE_CFG

  const { ctx, routes, disposers, prompts } = makeCtx()
  try {
    const mod = await import('../../lib/index.js?host-routes-test')   // 带 query：每次拿到全新模块实例（路径常量按新环境重算 ✓）
    mod.default.apply(ctx)

    // 路由都在
    for (const p of ['/dsh-bili/api/task', '/dsh-bili/api/task/add', '/dsh-bili/api/task/run',
      '/dsh-bili/api/task/cancel', '/dsh-bili/api/task/delete', '/dsh-bili/api/outbox', '/dsh-bili/api/emotes']) {
      assert.ok(routes.has(p), `少了路由 ${p}`)
    }

    // 读：格式清单由后端给（窗口不抄一份）
    const t0 = await call(routes, 'GET', '/dsh-bili/api/task')
    assert.equal(t0.code, 200)
    assert.equal(t0.json.formats.length, 6)
    assert.ok(t0.json.formats.some((f) => f.id === 'timeline' && f.label === '时间轴'))
    assert.deepEqual(t0.json.tasks, [])
    assert.equal(t0.json.labels.timeline, undefined, 'labels 只该有状态')

    // 派活 + 立刻做：状态变 running，且她的会话真的收到了这条活（含 @ 指定的人 + 指定贴纸）
    const add = await call(routes, 'POST', '/dsh-bili/api/task/add', {
      bv: 'https://www.bilibili.com/video/BV1x3nw6KEj2/', format: 'timeline', chars: 240, now: true,
      mentions: ['张三'], stickers: ['测试图'],
    })
    assert.equal(add.code, 200)
    assert.equal(add.json.created, true)
    assert.equal(add.json.prompted, true)
    assert.equal(add.json.task.status, 'running')
    assert.equal(add.json.task.bv, 'BV1x3nw6KEj2')
    assert.deepEqual(add.json.task.mentions, ['张三'])
    assert.deepEqual(add.json.task.stickers, ['测试图'], '派活时指定的配图要存进任务')

    const text = prompts[0]?.content?.[0]?.text ?? ''
    assert.match(text, /BV1x3nw6KEj2/)
    assert.match(text, /时间轴/)
    assert.match(text, /task draft/)
    assert.match(text, /@张三/, '任务里点的人要进提示词')
    assert.match(text, /不要自己发评论/, '提示词必须挡住"自己去发评论"')

    const id = add.json.task.id
    const t1 = await call(routes, 'GET', '/dsh-bili/api/task')
    assert.equal(t1.json.tasks[0].status, 'running')
    assert.equal(t1.json.stats.running, 1)

    // 重做：再叫一次（attempts 累加），失败要能退回排队
    const run = await call(routes, 'POST', '/dsh-bili/api/task/run', { id })
    assert.equal(run.code, 200)
    assert.equal(run.json.task.attempts, 2)

    // 取消 + 删除
    const cancel = await call(routes, 'POST', '/dsh-bili/api/task/cancel', { id })
    assert.equal(cancel.json.task.status, 'cancelled')
    const del = await call(routes, 'POST', '/dsh-bili/api/task/delete', { id })
    assert.equal(del.code, 200)
    const t2 = await call(routes, 'GET', '/dsh-bili/api/task')
    assert.equal(t2.json.tasks.length, 0)

    // 收件箱还能读（两条窗口共用一个入口，别把旧的弄坏 ✗）
    const ob = await call(routes, 'GET', '/dsh-bili/api/outbox')
    assert.equal(ob.code, 200)
    assert.deepEqual(ob.json.items, [])

    // 表情库：窗口"打开表情库"拿的就是这份（标签 + 图墙）
    const emo = await call(routes, 'GET', '/dsh-bili/api/emotes')
    assert.equal(emo.json.ok, true)
    assert.equal(emo.json.total, 2)
    assert.ok(emo.json.tags.some((t) => t.name === '笑' && t.n === 1))
    const emoTag = await call(routes, 'GET', '/dsh-bili/api/emotes?tag=' + encodeURIComponent('哭'))
    assert.equal(emoTag.json.items.length, 1)
    assert.equal(emoTag.json.items[0].text, '[大哭]')

    // 自己的表情包：列表里带着名字/标签，图通过 /sticker 吐（本地文件不暴露路径）
    assert.equal(emoTag.json.stickers.count, 1)
    assert.equal(emoTag.json.stickers.items[0].name, '测试图')
    // 单独一条 /stickers（不依赖官方表情库；窗口的「我的表情包」分类只看它）
    const stk = await call(routes, 'GET', '/dsh-bili/api/stickers')
    assert.equal(stk.json.ok, true)
    assert.equal(stk.json.count, 1)
    assert.equal(stk.json.items[0].name, '测试图')
    const img = await callRaw(routes, 'GET', '/dsh-bili/api/sticker?name=' + encodeURIComponent('测试图'))
    assert.equal(img.code, 200)
    assert.match(String(img.headers?.['Content-Type'] ?? ''), /image\/png/)
    assert.deepEqual([...Buffer.from(img.body).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], '返回的是真图片字节')
    const noImg = await callRaw(routes, 'GET', '/dsh-bili/api/sticker?name=' + encodeURIComponent('没有这张'))
    assert.equal(noImg.code, 404, '没登记的名字一律 404（不是任意文件读取）')

    // 草稿：表情（数组）+ @ 谁 都能存、能读回来
    const { emptyOutbox, addItem, saveOutbox } = await import('../../tools/lib/outbox.mjs')
    const seed = emptyOutbox()
    addItem(seed, { text: '先放一条', bv: 'BV1x3nw6KEj2' })
    saveOutbox(seed, path.join(dir, '.bili-ai', 'outbox.json'))
    const saved = await call(routes, 'POST', '/dsh-bili/api/outbox/save', {
      id: seed.items[0].id, text: '改过的正文', bv: 'BV1x3nw6KEj2', emotes: ['doge', '大哭'], mentions: ['张三'], stickers: ['测试图'],
    })
    assert.equal(saved.code, 200)
    assert.deepEqual(saved.json.item.emotes, ['doge', '大哭'])
    assert.deepEqual(saved.json.item.mentions, ['张三'])
    assert.deepEqual(saved.json.item.stickers, ['测试图'], '配图（贴纸）也要能存进草稿')
    const ob2 = await call(routes, 'GET', '/dsh-bili/api/outbox')
    assert.deepEqual(ob2.json.items[0].emotes, ['doge', '大哭'], '窗口写进去的表情要能读回来')

    // 坏输入：没有 BV → 400 且说人话（不是"成功但列表空着"）
    const bad = await call(routes, 'POST', '/dsh-bili/api/task/add', { bv: '随便写的' })
    assert.equal(bad.code, 400)
    assert.match(bad.json.error, /BV/)
  } finally {
    for (const d of disposers) { try { d() } catch {} }   // 停生物钟定时器（不然测试进程不退出 ✗）
    if (oldUser === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = oldUser
    if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome
    if (oldCfg !== undefined) process.env.WHALE_CFG = oldCfg
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
