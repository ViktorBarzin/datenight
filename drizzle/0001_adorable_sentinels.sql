CREATE TABLE "dates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_id" uuid,
	"venue" text NOT NULL,
	"activity_kind" text NOT NULL,
	"category" varchar(16) NOT NULL,
	"on" date NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"area" text DEFAULT '' NOT NULL,
	"dress_code" text DEFAULT '' NOT NULL,
	"booking_ref" text DEFAULT '' NOT NULL,
	"booking_platform" text DEFAULT '' NOT NULL,
	"booking_email" text DEFAULT '' NOT NULL,
	"price_gbp" integer,
	"notes" text DEFAULT '' NOT NULL,
	"status" varchar(16) NOT NULL,
	"source" varchar(16) NOT NULL,
	"rating" integer,
	"rating_note" text DEFAULT '' NOT NULL,
	"owner_event_uid" text,
	"hold_event_uid" text,
	"calendar_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "history_candidates" (
	"on" date PRIMARY KEY NOT NULL,
	"venue_guess" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"venue" text NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"area" text DEFAULT '' NOT NULL,
	"postcode" text DEFAULT '' NOT NULL,
	"lat" double precision,
	"lon" double precision,
	"category" varchar(16) NOT NULL,
	"activity_kind" text NOT NULL,
	"price_gbp" integer,
	"url" text DEFAULT '' NOT NULL,
	"booking_url" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"why" text DEFAULT '' NOT NULL,
	"source" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"rejections" integer DEFAULT 0 NOT NULL,
	"ends_on" date,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"name" varchar(32) NOT NULL,
	"period_key" varchar(32) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" varchar(16) DEFAULT 'running' NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	CONSTRAINT "job_runs_name_period_key_pk" PRIMARY KEY("name","period_key")
);
--> statement-breakpoint
CREATE TABLE "shortlists" (
	"week_start" date PRIMARY KEY NOT NULL,
	"evening_date" date,
	"skip_reason" varchar(16),
	"round" integer DEFAULT 0 NOT NULL,
	"idea_ids" jsonb NOT NULL,
	"offered_ids" jsonb NOT NULL,
	"status" varchar(16) NOT NULL,
	"date_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dates" ADD CONSTRAINT "dates_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortlists" ADD CONSTRAINT "shortlists_date_id_dates_id_fk" FOREIGN KEY ("date_id") REFERENCES "public"."dates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dates_on_idx" ON "dates" USING btree ("on");--> statement-breakpoint
CREATE INDEX "dates_status_idx" ON "dates" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "ideas_dedupe_key_idx" ON "ideas" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "ideas_status_idx" ON "ideas" USING btree ("status");