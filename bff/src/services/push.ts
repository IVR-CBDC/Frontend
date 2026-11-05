

import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  createSign,
  createHmac,
  randomBytes,
} from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

interface StoredSubscription {
  companyId: string;
  subscription: {
    endpoint: string;
    expirationTime: number | null;
    keys: { p256dh: string; auth: string };
  };
}

const storePath =
  process.env.PUSH_SUBSCRIPTIONS_FILE || "data/push-subscriptions.json";
let mutationQueue: Promise<void> = Promise.resolve();
const b64url = (value: Buffer | string) =>
  Buffer.from(value).toString("base64url");
const fromB64url = (value: string) => Buffer.from(value, "base64url");

function hmac(key: Buffer, value: Buffer | string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function vapidConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

async function readSubscriptions(): Promise<StoredSubscription[]> {
  try {
    return JSON.parse(
      await readFile(storePath, "utf8"),
    ) as StoredSubscription[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeSubscriptions(items: StoredSubscription[]): Promise<void> {
  await mkdir(path.dirname(storePath), { recursive: true });
  const temporary = `${storePath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(items), { mode: 0o600 });
  await rename(temporary, storePath);
}

async function updateSubscriptions(
  update: (items: StoredSubscription[]) => StoredSubscription[],
): Promise<void> {
  const operation = mutationQueue.then(async () => {
    const items = await readSubscriptions();
    await writeSubscriptions(update(items));
  });
  mutationQueue = operation.catch(() => undefined);
  await operation;
}

function vapidToken(endpoint: string): string {
  const config = vapidConfig();
  if (!config) throw new Error("VAPID is not configured");
  const audience = new URL(endpoint).origin;
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = b64url(
    JSON.stringify({
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
      sub: config.subject,
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signature = createSign("SHA256")
    .update(unsigned)
    .sign({
      key: createPrivateKey(config.privateKey),
      dsaEncoding: "ieee-p1363",
    });
  return `${unsigned}.${b64url(signature)}`;
}

function encryptPayload(
  subscription: StoredSubscription["subscription"],
  payload: Buffer,
): Buffer {
  const clientPublicKey = fromB64url(subscription.keys.p256dh);
  const authSecret = fromB64url(subscription.keys.auth);
  if (clientPublicKey.length !== 65 || authSecret.length !== 16)
    throw new Error("Invalid push subscription keys");

  const ecdh = createECDH("prime256v1");
  const serverPublicKey = ecdh.generateKeys();
  const sharedSecret = ecdh.computeSecret(clientPublicKey);
  const authPrk = hmac(authSecret, sharedSecret);
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0"),
    clientPublicKey,
    serverPublicKey,
  ]);
  const inputKeyMaterial = hmac(authPrk, keyInfo);
  const salt = randomBytes(16);
  const prk = hmac(salt, inputKeyMaterial);
  const cek = hmac(
    prk,
    Buffer.concat([
      Buffer.from("Content-Encoding: aes128gcm\0"),
      Buffer.from([1]),
    ]),
  ).subarray(0, 16);
  const nonce = hmac(
    prk,
    Buffer.concat([Buffer.from("Content-Encoding: nonce\0"), Buffer.from([1])]),
  ).subarray(0, 12);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.concat([payload, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header[20] = serverPublicKey.length;
  return Buffer.concat([header, serverPublicKey, ciphertext]);
}

async function sendToSubscription(
  subscription: StoredSubscription["subscription"],
  payload: Buffer,
): Promise<boolean> {
  const config = vapidConfig();
  if (!config) return false;
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${vapidToken(subscription.endpoint)}, k=${config.publicKey}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "normal",
    },
    body: encryptPayload(subscription, payload),
  });
  return response.status !== 404 && response.status !== 410;
}

export function getVapidPublicKey(): string | null {
  return vapidConfig()?.publicKey ?? null;
}

export async function savePushSubscription(
  companyId: string,
  subscription: StoredSubscription["subscription"],
): Promise<void> {
  await updateSubscriptions((items) => [
    ...items.filter(
      (item) => item.subscription.endpoint !== subscription.endpoint,
    ),
    { companyId, subscription },
  ]);
}

export async function removePushSubscription(
  companyId: string,
  endpoint: string,
): Promise<void> {
  await updateSubscriptions((items) =>
    items.filter(
      (item) =>
        item.companyId !== companyId || item.subscription.endpoint !== endpoint,
    ),
  );
}

export async function sendPushToCompany(
  companyId: string,
  data: unknown,
): Promise<void> {
  if (!vapidConfig()) return;
  const items = await readSubscriptions();
  const selected = items.filter((item) => item.companyId === companyId);
  if (!selected.length) return;
  const payload = Buffer.from(JSON.stringify(data));
  const results = await Promise.allSettled(
    selected.map((item) => sendToSubscription(item.subscription, payload)),
  );
  const expired = new Set<string>();
  results.forEach((result, index) => {
    if (result.status === "fulfilled" && !result.value)
      expired.add(selected[index].subscription.endpoint);
  });
  if (expired.size) {
    await updateSubscriptions((current) =>
      current.filter((item) => !expired.has(item.subscription.endpoint)),
    );
  }
}
