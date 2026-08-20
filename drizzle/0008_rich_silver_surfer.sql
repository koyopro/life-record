-- 「Inbox」と「Backlog」は運用上の差があいまいだったため「未着手」に統合する。
-- status の enum から inbox を落とすので、型を作り直す必要がある。
--
-- items_completed_at_only_when_closed は式の中で status を enum と比べており、
-- 列を text に移す時点で「operator does not exist: text = item_status」で落ちる。
-- 先に外し、型を入れ替えてから同じ内容で付け直す（drizzle-kit の生成では
-- ここが漏れるため、手で足している）。
ALTER TABLE "items" DROP CONSTRAINT "items_completed_at_only_when_closed";--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "status" SET DEFAULT 'backlog'::text;--> statement-breakpoint
-- 残っていると新しい enum へのキャストで落ちるので、先に寄せておく
UPDATE "items" SET "status" = 'backlog' WHERE "status" = 'inbox';--> statement-breakpoint
DROP TYPE "public"."item_status";--> statement-breakpoint
CREATE TYPE "public"."item_status" AS ENUM('backlog', 'in_progress', 'closed');--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "status" SET DEFAULT 'backlog'::"public"."item_status";--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "status" SET DATA TYPE "public"."item_status" USING "status"::"public"."item_status";--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_completed_at_only_when_closed" CHECK ("items"."status" = 'closed' OR "items"."completed_at" IS NULL);
