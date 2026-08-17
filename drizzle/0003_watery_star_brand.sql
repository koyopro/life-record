CREATE TYPE "public"."recurrence_basis" AS ENUM('due', 'completion');--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "recurrence_rule" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "recurrence_basis" "recurrence_basis";--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "series_id" uuid;--> statement-breakpoint
CREATE INDEX "items_series_id_idx" ON "items" USING btree ("series_id");--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_recurrence_complete" CHECK (("items"."recurrence_rule" IS NULL AND "items"."recurrence_basis" IS NULL)
          OR ("items"."recurrence_rule" IS NOT NULL AND "items"."recurrence_basis" IS NOT NULL));