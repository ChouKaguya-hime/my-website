-- =============================================================================
-- db/seed.sql ｜ 习惯规划板 · 种子数据（Day 16 产出）
-- =============================================================================
-- 作用：往 habits / habit_records / todos 三张表里灌一批「看起来像真用过一阵子」的示例数据，
--       好让 Day 17 的读接口一写出来就有东西可读，也方便验收「每张表 ≥5 行」。
-- 幂等：每条 INSERT 都带 ON CONFLICT ... DO NOTHING —— 重复执行不报错、也不会插重复。
-- 依赖：必须先执行 db/schema.sql 建好表（habit_records 有外键指向 habits）。
-- 执行：tcb db execute -e <envId> --role postgres --sql "<本文件内容>"
--
-- 说明：种子数据用语义化的固定 id（h_seed_* / t_seed_*），
--       好处是重复执行能靠主键去重，且一眼能看出「这条是种子数据，不是用户真录的」。
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1) habits —— 6 条习惯（3 个每天型 + 3 个每周型，覆盖两种频率）
-- -----------------------------------------------------------------------------
INSERT INTO habits (id, name, freq_type, freq_count, created_at) VALUES
  ('h_seed_water',   '每天喝 8 杯水',        'daily',  7, CURRENT_DATE - 40),
  ('h_seed_walk',    '每天走 6000 步',       'daily',  7, CURRENT_DATE - 35),
  ('h_seed_read',    '睡前阅读 20 分钟',      'daily',  7, CURRENT_DATE - 28),
  ('h_seed_english', '背 15 个单词',          'daily',  7, CURRENT_DATE - 30),
  ('h_seed_gym',     '去健身房',              'weekly', 3, CURRENT_DATE - 21),
  ('h_seed_diary',   '写一段日记',            'weekly', 2, CURRENT_DATE - 14)
ON CONFLICT (id) DO NOTHING;


-- -----------------------------------------------------------------------------
-- 2) habit_records —— 打卡记录（靠 habit_id 关联上面的习惯）
--    故意造成「有的习惯最近很勤、有的断了几天」的分布，好让 Day 17 算出的
--    「本周强度」有的显示百分比、有的显示「—」（零完成不显示 0%，守 PRD 原则 1）。
-- -----------------------------------------------------------------------------
INSERT INTO habit_records (habit_id, done_date) VALUES
  -- 喝 8 杯水：近 7 天完成 6 天（强度会很高）
  ('h_seed_water', CURRENT_DATE),
  ('h_seed_water', CURRENT_DATE - 1),
  ('h_seed_water', CURRENT_DATE - 2),
  ('h_seed_water', CURRENT_DATE - 3),
  ('h_seed_water', CURRENT_DATE - 4),
  ('h_seed_water', CURRENT_DATE - 6),
  -- 走 6000 步：近 7 天完成 4 天
  ('h_seed_walk', CURRENT_DATE),
  ('h_seed_walk', CURRENT_DATE - 1),
  ('h_seed_walk', CURRENT_DATE - 3),
  ('h_seed_walk', CURRENT_DATE - 5),
  -- 睡前阅读：近 7 天完成 2 天
  ('h_seed_read', CURRENT_DATE - 1),
  ('h_seed_read', CURRENT_DATE - 4),
  -- 背单词：近 7 天只完成 1 天
  ('h_seed_english', CURRENT_DATE - 2),
  -- 去健身房（每周 3 次）：近 7 天 3 次，刚好达标
  ('h_seed_gym', CURRENT_DATE),
  ('h_seed_gym', CURRENT_DATE - 2),
  ('h_seed_gym', CURRENT_DATE - 5),
  -- 写日记（每周 2 次）：近 7 天 1 次
  ('h_seed_diary', CURRENT_DATE - 3)
ON CONFLICT (habit_id, done_date) DO NOTHING;


-- -----------------------------------------------------------------------------
-- 3) todos —— 6 条待办（5 条「今天」+ 1 条「昨天」，用来验证页面只取今天）
-- -----------------------------------------------------------------------------
INSERT INTO todos (id, text, todo_date, done) VALUES
  ('t_seed_1', '把 Day 16 的表结构画成一张图，讲清楚两张核心表怎么关联', CURRENT_DATE,     FALSE),
  ('t_seed_2', '给 seed.sql 补一条「重复执行」自检，确认不重复插',        CURRENT_DATE,     TRUE),
  ('t_seed_3', '把 CloudBase 控制台的表数据页截图交给助教',              CURRENT_DATE,     FALSE),
  ('t_seed_4', '复习外键和外键级联、唯一约束的区别',                      CURRENT_DATE,     TRUE),
  ('t_seed_5', '明天 Day 17 开写第一个读接口（GET /habits）',             CURRENT_DATE,     FALSE),
  ('t_seed_6', '把 PRD 6.1 的字段表跟数据库列名对一遍',                   CURRENT_DATE - 1, TRUE)
ON CONFLICT (id) DO NOTHING;
