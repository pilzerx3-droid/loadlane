// End-to-end tests of documents on transports: permissions, upload checks by content, download
// headers, soft delete, audit entries and tenant isolation. Storage is in memory here (MOCK); the
// S3 adapter has its own test in platform/object-storage.e2e.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryObjectStorage, type ObjectStorage } from "../platform/object-storage.ts";
import { startTestApi, type TestApi } from "../testing/harness.ts";

const storage = new MemoryObjectStorage();
let api: TestApi;

beforeAll(async () => {
  api = await startTestApi({ storage });
});

afterAll(async () => {
  await api.close();
});

type Json = Record<string, unknown>;

async function body(response: Response): Promise<Json> {
  return (await response.json()) as Json;
}

const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("fake image data"),
]);

interface Workspace {
  as: { token: string; organizationId: string };
  transportId: string;
}

async function workspace(roles = ["admin"]): Promise<Workspace> {
  const person = await api.person("docs");
  const organizationId = await api.seedOrganization({
    creatorUserId: person.id,
    members: [{ userId: person.id, roles: ["admin", ...roles.filter((r) => r !== "admin")] }],
  });
  const as = { token: person.token, organizationId };
  const customer = await body(await api.call("/v1/customers", { ...as, json: { name: "Acme" } }));
  const location = await body(
    await api.call("/v1/locations", {
      ...as,
      json: {
        name: "Dock",
        addressLine1: "1 Main St",
        city: "Dallas",
        state: "TX",
        postalCode: "75001",
        timezone: "America/Chicago",
      },
    }),
  );
  const stop = (type: string) => ({
    type,
    locationId: location["id"],
    windowStart: "2026-12-01T14:00:00-06:00",
    windowEnd: "2026-12-01T16:00:00-06:00",
  });
  const transport = await body(
    await api.call("/v1/transports", {
      ...as,
      json: { customerId: customer["id"], stops: [stop("pickup"), stop("delivery")] },
    }),
  );
  return { as, transportId: String(transport["id"]) };
}

/** A person with only the given role in the same organization as `w`. */
async function memberOf(w: Workspace, role: string) {
  const person = await api.person(role);
  await api.asOwner(
    "INSERT INTO membership (organization_id, user_id, status) VALUES ($1, $2, 'active')",
    [w.as.organizationId, person.id],
  );
  await api.asOwner(
    "INSERT INTO membership_role (organization_id, membership_id, role_key) SELECT organization_id, id, $3 FROM membership WHERE user_id = $1 AND organization_id = $2",
    [person.id, w.as.organizationId, role],
  );
  return { token: person.token, organizationId: w.as.organizationId };
}

function upload(
  as: { token: string; organizationId: string },
  transportId: string,
  file: { name: string; bytes: Buffer; type?: string } | undefined,
  type: string | null = "proof_of_delivery",
): Promise<Response> {
  const form = new FormData();
  if (file) {
    form.set(
      "file",
      new Blob([new Uint8Array(file.bytes)], { type: file.type ?? "application/pdf" }),
      file.name,
    );
  }
  if (type !== null) form.set("type", type);
  return fetch(`${api.baseUrl}/v1/transports/${transportId}/documents`, {
    method: "POST",
    headers: { authorization: `Bearer ${as.token}`, "x-organization-id": as.organizationId },
    body: form,
  });
}

async function uploadPdf(w: Workspace, name = "pod.pdf"): Promise<Json> {
  const response = await upload(w.as, w.transportId, { name, bytes: PDF });
  expect(response.status).toBe(201);
  return body(response);
}

describe("permissions", () => {
  const cases: [role: string, list: number, manage: number][] = [
    ["admin", 200, 201],
    ["dispatcher", 200, 201],
    ["sales", 200, 403],
    ["carrier_user", 403, 403],
  ];
  it.each(cases)("%s: list -> %i, upload -> %i", async (role, list, manage) => {
    const w = await workspace();
    const as = await memberOf(w, role);
    expect((await api.call(`/v1/transports/${w.transportId}/documents`, as)).status).toBe(list);
    expect((await upload(as, w.transportId, { name: "a.pdf", bytes: PDF })).status).toBe(manage);
  });

  it("only lets readers download and managers delete", async () => {
    const w = await workspace();
    const doc = await uploadPdf(w);
    const sales = await memberOf(w, "sales");
    expect((await api.call(`/v1/documents/${String(doc["id"])}/download`, sales)).status).toBe(200);
    const deleted = await api.call(`/v1/documents/${String(doc["id"])}`, {
      ...sales,
      method: "DELETE",
    });
    expect(deleted.status).toBe(403);
    const carrierUser = await memberOf(w, "carrier_user");
    expect(
      (await api.call(`/v1/documents/${String(doc["id"])}/download`, carrierUser)).status,
    ).toBe(403);
  });
});

describe("upload", () => {
  it("stores the file, records its metadata and lists it", async () => {
    const w = await workspace();
    const doc = await uploadPdf(w, "Signed POD.pdf");
    expect(doc).toMatchObject({
      type: "proof_of_delivery",
      filename: "Signed POD.pdf",
      contentType: "application/pdf",
      sizeBytes: PDF.length,
      transportId: w.transportId,
    });
    const key = (
      await api.db.ownerPool.query<{ storage_key: string }>(
        "SELECT storage_key FROM document WHERE id = $1",
        [doc["id"]],
      )
    ).rows[0]?.storage_key;
    expect(key).toBe(`org/${w.as.organizationId}/transport/${w.transportId}/${String(doc["id"])}`);
    expect(storage.objects.get(key ?? "")?.body.equals(PDF)).toBe(true);

    const list = await body(await api.call(`/v1/transports/${w.transportId}/documents`, w.as));
    expect((list["items"] as Json[]).map((item) => item["id"])).toEqual([doc["id"]]);
  });

  it("decides the type from the content, not from the upload", async () => {
    const w = await workspace();
    const response = await upload(w.as, w.transportId, {
      name: "photo.pdf",
      bytes: PNG,
      type: "application/pdf",
    });
    expect(response.status).toBe(201);
    expect(await body(response)).toMatchObject({ contentType: "image/png" });
  });

  it.each([
    [
      "a web page claiming to be a PDF",
      Buffer.from("<html><script>alert(1)</script></html>"),
      "x.pdf",
    ],
    ["an executable", Buffer.from("MZ\x90\x00\x03"), "x.png"],
    ["plain text", Buffer.from("hello"), "x.pdf"],
  ])("rejects %s", async (_name, bytes, name) => {
    const w = await workspace();
    const response = await upload(w.as, w.transportId, { name, bytes, type: "application/pdf" });
    expect(response.status).toBe(400);
    const problem = await body(response);
    expect((problem["errors"] as Json[])[0]).toMatchObject({
      path: "file",
      code: "unsupported_file_type",
    });
    const rows = await api.db.ownerPool.query("SELECT 1 FROM document WHERE transport_id = $1", [
      w.transportId,
    ]);
    expect(rows.rowCount).toBe(0);
  });

  it("cleans the file name", async () => {
    const w = await workspace();
    const a = await upload(w.as, w.transportId, { name: "../../etc/passwd.pdf", bytes: PDF });
    expect((await body(a))["filename"]).toBe("passwd.pdf");
    const b = await upload(w.as, w.transportId, { name: "C:\\Users\\x\\evil<>.pdf", bytes: PDF });
    expect((await body(b))["filename"]).toBe("evil.pdf");
  });

  it("rejects a missing file, a missing or unknown type and an empty file", async () => {
    const w = await workspace();
    expect((await upload(w.as, w.transportId, undefined)).status).toBe(400);
    expect((await upload(w.as, w.transportId, { name: "a.pdf", bytes: PDF }, null)).status).toBe(
      400,
    );
    expect((await upload(w.as, w.transportId, { name: "a.pdf", bytes: PDF }, "cmr")).status).toBe(
      400,
    );
    expect(
      (await upload(w.as, w.transportId, { name: "a.pdf", bytes: Buffer.alloc(0) })).status,
    ).toBe(400);
  });

  it("rejects files over 10 MB", async () => {
    const w = await workspace();
    const big = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]);
    const response = await upload(w.as, w.transportId, { name: "big.pdf", bytes: big });
    expect(response.status).toBe(413);
    expect(await body(response)).toMatchObject({ code: "payload_too_large" });
  });

  it("answers 404 for an unknown transport", async () => {
    const w = await workspace();
    const response = await upload(w.as, "00000000-0000-4000-8000-000000000000", {
      name: "a.pdf",
      bytes: PDF,
    });
    expect(response.status).toBe(404);
  });

  it("leaves no row behind when the storage fails", async () => {
    const failing: ObjectStorage = {
      put: () => Promise.reject(new Error("disk full")),
      get: () => Promise.reject(new Error("unused")),
    };
    const other = await startTestApi({ storage: failing });
    try {
      const person = await other.person("docs");
      const organizationId = await other.seedOrganization({
        creatorUserId: person.id,
        members: [{ userId: person.id, roles: ["admin"] }],
      });
      const as = { token: person.token, organizationId };
      const customer = await body(
        await other.call("/v1/customers", { ...as, json: { name: "Acme" } }),
      );
      const location = await body(
        await other.call("/v1/locations", {
          ...as,
          json: {
            name: "Dock",
            addressLine1: "1 St",
            city: "Dallas",
            state: "TX",
            postalCode: "75001",
            timezone: "America/Chicago",
          },
        }),
      );
      const stop = (type: string) => ({
        type,
        locationId: location["id"],
        windowStart: "2026-12-01T14:00:00-06:00",
        windowEnd: "2026-12-01T16:00:00-06:00",
      });
      const transport = await body(
        await other.call("/v1/transports", {
          ...as,
          json: { customerId: customer["id"], stops: [stop("pickup"), stop("delivery")] },
        }),
      );
      const form = new FormData();
      form.set("file", new Blob([new Uint8Array(PDF)]), "a.pdf");
      form.set("type", "photo");
      const response = await fetch(
        `${other.baseUrl}/v1/transports/${String(transport["id"])}/documents`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${person.token}`, "x-organization-id": organizationId },
          body: form,
        },
      );
      expect(response.status).toBe(500);
      const rows = await other.db.ownerPool.query("SELECT 1 FROM document");
      expect(rows.rowCount).toBe(0);
    } finally {
      await other.close();
    }
  });
});

describe("download", () => {
  it("returns the bytes as an attachment that the browser cannot run", async () => {
    const w = await workspace();
    const doc = await uploadPdf(w, "Delivery receipt.pdf");
    const response = await api.call(`/v1/documents/${String(doc["id"])}/download`, w.as);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).equals(PDF)).toBe(true);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain(
      'attachment; filename="Delivery receipt.pdf"',
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("answers 404 for an unknown id and 400 for a malformed one", async () => {
    const w = await workspace();
    expect(
      (await api.call("/v1/documents/00000000-0000-4000-8000-000000000000/download", w.as)).status,
    ).toBe(404);
    expect((await api.call("/v1/documents/nope/download", w.as)).status).toBe(400);
  });
});

describe("delete", () => {
  it("hides the document, keeps the stored file and refuses further downloads", async () => {
    const w = await workspace();
    const doc = await uploadPdf(w);
    const id = String(doc["id"]);
    const removed = await api.call(`/v1/documents/${id}`, { ...w.as, method: "DELETE" });
    expect(removed.status).toBe(200);
    expect(await body(removed)).toEqual({ id });

    const list = await body(await api.call(`/v1/transports/${w.transportId}/documents`, w.as));
    expect(list["items"]).toEqual([]);
    expect((await api.call(`/v1/documents/${id}/download`, w.as)).status).toBe(404);
    expect((await api.call(`/v1/documents/${id}`, { ...w.as, method: "DELETE" })).status).toBe(404);

    const row = await api.db.ownerPool.query<{ storage_key: string; deleted_at: Date | null }>(
      "SELECT storage_key, deleted_at FROM document WHERE id = $1",
      [id],
    );
    expect(row.rows[0]?.deleted_at).not.toBeNull();
    expect(storage.objects.has(row.rows[0]?.storage_key ?? "")).toBe(true);
  });
});

describe("audit trail", () => {
  it("records upload, download and delete with who did it", async () => {
    const w = await workspace();
    const doc = await uploadPdf(w);
    const id = String(doc["id"]);
    await api.call(`/v1/documents/${id}/download`, w.as);
    await api.call(`/v1/documents/${id}`, { ...w.as, method: "DELETE" });
    const rows = await api.db.ownerPool.query<{
      action: string;
      actor_user_id: string;
      ip: string | null;
    }>(
      "SELECT action, actor_user_id, ip FROM audit_log WHERE entity_id = $1 ORDER BY occurred_at, id",
      [id],
    );
    expect(rows.rows.map((row) => row.action)).toEqual([
      "document.uploaded",
      "document.downloaded",
      "document.deleted",
    ]);
    expect(rows.rows.every((row) => row.ip === null && row.actor_user_id)).toBe(true);
  });
});

describe("tenant isolation", () => {
  it("keeps organization B away from the documents of organization A", async () => {
    const a = await workspace();
    const b = await workspace();
    const doc = await uploadPdf(a);
    const id = String(doc["id"]);

    expect((await api.call(`/v1/transports/${a.transportId}/documents`, b.as)).status).toBe(404);
    expect((await api.call(`/v1/documents/${id}/download`, b.as)).status).toBe(404);
    expect((await api.call(`/v1/documents/${id}`, { ...b.as, method: "DELETE" })).status).toBe(404);
    expect((await upload(b.as, a.transportId, { name: "x.pdf", bytes: PDF })).status).toBe(404);

    const still = await api.call(`/v1/documents/${id}/download`, a.as);
    expect(still.status).toBe(200);
  });
});

describe("without storage", () => {
  it("answers 503 with a stable code and leaves no row", async () => {
    const plain = await startTestApi();
    try {
      const person = await plain.person("docs");
      const organizationId = await plain.seedOrganization({
        creatorUserId: person.id,
        members: [{ userId: person.id, roles: ["admin"] }],
      });
      const as = { token: person.token, organizationId };
      const customer = await body(
        await plain.call("/v1/customers", { ...as, json: { name: "Acme" } }),
      );
      const location = await body(
        await plain.call("/v1/locations", {
          ...as,
          json: {
            name: "Dock",
            addressLine1: "1 St",
            city: "Dallas",
            state: "TX",
            postalCode: "75001",
            timezone: "America/Chicago",
          },
        }),
      );
      const stop = (type: string) => ({
        type,
        locationId: location["id"],
        windowStart: "2026-12-01T14:00:00-06:00",
        windowEnd: "2026-12-01T16:00:00-06:00",
      });
      const transport = await body(
        await plain.call("/v1/transports", {
          ...as,
          json: { customerId: customer["id"], stops: [stop("pickup"), stop("delivery")] },
        }),
      );
      const form = new FormData();
      form.set("file", new Blob([new Uint8Array(PDF)]), "a.pdf");
      form.set("type", "photo");
      const response = await fetch(
        `${plain.baseUrl}/v1/transports/${String(transport["id"])}/documents`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${person.token}`, "x-organization-id": organizationId },
          body: form,
        },
      );
      expect(response.status).toBe(503);
      expect(await body(response)).toMatchObject({ code: "storage_not_configured" });
      expect((await plain.db.ownerPool.query("SELECT 1 FROM document")).rowCount).toBe(0);
    } finally {
      await plain.close();
    }
  });
});
