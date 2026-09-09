ALTER TABLE "items" ADD COLUMN "generated_from" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "items_generated_from_uniq" ON "items" USING btree ("generated_from");