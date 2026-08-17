CREATE TYPE "public"."item_status" AS ENUM('inbox', 'backlog', 'in_progress', 'closed');--> statement-breakpoint
CREATE TABLE "diaries" (
	"date" date PRIMARY KEY NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"status" "item_status" DEFAULT 'inbox' NOT NULL,
	"priority" smallint,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_priority_range" CHECK ("items"."priority" BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"date" date NOT NULL,
	"body" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "items_status_idx" ON "items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "items_priority_due_idx" ON "items" USING btree ("priority" ASC NULLS LAST,"due_at" ASC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sections_item_id_idx" ON "sections" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "sections_date_idx" ON "sections" USING btree ("date");