CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_key_not_blank" CHECK (length(btrim("settings"."key")) > 0),
	CONSTRAINT "settings_key_length" CHECK (length("settings"."key") <= 100),
	CONSTRAINT "settings_value_length" CHECK (length("settings"."value") <= 500)
);
