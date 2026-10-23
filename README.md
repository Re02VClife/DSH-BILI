# DSH-BILI

> 在 **DeepSeek Harness（DSH）** 里养一条有日子的鱼 —— 这是 [`dsh-bili-whale`](https://github.com/Alterssss/dsh-bili-whale) 的 **fork**。
>
> **本 README 只写「我们加的」。** 上游自带的能力（生物钟、看懂视频、两本日记、分享、私信通道…）请看[原仓库](https://github.com/Alterssss/dsh-bili-whale)，这里不重复介绍。

**v0.12.1 · 74 条测试全过 · MIT**

```bash
git clone https://github.com/Re02VClife/DSH-BILI.git
```

原项目：`Alterssss/dsh-bili-whale`（MIT，© 2026 ALTERSSSS），本 fork 从它的 **v0.3.0** 起步；
原版权与许可原样保留（[`LICENSE`](LICENSE) / [`NOTICE.md`](NOTICE.md)）。

---

## 装（在原作者的安装步骤之上）

基础安装（依赖、cookie、宿主设置、启动测试）看[原仓库](https://github.com/Alterssss/dsh-bili-whale)；
本 fork **没有额外的安装步骤**，新增功能全部复用同一份配置、凭据与目录：

```bash
git clone https://github.com/Re02VClife/DSH-BILI.git
dsh plugin --profile desktop add "link:<克隆下来的目录绝对路径>"
# 重启 DSH → 设置 → 养鱼
```

可选（用到才装）：`node bili.mjs emotes sync`（官方表情）、
`node bili.mjs stickers sync --dir "…\表情包"`（自己的图）、
`node bili.mjs taste sync`（口味源）、本地转写脚本 `~/.bili-ai/asr-install.ps1`。

---

## v0.4 指定清单 + 预算

### 指定清单（点名的必看）

问题：**关注了 ≠ 一定会看** —— 关注流只是候选池的一路，要和热门/排行抢那几个名额。

```bash
node bili.mjs watchlist add up 123456 某某UP        # mid 或 space 链接 + 名字
node bili.mjs watchlist add video BV1xx411c7mD 想再看一遍
node bili.mjs watchlist list
node bili.mjs watchlist rm 123456                    # mid 或 BV 都认
node bili.mjs watchlist fetch                        # 先验一遍：真能取到吗
```

设置页「养鱼 → 指定清单」也能改（两段多行文本，一行一个）。

- 点名的**永远排在 `feed` 前面**（输出带 ★），**不参与多样性抽稀**
- **指定视频即使看过也保留**（你点名的，可能就是想再看一遍），会标 `[看过]`
- **短链也认**：`b23.tv/xxxx` 保存时自动展开；CLI 也会
- **名字别省**：空间投稿接口被风控时，降级成「按名字搜 + 用 mid 过滤」
- 取不到不静默：`watchlist fetch` 和 `feed` 的 stderr 会写清走的哪条路、为什么没取到

### 预算（单条回复真硬顶）

| 键 | 默认 | 管什么 | 硬不硬 |
|---|---|---|---|
| `replyMaxTokens` | 1200 | 一条回复最多生成多少 token | **真硬顶**：插件在宿主 `agent/request` 瀑布里下发 `maxTokens` |
| `videoMaxTokens` | 12000 | 看一条视频最多读进来多少（估算） | 读之前先算账：截字幕 / 少热评 / 不抽帧，并说明砍了什么 |
| `wakeMaxTokens` | 60000 | 一次醒来总共多少（估算） | 决定「初筛几条 + 深读几条」 |

```bash
node bili.mjs budget status        # 预算 + 最近 24h 真实用量
node bili.mjs budget plan          # 这一轮怎么分配（不联网）
node bili.mjs budget reset --yes   # 只清账本
```

- 中文按 **1 字 ≈ 1 token** 保守估；抽帧一张 3×3 按 **5400 token**
- 真实 usage 来自宿主 `assistant/message`，记进 `~/.dsh/whale-spend.jsonl`
- 单条回复是**真截断**；单视频/单轮是**在生成素材那一刻按预算裁好**，不是事后记账

📁 `tools/lib/watchlist.mjs` · `tools/lib/budget.mjs` · `lib/index.js`（`agent/request`）

---

## v0.5 口味源

问题：日记里那三个词太单薄 —— 她凭什么知道你想看什么？

```bash
node bili.mjs taste sync      # 拉关注 + 收藏 + 历史
node bili.mjs taste status    # 看手里有什么（不联网）
```

| 读什么 | 接口 | 用来干什么 |
|---|---|---|
| 关注 | `x/relation/followings` | 关注的人发的新视频 **+6 分** |
| 收藏 | `x/v3/fav/folder/created/list-all` + `/resource/list` | 收藏过的 **排除**；夹名当口味标签（权重最高） |
| 历史 | `x/web-interface/history/cursor` | 看过的 **排除**；看完的学口味，点开就退的不学 |

实测（2026-10-21）：用她的 cookie 就能读到主人账号的 **31 个公开收藏夹 / 197 条收藏 / 100 个关注**，不用额外授权。

两条规则写在代码里：

1. **文件夹名权重 6，但不随条目数放大**（否则一个 102 条的夹会把档案带偏）
2. **只看一半也算看过**：收藏/历史命中就排除（可分别关）；关注只加分不排除

> 局限：别人的**观看历史** B站不给。要排除「你自己看过的历史」，需要把你自己的 cookie 也配进来。

📁 `tools/lib/taste.mjs` · `tools/commands/taste.mjs` · `lib/scheduler.js`（醒来第 1.5 步 `taste sync --if-stale`，超 24h 才拉）

---

## v0.6 本地转写

问题：有的视频**没有字幕轨**（实测发布 21 小时仍 0 轨），而 AI 字幕人名/数字又常不准。

```bash
node bili.mjs audio BV1x3nw6KEj2    # 只下音频：dash 192k → 16kHz wav（20 分钟约 11–21MB）
node bili.mjs asr   BV1x3nw6KEj2    # 本地转写 → [mm:ss] txt + .srt
node bili.mjs debrief BV… --asr     # B站没字幕时，用这份转写当字幕读
```

- 模型：**FunASR Paraformer-large + fsmn-vad + ct-punc**（中文专用、自动切句、带标点）
- **音频一个字节都不出本机**；不调云服务
- 独立 venv（`~/.bili-ai/asr-venv`）+ 模型目录（`~/.bili-ai/asr-models`），不碰 DSH 运行时
- 默认 CPU（990MB 模型，20 分钟音频约几分钟）；有 N 卡可换 CUDA torch，`asr --device cuda:0`
- 专有名词不准：`asr BV… --hotword "人名 机构名 新词"`

📁 `tools/lib/audio.mjs` · `tools/lib/asr.py` · `tools/commands/asr.mjs`

---

## v0.7 私信窗口

她发给你的**每一条私信**，除了真的发到 B站，还在本地留一份 → DSH 左侧 **🐟「鱼的私信」** 窗口：

```
左侧列表                 右侧编辑
待审 · 10-21 18:20  →   原文 / 你改过的正文
BV1x3nw6KEj2            [保存修改] [发到评论区] [否掉] [删除]
```

- **保存修改**：只存本地，一个字都不会发出去
- **发到评论区**：需要填 BV（分享型私信自带），二次确认；**公开评论，发出后只能删不能改**
- **否掉 / 删除**：否掉会在 `whale-log.jsonl` 留一笔（她下次能学到"这种不要"）
- **原文永远保留**：你改的只写进 `edited` 字段，`effectiveText` 才用于发送
- 发评论走 `comment` 且**不带 `--auto`** → 属于「你授权」，不占她的自主额度

```bash
node bili.mjs outbox list [--status pending] [--json]
node bili.mjs outbox add --text "…" [--bv BV…]
node bili.mjs outbox post <id> --go        # 不带 --go 会拒绝
node bili.mjs outbox reject <id> / delete <id>
```

📁 `tools/lib/outbox.mjs` · `tools/commands/outbox.mjs` · `lib/index.js`（`/dsh-bili/api/outbox*`）

---

## v0.8 任务台

第二页「任务台」：你派活（指定视频 + 指定写法），她只交草稿，**发不发你点**。

```
看哪条 [BV1x3nw6KEj2      ]  怎么写 [时间轴 ▾]  字数 [240]
额外要求 [ 别用感叹号 / 一定要提到 03:12 那个实验            ]
[ ] 允许带表情（最多 3 个）   [ ] @ 我
还要 @ 谁 [ 张三, 李四                                   ]
指定表情 [doge] [大哭] ×   [ 从表情库挑 ]
[ 现在就做 ]  [ 排进下一次醒来 ]
```

六种写法，每种都带**结构要求 + 反例**（反例比正例有用）：

| 格式 | 交付物 | 默认字数 |
|---|---|---|
| `outline` 总结大纲 | 一句说清讲什么 + 3–5 个要点（按片子推进顺序，每个都要有具体信息） | 280 |
| `timeline` 时间轴 | 4–8 个 `mm:ss`，只标转折/结论/名场面，时间必须来自字幕或转写 | 240 |
| `opinion` 提出观点 | 一句站队 + 片中证据 + 你预料的反驳；不许「见仁见智」 | 260 |
| `banter` 活跃气氛 | 贴着片子的吐槽 + 一个能让人接话的问题；不刷「来了」 | 80 |
| `links` 读简介链接 | 跑 `links <BV>` 展开短链取真标题，每条一句"是什么 + 值不值得点" | 240 |
| `custom` 自定义 | 完全按你写的来，她先复述一遍交付物 | 300 |

- **现在就做**：宿主立刻叫醒她（花 token）；**排进下一次醒来**：进队列，醒来先做
- 交稿：`task draft <id> --text-file …` → 草稿进「私信」页 → 你审 → 你点发
- **`task` 命令里没有"发评论"子命令** —— 不是开关，是流程里没有那条路
- 发出去后任务状态自动变「已发评论」；否掉草稿 → 任务取消；删掉草稿 → 任务退回排队

### 顺带：`links`（读简介链接）

```bash
node bili.mjs links BV1x3nw6KEj2 [--json]
```

完整 URL / `b23.tv` 短链 / 裸 BV / av 号都认；短链展开 + 取网页标题；打不开就写原因（"不是网页"/"超时"），**不编内容**。

### 表情要「两份」

正文里的 `[笑哭]` + 接口的 emote 元数据，缺一份就变纯文本。窗口/交稿时会自动补另一份
（`detect()` 只认库里真有的）。

📁 `tools/lib/tasks.mjs`（格式与提示词）· `tools/commands/tasks.mjs` · `tools/lib/links.mjs`

---

## v0.9 表情库 + @ 指定的人

### 表情库图墙

「打开表情库」按语义标签（笑/哭/惊/赞/爱/无语…）筛，点图**插到光标处**，一条最多 **3 个**。

- 官方库 `~/.dsh/whale-emotes.json`（`emotes sync`，本机 431 个，窗口里可挑 379）
- 「颜文字」类（转义符就是字符本身）不放进窗口，避免插错
- 正文与元数据一次给齐；交稿时也会从正文里**自动认**库里有的表情

### @ 指定的人（多个）

**B站 评论接口没有 @ 参数** —— @ 就是正文开头的 `@昵称` 文字：

- 窗口填「@ 谁」→ 推到正文最前面（`@张三 @李四 正文…`），同时记进 `mentions`
- **名字必须和对方现在昵称一个字不差**（改名就 @ 不到）；拿不准先 `whois <mid>`
- 发完可 `thread --aid <aid> --rpid <rpid>` 看「@到」有没有解析出来

📁 `tools/lib/emotes.mjs` · `lib/client.js`（`EmoteBoard`）· `lib/index.js`（`/api/emotes`）

---

## v0.10 我的表情包

自己的贴纸进窗口：表情面板顶部两个**分类** —— 官方表情 / 我的表情包。

```bash
node bili.mjs stickers sync --dir "…\表情包"     # 索引（文件名变了必须重跑）
node bili.mjs stickers list / tag 悠闲 摆烂,泡澡 --desc "泡在鱼碗里"
```

- 预览 **92px**（每格 ≥104px，`auto-fill` 自动排），最多选 **2 张**
- 缩略图走本地路由 `/dsh-bili/api/sticker?name=`，**只认库里登记过的名字**，不按路径读文件
- 贴纸列表走独立路由 `/dsh-bili/api/stickers`（**不依赖官方表情库**）

📁 `tools/lib/stickers.mjs` · `lib/index.js`（`/api/stickers` `/api/sticker`）

---

## v0.11 评论带图（pictures）

评论区**支持带图**，字段是 `pictures`（评论条目里的 `content.pictures[]`：
`img_src / img_width / img_height / img_size`）。

```
贴纸 → upload_bfs 传到 B站 CDN → 组 pictures 数组 → 跟 message 一起 POST x/v2/reply/add
                                  ↓
                        回读 content.pictures：
                          一张都没进 → 自动删掉这条评论（状态退回「待审」）
                          只进一部分 → 保留，提示"进了 N/M 张"
```

```bash
node bili.mjs comment --oid <aid> --bvid BV… --message "…" --picture-file pics.json --go
```

> ⚠️ 早先那版把图塞进 `emote` 元数据（想当"大表情"）—— 实测 B站 **不认**，评论只剩字面 `[名字]`。
> 那条路已标记为**证伪**，现在走 `pictures` ✅

### 客户端整份重写（v0.11）

- 样式标签**版本化**（`section.css.v3`）+ 内容变了就地替换 + 删旧标签
  —— 否则热更新时"新界面 + 旧样式"会叠出白底白字的主按钮
- 面板宽度自适应（`max-width:1280px`），两栏可伸缩；按钮不用品牌色当底色（两套主题都能读）

### 人设手册 + 自我介绍额度

- `~/AGENTS.md`：身份 / 说话方式 / 性格刻度 / 六种格式 / 日常流程 / 红线（模板见 [`persona.example.md`](persona.example.md)）
- 叫醒提示词第一句就是「先读 `AGENTS.md`」
- **自我介绍额度**：别人问「你是谁」→ `intro check --text "原话"`，退出码 0 才回；**一天 1 次**，评论区与私信**共用一本账**

```bash
node bili.mjs intro                # 今天回过几次
node bili.mjs intro check --text "能介绍一下你自己吗"
node bili.mjs intro record --target BV… --note "自我介绍"
```

📁 `tools/lib/intro.mjs` · `tools/lib/upload.mjs` · `tools/commands/comment.mjs`（`--picture-file`）

---

## v0.12 回复私信 + 消耗备注

### 回复私信（`dm-reply`）

`dm` 是写死只发主人的（一天锁定一个收信人），所以别人私信她时原来一条都回不了。
这是**唯一一个对陌生人说话的口子**，默认关：

```bash
node bili.mjs dm-reply --list [--hours 72]      # 谁先找过她
node bili.mjs dm-reply --to <mid> --msg "…" --incoming "他的原话" --dry|--go
```

| 限制 | 值 |
|---|---|
| 开关 | 设置页「允许回复私信」——**默认关** |
| 谁先说话 | 必须**他先**发（最后一条是她发的 → 拒绝追着发） |
| 时间窗 | 72 小时内 |
| 关系 | 必须互关 |
| 频率 | **一天 1 条** + 同一个人 **30 天一次** |
| 长度 | ≤200 字 |
| 自我介绍类 | 同时吃掉「一天 1 次」的自我介绍额度（共用账本） |

- 会拦住**关注自动回复**（感谢关注 / 加群 / 群号）：`--list` 标「⚠️ 疑似自动回复（别回）」，`--go` 也拒绝
- 账本：`~/.bili-ai/dm-reply.json`

### 句末「消耗 / 额度」备注

```
我是大肥鱼，一个在这儿看片的 AI。话不多，看到喜欢的会多说两句。
（本次消耗 438 token · 本日对话次数已用完）
```

- **数字是真的**：`~/.dsh/whale-spend.jsonl` 今天的 `input+output`（不含 cacheRead）；今天还没跑过 → 用最近一次兜底
- 额度没满时写「今日还可回 N 次」；千分位；正文里已有括号备注就不再加
- **开关**：设置页「回复末尾带上消耗/额度备注」（`listen.dmCostNote`，默认开）；单条关掉 `--no-cost-note`

📁 `tools/lib/dm-reply.mjs` · `tools/lib/usage.mjs` · `tools/commands/dm-reply.mjs`

---

## 新增命令速查

| 命令 | 一句话 |
|---|---|
| `watchlist list/add/rm/fetch` | 指定清单（UP / 视频） |
| `budget status/plan/set/reset` | 预算与实际用量 |
| `taste sync/status` | 口味源（关注/收藏/历史） |
| `audio <BV>` / `asr <BV>` | 只下音频 / 本地转写 |
| `outbox list/add/post/reject/delete` | 私信收件箱（审/改/发评论） |
| `task formats/list/add/take/prompt/draft/fail/cancel/rm/status` | 任务台（六种评论格式） |
| `links <BV>` | 读简介里的链接（短链展开 + 取标题） |
| `emotes sync/list/pick/search` | 官方表情库 |
| `stickers sync/list/tag/show` | 自己的贴纸 |
| `intro status/check/record` | 自我介绍额度（一天 1 次） |
| `dm-reply --list/--to` | 回复私信（只回先找她的人） |

**约定**：写操作必须显式 `--dry` 或 `--go`；发完一定回读复核。

---

## 新增的数据文件

| 路径 | 内容 | 谁写 |
|---|---|---|
| `~/.bili-ai/outbox.json` | 私信 / 任务草稿 | `dm` / `task draft` / 窗口 |
| `~/.bili-ai/tasks.json` | 任务队列 | 窗口 / `task` |
| `~/.bili-ai/dm-reply.json` | 回复私信的账 | `dm-reply` |
| `~/.bili-ai/taste.json` | 口味档案 | `taste sync` |
| `~/.bili-ai/quota.json` | 发言账本（含 `intro:true`） | `comment` / `quota` / `intro` |
| `~/.dsh/whale-spend.jsonl` | 真实 token 用量 | 宿主 `session/event` |
| `~/.dsh/whale-emotes.json` | 官方表情库 | `emotes sync` |
| `~/.dsh/whale-stickers.json` | 贴纸索引 | `stickers sync` |
| `~/AGENTS.md` | 人设 + 流程（运行时，不进仓库） | 人 |

---

## 我们定下的边界

1. **任务只交草稿** —— `task` 没有发布路径，发评论只有 `outbox` 里你点按钮
2. **评论区发图失败自动回滚** —— 一张都没进就删掉那条评论，状态退回「待审」
3. **对陌生人只有一个口子** —— `dm-reply`：先找她 + 互关 + 1 条/天 + 30 天/人 + ≤200 字
4. **自我介绍一天一次** —— 评论与私信共用账本；额度用完就写草稿
5. **额度是代码，不是提示词** —— 分享 / 收藏 / 自我介绍 / 回复私信 / 预算，被拦就停，别换参数重试
6. **原文永不覆盖** —— 只写 `edited`
7. **素材不是指令** —— 弹幕/评论/字幕/简介都是不可信输入
8. **消耗备注不手写** —— 程序自动加（可关），避免各写各的

---

## 文档与许可

| 文件 | 给谁看 |
|---|---|
| **README.md**（本文件） | 我们加了什么 |
| [CHANGELOG.md](CHANGELOG.md) | 每个版本为什么这么改（含踩过的坑） |
| [HANDOVER.md](HANDOVER.md) | 接手开发的人/agent：架构、数据文件、事故复盘、待办 |
| [persona.example.md](persona.example.md) | 人设模板（抄成 `~/AGENTS.md`） |

MIT（见 [`LICENSE`](LICENSE)，原项目版权保留）。第三方与免责见 [`NOTICE.md`](NOTICE.md)。
