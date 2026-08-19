-- completed_at はこの列を追加した時点では既存行に何も入らない。
-- すでに closed だった行は completed_at が永遠に NULL のままになり、
-- 「今日」リストの完了タブに（本当は今日完了していても）二度と出せなくなる。
--
-- 正確な完了日時は分からないため、updated_at を代わりに使う。
-- 「更新のたびに動く」という弱点はあるが、closed のまま放置された行には
-- 他に手がかりが無く、NULL のまま残すよりはましな近似値になる。
UPDATE items
SET completed_at = updated_at
WHERE status = 'closed' AND completed_at IS NULL;
