import { z } from "zod";

export const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  entityType: z
    .enum([
      "transport",
      "document",
      "customer",
      "carrier",
      "location",
      "organization",
      "driver_link",
      "tracking_link",
      "calculation",
    ])
    .optional()
    .describe("Only entries about this kind of record"),
  entityId: z.uuid().optional().describe("Only entries about this record"),
});

export const auditResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      occurredAt: z.iso.datetime(),
      action: z.string().describe("For example transport.status_changed"),
      entityType: z.string().nullable(),
      entityId: z.uuid().nullable(),
      actor: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
      changes: z.unknown().describe("What changed. Never contains secrets or client addresses."),
      requestId: z.string().nullable(),
    }),
  ),
  page: z.object({ limit: z.number().int(), offset: z.number().int(), total: z.number().int() }),
});

export type AuditQuery = z.output<typeof auditQuerySchema>;
export type AuditResponse = z.infer<typeof auditResponseSchema>;
