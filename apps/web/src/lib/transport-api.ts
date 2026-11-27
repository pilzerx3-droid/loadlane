import { TRANSPORT_STATUSES } from "@loadlane/shared";
import { z } from "zod";

// What the web app reads from the transport endpoints of the API (ADR 0014).

const status = z.enum(TRANSPORT_STATUSES);
const place = z.object({
  city: z.string(),
  state: z.string(),
  timezone: z.string(),
  windowStart: z.string(),
});

export const transportListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      number: z.number(),
      reference: z.string(),
      status,
      customer: z.object({ id: z.string(), name: z.string() }),
      carrier: z.object({ id: z.string(), name: z.string() }).nullable(),
      customerReference: z.string().nullable(),
      purchaseOrder: z.string().nullable(),
      origin: place,
      destination: place,
      createdAt: z.string(),
    }),
  ),
  page: z.object({ total: z.number().int() }),
});

export type TransportListItem = z.infer<typeof transportListSchema>["items"][number];

export const transportDetailSchema = z.object({
  id: z.string(),
  number: z.number(),
  reference: z.string(),
  status,
  allowedStatuses: z.array(status),
  editable: z.boolean(),
  customer: z.object({ id: z.string(), name: z.string() }),
  carrier: z.object({ id: z.string(), name: z.string() }).nullable(),
  customerReference: z.string().nullable(),
  purchaseOrder: z.string().nullable(),
  weightLb: z.number().nullable(),
  pieces: z.number().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  stops: z.array(
    z.object({
      id: z.string(),
      sequence: z.number(),
      type: z.enum(["pickup", "delivery"]),
      location: z.object({
        id: z.string(),
        name: z.string(),
        addressLine1: z.string(),
        addressLine2: z.string().nullable(),
        city: z.string(),
        state: z.string(),
        postalCode: z.string(),
        timezone: z.string(),
      }),
      windowStart: z.string(),
      windowEnd: z.string(),
      reference: z.string().nullable(),
      notes: z.string().nullable(),
    }),
  ),
  events: z.array(
    z.object({
      id: z.string(),
      occurredAt: z.string(),
      source: z.enum(["user", "driver", "integration", "system"]),
      actor: z.object({ id: z.string(), displayName: z.string() }).nullable(),
      fromStatus: status.nullable(),
      toStatus: status,
      note: z.string().nullable(),
    }),
  ),
});

export type TransportDetail = z.infer<typeof transportDetailSchema>;

/** Choices for the selects of the transport form. */
export const optionListSchema = z.object({
  items: z.array(z.looseObject({ id: z.string(), name: z.string() })),
});

export const locationOptionListSchema = z.object({
  items: z.array(
    z.looseObject({ id: z.string(), name: z.string(), city: z.string(), state: z.string() }),
  ),
});
