# Phase 5: Freight calculation and quotes

Goal: costs in, price and margin out, frozen as snapshots (ADR 0007), then quotes that turn into transports. Decisions: markup, margin and contribution are never mixed (CLAUDE.md rule 6). Status: **in progress**.

| ID    | Task                        | Status | Notes                                                                                                                                                       |
| ----- | --------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P5-01 | Money math and engine       | Done   | `packages/shared`: cents and basis points, three pricing views kept apart, rate x quantity lines, deterministic `calculate()`.                              |
| P5-02 | Calculation snapshots + API | Done   | `calculation` table (frozen, RLS), `/v1/calculations`, permissions `calculation:read/manage`.                                                               |
| P5-03 | Calculator page             | Done   | `/calculations`, `/new` with live preview from the same engine, detail view with each line's basis.                                                         |
| P5-04 | Tariffs (versioned)         | Open   | Rate tables per customer or carrier, versions, effective dates; a calculation records the tariff versions it used. Needs the product owner's pricing facts. |
| P5-05 | Quotes and PDF              | Open   | Quote from a calculation, number, validity, accept or reject, convert to a transport.                                                                       |
| P5-06 | Compare variants, duplicate | Open   | Side by side view; duplicate creates a new snapshot.                                                                                                        |
