CREATE TABLE "smart_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"tag" text,
	"view" text DEFAULT 'open' NOT NULL,
	"group_by" text DEFAULT 'none' NOT NULL,
	"sort" text DEFAULT 'priorityDueDesc' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "smart_lists_name_not_blank" CHECK (length(btrim("smart_lists"."name")) > 0),
	CONSTRAINT "smart_lists_name_length" CHECK (length("smart_lists"."name") <= 50)
);
