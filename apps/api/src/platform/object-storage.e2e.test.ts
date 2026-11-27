// Tests the S3 adapter against a real S3-compatible service (the local SeaweedFS from `pnpm infra:up`).
// Skipped when S3_ENDPOINT is not set, for example in CI, which has no storage service. Because of
// that, CI does not prove that uploads reach storage: this file does, on a developer machine.
import { randomUUID } from "node:crypto";
import { DeleteBucketCommand, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnvFileIfPresent } from "../config/env.ts";
import { S3ObjectStorage } from "./object-storage.ts";

loadEnvFileIfPresent();
const endpoint = process.env["S3_ENDPOINT"];
const accessKeyId = process.env["S3_ACCESS_KEY_ID"];
const secretAccessKey = process.env["S3_SECRET_ACCESS_KEY"];
const configured =
  endpoint !== undefined && accessKeyId !== undefined && secretAccessKey !== undefined;

describe.skipIf(!configured)("S3ObjectStorage against a real service", () => {
  const bucket = `loadlane-test-${randomUUID().slice(0, 8)}`;
  const keys: string[] = [];
  let storage: S3ObjectStorage;
  let cleanup: S3Client;

  beforeAll(async () => {
    const settings = {
      endpoint: endpoint ?? "",
      region: process.env["S3_REGION"] ?? "us-east-1",
      accessKeyId: accessKeyId ?? "",
      secretAccessKey: secretAccessKey ?? "",
      bucket,
    };
    storage = new S3ObjectStorage(settings);
    cleanup = new S3Client({
      endpoint: settings.endpoint,
      region: settings.region,
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
      forcePathStyle: true,
    });
    await storage.ensureBucket();
  });

  afterAll(async () => {
    for (const Key of keys) await cleanup.send(new DeleteObjectCommand({ Bucket: bucket, Key }));
    await cleanup.send(new DeleteBucketCommand({ Bucket: bucket }));
    cleanup.destroy();
  });

  it("stores and returns binary data and its content type", async () => {
    const key = `test/${randomUUID()}`;
    keys.push(key);
    const bytes = Buffer.from(Array.from({ length: 5000 }, (_, index) => index % 256));
    await storage.put(key, bytes, "application/pdf");
    const stored = await storage.get(key);
    expect(stored.body.equals(bytes)).toBe(true);
    expect(stored.contentType).toBe("application/pdf");
  });

  it("creating the bucket again is harmless", async () => {
    await expect(storage.ensureBucket()).resolves.toBeUndefined();
  });

  it("fails for a key that does not exist", async () => {
    await expect(storage.get(`test/${randomUUID()}`)).rejects.toThrow();
  });
});
