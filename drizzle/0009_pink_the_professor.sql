-- RTM と同じ 24 色をタグの色見本に足す（docs/09-tags.md 9.2）。
-- RTM から import した色を丸めずにそのまま使えるようにするため。
-- すでに使われている元の 12 色は、付いているタグがあるので残す
-- （enum は値を後から削れず、作り直すと色が消えるため）。
ALTER TYPE "public"."tag_color" ADD VALUE 'rtm-sky-pale' BEFORE 'red';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE 'rtm-blue-pale' BEFORE 'red';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE 'rtm-navy-pale' BEFORE 'red';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE 'rtm-purple-pale' BEFORE 'red';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE 'rtm-mauve-pale' BEFORE 'red';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE 'rtm-red-pale' BEFORE 'red';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE 'rtm-sky' BEFORE 'red';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE 'rtm-blue' BEFORE 'red';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE 'rtm-navy' BEFORE 'red';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE 'rtm-purple' BEFORE 'red';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE 'rtm-mauve' BEFORE 'red';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE 'rtm-red' BEFORE 'red';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE 'rtm-orange-pale' BEFORE 'red';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE 'rtm-amber-pale' BEFORE 'red';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE 'rtm-gold-pale' BEFORE 'red';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE 'rtm-olive-pale' BEFORE 'red';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE 'rtm-green-pale' BEFORE 'red';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE 'rtm-forest-pale' BEFORE 'red';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE 'rtm-orange' BEFORE 'red';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE 'rtm-amber' BEFORE 'red';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE 'rtm-gold' BEFORE 'red';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE 'rtm-olive' BEFORE 'red';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE 'rtm-green' BEFORE 'red';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE 'rtm-forest' BEFORE 'red';