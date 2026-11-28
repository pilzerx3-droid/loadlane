import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req } from "@nestjs/common";
import { z } from "zod";
import { RequirePermissions } from "../../platform/access.ts";
import { idParamSchema } from "../../platform/directory-http.ts";
import { ApiRoute } from "../../platform/openapi.ts";
import { requireTenant, type TenantRequest } from "../../platform/request-context.ts";
import { ZodPipe } from "../../platform/validation.ts";
import type { LocationCoordinates, MapData, MapsService } from "./maps-service.ts";
import { MAPS_SERVICE } from "./tokens.ts";

const coordinatesSchema = z.object({
  locationId: z.uuid(),
  latitude: z.number(),
  longitude: z.number(),
  geocodedAt: z.iso.datetime(),
  source: z.enum(["provider", "manual"]),
  matchedLabel: z.string().nullable(),
});

const manualBodySchema = z.strictObject({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const stopSchema = z.object({
  sequence: z.number().int(),
  type: z.enum(["pickup", "delivery"]),
  locationId: z.uuid(),
  placeName: z.string(),
  city: z.string(),
  state: z.string(),
  windowStart: z.iso.datetime(),
  windowEnd: z.iso.datetime(),
  timezone: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
});

const mapSchema = z.object({
  generatedAt: z.iso.datetime(),
  transports: z.array(
    z.object({
      id: z.uuid(),
      reference: z.string(),
      status: z.string(),
      customerReference: z.string().nullable(),
      stops: z.array(stopSchema),
      lastPosition: z
        .object({
          latitude: z.number(),
          longitude: z.number(),
          recordedAt: z.iso.datetime(),
          ageMs: z.number(),
          freshness: z.enum(["fresh", "aging", "stale"]),
          lowQuality: z.boolean(),
        })
        .nullable(),
      estimatedArrival: z.iso.datetime().nullable(),
    }),
  ),
  locationsWithoutCoordinates: z.array(
    z.object({ id: z.uuid(), name: z.string(), city: z.string(), state: z.string() }),
  ),
});

function contextOf(request: TenantRequest & { id?: unknown }) {
  const { auth, tenant } = requireTenant(request);
  return {
    organizationId: tenant.organizationId,
    userId: auth.user.id,
    requestId: typeof request.id === "string" ? request.id : undefined,
  };
}

@Controller("v1")
export class MapsController {
  constructor(@Inject(MAPS_SERVICE) private readonly service: MapsService) {}

  @Post("locations/:id/geocode")
  @HttpCode(200)
  @RequirePermissions("location:manage")
  @ApiRoute({
    summary:
      "Look up the coordinates of a location's address and store them. A weak match stores nothing.",
    response: coordinatesSchema,
  })
  geocode(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
  ): Promise<LocationCoordinates> {
    return this.service.geocode(contextOf(request), id);
  }

  @Put("locations/:id/coordinates")
  @RequirePermissions("location:manage")
  @ApiRoute({
    summary:
      "Enter the coordinates of a location yourself. They are marked as entered by a person.",
    body: manualBodySchema,
    response: coordinatesSchema,
  })
  setCoordinates(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
    @Body(new ZodPipe(manualBodySchema)) body: z.output<typeof manualBodySchema>,
  ): Promise<LocationCoordinates> {
    return this.service.setManual(contextOf(request), id, body.latitude, body.longitude);
  }

  @Get("map/transports")
  @RequirePermissions("transport:read")
  @ApiRoute({
    summary:
      "Open transports with their stops and the last position a consenting driver reported, with its age. Positions are never estimated.",
    response: mapSchema,
  })
  mapData(@Req() request: TenantRequest): Promise<MapData> {
    return this.service.mapData(contextOf(request));
  }
}
