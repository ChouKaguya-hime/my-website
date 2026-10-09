# api-contract.md｜接口契约

> **项目**：`my-website`（习惯规划板）
> **版本**：v1.3 ｜ **日期**：2026-10-09（Day 22）｜ **作者**：斌（与 AI 协作）
> **上游文档**：`PRD.md`（做什么）、`TECH_DESIGN.md`（怎么实现）
> **本文回答一个问题**：**前端和后端之间，一个请求长什么样、一个回应长什么样。**
> 两边都照这一份写，就不会出现「前端以为字段叫 A、后端返回的是 B」。

---

## 0. 先说清楚「契约」是什么

一个接口是两边的事：一边发请求，一边给回应。**契约就是把这件事写死**——

| 契约里写死的 | 不写会怎样 |
| --- | --- |
| 地址和方法（往哪发、用什么动作发） | 前端发到 `/health`，后端挂在 `/api/health`，404 |
| 请求要带什么 | 前端没带参数，后端以为参数必填，报错 |
| 回应的字段名和类型 | 前端读 `data.envId`，后端返回的是 `data.envid`，读出 `undefined` |
| 出错时回什么 | 前端把「出错了」当成「没有数据」，页面显示成空列表 |
| 字段的含义和时间格式 | 「本周强度 0%」和「本周强度 没算」分不清（Day 14 真人测试真踩过这个） |

**一句话**：契约不是给机器看的，是给「以后改代码的人」看的——**包括三天后的自己**。

---

## 1. 当前实现的范围（Day 22 更新）

**已经上了公网的接口，一共六个动作（挂在四个函数上）**：

| 接口 | 什么时候上的 | 干什么 |
| --- | --- | --- |
| `GET /api/health` | Day 15 | 报服务自己的状态（部署后探活用） |
| `GET /api/habits` | Day 17 | 读习惯列表，含每个习惯的打卡日期 |
| `GET /api/todos` | Day 17 | 读待办列表 |
| **`POST /api/habits`** | **Day 18** | **新建一个习惯（写进数据库）** |
| **`PATCH /api/habits/<id>`** | **Day 22** | **改一条习惯（只改传进来的字段）** |
| **`DELETE /api/habits/<id>`** | **Day 22** | **删一条习惯（默认软删除，可找回）** |

Day 15 只做一个接口，是为了先证明第一件事：**公网能打到我的云函数**。
Day 17 要证明的是下一件事：**数据真的是从数据库里读出来的**，
而不是页面上那份浏览器本地存储 —— 而且这两样东西的形状还不一样（见第 3.1 节）。
Day 18 要证明的是第三件事：**接口能把数据写回去，而且重复提交不会写出两条**。
Day 22 要证明的是第四件事：**「增删改查」四类操作能形成一个闭环** ——
一条数据能被建出来、被改到、被删掉，而删掉之后「读」这一侧真的看不到了。

⚠️ 注意 `GET` / `POST /api/habits` 是**同一个地址**，靠 HTTP 方法区分动作；
而 `PATCH` / `DELETE` 是**单条资源地址** `/api/habits/<id>`（第 4.1 节的规矩：资源用复数、
一条和多条靠「地址里有没有带 ID」区分）。两段地址都挂在**同一个云函数** `api-habits` 上 ——
原因见下面这段（网关是路径前缀匹配）。

> 📌 **Day 22 实测到的一件事（部署前必须先知道）**：CloudBase 的 HTTP 访问服务是
> **路径前缀匹配 + 剥掉前缀** —— 把路由配成 `/api/habits` 之后，
> 请求 `/api/habits/h_seed_water` 确实会打到 `api-habits` 这个函数，
> **但云函数收到的 `event.path` 是 `/h_seed_water`，前面那段 `/api/habits` 被网关吃掉了。**
> 所以解析 id 时必须同时认两种形状（`/api/habits/<id>` 和裸的 `/<id>`）。
> 这个坑当天踩过：按「完整路径」解析 → 永远解析不出 id → PATCH/DELETE 一路回 405。

| 还没做的 | 为什么现在不做 | 什么时候 |
| --- | --- | --- |
| 习惯的**打卡/取消打卡**（勾选） | 现状是「改一条习惯」，而「今天完成没完成」改的是 `habit_records` 那张表，是另一件事 | 第 4 周之后 |
| 待办的**改与删**（`PATCH`/`DELETE /api/todos/<id>`） | 和习惯的改删是同一套做法，先把习惯这条路走通、验透 | 需要时再说 |
| 待办的**写入**（`POST /api/todos`） | 同上 | 需要时再说 |
| **批量写入 / 批量删除** | 单条还没在真环境跑稳之前，批量只会让出错时更难定位是哪一条 | 需要时再说 |
| 登录 / 鉴权 | 本期只有一个用户（`PRD.md` 第 6 节） | 未排期 |

> ⚠️ **页面上的「写」还没接**：Day 18 做的是**接口**，Day 22 做的还是**接口**，前端两个字没改。
> 所以今天在页面上新增 / 勾选 / 删除，**刷新之后仍然会被数据库那一份盖掉** ——
> 这是刻意排的顺序（先把四类操作的接口做扎实、再动前端），不是 bug。
> 页面上那个「云端数据库 / 本机数据」小标仍然有效：它说的是**读**的那一份。

---

## 2. `GET /api/health` —— 健康检查（Day 15）

### 2.1 请求

| 项 | 值 |
| --- | --- |
| 方法 | `GET` |
| 地址 | `https://<环境ID>.service.tcloudbase.com/api-health` |
| 参数 | 无 |
| 请求头 | 无要求（不需要 token、不需要 Content-Type） |
| 请求体 | 无 |

<details>
<summary>「需要 token」是什么？</summary>
有些接口要先证明「你是谁」才给数据（比如查我的待办）。这个接口不需要——它不返回任何私人数据，只报服务自己的状态。
</details>

**命令行请求示例**：

```bash
curl -s "https://<环境ID>.service.tcloudbase.com/api-health"
```

**防缓存**：探活时建议带一个一次性参数，彻底排除「拿到的是缓存的旧结果」：

```bash
curl -s "https://<环境ID>.service.tcloudbase.com/api-health?_t=1730000000000"
```

> 这个 `_t` 接口**不认识也**不会报错——今天实现里直接忽略它。它只是让浏览器/中间层「认得」这是个新地址。

### 2.2 成功：`200 OK`

返回体是一个 JSON 对象：

```json
{
  "ok": true,
  "service": "habit-board-api",
  "function": "api-health",
  "version": "v1",
  "envId": "my-env-1a2b3c",
  "region": "ap-shanghai",
  "runtime": "v18.15.0",
  "requestId": "a1b2c3d4-0000-0000-0000-000000000000",
  "checkedAt": "2026-10-03T01:14:15.703Z",
  "containerAliveSec": 0
}
```

| 字段 | 类型 | 例 | 它保证什么 | 谁在用 |
| --- | --- | --- | --- | --- |
| `ok` | boolean | `true` | 这是唯一的「成功与否」判据。**前端只认它**，不要靠猜别的字段 | 前端 |
| `service` | string | `"habit-board-api"` | 打到的真是这个项目的后端，不是别的服务的默认页 | 人核对 |
| `function` | string | `"api-health"` | 回应来自哪一个云函数（以后函数多了要靠它定位） | 人核对 / 排查 |
| `version` | string | `"v1"` | 后端契约版本。前端对不上就该知道要去看文档，而不是硬着头皮读 | 前端 / 排查 |
| `envId` | string | `"my-env-1a2b3c"` | **部署在哪一个环境**。和我在控制台看到的一不一样，就说明打错了环境 | 人核对 |
| `region` | string | `"ap-shanghai"` | 服务器在哪个地域（以后排查「某个地域不通」用） | 排查 |
| `runtime` | string | `"v18.15.0"` | 函数跑在哪个 Node 版本上 | 排查 |
| `requestId` | string | `"a1b2c3d4-…"` | **这一次请求的编号**。出了问题拿它去后台捞日志 | 排查 |
| `checkedAt` | string | `"2026-10-03T01:14:15.703Z"` | 服务器**这一刻**的时间。是个刚生成的时间，就说明不是缓存 | 人核对 |
| `containerAliveSec` | number | `0` | 这个容器已经活了多久（秒）。`0` 附近 = 刚冷启动 | 排查 |

**三条写死在契约里的规矩**：

1. `ok` 是**唯一**的成功判据。以后加业务接口也照这条：不看 HTTP 状态码猜，看 `ok`。
2. 时间一律用 **ISO 8601 的 UTC 格式**，末尾带 `Z`（例：`2026-10-03T01:14:15.703Z`）。**不用** `2026-10-03 09:14:15` 这种本地时间字符串——服务器在哪个时区、你电脑在哪个时区，两边不一致就会算错。
3. 字段名一律 **小驼峰**（`envId`，不是 `env_id` / `EnvId` / `envid`）。

### 2.3 方法用错：`405 Method Not Allowed`

用 `POST` 打这个地址时：

```json
{
  "ok": false,
  "service": "habit-board-api",
  "function": "api-health",
  "version": "v1",
  "error": "method_not_allowed",
  "message": "这个接口只接受 GET"
}
```

**为什么值得单独写出来**：出错时如果什么都不回、或者回一段 HTML 报错页，前端只能瞎猜。**出错也要有结构，字段名和成功时保持一致**（`ok` / `service` / `version` 都在），前端一套代码就能读两种情况。

### 2.4 响应头

| 响应头 | 值 | 为什么 |
| --- | --- | --- |
| `content-type` | `application/json; charset=utf-8` | 明确告诉浏览器「这是 JSON」，让它按 JSON 显示而不是下载文件；`charset=utf-8` 保证中文不乱码 |
| `cache-control` | `no-store` | **健康检查绝不能缓存**。否则「真打不通」和「其实是缓存的旧结果」分不清 |

**Day 15 当时不发 `access-control-allow-origin`** —— 那时前端还不调接口。
Day 17 起两个读接口**会发**（页面要 fetch 它们），见第 3.7 节；
健康检查到今天仍然没发（它只给人用地址栏打开，不需要跨域）。

### 2.5 第一次打开公网地址时，先确认哪一件事？

> **不是「它通不通」，是「它返回的是不是我刚部署的那一份」。**

理由：这个地址上「通」有太多种可能——平台的默认页、上一个版本、别人的环境、CDN 缓存。**先确认身份，再谈功能**；身份不对，后面所有排查都是白费的。

**四个动作，从强到弱**：

| # | 看什么 | 什么样算对 | 什么样说明有问题 |
| --- | --- | --- | --- |
| 1 | `envId` | 等于我在控制台看到的环境 ID | 打错环境了 / 环境 ID 记错了 |
| 2 | `checkedAt` | 是**刚刚**的时间（差几秒内） | 拿到的是缓存，或者打到了一个不动的静态文件 |
| 3 | `service` + `function` | `habit-board-api` / `api-health` | 打开的是平台默认页或别的服务 |
| 4 | `version` | `v1`，和本文档标题下写的版本一致 | 部署的是旧代码/别的分支 |

**为什么这四条要塞进返回体，而不是靠我自己记得**：靠记的核对不了。写进返回体，它就变成**每次都能复核的事实**——三天后、换台电脑、别人接手，都能核。

---

## 3. 业务接口（Day 17 上「读」，Day 18 上「写」）

> **这一章为什么把两天的接口放在一起**：Day 15 的 §2 是「服务自己的状态」，从 §3 开始都是**业务接口**。
> 业务接口按「同一个地址、不同方法」组织（§4.1 节），读和写本来就该并排看 ——
> 所以 Day 18 没有另开一章、也没有把原来的节号往后挪（挪号会让代码注释里的
> 「第 4.2 节」「第 3.6 节」全部失效，代价比收益大）。**Day 18 的内容从 §3.8 开始。**

### 3.1 先说 Day 17 清单上那个问题：**接口要的数据，和建的表哪里对不上？**

**答：有两处对不上。而且都不是靠「看」发现的，是写接口时被数据逼出来的。**

#### 一、形状对不上：库里是「一行一次」，接口要的是「一个数组」

| | |
| --- | --- |
| **建的表** | `habit_records` 表：**完成一次打卡 = 一行**（一行里是 `habit_id` + `done_date`） |
| **接口要的** | `PRD.md` 6.1 里 `habit.doneDates` 是**一个数组**：`["2026-10-04", "2026-10-03", ...]` |

关系型数据库**一个格子只能放一个值**，所以库里必须拆成多行；
可前端从 Day 8 起用的就是那个数组。**接口层的活就是把它聚合回去**——一行行读出来，合成一个数组。

#### 二、命名对不上：库里 `snake_case`，契约要 `camelCase`

| 表里的列名 | 接口要返回的字段名 | 出处 |
| --- | --- | --- |
| `freq_type` | `freqType` | 本文档第 4.2 节「字段命名：小驼峰」 |
| `freq_count` | `freqCount` | 同上 |
| `created_at` | `createdAt` | 同上 |
| `todo_date` | `date` | 同上（`app.js` / `dashboard.js` 一直用 `date`） |
| `done_date` | 聚进 `doneDates` 数组 | 同上 |

> ⚠️ 注意这条是**双向**的：数据库用下划线是 SQL 的惯例，JSON 用小驼峰是本项目的契约。
> 两边都没错，所以**这个翻译必须有人做**——今天它做在云函数里。

#### 怎么发现的（三条比对，第三条最硬）

1. 把 `db/schema.sql` 的列名，跟本文档第 4.2 节「字段命名：小驼峰」逐条对 → 命名对不上
2. 把 `PRD.md` 6.1 的字段表（`doneDates: []`）跟表的列逐条对 → 形状对不上
3. **直接问库要一行，看它到底回什么**（Day 16 建表那天记下的 `snake_case` 说法，在 Day 17 动手时被验证）：

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://<环境ID>.api.tcloudbasegateway.com/v1/rdb/rest/habits?select=*&limit=1" \
  -H "Authorization: Bearer <服务端密钥>"
# → 200
# [{"id":"h_seed_water","name":"每天喝 8 杯水","freq_type":"daily",
#   "freq_count":7,"created_at":"2026-08-25"}]
```

一眼就看出来：`freq_type` 前端不认，`doneDates` **压根没有**。

> **这就是契约值得单独写一份的理由**：两边对不上是常态，对上了才是刻意做的。
> 如果前后端各凭记忆写，这种错要到页面上显示 `undefined` 才暴露 —— 那时代码已经写了一大堆。

---

### 3.2 `GET /api/habits` —— 读习惯列表

#### 请求

| 项 | 值 |
| --- | --- |
| 方法 | `GET` |
| 地址 | `https://<环境ID>-1499798330.ap-shanghai.app.tcloudbase.com/api/habits` |
| 参数 | `limit`（可选，1–200，最多返回几个习惯；不传 = 全部） |
| 请求头 | 无要求（不需要 token） |
| 请求体 | 无 |

#### 成功：`200 OK`

```json
{
  "ok": true,
  "service": "habit-board-api",
  "function": "api-habits",
  "version": "v1.1",
  "envId": "habit-board-d0gum6nqu512acc29",
  "count": 6,
  "generatedAt": "2026-10-04T15:22:37.171Z",
  "data": [
    {
      "id": "h_seed_water",
      "name": "每天喝 8 杯水",
      "freqType": "daily",
      "freqCount": 7,
      "createdAt": "2026-08-25",
      "doneDates": ["2026-10-04", "2026-10-03", "2026-10-02", "2026-10-01", "2026-09-30", "2026-09-28"]
    }
  ]
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `ok` | boolean | **唯一的成功判据**（第 4.3 节），前端只认它 |
| `function` | string | `api-habits` —— 以后函数多了靠它定位 |
| `version` | string | 后端契约版本 |
| `envId` | string | 数据来自哪个环境（打错环境一眼能看出来） |
| `count` | number | `data` 里有几条（省得前端自己数） |
| `generatedAt` | string | 服务器**这一刻**的时间，ISO 8601 UTC 带 `Z`。是刚生成的 = 不是缓存 |
| `data` | array | 习惯列表 |
| `data[].id` | string | 习惯唯一标识（`h_seed_water` / `h_xxxxx`） |
| `data[].name` | string | 习惯名称 |
| `data[].freqType` | string | `daily`（每天）/ `weekly`（每周 N 次） |
| `data[].freqCount` | number | 每周目标次数；`daily` 时固定 7 |
| `data[].createdAt` | string | 创建日期，`YYYY-MM-DD`（只有年月日，**不带时分秒**） |
| `data[].doneDates` | string[] | **已完成日期的数组**，倒序（最近的在前面）。★ 库里是 `habit_records` 的多行，这里是聚合后的结果 ★ |

---

### 3.3 `GET /api/todos` —— 读待办列表

#### 请求

| 项 | 值 |
| --- | --- |
| 方法 | `GET` |
| 地址 | `https://<环境ID>-1499798330.ap-shanghai.app.tcloudbase.com/api/todos` |
| 参数 | `date`（可选，`YYYY-MM-DD`，只取这一天的）；`limit`（可选，1–200） |
| 请求头 | 无要求 |
| 请求体 | 无 |

> 不传 `date` = 返回**全部**待办（默认按日期倒序），前端自己在本地筛「今天」。
> 传了 `date` 就只回那一天的，回显在 `date` 字段里（没筛时是 `null`）——
> 这样前端一眼能确认「服务器是按我说的筛的」，而不是猜。

#### 成功：`200 OK`

```json
{
  "ok": true,
  "function": "api-todos",
  "version": "v1.1",
  "count": 6,
  "date": null,
  "generatedAt": "2026-10-04T15:22:37.171Z",
  "data": [
    { "id": "t_seed_1", "text": "把 Day 16 的表结构画成一张图，讲清楚两张核心表怎么关联", "date": "2026-10-04", "done": false }
  ]
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `data[].id` | string | 待办唯一标识 |
| `data[].text` | string | 待办内容 |
| `data[].date` | string | 归属日期 `YYYY-MM-DD`（★ 库里叫 `todo_date`，这里改名为 `date` ★） |
| `data[].done` | boolean | 是否已完成。**真布尔**，不是 `1` / `0` / `"是"` |

---

### 3.4 两个查询参数（Day 17 的「余力加练」，顺手做了）

| 参数 | 作用 | 边界怎么处理 |
| --- | --- | --- |
| `limit` | 最多返回几条 | 不是数字 = 当没传；小于 1 = 按 1；大于 200 = **夹到 200**（防着有人拿 `?limit=999999` 来打） |
| `date` | 只要某一天的待办（只 `/api/todos` 有） | 不是 `YYYY-MM-DD`、或 `2026-02-30` 这种不存在的日期 = **当没传，返回全部**，不报 500 |

**为什么边界要这么处理**：查数据的接口，参数写错就整个失败，对使用者太苛刻；
宁可「降级成不筛、返回全部」，也不要因为一个手抖的参数把页面打成空白。

### 3.5 读接口出错时会回什么

`GET /api/habits`、`GET /api/todos` 和健康检查**共用同一套形状**（第 4.3 节）：

```json
{ "ok": false, "service": "habit-board-api", "function": "api-habits",
  "version": "v1.3", "error": "method_not_allowed", "message": "这个接口只接受 GET, POST, PATCH, DELETE, OPTIONS" }
```

| 情况 | HTTP | `error` | `message`（给人看） |
| --- | --- | --- | --- |
| 用了 `PUT` 等本接口不支持的方法 | 405 | `method_not_allowed` | 这个接口只接受 GET, POST, PATCH, DELETE, OPTIONS |
| 用了 `PATCH` / `DELETE`，但**地址里没带 id** | 405 | `method_not_allowed` | 改/删一条习惯要把 id 写进地址：`PATCH|DELETE /api/habits/<id>` |
| 数据库连不上 / 没配密钥 / SQL 出错 | 500 | `server_error` | 读取习惯失败：<原因> |
| 跨域预检 `OPTIONS` | 204 | —（空 body） | — |

> ⚠️ **Day 18 起 `/api/habits` 也能 `POST` 了；Day 22 起 `PATCH` / `DELETE` 也上了** ——
> 所以上表说的「只接受 GET」变成了「只接受 GET, POST, PATCH, DELETE」。
> 写接口自己的出错情况（缺字段、重名、找不到……）更多，单独列在第 3.8 / 3.11 / 3.12 节。
>
> ⚠️ **`allow` 响应头**跟着一起变：Day 18 是 `GET, POST, OPTIONS`，
> **Day 22 起是 `GET, POST, PATCH, DELETE, OPTIONS`**（按 HTTP 的规矩告诉对方这个地址能用什么方法）。

**关键点：出错也要有结构，字段名和成功时保持一致。** 前端一套代码就能读两种情况，
不用「先判断字段存不存在」再决定怎么读。

### 3.6 后端是怎么读到数据库的（Day 17 实测结论）

CloudBase 的 PostgreSQL 有**三条路**能走，官方文档写得很清楚，但**本环境实测只有一条走得通**：

| 走法 | 谁用 | 本环境能不能用 |
| --- | --- | --- |
| 小程序 SDK / Web JS SDK | 前端直连 | 能，但**必须在库里配 RLS 策略**（权限边界靠它兜），而且要把用户身份带上 —— 本期只有一个用户，不值当 |
| **HTTP API（PostgREST）** | 应用、服务器、第三方系统 | ✅ **今天用的就是这条**。带服务端 API Key，不需要 VPC、不需要配 RLS |
| PostgreSQL 协议直连（`pg` 包） | 云函数、云托管 | ❌ **体验版走不通**：内网互联要标准版才有；公网直连开关也开不了（社区里已有同样结论） |

**今天的做法**：

- 云函数里用 **Node 18 自带的 `fetch`** 去请求
  `https://<环境ID>.api.tcloudbasegateway.com/v1/rdb/rest/<表名>` —— 所以这两个函数**零依赖**
  （`installDependency: false`，没有 `node_modules`）
- **密钥不进代码、不进 Git、不进聊天**：
  - 用 `tcb env apikey create` 建了一个**服务端 API Key**（`--type api_key`）
  - 它写在**云函数的环境变量 `PG_API_KEY`** 里（`cloudbaserc.json` 里用 `{{env.PG_API_KEY}}` 引用）
  - 本地那份在 `.env`（`.gitignore` 里，不入库）
  - **前端拿不到它**：页面只调 `/api/habits`、`/api/todos` 这两个自己的云函数
- 为什么不用「传连接串让函数直连」：先不说体验版连不通，光是把库的账号密码散到代码里就更难管。
  HTTP API 只需要一个可以随时吊销的 Key。

> **一句话记法**：云函数当「翻译官」—— 一边用 HTTP API 跟数据库说话（SQL 那套），
> 一边用契约规定的 JSON 跟前端说话（小驼峰那套）。

### 3.7 跨域（CORS）—— Day 17 起打开

| 响应头 | 值 | 为什么 |
| --- | --- | --- |
| `access-control-allow-origin` | `*` | 页面在 `xxx.tcloudbaseapp.com`，接口在 `xxx.app.tcloudbase.com`，**不同源**，不配浏览器会直接拦掉请求 |
| `access-control-allow-methods` | `GET, POST, PATCH, DELETE, OPTIONS` | Day 17 只有读；Day 18 加了 `POST`；**Day 22 又加了 `PATCH` / `DELETE`** —— 漏一个，那一类请求就会在预检那一步被浏览器拦下 |
| `access-control-max-age` | `86400` | 预检结果缓存一天，少发一次 OPTIONS |

> ⚠️ **`*` 是「本期只有一个用户、没有登录」前提下的选择**（`PRD.md` 第 6 节）。
> 哪天真要多人用了，这里必须换成白名单域名 + 鉴权 —— 现在的接口是**公开可读**的，
> **而且从 Day 18 起多了一个 `POST`：谁能猜到地址，谁就能往库里写东西。**
> 这件事记在「明确不做」里（第 5 节），不是忘了。

---

### 3.8 `POST /api/habits` —— 新建习惯（Day 18 新增）

#### 请求

| 项 | 值 |
| --- | --- |
| 方法 | `POST` |
| 地址 | `https://<环境ID>-1499798330.ap-shanghai.app.tcloudbase.com/api/habits` |
| 请求头 | `content-type: application/json; charset=utf-8` |
| 请求体 | 一个 JSON 对象，字段见下表 |

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `name` | ✅ **必填** | string | 习惯名称。前后空格会被去掉；**去掉后不能是空的**；最长 50 个字 |
| `freqType` | 可选 | string | `daily`（每天）/ `weekly`（每周 N 次）。不传 = `daily` |
| `freqCount` | 可选 | number | 每周目标次数，1–7 的整数。不传 = 7；**`freqType` 是 `daily` 时一律存 7**（和表结构、前端默认值一致） |
| `id` | 可选 | string | 习惯标识，形如 `h_abc123`。**不传就由服务端生成**（推荐不传 —— 免得两个客户端撞上同一个 id） |

> **为什么不接收 `createdAt`**：创建日期就是「服务器这边的今天」，由服务端定，客户端说了不算 ——
> 这样也不会出现「客户端时区不同、写进去的日期差一天」。

**命令行请求示例**：

```bash
curl -s -X POST "https://<环境ID>-1499798330.ap-shanghai.app.tcloudbase.com/api/habits" \
  -H 'content-type: application/json' \
  -d '{"name":"睡前不看手机"}'
```

#### 成功：`201 Created`

```json
{
  "ok": true,
  "service": "habit-board-api",
  "function": "api-habits",
  "version": "v1.3",
  "envId": "habit-board-d0gum6nqu512acc29",
  "generatedAt": "2026-10-05T01:42:20.492Z",
  "data": {
    "id": "h_muul4ci8mcwly",
    "name": "睡前不看手机",
    "freqType": "daily",
    "freqCount": 7,
    "createdAt": "2026-10-05",
    "doneDates": []
  }
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `ok` | boolean | **唯一的成功判据**（第 4.3 节），前端只认它 |
| `generatedAt` | string | 服务器**这一刻**的时间，ISO 8601 UTC 带 `Z` |
| `data` | object | **新建好的那一条习惯**，★ 形状和 `GET /api/habits` 列表里的元素**完全一样** ★ |
| `data.id` | string | 服务端生成的（或客户端传的那个）。前端后续勾选 / 编辑都用它 |
| `data.doneDates` | string[] | 刚建出来的习惯**一定是空数组** —— 「空数组」不是「字段没有」，第 4.2 节：字段永远在，值是 `null` / `[]` 表示「还没有」 |

**为什么状态码是 `201` 而不是 `200`**：`201 Created` 是 HTTP 给「新建成功」的标准答案
（`200` 只说「成功了」，不一定是新建了东西）。前端两种都当成功，但日志和排障时一眼能分辨。
**判成功仍然只看 `ok`**，不靠状态码猜。

#### 出错时会回什么

| 情况 | HTTP | `error` | `message`（给人看，一律中文） |
| --- | --- | --- | --- |
| **缺 `name`** | 400 | `bad_request` | 缺少必填字段 name（习惯名称） |
| `name` 是空字符串 / 全是空格 | 400 | `bad_request` | 习惯名称不能是空的 |
| `name` 不是字符串 | 400 | `bad_request` | name 要是字符串（习惯名称），现在收到的是 number |
| `name` 超过 50 个字 | 400 | `bad_request` | 习惯名称太长了（最多 50 个字，现在 51 个） |
| `freqType` 不是 `daily` / `weekly` | 400 | `bad_request` | freqType 只能是 daily（每天）或 weekly（每周 N 次），现在收到的是「monthly」 |
| `freqCount` 不在 1–7 | 400 | `bad_request` | freqCount 只能是 1 到 7 的整数，现在收到的是「99」 |
| `id` 格式不对 | 400 | `bad_request` | id 格式不对：要以 h_ 开头，后面只放字母、数字、下划线或连字符… |
| 请求体是空的 | 400 | `bad_request` | 请求体是空的：需要一段 JSON，例如 {"name":"每天喝 8 杯水"} |
| 请求体不是合法 JSON | 400 | `bad_request` | 请求体不是合法的 JSON（大概率是引号或逗号写错了） |
| **这个名字已经有了** | **409** | **`conflict`** | 已经有一个叫「睡前不看手机」的习惯了，不用再加一遍 |
| `id` 已经被占用 | 409 | `conflict` | 这个 id 已经被占用了（「h_…」），换一个再试 |
| 数据库连不上 / 写入出错 | 500 | `server_error` | 写入习惯失败：<原因> |
| 用了 `PUT` 等不支持的方法 | 405 | `method_not_allowed` | 这个接口只接受 GET, POST, PATCH, DELETE, OPTIONS |

**为什么「重名」用 `409` 而不是 `400`**：
`400` 是「你这次请求本身写错了」（少字段、格式不对）—— 改对了就能过；
`409 Conflict` 是「你的请求没毛病，但**和库里已有的东西冲突了**」。
前端要区别对待：`400` 应该把用户拉回去改输入框，`409` 应该告诉他「这条已经有了，不用再加」。
（`conflict` 是 Day 18 新加的错误码，见第 4.4 节。）

另外，**405 会带一个 `allow: GET, POST, PATCH, DELETE, OPTIONS` 响应头** —— 按 HTTP 的规矩告诉对方
「这个地址能用什么方法」，省得靠猜。

---

### 3.9 防重复提交：两层，一层都不能少（Day 18）

#### 要防的是什么

**同一个习惯被提交两次。** 这不是假想的问题，两条路都会走到：

- **双击保存** —— 用户点得快，浏览器发出两个一模一样的请求
- **网络重试** —— 第一个请求其实到了，只是响应在回来的路上丢了，客户端自动重发

#### 两层怎么分工

| 层 | 在哪 | 干什么 | 单独用会怎样 |
| --- | --- | --- | --- |
| **第一层** | 云函数 `api-habits` 里，插之前先查一眼重名 | 把结果翻成人话：`409` +「已经有一个叫「X」的习惯了」 | **并发下会漏**：两个请求同时到达时，它们**都会**看到「这名字还没人用过」，然后各插一条 |
| **第二层** | 数据库上的唯一索引 `ux_habits_name` | 让重复**真的插不进去**（第二条报 `SQLSTATE 23505`） | 挡得住，但前端只会收到一句数据库报错，看不懂 |

**所以两层都要**：第一层负责「话说得好听」，第二层负责「事真的防住」。
只有第一层 → 并发漏网；只有第二层 → 用户看不懂。

> **今天最值得带走的一课**：应用层里「先查一遍再写」**永远**防不住并发 ——
> 查询和写入之间有条缝，两个请求都能从缝里挤过去。
> **唯一能真的防住的是数据库自己**（唯一索引 / 唯一约束），因为它是原子的。
> 应用层那一眼查重，价值在**提示友好**，不在**安全**。

#### 怎么测的（三条，都能照着重跑）

```bash
ENV=habit-board-d0gum6nqu512acc29
B="https://$ENV-1499798330.ap-shanghai.app.tcloudbase.com"

# 1) 顺序重复提交：把已有习惯的名字再 POST 一次 → 409（第一层拦下）
curl -s -X POST "$B/api/habits" -H 'content-type: application/json' -d '{"name":"每天走 6000 步"}'

# 2) 并发重复提交：两个同时发出的、一模一样的请求 → 实测一个 201、一个 409（第二层兜住）
curl -s -X POST "$B/api/habits" -H 'content-type: application/json' -d '{"name":"并发测试-勿留"}' -o A.json -w "%{http_code}\n" &
curl -s -X POST "$B/api/habits" -H 'content-type: application/json' -d '{"name":"并发测试-勿留"}' -o B.json -w "%{http_code}\n" &
wait

# 3) 绕过云函数，直接往库里插一条重名的 → 唯一索引自己就拦得住
#    （这条最硬：证明第二层不依赖第一层，也不是靠云函数那一眼查重）
tcb db execute -e $ENV --sql "INSERT INTO habits (id, name) VALUES ('h_dup_probe', '每天喝 8 杯水')"
# → ERROR: duplicate key value violates unique constraint "ux_habits_name" (SQLSTATE 23505)

# 清掉测试造出来的数据
tcb db execute -e $ENV --sql "DELETE FROM habits WHERE name = '并发测试-勿留'"
```

**服务端日志会把「被哪一层拦下的」也记下来**（`layer: precheck` / `layer: db_unique`），
所以并发那次到底是谁兜住的，事后查得到（见 §3.10）。

---

### 3.10 服务端日志（Day 18 的余力加练）

每个请求**只打一行** JSON，够用就好：

```json
{"at":"2026-10-05T01:37:22.637Z","service":"habit-board-api","function":"api-habits",
 "version":"v1.3","requestId":"local-B1","method":"POST","status":201,"ms":181,
 "outcome":"created","id":"h_muukxyqhvf7a6","name":"Day18 自检-勿留"}
```

| 字段 | 作用 |
| --- | --- |
| `at` | 服务端时间（ISO 8601 UTC） |
| `requestId` | 这一次请求的编号 —— **排障的抓手**：用户说「我提交失败了」，拿它去日志里搜就完了 |
| `method` / `status` / `ms` | 什么方法、回了什么状态码、花了多久 |
| `outcome` | 这次到底发生了什么：`read_ok` / `created` / `duplicate` / `bad_request` / `method_not_allowed` / `write_failed`（Day 18）；**Day 22 新增** `updated` / `deleted_soft` / `deleted_hard` / `restored` / `not_found` / `already_deleted` / `update_failed` / `delete_failed` |
| `layer` | 只在 `duplicate` 时出现：`precheck`（第一层拦的）/ `db_unique`（第二层兜的） |

**两条自律**：① 一行就够，不刷屏；② **日志绝不能影响接口** —— 打日志整段包在 `try/catch` 里，
出任何问题都吞掉。

> ⚠️ **待确认**：用 `tcb fn log api-habits -e <环境ID>` 去云端捞，报
> `[SearchClsLog] topic not exist`（体验版没开日志主题）。日志**内容本身**在本地自检里验过
> （47 条断言里的 H 组），但**云端到底能不能查到、控制台日志页有没有**，今天没验过 —— 不当结论用。

---

### 3.11 `PATCH /api/habits/<id>` —— 改一条习惯（Day 22 新增）

#### 请求

| 项 | 值 |
| --- | --- |
| 方法 | `PATCH` |
| 地址 | `https://<环境ID>-1499798330.ap-shanghai.app.tcloudbase.com/api/habits/<id>` |
| 请求头 | `content-type: application/json; charset=utf-8` |
| 请求体 | 一个 JSON 对象，**只放要改的字段**（见下表） |

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `name` | 可选 | string | 新的习惯名称。前后空格去掉、不能为空、最长 50 字 |
| `freqType` | 可选 | string | `daily` / `weekly` |
| `freqCount` | 可选 | number | 1–7 的整数；**`freqType` 是 `daily` 时一律存 7** |

**三条硬规矩**：

1. **至少带一个字段** —— 一个都没带（或只带了 `id` / `createdAt`）→ `400`。
   因为那样这个请求什么都没干，却回一个「成功」，是最误导人的回答。
2. **`id` / `createdAt` 改不了** —— 它们不在白名单里，传了也被忽略。
   `id` 是这条记录的身份（改了等于换了一条）；`createdAt` 是「服务器那边的今天」，客户端说了不算。
3. **地址里必须带 id** —— 只写 `/api/habits` 的 `PATCH` → `405`。**绝不去猜「他想改哪一条」。**

```bash
curl -s -X PATCH "$B/api/habits/h_seed_water" \
  -H 'content-type: application/json' \
  -d '{"name":"每天喝够 8 杯水"}'
```

#### 成功：`200 OK`

`data` 是**改完的那一条**，形状和 `GET /api/habits` 列表里的元素**完全一样**（含 `doneDates`）：

```json
{
  "ok": true, "service": "habit-board-api", "function": "api-habits", "version": "v1.3",
  "envId": "habit-board-d0gum6nqu512acc29",
  "generatedAt": "2026-10-09T02:19:40.375Z",
  "data": { "id": "h_seed_water", "name": "每天喝够 8 杯水", "freqType": "daily",
            "freqCount": 7, "createdAt": "2026-08-25", "doneDates": ["2026-10-04", "2026-10-03"] }
}
```

#### 出错时会回什么

| 情况 | HTTP | `error` | `message`（给人看） |
| --- | --- | --- | --- |
| 地址里没带 id | 405 | `method_not_allowed` | 改一条习惯要把 id 写进地址：PATCH /api/habits/<id> |
| 地址里的 id 格式不对 | 400 | `bad_request` | 地址里的 id 格式不对：要以 h_ 开头… |
| **这个 id 不存在**（或已被删） | **404** | **`not_found`** | 没有找到 id 为「h_…」的习惯 |
| 请求体是空的 / 不是合法 JSON | 400 | `bad_request` | 请求体是空的：要带一段 JSON，写明改什么… |
| 请求体是 `{}`（没字段可改） | 400 | `bad_request` | 没有要改的字段：请至少带上 name / freqType / freqCount 里的一个 |
| `name` 为空 / 超长 / 类型不对 | 400 | `bad_request` | （同 §3.8 的写法） |
| **改成的新名字已经有了** | **409** | **`conflict`** | 已经有一个叫「X」的习惯了 |
| 数据库出错 | 500 | `server_error` | 修改习惯失败：<原因> |

> **为什么改之前要「先查在不在」（而不是直接 UPDATE）**：
> 如果直接 UPDATE 一个不存在的 id，数据库会安静地影响 0 行、HTTP 还是回成功 ——
> 用户以为改生效了，其实什么也没发生。所以先 `findHabitById` 一下，不在就 **404**，
> **宁可明确失败，也不要一个假成功**。这也正是第 4.4 节里 `not_found`(404) 预留了四天、
> 今天第一次真正用上的地方。

---

### 3.12 `DELETE /api/habits/<id>` —— 删一条习惯（Day 22 新增）

#### 请求

| 项 | 值 |
| --- | --- |
| 方法 | `DELETE` |
| 地址 | `https://<环境ID>-1499798330.ap-shanghai.app.tcloudbase.com/api/habits/<id>` |
| 请求体 | **没有**（删哪一条，地址里已经写死了） |
| 查询参数 | `?hard=true` 走真删；`?restore=true` 把软删的**找回**（余力加练） |

```bash
curl -s -X DELETE "$B/api/habits/h_seed_water"              # 默认：软删除（可找回）
curl -s -X DELETE "$B/api/habits/h_seed_water?hard=true"    # 真删：从表里抹掉，找不回
curl -s -X DELETE "$B/api/habits/h_seed_water?restore=true" # 把软删的那条找回来
```

#### 成功：`200 OK`

```json
{
  "ok": true, "service": "habit-board-api", "function": "api-habits", "version": "v1.3",
  "envId": "habit-board-d0gum6nqu512acc29",
  "generatedAt": "2026-10-09T02:19:41.080Z",
  "deleted": { "mode": "soft", "recoverable": true },
  "data": { "id": "h_seed_water", "name": "每天喝够 8 杯水", "freqType": "daily",
            "freqCount": 7, "createdAt": "2026-08-25", "doneDates": ["2026-10-04", "2026-10-03"] }
}
```

| 字段 | 说明 |
| --- | --- |
| `deleted.mode` | `"soft"`（只打标记，数据还在）/ `"hard"`（真删，从表里抹掉） |
| `deleted.recoverable` | 还能不能找回。`soft` → `true`；`hard` → `false` |
| `data` | **被删掉的那一条**（快照）—— 让人一眼能核对「我删的就是这一条」 |

#### 出错时会回什么

| 情况 | HTTP | `error` | `message`（给人看） |
| --- | --- | --- | --- |
| **地址里没带 id（想删全部）** | **405** | **`method_not_allowed`** | 删一条习惯必须把 id 写进地址：DELETE /api/habits/<id>；本接口不提供「删除全部」 |
| 地址里的 id 格式不对 | 400 | `bad_request` | 地址里的 id 格式不对… |
| 这个 id 不存在 | 404 | `not_found` | 没有找到 id 为「h_…」的习惯 |
| 对**已经软删过**的再删一次 | 404 | `not_found` | id 为「h_…」的习惯已经被删除了（要找回它加 ?restore=true） |
| 对**没被删**的做 `?restore=true` | 409 | `conflict` | id 为「h_…」的习惯本来就没被删，不用恢复 |
| 数据库出错 | 500 | `server_error` | 删除习惯失败：<原因> |

---

### 3.13 ⭐ 今天要回答的那个问题：**删除为什么比新增更容易出事？你在哪加了确认？**

#### 一、为什么「删」比「增」危险

四类操作里，**只有「删」会丢数据**。把它们摆一起看就清楚了：

| 操作 | 做错了会怎样 | 能不能救 |
| --- | --- | --- |
| 增（POST） | 多出一条 | ✅ 删掉就行，代价小 |
| 查（GET） | 什么都没发生 | ✅ 本来就不改数据 |
| 改（PATCH） | 某个字段被写坏 | ⚠️ 知道旧值就能改回；不知道就麻烦了 |
| **删（DELETE）** | **数据没了**，而且**连它的打卡记录一起没** | ❌ **默认救不回** |

还有两条让「删」更容易失控的地方：

1. **影响面被外键放大**：`habit_records` 的外键是 `ON DELETE CASCADE` ——
   删**一个习惯**，它名下的**全部打卡记录**会跟着一起消失。删一行，掉一片。
2. **「写错地址」的后果不对称**：`POST /api/habits` 写错地址顶多 404；
   而 `DELETE` 一旦地址少写一段、或者服务端把「没带 id」理解成「删全部」，
   丢掉的就是整张表。

#### 二、我在三处加了「确认」（外加一层余力加练）

| # | 确认加在哪 | 具体是什么 | 挡住了什么 |
| --- | --- | --- | --- |
| **①** | **地址必须带精确的 id** | `DELETE /api/habits/<id>`；不带 id 的 `DELETE /api/habits` **一律 405** | 从设计上**取消「删全部」这个操作** —— 手一抖删全库这条路根本不存在 |
| **②** | **删之前先确认它在不在** | 先 `findHabitById`；不在 → **404**，**绝不静默成功** | 「删了个不存在的东西」却回成功 —— 那会让人误判「删掉了」 |
| **③** | **删完把删掉的那条回显** | 响应里的 `data` = 被删记录的快照（含 `name`） | 删错的时候，**当场就能从返回里看出删的是哪一条** |
| **＋** | **余力加练：默认软删除** | 默认只把 `is_deleted` 置 `true`（读时跳过），`?hard=true` 才真删；`?restore=true` 能找回 | 把「删错了」从**不可逆**变成**可逆** —— 这是对「删」最实在的一层保险 |

> **一句话记法**：**新增防的是「重复」，删除防的是「删错」。**
> 防重复靠数据库的唯一索引（§3.9）；防删错靠上面这四处「先确认、再动手、留退路」。

#### 三、软删除是怎么实现的（不真删，读时跳过）

| 环节 | 做了什么 |
| --- | --- |
| 表结构 | `habits` 加一列 `is_deleted BOOLEAN NOT NULL DEFAULT false`（`db/schema.sql`） |
| 删（默认） | `PATCH /habits?id=eq.<id>` 把 `is_deleted` 置 `true` —— **数据一个字节没少** |
| 读 | `listHabits` 永远带上 `&is_deleted=is.false` —— **被软删的记录从「读」这一层就看不见了** |
| 找回 | `?restore=true` → 把 `is_deleted` 置回 `false`，它立刻又出现在列表里 |
| 唯一索引 | 从「全表唯一」改成**部分唯一** `WHERE is_deleted = false` —— 否则「删掉『喝水』后再建一个『喝水』」会被已删的那条占着名字、建不出来 |

> ⚠️ **一个必须讲清的代价**：软删除 = 「读」永远要记得过滤 `is_deleted`。
> 现在只有 `listHabits` / `findHabitByName` 两处读，都加上了；
> **将来每新增一个读的口子（比如「读单条」「统计」），都必须记得带上这个条件** ——
> 漏一处，被删的记录就会从那处漏出来。这是软删除的固有成本，不是这次没做好。

#### 四、四类操作闭环怎么复现（都能照着重跑）

```bash
ENV=habit-board-d0gum6nqu512acc29
B="https://$ENV-1499798330.ap-shanghai.app.tcloudbase.com"

# 增：建一条 → 201
curl -s -X POST "$B/api/habits" -H 'content-type: application/json' \
  -d '{"name":"Day22 演示 · 每天冥想 10 分钟","freqType":"weekly","freqCount":2}'
ID=h_xxxxxx   # 用上一步返回的 data.id

# 查：读回列表 → 能看到它
curl -s "$B/api/habits" | grep -o "$ID"

# 改：改名字 → 200，data 是新值
curl -s -X PATCH "$B/api/habits/$ID" -H 'content-type: application/json' \
  -d '{"name":"Day22 演示 · 每天冥想 15 分钟","freqType":"daily"}'

# 删：默认软删 → 200，deleted.mode = soft
curl -s -X DELETE "$B/api/habits/$ID"
# 删完再读 → ★ 它不在返回里了 ★
curl -s "$B/api/habits" | grep -o "$ID"     # 期望：无输出

# 删错了能找回（余力加练）
curl -s -X DELETE "$B/api/habits/$ID?restore=true"
curl -s "$B/api/habits" | grep -o "$ID"     # 又出现了

# 收尾：真删干净，不留垃圾
curl -s -X DELETE "$B/api/habits/$ID?hard=true"
```

---

## 4. 全项目统一约定（Day 16–22 沿用）

这一节不是今天要实现的，是**今天先定下来、后面照着做**的。今天只实现它的最小一份（就是上面那个健康检查）。

### 4.1 地址结构

```text
https://<环境ID>.service.tcloudbase.com/<功能>[/<资源>][/<资源ID>]
```

| 例子 | 含义 | 现状 |
| --- | --- | --- |
| `/api-health` | 服务自身的状态 | ✅ Day 15（历史遗留了连字符写法，保留不动，免得把已发出去的地址弄失效） |
| `/api/habits` | 习惯列表 | ✅ Day 17 |
| `/api/todos` | 待办列表 | ✅ Day 17 |
| `/api/habits/h_1234` | 某一个习惯 | ✅ **Day 22**（`PATCH` 改它 / `DELETE` 删它） |

- **资源用复数**（`habits`，不是 `habit`）——一条和多条地址长一样，靠有没有带 ID 区分。
- **动作交给 HTTP 方法**：读用 `GET`、新增用 `POST`、改动用 `PATCH`、删除用 `DELETE`。地址里不写动词（不写 `/getHabits`）。
- ⚠️ **`/api/habits/<id>` 不用另配网关路由**：CloudBase 的 HTTP 访问服务是**路径前缀匹配**，
  配了 `/api/habits` 就把它的子路径一起收了；但**前缀会被网关剥掉**（函数收到的是 `/h_1234`，
  不是 `/api/habits/h_1234`）—— 解析 id 时两种形状都要认（见 §1 那条实测笔记）。

### 4.2 数据格式

| 项 | 约定 |
| --- | --- |
| 编码 | UTF-8 |
| 格式 | JSON（`content-type: application/json; charset=utf-8`） |
| 字段命名 | 小驼峰 `camelCase` |
| 时间 | ISO 8601 UTC，带 `Z` |
| 日期（只有年月日） | `YYYY-MM-DD`，例 `2026-10-03` |
| 布尔 | `true` / `false`，**不用** `1` / `0` / `"是"` |
| 空值 | 用 `null`，**不省略字段** —— 字段永远在，值是 `null` 表示「没有」，这样前端不用先判断字段存不存在 |

### 4.3 回应的两种形状

**成功**

```json
{ "ok": true, "data": { } }
```

**失败**

```json
{ "ok": false, "error": "错误码", "message": "给人看的一句话" }
```

- 健康检查接口是**例外**：它没有 `data`，把状态直接铺在顶层（因为它要报的本来就是服务自己的信息）。
- 业务接口（Day 17 起）一律用上面这两种形状（`/api/habits`、`/api/todos` 已经照这个写的）。
- `data` 的形状**看接口**：读列表时是**数组**（`[{…},{…}]`），新建成功时是**一个对象**（`{…}`）——
  因为新建本来就只产生一条。第 3.8 节那个 `data` 就是「新建好的那一条」。
- `error` 是给程序判断的（固定的英文短语），`message` 是给人看的（可以中文）。

### 4.4 错误码

| 错误码 | HTTP 状态码 | 含义 | 什么时候实现 |
| --- | --- | --- | --- |
| `method_not_allowed` | 405 | 方法用错了 | ✅ Day 15（Day 17 / 18 的接口照用，Day 18 起带 `allow` 头） |
| `server_error` | 500 | 服务自己出错了（连不上库、SQL 出错等） | ✅ Day 17 |
| `bad_request` | 400 | 请求内容不合法（缺字段、格式错、不是合法 JSON） | ✅ **Day 18**（写接口第一次真正用上） |
| `conflict` | **409** | 请求没毛病，但**和库里已有的数据冲突了**（重名、id 被占） | ✅ **Day 18（新增）** |
| `not_found` | 404 | 要的资源不存在（改了/删了一个不存在的 id） | ✅ **Day 22**（做单条资源时第一次用上） |

> **`400` 和 `409` 为什么要分开**：`400` 是「你这次请求写错了」→ 前端该让用户改输入；
> `409` 是「你写得没错，但这条已经有了」→ 前端该告诉用户「不用再加」，别让他白改一遍。
> 混成一个码，前端就没法区别对待。
>
> ⚠️ 另外注意 `bad_request` 为什么**读接口到今天都没用**：两个读接口的参数（`limit` / `date`）写错了
> 只是「当没传」降级处理，不报 400。查数据的接口，参数写错就整个失败，对使用者太苛刻了（见第 3.4 节）。
> **写接口不一样** —— 写进去的东西要长期躺在库里，宁可当场拒掉，也不能猜着写。

### 4.5 版本

后端版本放在返回体的 `version` 字段里（Day 15 是 `"v1"`，Day 17 起是 `"v1.1"`，Day 18 起 `"v1.2"`，
**Day 22 起 `"v1.3"`**），**不放在地址里**（不写 `/v1/habits`）。

**这个字段到底是谁的版本**：**是「这个接口遵循的契约版本」**，不是整个后端的版本。
所以它可能几个接口不一样 —— **今天就是这样**：

| 接口 | 报的版本 | 为什么 |
| --- | --- | --- |
| `api-habits`（读 + 写 + 改 + 删） | **`v1.3`** | 今天给它加了 `PATCH` / `DELETE`，请求/响应都变了 |
| `api-todos`（只读） | `v1.1` | **本次一个字没改**，没理由动它，也就**没有重新部署** |
| `api-health` | `v1` | 同上，Day 15 之后没动过 |

> 这样反而多一个好处：**光看 `version` 就知道这个接口最后一次变动是什么时候**。
> 「不擅自扩大改动范围」——没改的东西就不重新部署，`version` 也不会假装自己变了。

**为什么版本不放进地址**：地址加版本号意味着以后升级要动所有前端地址；放字段里，
前端读到对不上的版本时可以选择提示，而不是直接崩。本期只有一个前端、规模很小，`version` 字段够用了。

---

## 5. 明确不做（不是漏了，是排在后面）

| 不做的事 | 为什么不做 | 什么时候 |
| --- | --- | --- |
| 习惯的**打卡 / 取消打卡**（勾选） | 改的是 `habit_records` 那张表，不是「改一条习惯」；两件事，分开做 | 第 4 周之后 |
| 待办的**改与删**（`PATCH`/`DELETE /api/todos/<id>`） | 和习惯的改删是同一套做法，先把习惯这条路走通、验透 | 需要时再说 |
| 待办的**写入**（`POST /api/todos`） | 同上 | 需要时再说 |
| **批量写入 / 批量删除** | 单条还没在真环境跑稳之前，批量只会让「出错时是哪一条」更难定位。**今天明确不做** | 需要时再说 |
| 登录 / 鉴权 | 本期只有一个用户（`PRD.md` 第 6 节）。**代价要认**：读接口是公开可读的，`POST /api/habits` 是公开可写的，**Day 22 起 `PATCH`/`DELETE` 也是公开可改可删的** —— 谁知道地址谁就能增、能改、能删 | 未排期 |
| 分页、限流、重试 | 数据量极小，现在写等于凭空猜参数（`limit` 只做了上限夹取，没有分页） | 需要时再说 |
| 多用户 / 云端账号 | 同上 | 未排期 |

> 已经做完、**从这张表里划掉**的：跨域（Day 17，见第 3.7 节）、数据库建表（Day 16）、
> 真实业务接口的**读**这一半（Day 17）、习惯的**新建**（Day 18，见第 3.8 节）、
> **习惯的改与删**（Day 22，见第 3.11 / 3.12 节）—— 到这一天，习惯的「增删改查」四类操作**凑齐了**。

---

## 6. 前端怎么用

**Day 15–16**：**一行接口都不调**，数据全在浏览器本地存储（键名 `habit-board/v1`）。
原因：那时没配跨域，调了会被浏览器拦；而且「让公网能打开页面」和「让页面连上后端」是两件事，
混在一起会分不清是哪一步错了。

**Day 17 起（现在这样）**：前端**读**走接口，**写**还在本地。
⚠️ **Day 18 / Day 22 做的都是接口，前端至今一个字没改** —— 所以「写还在本地」这条到今天依然成立
（页面上加的、勾的、删的，刷新之后还是会被数据库那一份盖掉）。
**到今天为止，四类操作的接口已经凑齐了**（读 `GET` / 增 `POST` / 改 `PATCH` / 删 `DELETE`），
把页面的「写」整体切过去的前置条件**已经具备** —— 那是下一步的事，不是今天。

**「读」的逻辑全部收在一个文件里** ——
仓库根目录的 **`cloud.js`**（这就是上面那句「接口地址和读法只出现在一个地方」的落点）：

```js
// cloud.js 里的核心就是这一段（完整版见文件）
var BASE = 'https://habit-board-d0gum6nqu512acc29-1499798330.ap-shanghai.app.tcloudbase.com';
var API = { habits: BASE + '/api/habits', todos: BASE + '/api/todos' };

function getJson(url) {
  return fetch(url)
    .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
    .then(function (json) {
      if (!json || json.ok !== true || !Array.isArray(json.data)) return null;  // 只认 ok
      return json.data;
    })
    .catch(function () { return null; });   // 任何异常都当「没读到」，绝不让页面崩
}
```

两个页面各自只加**一行**调用：

```js
if (window.HabitBoardCloud) {
  window.HabitBoardCloud.sync({ state: state, save: saveData, rerender: render });
}
```

**为什么是「先本机画一遍、再去问云端」而不是「等云端」**：
接口挂了、断网了、还没部署 —— 页面必须照常打得开（这是 Day 1 就定的底线）。
读到了就用云端那份重画；读不到就保持本机那份，一个字都不说，也不白屏。
右上角那个「云端数据库 / 本机数据」小标会把此刻用的是哪一份摆明。

> **为什么这段写进文档而不是藏在代码里**：`TECH_DESIGN.md` 第 8 节写着
> 「接真正的数据库时，只把存储层那两个函数换掉，界面逻辑不动」——
> 今天真的走到这一步了：换掉的是 `loadData()` 的来源，`render()` 那几百行一行没改。

---

## 7. 怎么核对（可复现）

每一条都是能直接跑的命令，不是「应该没问题」。

```bash
ENV=habit-board-d0gum6nqu512acc29
B="https://$ENV-1499798330.ap-shanghai.app.tcloudbase.com"

# ---------- 健康检查（Day 15 留下的，每次部署后都跑） ----------
curl -s "$B/api-health"                       # ok 是不是 true、envId 对不对
curl -s "$B/api-health" | grep -o '"envId":"[^"]*"'
curl -sI "$B/api-health"                      # content-type / cache-control
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$B/api-health"     # 应该是 405

# ---------- 两个读接口（Day 17） ----------
curl -s "$B/api/habits" | head -c 400         # ok / count / data，字段应是 camelCase
curl -s "$B/api/todos"  | head -c 400

# 1) 库里那三个 snake_case 名字不许漏出来（应该一个都搜不到）
curl -s "$B/api/habits" | grep -o 'freq_type\|freq_count\|created_at'    # 期望：无输出

# 2) doneDates 是不是真的数组（多行聚合的结果）
curl -s "$B/api/habits" | grep -o '"doneDates":\[[^]]*\]' | head -2

# 3) 跨域头在不在（页面 fetch 靠它）
curl -sI "$B/api/habits" | grep -i "access-control-allow-origin"

# 4) 查询参数（余力加练）
curl -s "$B/api/habits?limit=2"            | grep -o '"count":[0-9]*'   # 2
curl -s "$B/api/todos?date=2026-10-04"     | grep -o '"count":[0-9]*'   # 5
curl -s "$B/api/todos?date=2026-02-30"     | grep -o '"date":[^,]*'     # null（假日期被识破，降级成不筛）

# 5) 方法用错：该 405
#    ⚠️ Day 22 起 /api/habits 也支持 PATCH / DELETE 了 —— 现在要拿 PUT 才测得到 405
curl -s -o /dev/null -w "%{http_code}\n" -X PUT   "$B/api/habits"     # 405
curl -s -o /dev/null -w "%{http_code}\n" -X POST  "$B/api/todos"      # 405（待办还没有写接口）
curl -s -i -X PUT "$B/api/habits" | grep -i "^allow"                  # allow: GET, POST, PATCH, DELETE, OPTIONS

# ---------- 写接口（Day 18）----------
# 6) 正常新建 → 201 + {ok:true, data:{…}}   ★ 这一步会真的往库里加一行 ★
curl -s -X POST "$B/api/habits" -H 'content-type: application/json' -d '{"name":"睡前不看手机"}'
#    写完立刻读回（读回验证）→ count 应该比上一步多 1，新习惯在列表里、doneDates 是 []
curl -s "$B/api/habits" | grep -o '"count":[0-9]*'

# ---------- 改 / 删（Day 22）----------
ID=h_xxxxxx   # 用第 6 步返回的 data.id（或列表里任意一条）

# 7) 改一条 → 200；改完读回，新值在列表里
curl -s -X PATCH "$B/api/habits/$ID" -H 'content-type: application/json' -d '{"name":"睡前不看手机（改）"}'
curl -s "$B/api/habits" | grep -o "睡前不看手机（改）"

# 8) 删一条（默认软删）→ 200 + deleted.mode = soft；删完读回，它**不在**了
curl -s -X DELETE "$B/api/habits/$ID"
curl -s "$B/api/habits" | grep -o "$ID"        # 期望：无输出

# 9) 删错了能找回 → 又出现；最后真删干净
curl -s -X DELETE "$B/api/habits/$ID?restore=true"
curl -s -X DELETE "$B/api/habits/$ID?hard=true"

# 10) ★ 最关键的护栏：不带 id 的 DELETE 必须被挡下（不许有「删全部」）
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE "$B/api/habits"    # 期望：405
curl -s -X DELETE "$B/api/habits"                                     # 看它拦下来的原话

# 11) 改/删一个不存在的 id → 404 not_found（不是静默成功）
curl -s -X DELETE "$B/api/habits/h_notexist22" | grep -o '"error":"[^"]*"'   # not_found

# 7) 重复提交被拒 → 409 + conflict + 中文
curl -s -X POST "$B/api/habits" -H 'content-type: application/json' -d '{"name":"睡前不看手机"}'

# 8) 缺必填字段被拒 → 400 + bad_request + 中文
curl -s -X POST "$B/api/habits" -H 'content-type: application/json' -d '{"freqType":"daily"}'

# 9) 换个角度核「库里真的多了一行」（不看接口，直接问库）
tcb db execute -e $ENV --sql "SELECT id, name, freq_type, freq_count, created_at FROM habits WHERE name = '睡前不看手机'"
tcb db execute -e $ENV --sql "SELECT (SELECT count(*) FROM habits) AS habits, (SELECT count(*) FROM habit_records) AS habit_records, (SELECT count(*) FROM todos) AS todos"
#    → habits 7（原来 6）；habit_records 仍 17、todos 仍 6 —— 只动了该动的

# 10) 防重复的第二层自己站得住吗（绕过云函数直接插重名）
tcb db execute -e $ENV --sql "INSERT INTO habits (id, name) VALUES ('h_dup_probe', '每天喝 8 杯水')"
#    → ERROR: duplicate key value violates unique constraint "ux_habits_name" (SQLSTATE 23505)
```

> ⚠️ **第 6 条跑过第二次会变成 `409`** —— 因为「睡前不看手机」已经在库里了。
> 那正是第 7 条要验的事。想原样重跑，先把那一条清掉：
> `tcb db execute -e $ENV --sql "DELETE FROM habits WHERE name = '睡前不看手机'"`
> （这也是为什么第 6 条特意挑了一个**还没被占用**的名字）。

**「改一行数据、接口跟着变」怎么验**（今天做过的，可重跑）：

```bash
tcb db execute -e $ENV --sql "UPDATE todos SET done = TRUE WHERE id = 't_seed_3'"
curl -s "$B/api/todos" | grep -o '"id":"t_seed_3"[^}]*'   # done 应变成 true
```

服务**不用重新部署**：接口每次请求都现查数据库。这条能过，说明「页面上的数据是真的从库里来的」，
不是部署时打包进去的。

**前端接上了没**（页面自己会报）：

```bash
curl -s "https://$ENV-1499798330.tcloudbaseapp.com/cloud.js" | grep -o "api/habits" | head -1
```

---

## 8. 变更记录

| 版本 | 日期 | 改了什么 |
| --- | --- | --- |
| v1.0 | 2026-10-03 | 首版（Day 15 产出）：定下 `GET /api/health` 的请求与响应；定下全项目的数据格式、成功/失败形状、错误码名称、版本策略；列出今天不做的事及各自排期 |
| v1.1 | 2026-10-04 | Day 17：新增第 3 节，写清 `GET /api/habits`、`GET /api/todos` 两个读接口的请求 / 响应 / 字段表；新增 3.1 节记录「接口要的数据和建的表哪里对不上」（形状 + 命名两处）；新增 3.4 查询参数、3.6 后端怎么读到数据库（三条路实测）、3.7 跨域；第 1 / 4 / 5 / 6 / 7 节按现状改写；版本号从 `v1` 升到 `v1.1` |
| v1.2 | 2026-10-05 | Day 18：第 3 节改名为「业务接口」（读 Day 17 / 写 Day 18），**新增 3.8 `POST /api/habits` 完整定义**（请求字段表 + `201` 响应示例 + 13 种出错情况的中文提示）；**新增 3.9 防重复提交的两层设计**（应用层查重只负责说人话，数据库唯一索引才真的防住并发）与三条可重跑的测法；**新增 3.10 服务端日志**字段说明；第 4.3 / 4.4 / 4.5 节更新（`data` 可以是对象、新增错误码 `conflict`(409)、`bad_request` 第一次真正用上、说清 `version` 是**每个接口各自**的契约版本，所以 `api-todos` 仍报 `v1.1`）；第 1 / 3.7 / 5 / 6 / 7 节按现状改写；**没有新增章节、也没挪动原有节号**（免得代码注释里的「第 4.2 节」全部失效）|
| v1.3 | 2026-10-09 | Day 22：第 1 节把范围从「四个接口」改成「六个动作」；**新增 3.11 `PATCH /api/habits/<id>`（改一条）**、**3.12 `DELETE /api/habits/<id>`（删一条，默认软删除 + `?restore=true` 可找回）**、**3.13「删除为什么比新增更容易出事 + 我在三处加了确认」**（含软删除实现表、`is_deleted` 与部分唯一索引的取舍、四类闭环复现命令）；3.5 / 3.7 / 3.8 / 3.10 / 4.1 / 4.4 / 4.5 / 5 / 6 / 7 节按现状改写（`not_found`(404) 第一次真正用上、`allow` 头与 CORS 方法表加 `PATCH`/`DELETE`、`version` 升 `v1.3`、第 4.1 节那条「单条资源还没做」划掉）；**新增一条实测笔记**：CloudBase HTTP 访问服务是**路径前缀匹配 + 剥掉前缀**（函数收到的 `event.path` 是 `/h_xxx`，不是 `/api/habits/h_xxx`）|

---

**下一步**：把页面的「写」也接到接口上 —— 那需要 `PATCH`（改）和 `DELETE`（删）一起上，
因为页面上的「勾选完成」和「删除」分别要用到这两个方法。届时前端「写」不再走浏览器本地存储，
页面上那个「本机数据」的临时状态就结束了；第 4.4 节里预留的 `not_found`(404) 也会在那时用上。
