# ADR 0004: Routing behind interface

Status: Proposed

Routing, geocoding and map tiles sit behind our own interface. Start with a hosted routing API (free tier is enough for a pilot) and MapLibre for display. Self-hosting an open-source router becomes an option once volume justifies the operations cost. Cache results and store provider and version with every route plan.
