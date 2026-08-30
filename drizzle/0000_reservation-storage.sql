CREATE TABLE "equipment" (
	"management_number" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"management_number" text NOT NULL,
	"starts_at" bigint NOT NULL,
	"ends_at" bigint NOT NULL,
	CONSTRAINT "positive_reservation_period" CHECK ("reservations"."starts_at" < "reservations"."ends_at")
);
--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_management_number_equipment_management_number_fk" FOREIGN KEY ("management_number") REFERENCES "public"."equipment"("management_number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reservation_overlap_candidates" ON "reservations" USING btree ("management_number","starts_at","ends_at");