import { createPublicKey, generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const jwk = createPublicKey(publicKey).export({ format: "jwk" });
const rawPublicKey = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(jwk.x, "base64url"),
  Buffer.from(jwk.y, "base64url"),
]);
process.stdout.write(`VAPID_PUBLIC_KEY=${rawPublicKey.toString("base64url")}\n`);
process.stdout.write(`VAPID_PRIVATE_KEY=${JSON.stringify(privateKey)}\n`);
process.stdout.write("VAPID_SUBJECT=mailto:admin@example.com\n");
