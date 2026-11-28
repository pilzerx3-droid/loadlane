import { createHmac, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  isPrivateAddress,
  newWebhookSecret,
  nextRetryDelayMs,
  parseEncryptionKey,
  postOnce,
  signPayload,
  webhookUrlProblem,
  MAX_ATTEMPTS,
} from "./webhooks.ts";

describe("secrets", () => {
  it("encrypts and decrypts, differently every time, and fails with another key or a changed text", () => {
    const key = randomBytes(32);
    const secret = newWebhookSecret();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{30,}$/);
    const first = encryptSecret(secret, key);
    expect(first).not.toContain(secret);
    expect(encryptSecret(secret, key)).not.toBe(first);
    expect(decryptSecret(first, key)).toBe(secret);
    expect(() => decryptSecret(first, randomBytes(32))).toThrow();
    const parts = first.split(".");
    parts[2] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
  });

  it("accepts only a 32 byte key", () => {
    expect(parseEncryptionKey(undefined)).toBeUndefined();
    expect(parseEncryptionKey(randomBytes(32).toString("base64"))).toHaveLength(32);
    expect(() => parseEncryptionKey("c2hvcnQ=")).toThrow(/32 bytes/);
  });
});

describe("signing", () => {
  it("is HMAC-SHA256 over timestamp, a dot and the raw body", () => {
    const header = signPayload("whsec_x", '{"a":1}', 1_700_000_000);
    const expected = createHmac("sha256", "whsec_x").update('1700000000.{"a":1}').digest("hex");
    expect(header).toBe(`t=1700000000,v1=${expected}`);
    expect(signPayload("whsec_y", '{"a":1}', 1_700_000_000)).not.toBe(header);
  });
});

describe("retry schedule", () => {
  it("backs off and gives up after six attempts", () => {
    expect(MAX_ATTEMPTS).toBe(6);
    expect([1, 2, 3, 4, 5].map(nextRetryDelayMs)).toEqual([
      60_000, 300_000, 1_800_000, 7_200_000, 43_200_000,
    ]);
    expect(nextRetryDelayMs(6)).toBeUndefined();
  });
});

describe("addresses and URLs", () => {
  it("recognizes private, loopback, link-local and mapped addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "not an ip",
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    for (const address of ["8.8.8.8", "172.32.0.1", "93.184.216.34", "2606:4700::1111"]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  it("wants https, no credentials, and http only for local development", () => {
    expect(webhookUrlProblem("https://hooks.example.com/in", false)).toBeUndefined();
    expect(webhookUrlProblem("http://hooks.example.com/in", false)).toBeDefined();
    expect(webhookUrlProblem("http://localhost:9/in", true)).toBeUndefined();
    expect(webhookUrlProblem("https://user:pw@hooks.example.com", false)).toBeDefined();
    expect(webhookUrlProblem("ftp://hooks.example.com", true)).toBeDefined();
    expect(webhookUrlProblem("nonsense", false)).toBeDefined();
  });
});

describe("postOnce", () => {
  let server: Server;
  let base = "";
  const received: { body: string; signature: string | undefined }[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        received.push({
          body: Buffer.concat(chunks).toString(),
          signature: request.headers["x-test"] as string | undefined,
        });
        if (request.url === "/redirect") {
          response.writeHead(302, { location: "http://127.0.0.1:1/elsewhere" });
        } else {
          response.writeHead(request.url === "/fail" ? 500 : 204);
        }
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it("posts the body and reports the status when private targets are allowed", async () => {
    const ok = await postOnce(`${base}/in`, '{"x":1}', { "x-test": "sig" }, { allowPrivate: true });
    expect(ok).toEqual({ statusCode: 204 });
    expect(received.at(-1)).toEqual({ body: '{"x":1}', signature: "sig" });
    expect(await postOnce(`${base}/fail`, "{}", {}, { allowPrivate: true })).toEqual({
      statusCode: 500,
    });
  });

  it("does not follow redirects", async () => {
    expect(await postOnce(`${base}/redirect`, "{}", {}, { allowPrivate: true })).toEqual({
      statusCode: 302,
    });
  });

  it("refuses a private address by default, before anything is sent", async () => {
    const before = received.length;
    expect(await postOnce(`${base}/in`, "{}", {}, { allowPrivate: false })).toEqual({
      error: "blocked_address",
    });
    expect(received.length).toBe(before);
  });

  it("reports an unreachable receiver", async () => {
    expect(await postOnce("http://127.0.0.1:1/in", "{}", {}, { allowPrivate: true })).toEqual({
      error: "connection_failed",
    });
  });
});
