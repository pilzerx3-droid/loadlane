import { z } from "zod";
import { createTransportSchema, transportDetailSchema } from "../transport-orders/index.ts";

export const API_KEY_SCOPES = ["lookup:read", "transport:write"] as const;

export const createKeySchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .describe("Which system this key is for, for example the ERP"),
  scopes: z
    .array(z.enum(API_KEY_SCOPES))
    .min(1)
    .max(API_KEY_SCOPES.length)
    .describe("lookup:read lists master data ids; transport:write creates transports"),
});

export const keySummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  prefix: z.string().describe("The first characters of the key, to recognize it. Not secret."),
  scopes: z.array(z.enum(API_KEY_SCOPES)),
  state: z.enum(["active", "revoked"]),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  createdBy: z.object({ id: z.uuid(), displayName: z.string() }),
});

export const createdKeySchema = keySummarySchema.extend({
  key: z.string().describe("The secret key. Shown once; only a hash is stored."),
});

export const keyListSchema = z.object({ items: z.array(keySummarySchema) });

/** What an external system sends to create a transport. `externalId` makes the call safe to repeat. */
export const inboundTransportSchema = z.strictObject({
  externalId: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe(
      "The id of this shipment in your system. Sending it again never creates a second transport.",
    ),
  transport: createTransportSchema.omit({ quoteId: true }),
});

export const inboundResultSchema = z.object({
  created: z
    .boolean()
    .describe("False when this externalId was already received with the same content"),
  transport: transportDetailSchema,
});

export const lookupQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  q: z.string().trim().min(1).max(100).optional().describe("Part of the name"),
});

export const lookupKindSchema = z.enum(["customers", "carriers", "locations"]);

export const lookupResultSchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      city: z.string().nullable(),
      state: z.string().nullable(),
      timezone: z.string().nullable(),
    }),
  ),
  page: z.object({ limit: z.number().int(), offset: z.number().int(), total: z.number().int() }),
});

export type CreateKeyInput = z.output<typeof createKeySchema>;
export type KeySummary = z.infer<typeof keySummarySchema>;
export type CreatedKey = z.infer<typeof createdKeySchema>;
export type InboundTransportInput = z.output<typeof inboundTransportSchema>;
export type InboundResult = z.infer<typeof inboundResultSchema>;
export type LookupQuery = z.output<typeof lookupQuerySchema>;
export type LookupResult = z.infer<typeof lookupResultSchema>;
