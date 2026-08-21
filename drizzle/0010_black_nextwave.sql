CREATE TABLE "icons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "icons_name_unique" UNIQUE("name"),
	CONSTRAINT "icons_name_not_blank" CHECK (length(btrim("icons"."name")) > 0),
	CONSTRAINT "icons_name_length" CHECK (length("icons"."name") <= 32)
);
