# Day 28 · 结营验收（28 天作品 v1.0 交付）

**日期**：2026-10-15（Day 28｜第 4 周）
**线上**：https://habit-board-d0gum6nqu512acc29-1499798330.tcloudbaseapp.com/
**健康接口**：https://habit-board-d0gum6nqu512acc29-1499798330.ap-shanghai.app.tcloudbase.com/api-health
**环境**：habit-board-d0gum6nqu512acc29（CloudBase 体验版，ap-shanghai）

> ⚠️ **关于「附录 J」**：训练营材料里附录 J 的原文手头没有存档。本清单是**按 Day 28 任务清单
> 点名的条目（公网首页 / 健康接口 / 一次线上写入+刷新持久化 / PATCH / DELETE）＋仓库实际交付物**
> 重建的，每一条都写成「当场能打开 / 能演示」的形式。**如果附录 J 原文另有条目，以原文为准补齐**，
> 缺哪条如实补标，不虚报。

---

## ① 验收官检测

以「第一次看到这个项目的验收官」视角，全部打**公网真实地址**，不打本地：

| # | 检测项 | 做法 | 结果 |
| --- | --- | --- | --- |
| V1 | 公网首页能打开 | `GET /` | **PASS**：HTTP 200，7828 字节，标题「习惯养成规划板」，Last-Modified 10-13（Day 27 发布那版） |
| V2 | 健康接口返回对的环境 | `GET /api-health` | **PASS**：`envId=habit-board-d0gum6nqu512acc29`、`version=v1`、`checkedAt=2026-10-15T03:45:46Z`（新鲜的，不是缓存） |
| V3 | 读接口返回库里那份 | `GET /api/habits` | **PASS**：`count=6`，6 个种子习惯逐条在列 |
| V4 | 公网那份 = 本地源码 | 6 个关键文件 md5 逐个比对（app.js / cloud.js / style.css / index.html / theme.css / theme.js） | **PASS**：6/6 一致 |
| V5 | 发布前检查技能全绿 | `node skills/preflight-check/run-preflight.js` | **PASS**：A1/A2/B1/B2/B3/C1/C2，**7 项全过 0 失败**（存档 `day28-preflight.txt`） |

---

## ② 核心流程重复检测

**两条腿都走了**：接口层的完整 CRUD 循环（curl，存档 `day28-crud-log.txt`）＋
真实浏览器像新用户那样走核心流程（CDP 驱动 Edge，存档 `day28-walk-core-flow.txt` + 截图 `day28-walk-core-flow.png`）。

### 接口层（一次线上写入 + 持久化 + PATCH / DELETE）

| # | 步骤 | 结果 |
| --- | --- | --- |
| C1 | `POST /api/habits` 新建（weekly/3 次） | **PASS**：201 形状，服务端发 id=`h_mv900o780jz5h`，`createdAt=2026-10-15` |
| C2 | 列表读回，确认它出现 | **PASS**：`count=6→7`，列表里逐字段一致（写入确实进了云数据库，不是只回了句成功） |
| C3 | `PATCH /api/habits/<id>` 改名 + 改次数 | **PASS**：返回改后那一条，`name/freqCount` 都变了 |
| C4 | `DELETE /api/habits/<id>` | **PASS**：`deleted.mode=soft, recoverable=true`（软删，可恢复） |
| C5 | 删除后再读列表 | **PASS**：`count=7→6`，该 id 不再出现 |
| C6 | 测完不留垃圾 | **PASS**：测试条目已软删，库回到 6 条 |

> ⚠️ **诚实记录一处打错的地址**：日志初稿的第 2/6 步打了 `GET /api/habits/<id>`——
> **契约里没有「读单条」这条路**，这个地址被云函数兜底成了返回整个列表（HTTP 200）。
> 删除是否生效的有效证据是列表 count 7→6 且 id 消失，这个成立；「返回 404」那句不成立，已在日志里更正。
> 教训：**验收官检测自己也要先对着契约打，不能想当然造地址。**

### 浏览器层（真实 Edge，公网地址，1240×960）

| # | 步骤 | 结果 |
| --- | --- | --- |
| W1 | 腾讯云「页面访问提示」中间页 | 命中并点掉（`gate=clicked`）—— 印证 Day 27 真人卡 5 秒的那道门，CLI 永远遇不到 |
| W2 | 首屏读数 | **PASS**：标题对、角标「**云端数据库**」、6 张习惯卡、今日 0/6 |
| W3 | 「＋ 新建习惯」弹层新建 | **PASS**：`addHabit=ok`，卡片 6→7 |
| W4 | 打卡（勾选圈） | **PASS**：`aria-pressed false -> true`，写回云端 |
| W5 | 点卡片上那排 7 格（Day 14 真人卡点、Day 27 修复的那处） | **PASS**：`详情弹层 hidden: true -> false` ← **有反应**，修复在线上真实生效 |
| W6 | 点习惯名字开详情 | 脚本超时——**不是产品 bug**：第 ⑤ 步已经把详情弹层打开了，再点入口被自己的弹层挡住。入口本身在第 ⑤ 步已验证可用 |
| W7 | 走查写入的测试习惯 | **PASS**：走完用 DELETE 软删清掉，`count` 回到 6，不留垃圾 |

---

## ③ 交付清单清点（附录 J · 重建版，逐项能当场打开）

| # | 清单项 | 当场怎么打开 / 演示 | 状态 |
| --- | --- | --- | --- |
| J1 | **作品公网 URL** | 浏览器打开 https://habit-board-d0gum6nqu512acc29-1499798330.tcloudbaseapp.com/ | ✅ 截图 `day28-live-homepage.png`（带地址栏） |
| J2 | **健康接口** | 打开 …/api-health | ✅ V2 |
| J3 | **一次线上写入 + 刷新后持久化** | POST 一条 → GET 读回（② 的 C1/C2） | ✅ `day28-crud-log.txt` |
| J4 | **PATCH（改一条）** | ② 的 C3 | ✅ 同上 |
| J5 | **DELETE（删一条，软删可恢复）** | ② 的 C4/C5 | ✅ 同上 |
| J6 | **产品需求文档** | `PRD.md`（v1.2，含变更记录） | ✅ 在仓库根 |
| J7 | **调研 + 技术设计** | `research.md` / `TECH_DESIGN.md` / `api-contract.md` | ✅ 在仓库根 |
| J8 | **接口契约** | `api-contract.md`（3 条路由 + 状态码表 + 统一约定） | ✅ V5 的 C2 项核过契约与部署配置一致 |
| J9 | **数据库** | CloudBase PostgreSQL：三张表 + 种子数据，`GET /api/habits` 返回的就是它 | ✅ V3 |
| J10 | **发布与回滚** | `ROLLBACK.md`（回滚手册）+ `acceptance/day26-evidence/day26-deploy-log.txt`（部署日志） | ✅ Day 26 真演练过，单次 4~5 秒 |
| J11 | **上手测试记录（含真人）** | `user-test/`：两轮 Day 14 记录 + Day 27 线上真人试用（7 条任务 + 原话存档） | ✅ 真人共 2 位 |
| J12 | **周验收 + 验收证据目录** | `acceptance/week3.md`（12 条，PASS 10 / FAIL 2 如实标出）+ 各 `dayNN-evidence/` | ✅ |
| J13 | **可复用技能包** | `skills/filter-check/`（28 断言）、`skills/preflight-check/`（7 条，故意种泄漏能抓到） | ✅ 本文档 V5 就是它刚跑的一轮 |
| J14 | **28 天过程记录** | `git log`：43 个提交，标题全是「Day N｜做了什么」，2026-09-17 → 2026-10-15 | ✅ 远端 main 已核验 = 本地 HEAD（`087e317`） |
| J15 | **结营复盘** | `acceptance/day28-retrospective.md` | ✅ 本文档同批交付 |

**交付截图（任务清单要求的两张）**：
1. `day28-appendix-j-checklist.png` —— 附录 J 清单逐项打勾状态（由 `day28-appendix-j.html` 渲染，`file://` 地址栏可见）
2. `day28-live-homepage.png` —— 作品公网 URL 打开的样子（地址栏 + 完整作品 + 云端数据库角标）

---

## ④ 结营复盘

见 `acceptance/day28-retrospective.md`（今天那一问：28 天里最大的一个认知改变）。

---

## 5. 如实标出：没做的事 / 遗留

| 项 | 状态 | 原因 |
| --- | --- | --- |
| 真人复测「修复后的版本」 | 未做 | Day 27 的真人测的是 v1.0（修复发布前）；修复发布后还没请他再走一轮。不阻塞结营，等斌邀请 |
| 「最近一个月」口径 | 未修 | Day 14 遗留：问最近一个月、答的是本周强度 |
| 跨页入口「看板 ↗」尺寸 | 未修 | 39×21px / 13px 字，低于拇指线，属另一条线 |
| 手机端点击目标偏小 | 未修 | Day 14 量过：习惯名 19px、勾选圈 22×22px |
| `GET /api/habits/<id>` 契约外兜底 | 新发现（小） | 契约里没有「读单条」，但契约外地址不报 404 而是兜底返回整个列表。不影响现有功能，记进待办：要么补进契约，要么让它按 405 回答 |
| 余力加练（导出按钮 / 完成率统计 / 部署日志提醒） | 未做 | 按今天清单「不能影响最终验收」，全部让位给验收本身 |

---

## 6. 改动归属（收尾清单）

见提交说明。全部改动属于 Day 28：验收文档 + 证据目录 + 复盘 + README 状态行。
**没有动任何产品代码**（今天不做影响最终验收的新功能）。
