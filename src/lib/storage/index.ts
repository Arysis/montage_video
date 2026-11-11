import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";

export type ObjectStream = { body: Readable; size: number; contentRange?: string; status: 200 | 206 };

export interface Storage {
  put(key: string, body: Readable | Buffer, mime: string): Promise<number>;
  get(key: string, range?: { start: number; end?: number }): Promise<ObjectStream>;
  size(key: string): Promise<number>;
  delete(key: string): Promise<void>;
  /** Copie l'objet dans un fichier local (pour FFmpeg). */
  download(key: string, filePath: string): Promise<void>;
  /** URL publique temporaire (pour les plateformes de publication). */
  publicUrl(key: string, expiresSec: number): Promise<string>;
  /** Supprime tous les objets sous un préfixe (suppression de compte). */
  deletePrefix(prefix: string): Promise<void>;
}

function safeKey(key: string): string {
  if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes("..")) throw new Error("Clé de stockage invalide");
  return key;
}

export function signKey(key: string, expires: number): string {
  return createHmac("sha256", env().APP_SECRET).update(`${key}:${expires}`).digest("base64url");
}

export function verifySignedKey(key: string, expires: number, sig: string): boolean {
  if (!Number.isFinite(expires) || expires < Date.now() / 1000) return false;
  const expected = Buffer.from(signKey(key, expires));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export class LocalStorage implements Storage {
  constructor(private root: string) {}

  private file(key: string) {
    return path.resolve(this.root, safeKey(key));
  }

  async put(key: string, body: Readable | Buffer, _mime: string): Promise<number> {
    const file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true });
    await pipeline(Buffer.isBuffer(body) ? Readable.from([body]) : body, createWriteStream(file));
    return (await stat(file)).size;
  }

  async get(key: string, range?: { start: number; end?: number }): Promise<ObjectStream> {
    const file = this.file(key);
    const size = (await stat(file)).size;
    if (range) {
      const end = Math.min(range.end ?? size - 1, size - 1);
      return {
        body: createReadStream(file, { start: range.start, end }),
        size: end - range.start + 1,
        contentRange: `bytes ${range.start}-${end}/${size}`,
        status: 206,
      };
    }
    return { body: createReadStream(file), size, status: 200 };
  }

  async size(key: string) {
    return (await stat(this.file(key))).size;
  }

  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }

  async download(key: string, filePath: string) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await pipeline(createReadStream(this.file(key)), createWriteStream(filePath));
  }

  async publicUrl(key: string, expiresSec: number) {
    const expires = Math.floor(Date.now() / 1000) + expiresSec;
    const sig = signKey(key, expires);
    return `${env().APP_URL}/api/public-files/${key}?e=${expires}&s=${sig}`;
  }

  async deletePrefix(prefix: string) {
    if (!prefix.endsWith("/")) throw new Error("Préfixe invalide");
    await rm(this.file(prefix), { recursive: true, force: true });
  }
}

export class S3Storage implements Storage {
  private client: S3Client;
  constructor(private bucket: string) {
    const e = env();
    this.client = new S3Client({
      region: e.S3_REGION,
      endpoint: e.S3_ENDPOINT,
      forcePathStyle: !!e.S3_ENDPOINT,
      credentials: { accessKeyId: e.S3_ACCESS_KEY_ID!, secretAccessKey: e.S3_SECRET_ACCESS_KEY! },
    });
  }

  async put(key: string, body: Readable | Buffer, mime: string) {
    const upload = new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: safeKey(key), Body: body, ContentType: mime },
    });
    await upload.done();
    return this.size(key);
  }

  async get(key: string, range?: { start: number; end?: number }): Promise<ObjectStream> {
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: safeKey(key),
        Range: range ? `bytes=${range.start}-${range.end ?? ""}` : undefined,
      }),
    );
    return {
      body: res.Body as Readable,
      size: Number(res.ContentLength ?? 0),
      contentRange: res.ContentRange,
      status: range ? 206 : 200,
    };
  }

  async size(key: string) {
    const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }));
    return Number(res.ContentLength ?? 0);
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }));
  }

  async download(key: string, filePath: string) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }));
    await pipeline(res.Body as Readable, createWriteStream(filePath));
  }

  async publicUrl(key: string, expiresSec: number) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }), {
      expiresIn: Math.min(expiresSec, 7 * 24 * 3600),
    });
  }

  async deletePrefix(prefix: string) {
    if (!prefix.endsWith("/")) throw new Error("Préfixe invalide");
    let token: string | undefined;
    do {
      const list = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: safeKey(prefix), ContinuationToken: token }),
      );
      const keys = (list.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (keys.length)
        await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys } }));
      token = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (token);
  }
}

let instance: Storage | undefined;

export function storage(): Storage {
  if (instance) return instance;
  const e = env();
  instance = e.STORAGE_DRIVER === "s3" ? new S3Storage(e.S3_BUCKET!) : new LocalStorage(e.STORAGE_LOCAL_DIR);
  return instance;
}
