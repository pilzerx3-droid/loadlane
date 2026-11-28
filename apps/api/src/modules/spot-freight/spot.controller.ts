import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiHeader } from "@nestjs/swagger";
import type { z } from "zod";
import { Public, RequirePermissions } from "../../platform/access.ts";
import { idParamSchema } from "../../platform/directory-http.ts";
import { ApiRoute } from "../../platform/openapi.ts";
import { requireTenant, type TenantRequest } from "../../platform/request-context.ts";
import { ZodPipe } from "../../platform/validation.ts";
import {
  awardSchema,
  carrierBidSchema,
  carrierOfferSchema,
  createTenderSchema,
  createdTenderSchema,
  inviteSchema,
  invitedSchema,
  manualBidSchema,
  tenderDetailSchema,
  tenderListQuerySchema,
  tenderListSchema,
  type CarrierOffer,
  type CreatedTender,
  type TenderDetail,
  type TenderList,
} from "./spot.schemas.ts";
import type { SpotCarrierService } from "./spot-carrier-service.ts";
import type { SpotService } from "./spot-service.ts";
import { SPOT_CARRIER_SERVICE, SPOT_SERVICE } from "./tokens.ts";

function contextOf(request: TenantRequest & { id?: unknown }) {
  const { auth, tenant } = requireTenant(request);
  return {
    organizationId: tenant.organizationId,
    userId: auth.user.id,
    requestId: typeof request.id === "string" ? request.id : undefined,
  };
}

@Controller("v1/spot-tenders")
export class SpotController {
  constructor(@Inject(SPOT_SERVICE) private readonly service: SpotService) {}

  @Get()
  @RequirePermissions("spot:read")
  @ApiRoute({
    summary: "Spot freight offers, newest first",
    response: tenderListSchema,
    query: tenderListQuerySchema,
  })
  list(
    @Req() request: TenantRequest,
    @Query(new ZodPipe(tenderListQuerySchema)) query: z.output<typeof tenderListQuerySchema>,
  ): Promise<TenderList> {
    return this.service.list(contextOf(request), query);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions("spot:manage")
  @ApiRoute({
    summary:
      "Offer a transport to chosen carriers. The response contains one secret link token per carrier, shown once.",
    body: createTenderSchema,
    response: createdTenderSchema,
    status: 201,
  })
  create(
    @Req() request: TenantRequest,
    @Body(new ZodPipe(createTenderSchema)) body: z.output<typeof createTenderSchema>,
  ): Promise<CreatedTender> {
    return this.service.create(contextOf(request), body);
  }

  @Get(":id")
  @RequirePermissions("spot:read")
  @ApiRoute({
    summary: "One offer with its lane, invitations and every bid, cheapest first",
    response: tenderDetailSchema,
  })
  get(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
  ): Promise<TenderDetail> {
    return this.service.get(contextOf(request), id);
  }

  @Post(":id/invitations")
  @HttpCode(201)
  @RequirePermissions("spot:manage")
  @ApiRoute({
    summary: "Invite one more carrier. The link token is in the response only.",
    body: inviteSchema,
    response: invitedSchema,
    status: 201,
  })
  invite(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
    @Body(new ZodPipe(inviteSchema)) body: z.output<typeof inviteSchema>,
  ) {
    return this.service.invite(contextOf(request), id, body.carrierId, body.inviteDays);
  }

  @Post(":id/bids")
  @HttpCode(201)
  @RequirePermissions("spot:manage")
  @ApiRoute({
    summary:
      "Enter a price a carrier gave you by phone or e-mail. It replaces that carrier's earlier bid.",
    body: manualBidSchema,
    response: tenderDetailSchema,
    status: 201,
  })
  enterBid(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
    @Body(new ZodPipe(manualBidSchema)) body: z.output<typeof manualBidSchema>,
  ): Promise<TenderDetail> {
    return this.service.enterBid(
      contextOf(request),
      id,
      body.carrierId,
      body.priceCents,
      body.note,
    );
  }

  @Post(":id/award")
  @HttpCode(200)
  @RequirePermissions("spot:manage")
  @ApiRoute({
    summary:
      "Award a bid. The carrier is set on the transport, which becomes assigned; other bids are rejected. Always your decision.",
    body: awardSchema,
    response: tenderDetailSchema,
  })
  award(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
    @Body(new ZodPipe(awardSchema)) body: z.output<typeof awardSchema>,
  ): Promise<TenderDetail> {
    return this.service.award(contextOf(request), id, body.bidId, body.note);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @RequirePermissions("spot:manage")
  @ApiRoute({
    summary: "Cancel an open offer. Open bids are rejected.",
    response: tenderDetailSchema,
  })
  cancel(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
  ): Promise<TenderDetail> {
    return this.service.cancel(contextOf(request), id);
  }
}

const tokenHeader = ApiHeader({
  name: "X-Spot-Token",
  required: true,
  description:
    "The secret token of an invitation link. It is the only credential; never accepted in a URL.",
});

/** What an invited carrier does through its link. Public in the sense of ADR 0010; the token is checked on every call. */
@Controller("v1/spot")
export class SpotCarrierController {
  constructor(@Inject(SPOT_CARRIER_SERVICE) private readonly service: SpotCarrierService) {}

  @Get("offer")
  @Public()
  @tokenHeader
  @ApiRoute({
    summary:
      "The offer behind the link: lane, windows, deadline and your own bid. Never the customer or other bids.",
    response: carrierOfferSchema,
  })
  offer(@Headers("x-spot-token") token: unknown): Promise<CarrierOffer> {
    return this.service.offer(token);
  }

  @Post("bid")
  @HttpCode(200)
  @Public()
  @tokenHeader
  @ApiRoute({
    summary:
      "Send a price. It replaces your earlier bid. Refused after the deadline or when the offer is closed.",
    body: carrierBidSchema,
    response: carrierOfferSchema,
  })
  bid(
    @Headers("x-spot-token") token: unknown,
    @Body(new ZodPipe(carrierBidSchema)) body: z.output<typeof carrierBidSchema>,
  ): Promise<CarrierOffer> {
    return this.service.submit(token, body.priceCents, body.note);
  }

  @Post("bid/withdraw")
  @HttpCode(200)
  @Public()
  @tokenHeader
  @ApiRoute({ summary: "Withdraw your current bid", response: carrierOfferSchema })
  withdraw(@Headers("x-spot-token") token: unknown): Promise<CarrierOffer> {
    return this.service.withdraw(token);
  }
}
