import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { ServiceUnavailableException } from "@nestjs/common";

/** Where uploaded files live. The database keeps only metadata and the key (ADR 0014). */
export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: Buffer; contentType: string }>;
}

export interface S3Settings {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/** S3-compatible storage (SeaweedFS locally, any S3 service in production). */
export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly settings: S3Settings) {
    this.client = new S3Client({
      endpoint: settings.endpoint,
      region: settings.region,
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
      // Local S3 gateways address buckets by path, not by host name.
      forcePathStyle: true,
    });
  }

  /** Creates the bucket when it does not exist. Production buckets are provisioned by whoever runs the service. */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.settings.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.settings.bucket }));
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.settings.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string }> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.settings.bucket, Key: key }),
    );
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Object ${key} has no body`);
    return {
      body: Buffer.from(bytes),
      contentType: result.ContentType ?? "application/octet-stream",
    };
  }
}

/** Used when no storage is configured: every use answers 503 with a stable code. */
export class UnconfiguredObjectStorage implements ObjectStorage {
  put(): Promise<void> {
    return Promise.reject(this.unavailable());
  }
  get(): Promise<{ body: Buffer; contentType: string }> {
    return Promise.reject(this.unavailable());
  }
  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      statusCode: 503,
      code: "storage_not_configured",
      message: "File storage is not configured on this server.",
    });
  }
}

/** In-memory storage for tests only. MOCK: nothing is persisted. */
export class MemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
    return Promise.resolve();
  }

  get(key: string): Promise<{ body: Buffer; contentType: string }> {
    const found = this.objects.get(key);
    return found ? Promise.resolve(found) : Promise.reject(new Error(`No object ${key}`));
  }
}
