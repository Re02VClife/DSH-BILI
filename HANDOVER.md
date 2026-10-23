# 交接文档 —— dsh-bili-whale（2026-10-24，v0.12.1）

> 写给**接手这个插件的人或 agent**。目标：30 分钟内能改代码、知道坑在哪、不重复踩。
> 先读三节：**0 现状**、**6 不能碰的边界**、**8 踩过的坑**。其余当字典查。

---

## 0. 现状（一句话）

一个 DSH 插件：让 DSH 里的 agent「养一条鱼」—— 按作息自己刷 B站、看懂视频、写两本日记、把值得的分享给主人；
另有两个窗口（🐟 私信/任务台）和一套**代码强制的额度**（分享 / 收藏 / 自我介绍 / 回复私信 / 预算）。

| 项 | 值 |
|---|---|
| 版本 | **0.12.1**（package.json；客户端标题右边也印着） |
| 测试 | `node --test tools/tests/*.test.mjs` → **74 条全过**（2026-10-24） |
| 代码位置 | `C:\Users\24628\Desktop\vscode\bilibili\dsh-bili-whale` |
| **Git 状态** | ⚠️ **最后一次提交是 v0.3.0**，v0.4→v0.12.1 全在工作区（44 个改动/新增文件）**没提交过** |
| 运行方式 | 装在 DSH 的 desktop profile（`~/.dsh/profiles/desktop`），插件宿主常驻，生物钟每 60s tick |
| 人设 | `C:\Users\24628\AGENTS.md`（这个文件不在仓库里，是**运行时数据**） |

### 第一件事：提交

```bash
cd dsh-bili-whale
git add -A && git commit -m "feat: v0.4→v0.12.1（指定清单/预算/口味/转写/私信窗口/任务台/表情贴纸/评论带图/配额/人设）"
```

> 为什么强调：v0.10 时 `lib/client.js` 被一次编码事故整篇毁掉，**因为没有提交、没有备份，只能整份重写**。
> 这段历史见第 8 节。

---

## 1. 目录地图

```
dsh-bili-whale/
├── lib/                     ← 宿主侧（Node ESM，跑在 DSH 主进程）
│   ├── index.js             ← 插件入口：路由、设置读写、预算硬顶、usage 记账
│   ├── scheduler.js         ← 生物钟：tick / 叫醒 / 监听 / 私信轮询 / 直播间
│   ├── client.js            ← 客户端半边（在浏览器里跑）：设置页 + 🐟 窗口
│   └── settings.html        ← 旧独立页（已下线，仅参考；别再挂路由）
├── tools/                   ← 工具链（独立 node 脚本，插件与 agent 共用）
│   ├── bili.mjs             ← 统一入口：node bili.mjs <命令>
│   ├── commands/            ← 每个命令一个文件（见第 3 节）
│   ├── lib/                 ← 纯函数/共用实现（见第 4 节）
│   ├── tests/               ← node:test（无外部依赖）
│   └── docs/                ← 从 bilibili-API-collect 抄的接口文档
├── persona.example.md       ← 人设模板（抄成 ~/AGENTS.md）
├── CHANGELOG.md             ← 每个版本改了什么、为什么（重要，先读最近 3 个版本）
└── README.md               ← 面向使用者的说明
```

### 数据文件（都不在仓库里）

| 路径 | 内容 | 谁写 |
|---|---|---|
| `~/.dsh/bili-whale.config.json` | **全部配置**（persona / owner / night / budget / taste / listen / share…） | 设置页 POST `/dsh-bili/api/settings` |
| `~/.bili-ai/credentials.json` | B站 cookie（SESSDATA/bili_jct/buvid3），**永不回显** | 设置页 | 
| `~/.dsh/whale-spend.jsonl` | 真实 token 用量（`kind:usage`）+ 视频估算 + 硬顶记录 | `lib/index.js` 监听 `session/event` |
| `~/.bili-ai/outbox.json` | 私信/任务草稿（待审/已发/已否） | `dm` / `task draft` / 窗口 |
| `~/.bili-ai/tasks.json` | 任务台队列 | 窗口 / `task` CLI |
| `~/.bili-ai/quota.json` | 发言账本（含 `intro:true` 的自我介绍） | `comment` / `quota` / `intro` |
| `~/.bili-ai/dm-reply.json` | 回复私信的账（谁、什么时候） | `dm-reply` |
| `~/.bili-ai/taste.json` | 口味档案（关注/收藏/历史） | `taste sync` |
| `~/.bili-ai/feedback.json` | 主人是否回应过（沉默衰减用） | `quota react` |
| `~/.dsh/whale-emotes.json` | 官方表情库（431 个，可挑 379） | `emotes sync` |
| `~/.dsh/whale-stickers.json` | 自己的表情包索引（30 张） | `stickers sync` |
| `~/.dsh/whale-diary.md` / `-private.md` | 两本日记 | 她自己写 |
| `~/.dsh/whale-night.json` | 今天的作息计划 | `night plan` |
| `~/AGENTS.md` | **人设 + 日常流程**（运行时，不进仓库） | 人（不是她） |

---

## 2. 架构（三块）

### 2.1 宿主半边（`lib/index.js`）

`apply(ctx)` 里做四件事：

1. **注册 HTTP 路由**（全部过 `connection.requestRejection` 信任栅栏 + 只接受回环）：

   | 路由 | 作用 |
   |---|---|
   | `GET/POST /dsh-bili/api/settings` | 读写配置（**保存时归一化**：watchlist 解析、budget/taste 夹区间） |
   | `POST /dsh-bili/api/cookie` | 写凭据（只写不读回） |
   | `GET /dsh-bili/api/deps` | 依赖体检 |
   | `GET /dsh-bili/api/pending` + `/approve` `/reject` | 待审回复（B 档：她回别人前先审） |
   | `GET /dsh-bili/api/outbox` + `/save` `/reject` `/delete` `/post` | 私信收件箱：看/改/发评论/否/删 |
   | `GET /dsh-bili/api/task` + `/add` `/run` `/cancel` `/delete` | 任务台：派活/立刻做/取消/删 |
   | `GET /dsh-bili/api/emotes` `GET /stickers` `GET /sticker?name=` | 表情库、贴纸列表、贴纸图片（**只认库里的名字**） |
   | `POST /dsh-bili/api/notify-test` `GET /status` | 推送测试、状态 |

2. **预算硬顶**：`ctx.on('agent/request')` 只对 session `bili-whale` 生效，把 `maxTokens` 改成配置值。
3. **真实用量**：`ctx.on('session/event')` 收 `assistant/message.usage` → 写 `whale-spend.jsonl`。
4. **启动生物钟** + 卸载时清理（`ctx.effect`）。

### 2.2 生物钟（`lib/scheduler.js`）

- 每 60s `tick()`：跑 `night plan` 算下一次醒 → 到点 `sessionController.prompt({ sessionId:'bili-whale', mode:'queue' })` 塞一段"你醒了"的话。
- 另外三个循环：`listenTick`（评论区/直播间，30s 检查）、`dmTick`（私信，20s）、`liveTick`（60s）。
- **`stop()` 必须清掉 `timer/timer2/timer3/timerDm` 和四个 bootTimeout** —— 漏一个就会"插件重载后还在跑"（v0.8 修过）。
- 叫醒文案在 `wakePrompt()` / `wakeSkipPrompt()` / 监听的 prompt 里；**改文案前先跑 `tools/tests/scheduler.test.mjs`**。

### 2.3 客户端半边（`lib/client.js`）

- `window.__ModuleLoader__.load({ id, factory })`，React 用 `h()`（不用 JSX）。
- 三个槽位（DSH 公开契约）：
  - `settings.section` ×1：设置页「养鱼」
  - `sidebar.panellist`：左侧 🐟 图标
  - `main`（key `bili-whale-outbox`）：整个窗口（私信 / 任务台 两页）
- **样式**：`useStyleOnce()` 插入 `<style id="dsh-bili-whale/section.css.v3">`；
  id 带版本号 + 内容变了就地替换 + 删旧标签。改 CSS 记得把 `CSS_VERSION` 加一（v3 → v4）。
- 组件：`EmoteBoard`（官方表情/我的表情包 两个分类）、`OutboxPanel`、`TaskPanel`、`WhaleWindow`、`BiliWhaleSection`。

---

## 3. 命令速查（`node bili.mjs <cmd>`）

| 分类 | 命令 |
|---|---|
| 读 | `session` `deps` `feed` `watchlist` `taste` `budget` `search` `video` `subtitles` `debrief` `links` `likes` `comment-digest` |
| 听懂视频 | `debrief <BV>`（封面+简介+字幕+弹幕+热评+抽帧）→ 没字幕：`audio` → `asr` → `debrief --asr` |
| 写 | `comment`（`--dry/--go`）`dm` `fav` `dynamic` `dynamic-image` `dynamic-edit` `danmaku` `comment-del` |
| 审核与发布 | `outbox`（私信收件箱）`task`（任务台）`reply-draft`（待审回复）`intro`（自我介绍额度）`dm-reply`（回复私信） |
| 配额 | `quota status/check/record/react` `intro status/check/record` `dm-reply --list` |
| 表情/贴纸 | `emotes sync/list/pick/search` `stickers sync/list/tag/show` |
| 记账 | `diary show/log/tail` `notify "…"` `night plan/clock/mark/status` |

**所有写操作必须显式 `--dry` 或 `--go`**；发完必须回读复核（`thread` / `check-comment` / `comment-digest`）。

---

## 4. 关键库（`tools/lib/`）

| 文件 | 职责 | 备注 |
|---|---|---|
| `config.mjs` | 读配置（与宿主**共用同一份文件**） | 默认值要跟 `lib/index.js` 的 DEFAULTS 对齐 |
| `outbox.mjs` | 私信/草稿数据模型 | `normalizeEmotes/Mentions/Stickers`、`effectiveText`（原文永不覆盖） |
| `tasks.mjs` | 任务台数据 + **六种评论格式的提示词** | `FORMATS` 是"格式"的唯一真相；`buildTaskPrompt` 是给她看的说明 |
| `budget.mjs` | token 估算（CJK 1:1）+ `capText`（70% 头 + 25% 尾）+ 账本 | `replyMaxTokens` 是真硬顶，另两个是**估算** |
| `subtitles.mjs` | 字幕（**只信 WBI**）、转写解析 | 旧 `/x/player/v2` 会返回**别的视频的字幕**，默认禁用 |
| `emotes.mjs` | 官方表情库、语义标签、`detect()`（从正文认表情） | |
| `stickers.mjs` / `upload.mjs` | 贴纸索引 / 上传到 B站 CDN（`biz=new_dyn` 必须带） | |
| `usage.mjs` | 今日真实 token 用量 | 备注数字来自这里 |
| `intro.mjs` | 自我介绍额度（一天 1 次，**评论与私信共用**） | `looksLikeIntro` 判据 |
| `dm-reply.mjs` | 回复私信的额度/判据/备注文案 | 默认关；先找她 + 互关 + 1/天 + 30 天/人 |
| `taste.mjs` | 口味档案（关注/收藏/历史） | 文件夹名权重 6，不按条目数放大 |
| `quota-gate.mjs` | 写通道统一闸门 | |

---

## 5. 功能清单（按版本）

| 版本 | 能力 |
|---|---|
| v0.3 | 生物钟、日记、分享、限额（**这是最后一次提交**） |
| v0.4 | 指定清单（UP/视频）+ 预算（单条硬顶 + 单视频/单轮估算） |
| v0.5 | 口味源（关注/收藏/历史 → 加分与排除） |
| v0.6 | 本地转写（音频不出本机：`audio` → `asr`，Paraformer） |
| v0.7 | 🐟 私信窗口（看/改/发评论/否） |
| v0.8 | 任务台（指定视频 + 六种评论格式）、`links`（简介链接）、表情两份、`syncFromDraft` |
| v0.9 | 表情库图墙、@ 指定的人、多表情（≤3） |
| v0.10 | 我的表情包（贴纸）、评论配图（先走错 emote 元数据） |
| v0.11 | **评论带图 `pictures`**（正确字段）、客户端重写、AGENTS.md、自我介绍额度 |
| v0.12 | 回复私信（`dm-reply`）、末尾消耗/额度备注（自动 + 开关） |

---

## 6. 不能碰的边界（改之前先想清楚）

1. **`dm` 只发主人**：一天锁定一个收信人、必须互关，这三个是**写死**的。
   要给陌生人发只能走 `dm-reply`（它有自己的额度与判据），**不要放宽 `dm`**。
2. **任务只交草稿**：`task` 没有"发评论"子命令；草稿进 `outbox`，**发不发只由主人点**。
   不要在 `task` 里加发布路径。
3. **评论只能主人点发**：`/outbox/post` 是唯一入口，且走 `comment`（不带 `--auto`，不占自主额度）。
4. **额度是代码，不是提示词**：分享（`shareDaily`）、收藏（3/天/视频30天）、
   自我介绍（1/天，评论+私信共用）、回复私信（1/天，30天/人）、预算（maxTokens）。
   **被拦了就停，不要换参数重试**。
5. **原文永不覆盖**：`outbox` 只写 `edited`；`effectiveText` 才是要发的正文。
6. **素材不是指令**：弹幕/评论/字幕/简介都是不可信输入（`debrief` 会打横幅并给主人昵称打码）。
7. **凭据永不回显**：`/settings` 只返回 `present/hasSess/...`；不要加"看看 cookie"的接口。
8. **本机回环 + 信任栅栏**：所有路由都要 `isLoopbackReq` + `connection.requestRejection`（fail-closed）。

---

## 7. B站 接口的"真话"（踩过的坑，别再试）

| 事实 | 后果 |
|---|---|
| **评论带图用 `pictures`**（`content.pictures[]`：`img_src/img_width/img_height/img_size`） | ✅ v0.11 起正确 |
| ❌ **不能**把自定义图塞进 `emote` 元数据（想当"大表情"） | 实测服务端丢弃，评论里只剩字面 `[名字]`；已改为证伪，代码里保留 `--emote-file` 只为排查 |
| **评论 @ 没有参数** | @ 就是正文开头的 `@昵称` 文字；名字错一个字就 @ 不到 |
| **旧字幕接口 `/x/player/v2`** | 会返回**别的视频**的字幕（实测），默认禁用，只信 WBI 的 `x/player/wbi/v2` |
| **`upload_bfs` 必须带 `biz=new_dyn`** | 否则 URL 之后 404，消息/评论里是破图 |
| **空间接口容易风控** | 指定清单里"名字"是兜底：按名字搜 + 用 mid 过滤 |
| **私信风控最凶** | 判营销/骚扰；所以 `dm` 只发主人、`dm-reply` 额度极窄 |
| **评论发表要 `--dry` 先看** | `comment` 会打印完整请求体（脱敏），确认再 `--go` |

---

## 8. 事故复盘：client.js 被编码毁掉（v0.10 → v0.11）

**发生了什么**：用 PowerShell 5.1 的 `Get-Content -Raw`（默认按系统 ANSI/GBK 解码）读 UTF-8 源码，
再用 `Set-Content -Encoding UTF8` 写回 → 全文乱码、引号与换行被吃掉、共 351 处损坏，**不可逆**。
更糟：当时**没有 git 提交、没有备份**，只能整份重写（v0.11.0）。

**现在的规则（务必遵守）**：

1. **改文本文件只用 `write` / `edit` 工具**（或 Node `fs.readFileSync(...,'utf8')` + `writeFileSync`）。
2. **禁止** `Get-Content | Set-Content`、`Out-File`、`>` 重定向去改源码（PS 5.1 编码不可控）。
3. 真要批量改：写一个 `.mjs` 脚本用 Node 做，再 `node --check` 验证。
4. 改完立刻 `node --check <file>`，并跑 `npm test`（或第 10 节的命令）。
5. **每完成一个版本就 commit**（本次交接的第一件事）。

**恢复手段（如果再次发生）**：`git checkout -- <file>`（前提：已提交）；
DSH 的 Electron 磁盘缓存里**找不到**插件源码（已验证），不要指望从缓存捞。

---

## 9. 客户端改动的注意点

- **改 CSS 必须加 `CSS_VERSION`**，否则热更新时旧样式还挂着（曾出现"新界面 + 旧样式"= 白底白字的主按钮）。
- **不要在按钮上用 `background: var(--dsw-alias-brand-primary)` 配 `color:#fff`**：
  这套主题的 brand 是**浅色**（当文字强调色用的），会白底白字。现在主按钮是
  `rgba(127,127,127,.22)` 底 + `label-primary` 字 + 深边框。
- 宿主只提供 `--dsw-alias-label-primary/secondary`（**没有 tertiary**），用错等于颜色没定义。
- 面板宽度是自适应的（`max-width:1280px`）；贴纸预览 92px；表情面板 `resize:vertical`。
- 改完客户端要**重启 DSH + 刷新页面**；标题右边的版本号（`v0.12.1`）用来确认是不是新 bundle。

---

## 10. 测试

```bash
cd dsh-bili-whale
node --test tools/tests/watchlist.test.mjs tools/tests/budget.test.mjs \
  tools/tests/scheduler.test.mjs tools/tests/subtitles.test.mjs tools/tests/taste.test.mjs \
  tools/tests/outbox.test.mjs tools/tests/tasks.test.mjs tools/tests/intro.test.mjs \
  tools/tests/dm-reply.test.mjs tools/tests/host-routes.test.mjs
```

- 期望：**74 pass / 0 fail**。
- `host-routes.test.mjs`：用**假 ctx** 把 `apply()` 挂起来，直接打路由（不连 DSH、不连 B站、不碰真实数据），
  能抓到"路由写错/字段变了"这类只有重启才发现的问题。它跑完会自己退出（说明 `stop()` 清干净了）。
- **别用 `node --test tools/tests/`**（MODULE_NOT_FOUND，得列文件）。
- 时间敏感的测试用**固定时刻**（例：`new Date('2026-10-24T12:00:00+08:00')`），否则凌晨跑会因跨天假失败。

---

## 11. 新机器从零跑起来

1. `node >= 18`；`ffmpeg`（抽帧用，`FFMPEG` 环境变量可指定）
2. `dsh plugin --profile desktop add "link:C:\path\to\dsh-bili-whale"` → **重启 DSH**
3. 设置 → 养鱼：填 cookie（SESSDATA/bili_jct）、主人 mid/昵称
4. 点「依赖体检」：cookie / ffmpeg / node / 数据目录 全 ✓
5. 把 `persona.example.md` 复制成 `~/AGENTS.md` 改成你的（**不写就没有人设**）
6. 可选：`emotes sync`（官方表情）、`stickers sync --dir "…\表情包"`（自己的图）、`taste sync`（口味）
7. 左侧出现 🐟；设置页能看到「养鱼」
8. 想立刻看她跑一轮：`node bili.mjs night plan` 看计划，或直接在会话里说"你醒一下"

---

## 12. 已知限制 / 下一步

**限制**

- 主人的**观看历史**读不到（B站只给登录账号）→ 「排除我看过的」不完整，除非把主人的 cookie 也配进来。
- 本地转写默认 CPU（990MB 模型，20 分钟音频几分钟）；有 N 卡可换 CUDA torch 提速。
- 评论配图（`pictures`）已实现但**只在本机验证过请求体**；服务端是否认、最多几张，需要真发一条确认。
- 客户端只有 `node --check`，没有 UI 测试；改布局靠截图核对。
- `AGENTS.md` 是运行时文件，不随插件分发；换机器要自己带。

**下一步建议（按价值排序）**

1. **先 commit**，然后打 tag `v0.12.1`。
2. 任务台「批量派活」（一个 BV 列表 + 一种格式）。
3. 定时任务（"每天 8 点给这条重写一版"）。
4. 评论配图实测 + 失败自动回滚（已有 `PIC_DROP` 回读，验证一次就够）。
5. 设置页里 `diaryTitle` / `keywords` 等还没暴露的字段（`FIELDS` 里加一行即可）。

---

## 13. 交接自查清单

- [ ] `git log` 能看到 v0.12.1 的提交
- [ ] 测试 74 pass
- [ ] 设置页能打开、能保存（保存后 `bili-whale.config.json` 真的变了）
- [ ] 🐟 窗口两个标签页都能开，标题右边显示 `v0.12.1`
- [ ] `node bili.mjs intro` / `dm-reply --list` / `task list` 三条都正常
- [ ] `~/AGENTS.md` 存在，且第一个小节是「每次醒来先做这三件」
- [ ] 知道三件"绝对不要做"：放宽 `dm`、给 `task` 加发布、用 PowerShell 改源码

有问题先看 `CHANGELOG.md` 最近 3 个版本和 `README.md` 的「依赖与移植性」一节。
