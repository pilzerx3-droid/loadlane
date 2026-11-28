"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { describeAge, FRESHNESS_LABELS } from "@loadlane/shared";
import { Card } from "@loadlane/ui";
import { mapPoints, type MapData, type MapPoint } from "../lib/map-data";

const COLORS: Record<MapPoint["kind"], string> = {
  pickup: "#2563eb",
  delivery: "#7c3aed",
  position: "#16a34a",
};
const FRESHNESS_COLORS = { fresh: "#16a34a", aging: "#d97706", stale: "#6b7280" } as const;

function markerElement(point: MapPoint): HTMLElement {
  const element = document.createElement("div");
  const color =
    point.kind === "position" && point.freshness
      ? FRESHNESS_COLORS[point.freshness]
      : COLORS[point.kind];
  element.style.cssText = [
    "width:16px",
    "height:16px",
    `background:${color}`,
    "border:2px solid #ffffff",
    "box-shadow:0 0 0 1px rgba(0,0,0,0.35)",
    point.kind === "position" ? "border-radius:50%" : "border-radius:3px",
    point.kind === "position" && point.freshness === "stale" ? "opacity:0.75" : "opacity:1",
  ].join(";");
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", `${point.title}. ${point.detail}`);
  return element;
}

/**
 * The map of open transports. Stops show only when their location has coordinates, and a position
 * shows only when a driver who agreed to share it reported one: its age and freshness are in the
 * popup and the list. Nothing is estimated or simulated.
 */
export function TransportMap({ data, styleUrl }: { data: MapData; styleUrl: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const points = mapPoints(data, describeAge, (freshness) => FRESHNESS_LABELS[freshness]);

  useEffect(() => {
    const target = container.current;
    if (!target || points.length === 0) return;
    let cancelled = false;
    let removeMap: (() => void) | undefined;
    void import("maplibre-gl")
      .then((maplibre) => {
        if (cancelled) return;
        // Served from our own origin by scripts/copy-map-worker.mjs (see there for why).
        maplibre.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
        const map = new maplibre.Map({
          container: target,
          style: styleUrl,
          center: [points[0]?.longitude ?? -98, points[0]?.latitude ?? 39],
          zoom: 4,
          attributionControl: { compact: true },
        });
        map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        map.on("error", (event) => {
          // A tile or style that cannot be loaded must say so instead of leaving a silent blank map.
          if ((event as { error?: { status?: number } }).error?.status !== undefined) {
            setFailed(true);
          }
        });
        const bounds = new maplibre.LngLatBounds();
        for (const point of points) {
          const popup = new maplibre.Popup({ offset: 12, closeButton: true });
          const body = document.createElement("div");
          const title = document.createElement("strong");
          title.textContent = point.title;
          const detail = document.createElement("div");
          detail.textContent = point.detail;
          const link = document.createElement("a");
          link.href = `/transports/${encodeURIComponent(point.transportId)}`;
          link.textContent = "Open transport";
          link.style.textDecoration = "underline";
          body.append(title, detail, link);
          popup.setDOMContent(body);
          new maplibre.Marker({ element: markerElement(point) })
            .setLngLat([point.longitude, point.latitude])
            .setPopup(popup)
            .addTo(map);
          bounds.extend([point.longitude, point.latitude]);
        }
        map.fitBounds(bounds, { padding: 60, maxZoom: 11, duration: 0 });
        removeMap = () => map.remove();
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      removeMap?.();
    };
    // The data is a server snapshot: a new snapshot remounts the component through its key.
  }, []);

  if (points.length === 0) {
    return (
      <Card className="p-5 text-sm text-muted-foreground">
        Nothing to show yet. A stop appears once its location has coordinates (open{" "}
        <a href="/locations" className="underline">
          Locations
        </a>{" "}
        and look up the address), and a position appears once a driver who agreed to share it has
        reported one.
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      <div
        ref={container}
        role="application"
        aria-label="Map of open transports"
        className="h-[560px] w-full overflow-hidden rounded-card border border-border"
      />
      {failed ? (
        <p className="text-sm text-danger">
          The map background could not be loaded. The list below still shows every transport.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Squares are planned stops (blue pickup, violet delivery). Round markers are the last
        position a driver reported: green is live, amber is not recent, grey is outdated. Map data ©
        OpenStreetMap contributors.
      </p>
    </div>
  );
}
