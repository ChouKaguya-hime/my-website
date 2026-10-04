-- =============================================================================
-- db/sync.sql ｜ 习惯规划板 · 当日数据同步（Day 17 产出）
-- =============================================================================
-- 它和 db/seed.sql（Day 16）的分工：
--   seed.sql —— 一次性「造出」演示数据，只在建库那天跑过（里面的日期是 CURRENT_DATE 相对值）。
--   sync.sql —— **可以每天跑、同一天跑几次都行**的同步任务：
--               把库刷新成「今天该有的样子」，让读接口每天都有当天数据可读。
--               它不删任何东西，也不改表结构（Day 17 清单写明「今日不做：改表结构」）。
--
-- 为什么需要它
--   seed.sql 里的日期是**相对建库那天**算出来的。到了第二天，
--   「今天的待办」查不到东西、打卡记录整批滑出「最近 7 天」窗口 ——
--   页面会空掉或强度全归零，看起来像接口坏了。同步任务解决的就是这个：
--   「今天」这件事，得有人每天重新对齐一次。
--
-- 它做三件事（全部幂等，重复跑结果一样）：
--   1. 习惯定义：缺了就补，有了就不动（ON CONFLICT DO NOTHING）
--   2. 打卡记录：种子那 17 条整体平移到「最新一条落在今天」，保持原来的疏密分布；
--                已经不是种子（比如你自己真勾出来的记录）的一条都不动
--   3. 待办：把种子那 6 条的日期对齐到今天（只改日期，内容 text 和勾选 done 保持原样）
--
-- ⚠️ 适用期（重要，别糊里糊涂一直跑）
--   这个脚本是**演示期**的工具：库里装的还是种子数据时，用它把日期推着走。
--   等 Day 18 接通真实写入、库里开始有你**真的**勾出来的记录之后，
--   第 2 段的「平移」就该停掉（或者改成只补不挪）—— 那时候历史日期就是历史，不该被推着跑。
--
-- ⚠️ 刻意不做的事
--   **不伪造打卡。** 平移只挪已有记录的日期，不会凭空给今天补一条。
--   「今天完成了几个习惯」应该是人真的勾出来的；Day 18 接通写入之后，这里的一条条就是真的。
--
-- 怎么跑（幂等，随便重复跑）：
--   tcb db execute -e <envId> --sql "$(cat db/sync.sql)"
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1／习惯定义：缺了补上，已有的一个字都不改
--    （id / 名称 / 频率与 db/seed.sql 完全一致，不要另起一套名字）
-- -----------------------------------------------------------------------------
INSERT INTO habits (id, name, freq_type, freq_count, created_at) VALUES
  ('h_seed_water',   '每天喝 8 杯水',     'daily',  7, CURRENT_DATE - 40),
  ('h_seed_walk',    '每天走 6000 步',    'daily',  7, CURRENT_DATE - 35),
  ('h_seed_read',    '睡前阅读 20 分钟',  'daily',  7, CURRENT_DATE - 28),
  ('h_seed_english', '背 15 个单词',      'daily',  7, CURRENT_DATE - 30),
  ('h_seed_gym',     '去健身房',          'weekly', 3, CURRENT_DATE - 21),
  ('h_seed_diary',   '写一段日记',        'weekly', 2, CURRENT_DATE - 14)
ON CONFLICT (id) DO NOTHING;


-- -----------------------------------------------------------------------------
-- 2a／打卡记录：先把缺的补上（空库/新环境能直接跑到和建库那天一样的分布）
--     同一个 (habit_id, done_date) 重复插入会被唯一约束挡掉，所以不会长行数。
-- -----------------------------------------------------------------------------
INSERT INTO habit_records (habit_id, done_date) VALUES
  -- 喝 8 杯水：近 7 天完成 6 天（强度会很高）
  ('h_seed_water', CURRENT_DATE),     ('h_seed_water', CURRENT_DATE - 1),
  ('h_seed_water', CURRENT_DATE - 2), ('h_seed_water', CURRENT_DATE - 3),
  ('h_seed_water', CURRENT_DATE - 4), ('h_seed_water', CURRENT_DATE - 6),
  -- 走 6000 步：近 7 天完成 4 天
  ('h_seed_walk', CURRENT_DATE),     ('h_seed_walk', CURRENT_DATE - 1),
  ('h_seed_walk', CURRENT_DATE - 3), ('h_seed_walk', CURRENT_DATE - 5),
  -- 睡前阅读：近 7 天完成 2 天
  ('h_seed_read', CURRENT_DATE - 1), ('h_seed_read', CURRENT_DATE - 4),
  -- 背单词：近 7 天只完成 1 天
  ('h_seed_english', CURRENT_DATE - 2),
  -- 去健身房（每周 3 次）：近 7 天 3 次，刚好达标
  ('h_seed_gym', CURRENT_DATE), ('h_seed_gym', CURRENT_DATE - 2), ('h_seed_gym', CURRENT_DATE - 5),
  -- 写日记（每周 2 次）：近 7 天 1 次
  ('h_seed_diary', CURRENT_DATE - 3)
ON CONFLICT (habit_id, done_date) DO NOTHING;


-- -----------------------------------------------------------------------------
-- 2b／打卡记录：把「种子那批」的日期整体平移到以今天为最新
--      为什么用整体平移：所有行加同一个天数，行和行之间的间距不变
--      → 原来「谁勤谁懒」的分布原样保留，也不会产生日期撞车。
--      为什么只在 delta > 0 时动：同一天跑第二次 delta = 0 → 一条都不改，天然幂等。
--      为什么限定 h_seed%：你自己真勾出来的记录（id 不带 seed）一条都不碰。
-- -----------------------------------------------------------------------------
WITH stale AS (
  SELECT CURRENT_DATE - max(done_date) AS delta
  FROM habit_records
  WHERE habit_id LIKE 'h_seed%'
)
UPDATE habit_records
SET done_date = done_date + (SELECT delta FROM stale)
WHERE habit_id LIKE 'h_seed%'
  AND (SELECT delta FROM stale) > 0;


-- -----------------------------------------------------------------------------
-- 3／待办：把种子那 6 条的日期对齐到今天
--    只改 todo_date —— text 和 done 保持原样，别把改过的状态冲掉。
--    同日重复跑：日期本来就是今天，等于没改，行数不变。
-- -----------------------------------------------------------------------------
INSERT INTO todos (id, text, todo_date, done) VALUES
  ('t_seed_1', '把 Day 16 的表结构画成一张图，讲清楚两张核心表怎么关联', CURRENT_DATE,     FALSE),
  ('t_seed_2', '给 seed.sql 补一条「重复执行」自检，确认不重复插',        CURRENT_DATE,     TRUE),
  ('t_seed_3', '把 CloudBase 控制台的表数据页截图交给助教',              CURRENT_DATE,     FALSE),
  ('t_seed_4', '复习外键和外键级联、唯一约束的区别',                      CURRENT_DATE,     TRUE),
  ('t_seed_5', '明天 Day 17 开写第一个读接口（GET /habits）',             CURRENT_DATE,     FALSE),
  ('t_seed_6', '把 PRD 6.1 的字段表跟数据库列名对一遍',                   CURRENT_DATE - 1, TRUE)
ON CONFLICT (id) DO UPDATE SET todo_date = EXCLUDED.todo_date;


-- -----------------------------------------------------------------------------
-- 4／自检：跑完直接把「现在库里是什么样」打出来（这一段的输出就是执行结果）
-- -----------------------------------------------------------------------------
SELECT 'habits 习惯'          AS 项目, count(*) AS 行数, '' AS 备注 FROM habits
UNION ALL
SELECT 'habit_records 打卡',   count(*), '最新一天 ' || max(done_date)::text FROM habit_records
UNION ALL
SELECT 'todos 待办（全部）',   count(*), '最新一天 ' || max(todo_date)::text FROM todos
UNION ALL
SELECT 'todos 待办（今天）',   count(*), CURRENT_DATE::text FROM todos WHERE todo_date = CURRENT_DATE
UNION ALL
SELECT 'habit_records 今天',   count(*), CURRENT_DATE::text FROM habit_records WHERE done_date = CURRENT_DATE;
