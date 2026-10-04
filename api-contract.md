# api-contract.md｜接口契约

> **项目**：`my-website`（习惯规划板）
> **版本**：v1.1 ｜ **日期**：2026-10-04（Day 17）｜ **作者**：斌（与 AI 协作）
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

## 1. 当前实现的范围（Day 17 更新）

**已经上了公网的接口，一共三个**：

| 接口 | 什么时候上的 | 干什么 |
| --- | --- | --- |
| `GET /api/health` | Day 15 | 报服务自己的状态（部署后探活用） |
| `GET /api/habits` | Day 17 | 读习惯列表，含每个习惯的打卡日期 |
| `GET /api/todos` | Day 17 | 读待办列表 |

Day 15 只做一个接口，是为了先证明第一件事：**公网能打到我的云函数**。
Day 17 要证明的是下一件事：**数据真的是从数据库里读出来的**，
而不是页面上那份浏览器本地存储 —— 而且这两样东西的形状还不一样（见第 3.1 节）。

| 还没做的 | 为什么现在不做 | 什么时候 |
| --- | --- | --- |
| 习惯 / 待办的**写入**接口（`POST` / `PATCH` / `DELETE`） | 今天只验「读」这一条链路，读写一起上出了问题分不清是哪一步 | Day 18 |
| 登录 / 鉴权 | 本期只有一个用户（`PRD.md` 第 6 节） | 未排期 |

> ⚠️ **今天起，前端会真的调这两个读接口**（跨域今天配了，见第 3.7 节）。
> 但**写入仍然走浏览器本地存储**（Day 18 才接）。
> 所以今天在页面上新增 / 勾选 / 删除，**刷新之后会被数据库那一份盖掉** ——
> 这是刻意排的先后顺序（先接读、再接写），不是 bug。
> 页面上那个「云端数据库 / 本机数据」小标就是用来告诉你此刻看的是哪一份。

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

## 3. Day 17 新增：两个读接口

### 3.1 先说今天清单上那个问题：**接口要的数据，和建的表哪里对不上？**

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

### 3.4 两个查询参数（今天是「余力加练」，顺手做了）

| 参数 | 作用 | 边界怎么处理 |
| --- | --- | --- |
| `limit` | 最多返回几条 | 不是数字 = 当没传；小于 1 = 按 1；大于 200 = **夹到 200**（防着有人拿 `?limit=999999` 来打） |
| `date` | 只要某一天的待办（只 `/api/todos` 有） | 不是 `YYYY-MM-DD`、或 `2026-02-30` 这种不存在的日期 = **当没传，返回全部**，不报 500 |

**为什么边界要这么处理**：查数据的接口，参数写错就整个失败，对使用者太苛刻；
宁可「降级成不筛、返回全部」，也不要因为一个手抖的参数把页面打成空白。

### 3.5 出错时会回什么

两个读接口和健康检查**共用同一套形状**（第 4.3 节）：

```json
{ "ok": false, "service": "habit-board-api", "function": "api-habits",
  "version": "v1.1", "error": "method_not_allowed", "message": "这个接口只接受 GET" }
```

| 情况 | HTTP | `error` | `message`（给人看） |
| --- | --- | --- | --- |
| 用了 POST / PATCH / DELETE | 405 | `method_not_allowed` | 这个接口只接受 GET |
| 数据库连不上 / 没配密钥 / SQL 出错 | 500 | `server_error` | 读取习惯失败：<原因> |
| 跨域预检 `OPTIONS` | 204 | —（空 body） | — |

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
| `access-control-allow-methods` | `GET, OPTIONS` | 今天只有读；写接口上线时这里要跟着加 |
| `access-control-max-age` | `86400` | 预检结果缓存一天，少发一次 OPTIONS |

> ⚠️ **`*` 是「本期只有一个用户、没有登录」前提下的选择**（`PRD.md` 第 6 节）。
> 哪天真要多人用了，这里必须换成白名单域名 + 鉴权 —— 现在的接口是**公开可读**的，
> 谁能猜到地址谁就能读到数据。这件事记在「明确不做」里（第 5 节），不是忘了。

---

## 4. 全项目统一约定（Day 16–20 沿用）

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
| `/api/habits/h_1234` | 某一个习惯 | 还没做（Day 18+，如果需要的话） |

- **资源用复数**（`habits`，不是 `habit`）——一条和多条地址长一样，靠有没有带 ID 区分。
- **动作交给 HTTP 方法**：读用 `GET`、新增用 `POST`、改动用 `PATCH`、删除用 `DELETE`。地址里不写动词（不写 `/getHabits`）。

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
- `error` 是给程序判断的（固定的英文短语），`message` 是给人看的（可以中文）。

### 4.4 错误码

| 错误码 | HTTP 状态码 | 含义 | 什么时候实现 |
| --- | --- | --- | --- |
| `method_not_allowed` | 405 | 方法用错了 | ✅ Day 15（Day 17 的读接口照用） |
| `server_error` | 500 | 服务自己出错了（连不上库、SQL 出错等） | ✅ Day 17 |
| `bad_request` | 400 | 请求内容不合法（缺字段、格式错） | 预留，Day 18 写接口时用 |
| `not_found` | 404 | 要的资源不存在 | 预留，Day 18+ |

> 标「预留」的都是**还没实现**的，写在这里是为了：到时候不用重新造名字，前后端一次对齐。
> ⚠️ 注意 `bad_request` 为什么今天**故意没用**：两个读接口的参数（`limit` / `date`）写错了
> 只是「当没传」降级处理，不报 400。参数错就整个失败，对查数据的接口太苛刻了（见第 3.4 节）。

### 4.5 版本

后端版本放在返回体的 `version` 字段里（Day 15 是 `"v1"`，Day 17 起是 **`"v1.1"`**），**不放在地址里**（不写 `/v1/habits`）。

**为什么**：地址加版本号意味着以后升级要动所有前端地址；放字段里，前端读到对不上的版本时可以选择提示而不是直接崩。本期只有一个前端、规模很小，`version` 字段够用了。

---

## 5. 明确不做（不是漏了，是排在后面）

| 不做的事 | 为什么不做 | 什么时候 |
| --- | --- | --- |
| 习惯 / 待办的**写入**接口 | 今天只验「读」这条链路；读写一起上，出问题分不清是哪一步 | Day 18 |
| 登录 / 鉴权 | 本期只有一个用户（`PRD.md` 第 6 节）。**代价要认**：两个读接口现在是公开可读的 | 未排期 |
| 分页、限流、重试 | 数据量极小，现在写等于凭空猜参数（`limit` 只做了上限夹取，没有分页） | 需要时再说 |
| 多用户 / 云端账号 | 同上 | 未排期 |

> 已经做完、**从这张表里划掉**的：跨域（Day 17，见第 3.7 节）、数据库建表（Day 16）、
> 真实业务接口的**读**这一半（Day 17）。

---

## 6. 前端怎么用

**Day 15–16**：**一行接口都不调**，数据全在浏览器本地存储（键名 `habit-board/v1`）。
原因：那时没配跨域，调了会被浏览器拦；而且「让公网能打开页面」和「让页面连上后端」是两件事，
混在一起会分不清是哪一步错了。

**Day 17 起（现在这样）**：前端**读**走接口，**写**还在本地。全部逻辑收在一个文件里 ——
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

# 5) 方法用错两个都该 405
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$B/api/habits"
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$B/api/todos"
```

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

---

**下一步**：Day 18 接**写入**接口（`POST /api/habits`、`PATCH`、`DELETE`，以及待办的增删改）——
届时前端「写」也走接口，页面上那个「本机数据」的临时状态就结束了，
第 4.4 节里预留的 `bad_request` 会第一次真正用上。
