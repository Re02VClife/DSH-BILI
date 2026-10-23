# NOTICE · 来源、第三方与免责

## 本项目是 fork

| | |
|---|---|
| 仓库 | https://github.com/Re02VClife/DSH-BILI |
| 版本 | v0.12.1 |
| 上游（原项目） | **https://github.com/Alterssss/dsh-bili-whale** —— MIT，© 2026 ALTERSSSS |
| 分叉点 | 上游 `v0.3.0` |
| 本 fork 的改动 | v0.4 → v0.12.1（指定清单、预算、口味源、本地转写、私信窗口、任务台、表情/贴纸、评论带图、自我介绍与回复私信额度、人设手册…），逐条见 `CHANGELOG.md` |

**原项目的版权声明与 MIT 许可原样保留**（见 `LICENSE`）。本 fork 的修改同样以 **MIT** 发布。

> 上游若更新，合并方式：`git remote add upstream https://github.com/Alterssss/dsh-bili-whale.git`
> → `git fetch upstream` → `git merge upstream/main`（冲突多半在 `lib/client.js` / `README.md`）。

## 它依赖/参考了这些第三方

| 名称 | 用途 | 许可 / 说明 |
|---|---|---|
| **Bilibili API** | 全部功能都调 B 站公开接口 | 非官方；本项目**不包含** B 站任何代码或数据 |
| **bilibili-API-collect** | `tools/docs/` 里的接口文档整理自该项目（社区维护的 B 站接口文档） | 遵循其原项目许可；仅作接口说明用，**不随本项目分发**时请以原仓库为准 |
| **ffmpeg** | 抽帧 / 看画面（`tools/lib/ffmpeg.mjs` 只是**定位并调用**它） | **LGPL v2.1+**（若用 GPL 构建则为 GPL）。本项目**不打包** ffmpeg：请自行安装，或使用发布页附带的 LGPL 构建（附其 LICENSE 与源码链接：https://ffmpeg.org）|
| **FunASR / ModelScope / PyTorch** | 可选：本地转写（`tools/lib/asr.py`） | 各自遵循其开源许可；模型在**你的本机**运行，音频不出本机 |
| **Node.js** | 运行环境 | MIT |
| **DeepSeek Harness（DSH）** | 宿主平台（插件接口 / 槽位 / 会话） | 本项目与 DSH、B 站官方均无隶属关系 |

## 免责

- 本项目是**个人自用工具的公开版**：它用**你自己的账号**在 B 站做评论/回复/发动态/私信等动作，**后果由使用者自负**。
- 不要用于批量刷量、水军、骚扰、绕过风控或任何违反 B 站用户协议的行为。
- 遵循平台规则，撞到风控（验证码 / 限流 / 判刷屏）就该停手，本项目内置了"撞到就停"的护栏。
- 本项目与 B 站、DeepSeek 官方均无隶属关系。
