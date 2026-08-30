import { Hono } from "hono";
import * as v from "valibot";
import { type ReserveEquipmentFailureReason } from "../application/reserve-equipment.js";
import { ReservationId } from "../domain/identifiers.js";
import { type Reservation } from "../domain/reservation.js";
import { type ReservationServices } from "../reservation-services.js";

export interface ReservationResponse {
  id: string;
  userId: string;
  managementNumber: string;
  startsAt: string;
  endsAt: string;
}

const reservationRequest = v.object({
  userId: v.string(),
  managementNumber: v.string(),
  startsAt: v.string(),
  endsAt: v.string(),
});

export type ReservationRequest = v.InferOutput<typeof reservationRequest>;

export interface ReservationErrorResponse {
  reason:
    | ReserveEquipmentFailureReason
    | "unsupported-media-type"
    | "invalid-request"
    | "reservation-not-found"
    | "internal-error";
}

const failureStatus = {
  "invalid-reservation-period": 400,
  "start-time-is-in-the-past": 400,
  "equipment-not-found": 404,
  "equipment-is-suspended": 409,
  "reservation-conflict": 409,
} as const satisfies Record<ReserveEquipmentFailureReason, number>;

const toResponse = (reservation: Reservation): ReservationResponse => ({
  id: reservation.id.value,
  userId: reservation.userId.value,
  managementNumber: reservation.managementNumber.value,
  startsAt: reservation.period.startsAt.toString(),
  endsAt: reservation.period.endsAt.toString(),
});

export const app = new Hono<{ Bindings: { services: ReservationServices } }>()
  .onError((_error, c) =>
    c.json({ reason: "internal-error" } satisfies ReservationErrorResponse, 500),
  )
  .post("/reservations", async (c) => {
    const mediaType = c.req.header("Content-Type")?.split(";")[0]?.trim().toLowerCase();
    if (mediaType !== "application/json") return c.json({ reason: "unsupported-media-type" }, 415);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ reason: "invalid-request" }, 400);
    }
    const parsed = v.safeParse(reservationRequest, body);
    if (!parsed.success) return c.json({ reason: "invalid-request" }, 400);
    const result = await c.env.services.reserveEquipment.execute(parsed.output);
    if (!result.ok) return c.json({ reason: result.reason }, failureStatus[result.reason]);
    c.header("Location", `/reservations/${result.reservation.id.value}`);
    return c.json(toResponse(result.reservation), 201);
  })
  .get("/reservations/:reservationId", async (c) => {
    const reservation = await c.env.services.reservationRepository.findById(
      new ReservationId(c.req.param("reservationId")),
    );
    if (!reservation) return c.json({ reason: "reservation-not-found" }, 404);
    return c.json(toResponse(reservation));
  });
