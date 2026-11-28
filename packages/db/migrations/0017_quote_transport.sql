ALTER TABLE "quote" ADD COLUMN "transport_id" uuid;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_transport_org_fk" FOREIGN KEY ("transport_id","organization_id") REFERENCES "public"."transport"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quote_one_per_transport" ON "quote" USING btree ("transport_id") WHERE "quote"."transport_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_transport_only_when_accepted" CHECK ("quote"."transport_id" IS NULL OR "quote"."status" = 'accepted');--> statement-breakpoint

-- Hand-written addition: the link to the transport can be set once (a draft or sent quote has none),
-- and only through this column grant.
GRANT UPDATE (transport_id) ON "quote" TO loadlane_app;
