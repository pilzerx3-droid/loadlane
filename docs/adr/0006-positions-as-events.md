# ADR 0006: Positions as events

Status: Proposed

Positions are append-only events (partitioned by month) plus one last-position row per transport. Each carries recorded_at (device), received_at (server), accuracy and source. Staleness is derived from timestamps and configurable thresholds. Positions are never estimated or interpolated without being labeled as such.
