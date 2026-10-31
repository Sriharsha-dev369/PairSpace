ALTER TABLE "rooms" ADD COLUMN "snapshot" "bytea";--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "snapshot_up_to" bigint;