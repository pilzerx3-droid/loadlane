ALTER TABLE "location" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "location" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "location" ADD COLUMN "geocoded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "location" ADD COLUMN "geocode_source" text;--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_coordinates_consistent" CHECK (("location"."latitude" IS NULL) = ("location"."longitude" IS NULL)
        AND ("location"."latitude" IS NULL) = ("location"."geocoded_at" IS NULL)
        AND ("location"."latitude" IS NULL) = ("location"."geocode_source" IS NULL));--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_coordinates_range" CHECK ("location"."latitude" BETWEEN -90 AND 90 AND "location"."longitude" BETWEEN -180 AND 180 OR "location"."latitude" IS NULL);--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_geocode_source" CHECK ("location"."geocode_source" IS NULL OR "location"."geocode_source" IN ('provider', 'manual'));
--> statement-breakpoint

-- Hand-written addition (ADR 0021): coordinates describe one address. When the address changes
-- and the same statement does not set new coordinates, the old ones are removed instead of kept wrong.
CREATE FUNCTION location_clear_stale_coordinates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF (NEW.address_line1, NEW.address_line2, NEW.city, NEW.state, NEW.postal_code, NEW.country)
		IS DISTINCT FROM (OLD.address_line1, OLD.address_line2, OLD.city, OLD.state, OLD.postal_code, OLD.country)
		AND NEW.latitude IS NOT DISTINCT FROM OLD.latitude
		AND NEW.longitude IS NOT DISTINCT FROM OLD.longitude THEN
		NEW.latitude := NULL;
		NEW.longitude := NULL;
		NEW.geocoded_at := NULL;
		NEW.geocode_source := NULL;
	END IF;
	RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER location_clear_stale_coordinates BEFORE UPDATE ON "location"
	FOR EACH ROW EXECUTE FUNCTION location_clear_stale_coordinates();