# Day 25 交付：发布前检查技能 `preflight-check`

> 今天要掌握的一句话：**我故意弄坏哪一项，来验证这个 Skill 不会虚报通过？**
> 答：**A2「被跟踪的文件里没有硬编码密钥」** —— 我把 `.env` 里 `PG_API_KEY` 的值写进一个
> 已经 `git add` 的文件，看它抓不抓得到。**抓到了。**

仓库：`C:\Users\LM\WorkBuddy\2026-09-17-21-37-40\my-website`

---

## 一、今天的板块顺序（对着任务清单走）

| 板块 | 做了什么 | 结果 |
| --- | --- | --- |
| ① 规划检查项 | 定下 7 条、分三块（A 密钥 / B 公网 / C 配置），每条写清「怎么算过」 | 见第二节 |
| ② 制作检查 Skill | 产出 `skills/preflight-check/`：`SKILL.md` + `run-preflight.js` + `usage-log.md` | 见第三节 |
| ③ 实跑验证 | 基线 1 遍 → **故意种问题** 1 遍 → 撤销后复跑 1 遍 | 见第四、五节 |

**今日不做**（按清单）：把检查 Skill 做成自动化流水线 —— 今天只做「一个能手动跑的技能包」。

---

## 二、检查清单（7 条，三块）

设计原则：**只审「发布这件事」**，不审功能对不对。边界收窄是有意的 —— 什么都管的技能等于什么都没管。

| 编号 | 板块 | 检查什么 | 怎么算过 |
| --- | --- | --- | --- |
| **A1** | 密钥 | 敏感文件没被 Git 跟踪 | `git ls-files` 里不出现 `.env` / `*.key` / `*.pem` / `*.p12` / `*.pfx` |
| **A2** | 密钥 | 被跟踪的文件里没有硬编码密钥 | 每个被跟踪的文本文件里，不出现 `.env` 中任何一个非空敏感值；也不出现 `service_role` JWT / 私钥头 / 疑似 JWT |
| **B1** | 公网 | 公网首页能打开 | 静态站 `…tcloudbaseapp.com/` 返回 **200** |
| **B2** | 公网 | 公网接口可达且是这份环境 | `/api-health` 返回 200，`service=habit-board-api`、`envId` 与 `.env` 一致 |
| **B3** | 公网 | **公网那份是最新** | 公网 `index.html / app.js / cloud.js / style.css / theme.css / dashboard.*` 与**本地源码**逐个比字节数 |
| **C1** | 配置 | `.gitignore` 挡住了该挡的 | `git check-ignore` 对 `.env` 与 `dist/` 都返回「被忽略」 |
| **C2** | 配置 | 路由契约与部署配置对得上 | `api-contract.md` 路由表里的每条 `/api…` 都能在 `cloudbaserc.json` 的 `gateway.routes` 找到，反过来也成立 |

**为什么是这 7 条**：前面二十几天出的岔子，全是「本地说好了、线上不是」这一类 ——
密钥可能混进提交、打包漏了新的、公网还挂着旧那份。
这些毛病**自己在编辑器里看永远看不出来**，只有拿工具去问「线上到底是哪一版」才会现形。

> **B3 的定位**：它是「**发之前跑大概率会红、发之后跑应该绿**」的那一条。
> 它红了的意思是「本地已经比线上新，该重新打包上传了」，不是脚本坏了。

---

## 三、技能包长什么样

```
skills/preflight-check/
├── SKILL.md          检查规则：边界 / 何时用 / 清单 / 怎么跑 / 判定硬规矩 / 抓过的战绩
├── run-preflight.js  可执行检查脚本（零依赖，只用 Node 内置模块，不开浏览器）
├── usage-log.md      调用记录（三次跑的对照表 + 教训）
└── last-run.json     最近一次结果（脚本自动写出，供留档）
```

- **跑法**：项目目录下 `node skills/preflight-check/run-preflight.js`
- **退出码**：0 = 全过；1 = 有 FAIL；2 = 脚本自身出错
- 沿用 Day 12 `filter-check` 同一套包结构（`SKILL.md` + 可跑脚本 + 调用记录 + `last-run.json`），
  不再新造一套规矩。

---

## 四、实跑结果：三遍对照

| 遍次 | 状态 | PASS / FAIL | 关键那一行 |
| --- | --- | --- | --- |
| ① 基线 | 仓库原样 | **6 / 1** | `[FAIL] B3 … app.js: 本地 29596 字节 ≠ 公网 23410 字节` |
| ② 种问题 | 把 `.env` 的 `PG_API_KEY` 值写进一个已 `git add` 的文件 | **5 / 2** | `[FAIL] A2 … tmp-leak-demo.js ← 含 .env 里 PG_API_KEY 的值` |
| ③ 撤销后 | 删文件 + 取消暂存，复跑 | **6 / 1** | A2 回到 `[PASS]` |

**为什么第二遍这么关键**：一个只会说「全过」的检查等于没做。
所以特意构造了一个**它必须抓到的**问题，看它到底是真查还是走过场。
抓到了，而且撤销后立刻回到干净 —— 说明它是**真在读文件的字节**，不是靠某种「一直报红」蒙对的。

原始输出（脚本 stdout 原样留档，未改一字）：
- `acceptance/day25-evidence/01-baseline.txt`
- `acceptance/day25-evidence/02-planted.txt` ← **交作业的那张图就是这一份**
- `acceptance/day25-evidence/03-after-revert.txt`

**截图**：`acceptance/day25-evidence/day25-preflight.png`
（源页 `preflight-report.html`，用 Edge 无头模式渲染成图；图里 A2 那条被标红，就是故意种的。）

---

## 五、故意种的问题：怎么种的、怎么被查出来的

**种法**：写一个临时的 `tmp-leak-demo.js`，内容是

```js
const config = { pgApiKey: "<.env 里 PG_API_KEY 的真值>", };
module.exports = config;
```

再 `git add` 它 —— 模拟「手滑把服务端密钥写进了要提交的文件」。
**密钥值由脚本运行时从 `.env` 读出来，不写死在命令行里**，减少它到处露面的机会。

**它怎么被查出来**：A2 不是「猜哪些文件可疑」，而是**把 `.env` 里的真值拿去跟每个被跟踪的文件比对**。
那个值一旦在任何要提交的文件里露过面，就报出「哪个文件 ← 含 .env 里哪个键的值」。
报出来的原文：

```
[FAIL] A2  被跟踪的文件里没有硬编码密钥  —  tmp-leak-demo.js ← 含 .env 里 PG_API_KEY 的值；
                                                 tmp-leak-demo.js ← 含疑似 JWT（eyJhbGciOiJS…）
```

**收尾**：验完立刻删掉文件、`git rm --cached`，**这个文件从头到尾没有进过任何一次提交**
（撤销后 `git status` 只剩两个新增目录，A2 复跑回到 PASS）。

---

## 六、顺带查出来的真问题（不是今天弄坏的）

**B3 报出：公网那份还是旧版。**

| 文件 | 本地源码 | 公网 | 差在哪 |
| --- | --- | --- | --- |
| `app.js` | 29596 字节 | **23410 字节** | 公网 = Day 24 之前的旧 `dist/` |
| `cloud.js` | 9929 字节 | **6251 字节** | 公网那份**完全没有** Day 24 新增的 `sendJson` / `createHabit` 等 |

**成因**：Day 24 修完 `app.js` / `cloud.js` 之后，`dist/` 没重跑 `scripts/stage-static.js`、
公网没重新上传 —— 这一条 **Day 24 当时就如实记进了待办**（「`dist/` 还是旧的 —— 修复要上公网得重跑 `stage-static.js` + 上传」）。
今天 B3 把它如实指了出来，**说明这个检查不是摆设**。

> ⚠️ **今天没有顺手把它发上去**（不在今日范围、且发布要碰凭据）。它仍是一条**待办**：
> 重跑 `scripts/stage-static.js` → 上传 → 再跑一次 `preflight-check`，B3 应变绿。

---

## 七、交付清单

| 文件 | 是什么 |
| --- | --- |
| `skills/preflight-check/SKILL.md` | 检查规则（边界 / 清单 / 跑法 / 硬规矩 / 战绩） |
| `skills/preflight-check/run-preflight.js` | 可执行检查脚本（7 条断言，零依赖） |
| `skills/preflight-check/usage-log.md` | 调用记录（三遍对照 + 教训） |
| `skills/preflight-check/last-run.json` | 最近一次结果留档 |
| `acceptance/day25-preflight-skill.md` | 本文件（四步证据报告） |
| `acceptance/day25-evidence/01..03-*.txt` | 三遍运行的**原样 stdout** |
| `acceptance/day25-evidence/preflight-report.html` | 结果报告页（截图源） |
| `acceptance/day25-evidence/day25-preflight.png` | **交作业截图**（A2 那条红的就是故意种的） |
| `README.md` | 余力加练：把本技能的用法写进项目说明 |

---

## 八、今天特意没做的（记下来）

1. **没做成自动化流水线** —— 清单里划掉的。现在是一个手动跑的技能包。
2. **没把公网那份更新掉** —— B3 指出的旧版仍在线上，属独立的一条待办（要碰发布凭据）。
3. **没把检查接进提交钩子** —— 那是「流水线」的范畴，留到需要时再说。
4. **B 板块三项需要联网** —— 断网时 B1–B3 会如实报「取不到」而红，不会假装过。
