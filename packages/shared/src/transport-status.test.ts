import { describe, expect, it } from "vitest";
import {
  canTransition,
  isActiveTransportStatus,
  isFinalTransportStatus,
  isTransportStatus,
  nextTransportStatuses,
  TRANSPORT_STATUS_LABELS,
  TRANSPORT_STATUSES,
  TRANSPORT_TRANSITIONS,
} from "./transport-status.ts";

describe("transport status model", () => {
  it("has a transition entry and a label for every status", () => {
    for (const status of TRANSPORT_STATUSES) {
      expect(TRANSPORT_TRANSITIONS[status], status).toBeDefined();
      expect(TRANSPORT_STATUS_LABELS[status], status).toBeTruthy();
    }
    expect(Object.keys(TRANSPORT_TRANSITIONS).sort()).toEqual([...TRANSPORT_STATUSES].sort());
  });

  it("only leads to statuses that exist and never to itself", () => {
    for (const status of TRANSPORT_STATUSES) {
      for (const next of TRANSPORT_TRANSITIONS[status]) {
        expect(isTransportStatus(next)).toBe(true);
        expect(next).not.toBe(status);
      }
    }
  });

  it("follows the happy path from created to completed", () => {
    const path = [
      "created",
      "planned",
      "assigned",
      "confirmed",
      "loading",
      "in_transit",
      "at_destination",
      "unloading",
      "delivered",
      "completed",
    ] as const;
    for (let index = 0; index < path.length - 1; index++) {
      const from = path[index];
      const to = path[index + 1];
      expect(canTransition(from as never, to as never), `${from} -> ${to}`).toBe(true);
    }
  });

  it("allows skipping optional steps but nothing else", () => {
    expect(canTransition("confirmed", "in_transit")).toBe(true);
    expect(canTransition("in_transit", "delivered")).toBe(true);
    expect(canTransition("created", "assigned")).toBe(false);
    expect(canTransition("planned", "in_transit")).toBe(false);
    expect(canTransition("assigned", "delivered")).toBe(false);
  });

  it("never moves backwards", () => {
    const order = TRANSPORT_STATUSES.filter((status) => status !== "cancelled");
    for (const [index, from] of order.entries()) {
      for (const to of order.slice(0, index)) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(false);
      }
    }
  });

  it("can cancel from every status before delivery, and not afterwards", () => {
    for (const status of [
      "created",
      "planned",
      "assigned",
      "confirmed",
      "loading",
      "in_transit",
      "at_destination",
      "unloading",
    ] as const) {
      expect(canTransition(status, "cancelled"), status).toBe(true);
    }
    for (const status of ["delivered", "completed", "cancelled"] as const) {
      expect(canTransition(status, "cancelled"), status).toBe(false);
    }
  });

  it("treats completed and cancelled as final", () => {
    expect(isFinalTransportStatus("completed")).toBe(true);
    expect(isFinalTransportStatus("cancelled")).toBe(true);
    expect(isFinalTransportStatus("delivered")).toBe(false);
    expect(nextTransportStatuses("completed")).toEqual([]);
  });

  it("counts a transport as active between assignment and delivery", () => {
    expect(isActiveTransportStatus("created")).toBe(false);
    expect(isActiveTransportStatus("planned")).toBe(false);
    expect(isActiveTransportStatus("assigned")).toBe(true);
    expect(isActiveTransportStatus("in_transit")).toBe(true);
    expect(isActiveTransportStatus("delivered")).toBe(false);
    expect(isActiveTransportStatus("cancelled")).toBe(false);
  });

  it("recognizes status keys", () => {
    expect(isTransportStatus("in_transit")).toBe(true);
    expect(isTransportStatus("delayed")).toBe(false);
  });
});
