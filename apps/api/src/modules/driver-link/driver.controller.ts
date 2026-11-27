import { Body, Controller, Get, Headers, HttpCode, Inject, Post } from "@nestjs/common";
import { ApiHeader } from "@nestjs/swagger";
import { CONSENT_TEXT_VERSION, DRIVER_REPORTABLE_STATUSES } from "@loadlane/shared";
import { z } from "zod";
import { Public } from "../../platform/access.ts";
import { ApiRoute } from "../../platform/openapi.ts";
import { ZodPipe } from "../../platform/validation.ts";
import type { DriverAccessService, DriverJob } from "./driver-access-service.ts";
import { DRIVER_ACCESS_SERVICE } from "./tokens.ts";

const TOKEN_HEADER = "x-driver-token";

const jobSchema = z.object({
  reference: z.string(),
  status: z.string(),
  nextStatuses: z.array(z.string()),
  sharing: z.boolean(),
  consent: z
    .object({ acceptedAt: z.iso.datetime(), withdrawnAt: z.iso.datetime().nullable() })
    .nullable(),
  consentTextVersion: z.number().int(),
  stops: z.array(
    z.object({
      sequence: z.number().int(),
      type: z.enum(["pickup", "delivery"]),
      windowStart: z.iso.datetime(),
      windowEnd: z.iso.datetime(),
      reference: z.string().nullable(),
      notes: z.string().nullable(),
      location: z.object({
        name: z.string(),
        addressLine1: z.string(),
        addressLine2: z.string().nullable(),
        city: z.string(),
        state: z.string(),
        postalCode: z.string(),
        timezone: z.string(),
      }),
    }),
  ),
});

const consentBodySchema = z.strictObject({
  textVersion: z.literal(CONSENT_TEXT_VERSION).describe("Version of the consent text shown"),
});
const statusBodySchema = z.strictObject({
  status: z.enum(DRIVER_REPORTABLE_STATUSES),
  note: z.string().trim().max(500).optional(),
});
const positionBodySchema = z.strictObject({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(100_000).nullable().optional(),
  recordedAt: z.iso.datetime({ offset: true }).describe("When the device took the reading"),
});
const acceptedSchema = z.object({ accepted: z.literal(true) });

const tokenHeader = ApiHeader({
  name: "X-Driver-Token",
  required: true,
  description:
    "The secret token of a Driver Link. It is the only credential; it is never accepted in a URL.",
});

/**
 * What a driver does through a Driver Link (ADR 0015). These routes are public in the sense of
 * ADR 0010 (no sign-in); the link token in `X-Driver-Token` is checked by the service on every call.
 */
@Controller("v1/driver")
export class DriverController {
  constructor(@Inject(DRIVER_ACCESS_SERVICE) private readonly service: DriverAccessService) {}

  @Get("job")
  @Public()
  @tokenHeader
  @ApiRoute({
    summary: "The job behind the link: stops, windows, allowed next statuses and sharing state",
    response: jobSchema,
  })
  job(@Headers(TOKEN_HEADER) token: unknown): Promise<DriverJob> {
    return this.service.job(token);
  }

  @Post("consent")
  @HttpCode(200)
  @Public()
  @tokenHeader
  @ApiRoute({
    summary:
      "Record that the driver read the consent text and agrees to share a position. Repeating it changes nothing.",
    response: jobSchema,
  })
  consent(
    @Headers(TOKEN_HEADER) token: unknown,
    @Body(new ZodPipe(consentBodySchema)) body: z.infer<typeof consentBodySchema>,
  ): Promise<DriverJob> {
    return this.service.acceptConsent(token, body.textVersion);
  }

  @Post("consent/withdraw")
  @HttpCode(200)
  @Public()
  @tokenHeader
  @ApiRoute({ summary: "Stop sharing the position", response: jobSchema })
  withdraw(@Headers(TOKEN_HEADER) token: unknown): Promise<DriverJob> {
    return this.service.withdrawConsent(token);
  }

  @Post("status")
  @HttpCode(200)
  @Public()
  @tokenHeader
  @ApiRoute({
    summary: "Report a status. The same transition rules as for dispatchers apply.",
    response: jobSchema,
  })
  status(
    @Headers(TOKEN_HEADER) token: unknown,
    @Body(new ZodPipe(statusBodySchema)) body: z.infer<typeof statusBodySchema>,
  ): Promise<DriverJob> {
    return this.service.reportStatus(token, body.status, body.note ?? null);
  }

  @Post("position")
  @HttpCode(201)
  @Public()
  @tokenHeader
  @ApiRoute({
    summary:
      "Send one position. Refused with `consent_required` unless the driver agreed, and once the transport is finished.",
    response: acceptedSchema,
    status: 201,
  })
  async position(
    @Headers(TOKEN_HEADER) token: unknown,
    @Body(new ZodPipe(positionBodySchema)) body: z.infer<typeof positionBodySchema>,
  ): Promise<{ accepted: true }> {
    await this.service.reportPosition(token, {
      latitude: body.latitude,
      longitude: body.longitude,
      accuracyM: body.accuracyM,
      recordedAt: new Date(body.recordedAt),
    });
    return { accepted: true };
  }
}
