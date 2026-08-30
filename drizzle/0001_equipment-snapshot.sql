ALTER TABLE "equipment" ADD COLUMN "status" text DEFAULT 'available' NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "version" numeric DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "last_performed_by" text;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "last_occurred_at_ns" numeric;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "suspension_reason" text;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "consistent_equipment_snapshot" CHECK ((
    "equipment"."status" = 'available' AND "equipment"."version" = 0
    AND "equipment"."last_performed_by" IS NULL AND "equipment"."last_occurred_at_ns" IS NULL
    AND "equipment"."suspension_reason" IS NULL
  ) OR (
    "equipment"."version" > 0 AND "equipment"."version" = trunc("equipment"."version")
    AND "equipment"."last_performed_by" IS NOT NULL AND "equipment"."last_occurred_at_ns" IS NOT NULL
    AND "equipment"."last_occurred_at_ns" = trunc("equipment"."last_occurred_at_ns")
    AND (("equipment"."status" = 'available' AND "equipment"."suspension_reason" IS NULL)
      OR ("equipment"."status" = 'suspended' AND "equipment"."suspension_reason" IS NOT NULL
        AND length(btrim("equipment"."suspension_reason")) > 0))
  ));