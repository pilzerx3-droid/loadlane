# Phase 6: Spot freight

Goal: offer a load to chosen carriers, compare their bids, award, and track the transport in the same place. Decisions: ADR 0019. Status: **done**.

| ID    | Task                 | Status | Notes                                                                                                  |
| ----- | -------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| P6-01 | Tender tables        | Done   | `spot_tender`, `spot_invitation`, `spot_bid` with forced RLS and two-organization tests.               |
| P6-02 | Staff API            | Done   | Create tender from a transport, invite carriers (links shown once), manual bids, award, close, cancel. |
| P6-03 | Carrier link page    | Done   | `/s/[token]`: lane summary, submit and withdraw a bid. Capability link like Driver Link.               |
| P6-04 | Staff pages          | Done   | Spot freight list and detail with bid comparison; action on the transport page.                        |
| P6-05 | Alerts and dashboard | Done   | Open tenders, tenders past their deadline without award, bids received.                                |
