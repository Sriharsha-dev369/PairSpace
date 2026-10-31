ALTER TABLE "rooms" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "title" text DEFAULT 'Untitled room' NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "last_edited_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;