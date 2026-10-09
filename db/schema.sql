-- =============================================================================
-- db/schema.sql ｜ 习惯规划板 · 数据库表结构（Day 16 产出，Day 18 加唯一索引，Day 22 加软删除）
-- =============================================================================
-- 目标环境：CloudBase PostgreSQL（实测 PostgreSQL 17.11）
-- 上游依据：PRD.md 第 6.1 节（存什么，字段不增不减）、api-contract.md 第 3.2 节（JSON 字段用小驼峰）
-- 执行方式：tcb db execute -e <envId> --sql "$(cat db/schema.sql)"
-- 幂等性：全部用 CREATE TABLE / CREATE INDEX IF NOT EXISTS / ADD COLUMN IF NOT EXISTS，
--   重复执行不报错、不改动已有表。Day 22 的索引调整是「先 DROP IF EXISTS 再建」，同样可反复执行。
--
-- 【Day 18 改了什么】只在 habits 上加了 ux_habits_name 这一条唯一索引（同名的习惯只留一条），
--   三张表的结构、列、其余约束一个字没动。原因见那条索引上方的注释。
--
-- 【Day 22 改了什么】给 habits 加了 is_deleted 列（软删除标记），并把唯一索引缩小成
--   「只对没被删的记录生效」。**没有新增表、没有动 habit_records / todos** ——
--   删除能力只落在 habits 这一张表上。
--   为什么软删除：删除是四类操作里**唯一一个会丢数据**的 —— 加错了能删、改错了能改回，
--   只有删错了不可逆。加一个标记位代替真删，删错了还能找回（见 api-contract.md 第 3.10 节）。

--
-- ── 今天要回答的那个问题 ──────────────────────────────────────────────────────
--   「你的两张表分别存什么？它们靠哪个字段关联？」
--   答：习惯的完成情况在 PRD 里是一个**数组**（habit.doneDates），
--       关系型数据库一个格子只放一个值，所以必须把它拆出来单独成表：
--         · habits        存「习惯本身」（叫什么、多久做一次）
--         · habit_records 存「哪天完成了哪个习惯」，★ 靠 habit_id 关联回 habits ★
--       待办（todos）是另一个独立列表，与习惯**没有外键关联**，
--       两者在页面上并排出现靠的是「同一天」这个口径，不是字段关联。
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 表 1／habits —— 习惯定义
-- 对应 PRD 6.1「习惯 habit」。这里只存习惯**是什么**，不存完成情况。
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS habits (
  id          VARCHAR(64)  PRIMARY KEY,                       -- 习惯唯一标识（前端生成，形如 h_xxxxx）
  name        TEXT         NOT NULL,                          -- 习惯名称
  freq_type   VARCHAR(8)   NOT NULL DEFAULT 'daily',          -- 频率类型：daily=每天 / weekly=每周 N 次（对应前端 freqType）
  freq_count  SMALLINT     NOT NULL DEFAULT 7,                -- 每周次数，仅 weekly 有效（对应前端 freqCount）
  created_at  DATE         NOT NULL DEFAULT CURRENT_DATE,     -- 创建日期 YYYY-MM-DD（对应前端 createdAt）
  is_deleted  BOOLEAN      NOT NULL DEFAULT false,            -- ★ Day 22 追加：软删除标记（true=已删，读时跳过，能找回）
  CONSTRAINT habits_freq_type_chk CHECK (freq_type IN ('daily', 'weekly')),
  CONSTRAINT habits_freq_count_chk CHECK (freq_count BETWEEN 1 AND 7)
);

-- ★ Day 22 追加：给**已经建好的老表**补上 is_deleted 这一列（新表上面的 CREATE TABLE 里已经带了）★
-- 为什么还要这一句：CREATE TABLE IF NOT EXISTS 对已存在的表**整段跳过**，不会帮你加列 ——
--   老环境（本项目的库就是）已经有 habits 了，所以必须靠 ALTER 补。
-- 为什么是 NOT NULL DEFAULT false：老数据全是「没删过」的，默认值正好；
--   NOT NULL + 有默认值 = PostgreSQL 加列时不回填、不锁长事务，6 条老数据自动就是 false。
-- 为什么用 IF NOT EXISTS：这个脚本要能反复执行，第二次跑必须安静地跳过。
ALTER TABLE habits ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;

-- ★ Day 18 追加、Day 22 调整：同一个名字的习惯只能有一条（**限未被软删的那些**）★
-- 为什么要有它（而不是只在云函数里「先查一遍再插」）：
--   云函数里的查重是「先看一眼、再写」——两个请求几乎同时到达时，
--   它们会同时看到「这个名字还没人用」，然后各插一条，查重就漏了（双击提交 / 网络重试正是这种情况）。
--   唯一索引由数据库自己保证：第二条不管怎么并发都插不进去。
--   → 两层分工：应用层负责给「已经有一个叫「X」的习惯了」这句人话；数据库层负责让重复真的进不来。
--
-- ⚠️ Day 22 为什么要从「全表唯一」改成「部分唯一（WHERE is_deleted = false）」：
--   加了软删除之后，如果还按全表唯一，会卡死在这个场景 ——
--     删掉「每天喝 8 杯水」（软删，行还留在表里）→ 用户想重新建一个同名的 →
--     唯一索引认出「这名字已被占」，第二条插不进去 —— **可界面上它明明已经不存在了**。
--   所以唯一性只该约束「还没被删的」：已软删的记录把名字**让出来**。
-- 幂等做法：先 DROP（存在就删、不存在就跳过），再按新定义重建 —— 反复执行结果都一样。
DROP INDEX IF EXISTS ux_habits_name;
CREATE UNIQUE INDEX IF NOT EXISTS ux_habits_name ON habits (name) WHERE is_deleted = false;

COMMENT ON TABLE  habits             IS '习惯定义表（PRD 6.1 习惯 habit）——只存习惯本身，不含完成记录';
COMMENT ON COLUMN habits.id          IS '习惯唯一标识，前端生成，形如 h_ + 时间戳36进制 + 随机串';
COMMENT ON COLUMN habits.name        IS '习惯名称，如「每天喝 8 杯水」';
COMMENT ON COLUMN habits.freq_type   IS '频率类型：daily=每天一次 / weekly=每周 N 次';
COMMENT ON COLUMN habits.freq_count  IS '每周目标次数，仅 freq_type=weekly 时有意义；daily 固定存 7（沿用前端默认值）';
COMMENT ON COLUMN habits.created_at  IS '创建日期（只有年月日，无时分秒），默认取当天';
COMMENT ON COLUMN habits.is_deleted  IS '★ Day 22：软删除标记。true=已被删除（读接口会跳过它，但数据还在，加 ?restore=true 能找回）；false=正常';


-- -----------------------------------------------------------------------------
-- 表 2／habit_records —— 打卡记录（★ 与 habits 靠 habit_id 关联 ★）
-- 对应 PRD 6.1 里 habit.doneDates 那个「已完成日期列表」，一行 = 某习惯某天完成了一次。
-- 用「多行」代替「一个数组字段」，这是关系型的标准做法，也让「最近 7 天完成了几次」能直接查。
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS habit_records (
  id         BIGSERIAL    PRIMARY KEY,                        -- 自增主键（记录本身不需要业务 id，用数据库生成的就行）
  habit_id   VARCHAR(64)  NOT NULL,                           -- ★ 外键：指向 habits.id，这就是两张表的关联字段
  done_date  DATE         NOT NULL,                           -- 完成日期 YYYY-MM-DD
  CONSTRAINT habit_records_habit_fk
    FOREIGN KEY (habit_id) REFERENCES habits (id) ON DELETE CASCADE,
  CONSTRAINT habit_records_unique
    UNIQUE (habit_id, done_date)                              -- 同一习惯同一天只记一次，重复打卡不产生脏数据
);

CREATE INDEX IF NOT EXISTS idx_habit_records_habit_id  ON habit_records (habit_id);
CREATE INDEX IF NOT EXISTS idx_habit_records_done_date ON habit_records (done_date);

COMMENT ON TABLE  habit_records            IS '习惯打卡记录表——把 PRD 的 doneDates 数组拆成「一行一次」，靠 habit_id 关联 habits';
COMMENT ON COLUMN habit_records.id         IS '记录自增主键，仅用于唯一排序，无业务含义';
COMMENT ON COLUMN habit_records.habit_id   IS '★ 关联字段：指向 habits.id；习惯被删时它的打卡记录级联删除';
COMMENT ON COLUMN habit_records.done_date  IS '完成日期（只有年月日）；与 habit_id 组成唯一约束，重复打卡会被忽略';


-- -----------------------------------------------------------------------------
-- 表 3／todos —— 待办
-- 对应 PRD 6.1「待办 todo」。与 habits 无外键关联，是独立列表。
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS todos (
  id         VARCHAR(64)  PRIMARY KEY,                        -- 待办唯一标识（前端生成，形如 t_xxxxx）
  text       TEXT         NOT NULL,                           -- 一句话文本（对应前端 text）
  todo_date  DATE         NOT NULL,                           -- 归属日期 YYYY-MM-DD（对应前端 date）；页面只显示「今天」的
  done       BOOLEAN      NOT NULL DEFAULT FALSE              -- 是否完成（对应前端 done）
);

CREATE INDEX IF NOT EXISTS idx_todos_todo_date ON todos (todo_date);

COMMENT ON TABLE  todos            IS '待办表（PRD 6.1 待办 todo）——与习惯表无外键关联，按 todo_date 取「今天」';
COMMENT ON COLUMN todos.id         IS '待办唯一标识，前端生成，形如 t_ + 时间戳36进制 + 随机串';
COMMENT ON COLUMN todos.text       IS '待办内容，一句纯文本';
COMMENT ON COLUMN todos.todo_date  IS '归属日期；今天页/看板只显示 todo_date = 今天 的行';
COMMENT ON COLUMN todos.done       IS '是否已完成，true/false（不用 1/0，与接口契约一致）';
