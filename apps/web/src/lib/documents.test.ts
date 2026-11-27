import { describe, expect, it, vi } from "vitest";
import { makeDeps } from "../testing/helpers";
import {
  deleteDocument,
  documentTypeLabel,
  fetchDocument,
  formatBytes,
  uploadDocument,
} from "./documents";

const ORG = "11111111-1111-4111-8111-111111111111";
const TRANSPORT = "22222222-2222-4222-8222-222222222222";
const DOC = "33333333-3333-4333-8333-333333333333";

function respond(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): typeof fetch {
  return vi.fn(() =>
    Promise.resolve(
      new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers }),
    ),
  );
}

async function sessionFor(deps: ReturnType<typeof makeDeps>) {
  return deps.store.createSession(
    {
      accessToken: "access-1",
      accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 300,
      subject: "s",
      activeOrganizationId: ORG,
    },
    60,
  );
}

const pdf = () =>
  new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "pod.pdf", { type: "application/pdf" });

describe("formatting", () => {
  it("shows sizes people can read", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });

  it("names document types and falls back to the key", () => {
    expect(documentTypeLabel("proof_of_delivery")).toBe("Proof of delivery");
    expect(documentTypeLabel("cmr")).toBe("cmr");
    expect(documentTypeLabel("toString")).toBe("toString");
  });
});

describe("uploadDocument", () => {
  it("posts the file and its type as a form to the transport, for the active organization", async () => {
    const deps = makeDeps();
    const sessionId = await sessionFor(deps);
    const fetchFn = respond(201, { id: DOC });
    expect(await uploadDocument(sessionId, TRANSPORT, pdf(), "photo", deps, fetchFn)).toBe("done");
    const [url, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(url).toBe(`http://127.0.0.1:4000/v1/transports/${TRANSPORT}/documents`);
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-organization-id"]).toBe(ORG);
    expect(headers["content-type"]).toBeUndefined();
    const form = init?.body as FormData;
    expect(form.get("type")).toBe("photo");
    expect((form.get("file") as File).name).toBe("pod.pdf");
  });

  it("does not call the API without a file", async () => {
    const deps = makeDeps();
    const sessionId = await sessionFor(deps);
    const fetchFn = respond(201, {});
    expect(await uploadDocument(sessionId, TRANSPORT, undefined, "photo", deps, fetchFn)).toBe(
      "missing",
    );
    expect(
      await uploadDocument(sessionId, TRANSPORT, new File([], "x.pdf"), "photo", deps, fetchFn),
    ).toBe("missing");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    [400, { errors: [{ code: "unsupported_file_type" }] }, "unsupported"],
    [400, { errors: [{ code: "required" }] }, "missing"],
    [413, { code: "payload_too_large" }, "too_large"],
    [503, { code: "storage_not_configured" }, "storage_unavailable"],
    [503, { code: "other" }, "unavailable"],
    [403, {}, "forbidden"],
    [404, {}, "not_found"],
    [401, {}, "signed_out"],
    [500, {}, "unavailable"],
  ])("maps HTTP %i %j to %s", async (status, body, expected) => {
    const deps = makeDeps();
    const sessionId = await sessionFor(deps);
    expect(
      await uploadDocument(sessionId, TRANSPORT, pdf(), "photo", deps, respond(status, body)),
    ).toBe(expected);
  });

  it("is signed out without a session and reports an unreachable API", async () => {
    expect(
      await uploadDocument(undefined, TRANSPORT, pdf(), "photo", makeDeps(), respond(201, {})),
    ).toBe("signed_out");
    const deps = makeDeps();
    const sessionId = await sessionFor(deps);
    const failing = vi.fn(() => Promise.reject(new TypeError("fetch failed")));
    expect(await uploadDocument(sessionId, TRANSPORT, pdf(), "photo", deps, failing)).toBe(
      "unavailable",
    );
  });
});

describe("deleteDocument", () => {
  it("sends DELETE for the document", async () => {
    const deps = makeDeps();
    const sessionId = await sessionFor(deps);
    const fetchFn = respond(200, { id: DOC });
    expect(await deleteDocument(sessionId, DOC, deps, fetchFn)).toBe("done");
    const [url, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(url).toBe(`http://127.0.0.1:4000/v1/documents/${DOC}`);
    expect(init?.method).toBe("DELETE");
  });

  it.each([
    [403, "forbidden"],
    [404, "not_found"],
    [401, "signed_out"],
    [500, "unavailable"],
  ])("maps HTTP %i to %s", async (status, expected) => {
    const deps = makeDeps();
    const sessionId = await sessionFor(deps);
    expect(await deleteDocument(sessionId, DOC, deps, respond(status, {}))).toBe(expected);
  });
});

describe("fetchDocument", () => {
  it("hands back the API's response so the browser gets the file, and never the token", async () => {
    const deps = makeDeps();
    const sessionId = await sessionFor(deps);
    const fetchFn = respond(200, "%PDF", { "content-type": "application/pdf" });
    const result = await fetchDocument(sessionId, DOC, deps, fetchFn);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(await result.response.text()).toBe("%PDF");
      expect(JSON.stringify([...result.response.headers])).not.toContain("access-1");
    }
    const [url, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(url).toBe(`http://127.0.0.1:4000/v1/documents/${DOC}/download`);
    expect((init?.headers as Record<string, string>)["authorization"]).toBe("Bearer access-1");
  });

  it.each([
    [403, "forbidden"],
    [404, "not_found"],
    [400, "not_found"],
    [401, "signed_out"],
    [500, "unavailable"],
  ])("maps HTTP %i to %s", async (status, expected) => {
    const deps = makeDeps();
    const sessionId = await sessionFor(deps);
    const result = await fetchDocument(sessionId, DOC, deps, respond(status, {}));
    expect(result.status).toBe(expected);
  });
});
