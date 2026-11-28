import { ALERT_CONDITIONS, TRANSPORT_STATUSES } from "@loadlane/shared";
import { z } from "zod";
import { optionalText } from "../../platform/directory-http.ts";

const statusSchema = z.enum(TRANSPORT_STATUSES);
const dateTime = z.iso.datetime({ offset: true });

export const stopInputSchema = z
  .strictObject({
    type: z.enum(["pickup", "delivery"]),
    locationId: z.uuid(),
    windowStart: dateTime.describe("Start of the appointment window (ISO 8601 with offset)"),
    windowEnd: dateTime.describe("End of the appointment window"),
    reference: optionalText(80).describe("Appointment or reference number at the place"),
    notes: optionalText(1000),
  })
  .refine((stop) => new Date(stop.windowEnd) >= new Date(stop.windowStart), {
    path: ["windowEnd"],
    message: "must not be before the window start",
  });

const stopsSchema = z
  .array(stopInputSchema)
  .min(2, "a transport needs at least a pickup and a delivery")
  .max(20)
  .superRefine((stops, context) => {
    if (stops[0]?.type !== "pickup")
      context.addIssue({
        code: "custom",
        path: [0, "type"],
        message: "the first stop must be a pickup",
      });
    if (stops[stops.length - 1]?.type !== "delivery")
      context.addIssue({
        code: "custom",
        path: [stops.length - 1, "type"],
        message: "the last stop must be a delivery",
      });
  });

const positiveNumber = (max: number) => z.number().positive().max(max).multipleOf(0.01);

const transportFields = {
  customerId: z.uuid(),
  carrierId: z.uuid().nullable().optional().describe("Leave empty until a carrier is assigned"),
  customerReference: optionalText(80),
  purchaseOrder: optionalText(80),
  weightLb: positiveNumber(1_000_000).nullable().optional().describe("Total weight in pounds"),
  pieces: z.number().int().positive().max(1_000_000).nullable().optional(),
  notes: optionalText(2000),
  stops: stopsSchema,
};

export const createTransportSchema = z.strictObject({
  ...transportFields,
  quoteId: z
    .uuid()
    .optional()
    .describe(
      "An accepted quote of the same customer that this transport is made from (used once)",
    ),
});

export const updateTransportSchema = z.strictObject({
  ...transportFields,
  customerId: transportFields.customerId.optional(),
  stops: stopsSchema.optional().describe("When given, replaces all stops"),
});

export const changeStatusSchema = z.strictObject({
  status: statusSchema,
  note: optionalText(500).describe("Why, for the history. Recommended when cancelling."),
});

export const transportListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  q: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe("Transport number (LL-123), references, customer or carrier name"),
  status: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(",") : undefined))
    .pipe(z.array(statusSchema).max(TRANSPORT_STATUSES.length).optional())
    .describe("Comma-separated statuses"),
  customerId: z.uuid().optional(),
  carrierId: z.uuid().optional(),
  pickupFrom: dateTime.optional().describe("First pickup window starts at or after this time"),
  pickupTo: dateTime.optional().describe("First pickup window starts before this time"),
});

const place = z.object({
  city: z.string(),
  state: z.string(),
  timezone: z.string().describe("IANA time zone of the place"),
  windowStart: z.iso.datetime(),
});

export const transportListItemSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  reference: z.string().describe("Display number, for example LL-000123"),
  status: statusSchema,
  customer: z.object({ id: z.uuid(), name: z.string() }),
  carrier: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  customerReference: z.string().nullable(),
  purchaseOrder: z.string().nullable(),
  origin: place,
  destination: place,
  createdAt: z.iso.datetime(),
});

export const transportListResponseSchema = z.object({
  items: z.array(transportListItemSchema),
  page: z.object({ limit: z.number().int(), offset: z.number().int(), total: z.number().int() }),
});

export const transportDetailSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  reference: z.string(),
  status: statusSchema,
  allowedStatuses: z.array(statusSchema).describe("Statuses this transport may move to now"),
  editable: z.boolean().describe("Whether fields and stops can still be changed"),
  customer: z.object({ id: z.uuid(), name: z.string() }),
  carrier: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  customerReference: z.string().nullable(),
  purchaseOrder: z.string().nullable(),
  weightLb: z.number().nullable(),
  pieces: z.number().int().nullable(),
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  lastPosition: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      accuracyM: z.number().nullable(),
      lowQuality: z.boolean(),
      recordedAt: z.iso.datetime().describe("When the device took the reading"),
      receivedAt: z.iso.datetime().describe("When Loadlane received it"),
    })
    .nullable()
    .describe("The newest position a driver shared, or null. Never estimated."),
  stops: z.array(
    z.object({
      id: z.uuid(),
      sequence: z.number().int(),
      type: z.enum(["pickup", "delivery"]),
      location: z.object({
        id: z.uuid(),
        name: z.string(),
        addressLine1: z.string(),
        addressLine2: z.string().nullable(),
        city: z.string(),
        state: z.string(),
        postalCode: z.string(),
        timezone: z.string(),
      }),
      windowStart: z.iso.datetime(),
      windowEnd: z.iso.datetime(),
      reference: z.string().nullable(),
      notes: z.string().nullable(),
    }),
  ),
  events: z.array(
    z.object({
      id: z.uuid(),
      occurredAt: z.iso.datetime(),
      source: z.enum(["user", "driver", "integration", "system"]),
      actor: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
      fromStatus: statusSchema.nullable(),
      toStatus: statusSchema,
      note: z.string().nullable(),
    }),
  ),
});

export type CreateTransportInput = z.output<typeof createTransportSchema>;
export type UpdateTransportInput = z.output<typeof updateTransportSchema>;
export type TransportListQuery = z.output<typeof transportListQuerySchema>;
export type TransportDetail = z.infer<typeof transportDetailSchema>;
export type TransportListResponse = z.infer<typeof transportListResponseSchema>;

export const importTransportsSchema = z.strictObject({
  csv: z
    .string()
    .min(1)
    .max(90_000)
    .describe(
      "The CSV text with a header row. Columns: customer, pickup_location, pickup_start, pickup_end, delivery_location, delivery_start, delivery_end; optional: customer_reference, purchase_order, weight_lb, pieces, carrier, notes. At most 200 rows.",
    ),
  dryRun: z
    .boolean()
    .default(true)
    .describe("true checks the file and writes nothing; false imports all rows or none"),
});

export const importReportSchema = z.object({
  status: z.enum(["preview", "imported", "rejected"]),
  fileProblems: z.array(z.string()),
  rows: z.array(z.object({ line: z.number().int(), problems: z.array(z.string()) })),
  summary: z.object({
    total: z.number().int(),
    valid: z.number().int(),
    failed: z.number().int(),
  }),
  created: z.array(z.string()).describe("References of the created transports"),
});

export type ImportTransportsInput = z.output<typeof importTransportsSchema>;

export const transportSummarySchema = z.object({
  total: z.number().int(),
  byStatus: z.record(statusSchema, z.number().int()).describe("Number of transports per status"),
  active: z.number().int().describe("Assigned up to unloading: the freight is moving or about to"),
  open: z.number().int().describe("Created or planned: still needs a carrier or a confirmation"),
  withoutCarrier: z
    .number()
    .int()
    .describe("Not cancelled, not delivered, and no carrier assigned"),
  pickupsNext24Hours: z
    .number()
    .int()
    .describe("Transports not yet loaded whose first pickup window starts within 24 hours"),
  deliveredLast7Days: z.number().int().describe("Transports moved to delivered in the last 7 days"),
  withoutPosition: z
    .number()
    .int()
    .describe("Loading up to unloading, and no driver position received yet"),
});

export type TransportSummary = z.infer<typeof transportSummarySchema>;

export const alertListSchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      reference: z.string(),
      status: statusSchema,
      conditions: z.array(z.enum(ALERT_CONDITIONS)).min(1),
      customerName: z.string(),
      carrierName: z.string().nullable(),
      firstPickupEnd: z.iso.datetime(),
      lastDeliveryEnd: z.iso.datetime(),
      lastPositionAt: z.iso.datetime().nullable(),
    }),
  ),
});
export type TransportAlert = z.infer<typeof alertListSchema>["items"][number];
