ALTER TABLE "equipment" DROP CONSTRAINT "consistent_equipment_snapshot";--> statement-breakpoint
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
        AND length("equipment"."suspension_reason") > 0
        AND "equipment"."suspension_reason" = btrim("equipment"."suspension_reason")))
  ));