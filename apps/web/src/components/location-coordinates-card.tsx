import { Button, Card, CardHeader, CardTitle, Input } from "@loadlane/ui";
import { geocodeLocationAction, setCoordinatesAction } from "../app/location-geo-actions";
import { LOCATION_GEO_MESSAGES } from "../lib/location-geo";
import { Notice } from "./notices";

/**
 * Coordinates of one location: looked up from the address by the server's lookup service, or typed
 * by a person. They are never guessed, and they are cleared when the address changes.
 */
export function LocationCoordinatesCard({
  id,
  latitude,
  longitude,
  source,
  geocodedAt,
  notice,
}: {
  id: string;
  latitude: number | null;
  longitude: number | null;
  source: string | null;
  geocodedAt: string | null;
  notice?: string | undefined;
}) {
  const message = notice ? LOCATION_GEO_MESSAGES[notice] : undefined;
  return (
    <Card className="space-y-4 p-5">
      <CardHeader>
        <CardTitle>Map coordinates</CardTitle>
      </CardHeader>
      {message ? <Notice>{message}</Notice> : null}
      {latitude !== null && longitude !== null ? (
        <p className="text-sm">
          <span className="font-mono">
            {latitude.toFixed(5)}, {longitude.toFixed(5)}
          </span>{" "}
          <span className="text-muted-foreground">
            {source === "manual" ? "entered by a person" : "found by address lookup"}
            {geocodedAt ? ` on ${new Date(geocodedAt).toLocaleDateString("en-US")}` : ""}
          </span>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          No coordinates yet, so this place is not shown on the map. Saving a changed address
          removes the old coordinates.
        </p>
      )}
      <form action={geocodeLocationAction.bind(null, id)}>
        <Button type="submit" variant="outline">
          Look up from address
        </Button>
      </form>
      <form action={setCoordinatesAction.bind(null, id)} className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="geo-lat" className="mb-1 block text-[13px] font-semibold">
            Latitude
          </label>
          <Input id="geo-lat" name="latitude" inputMode="decimal" placeholder="32.7767" required />
        </div>
        <div>
          <label htmlFor="geo-lng" className="mb-1 block text-[13px] font-semibold">
            Longitude
          </label>
          <Input
            id="geo-lng"
            name="longitude"
            inputMode="decimal"
            placeholder="-96.7970"
            required
          />
        </div>
        <div className="flex items-end">
          <Button type="submit" variant="outline">
            Save coordinates
          </Button>
        </div>
      </form>
    </Card>
  );
}
