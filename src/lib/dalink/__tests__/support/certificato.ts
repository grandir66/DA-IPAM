// Certificato autofirmato minimo (X.509 v1, ECDSA P-256) generato in memoria, solo
// per le prove: un DA-Link finto su 127.0.0.1 col TLS vero. Stesso metodo di
// `integrations/__tests__/unifi-api.test.ts`.
import { createHash, generateKeyPairSync, sign, X509Certificate } from "node:crypto";

export function certificatoDiProva(cn: string): { key: string; cert: string; impronta: string } {
  const tlv = (tag: number, content: Buffer): Buffer => {
    const n = content.length;
    let len: Buffer;
    if (n < 0x80) len = Buffer.from([n]);
    else {
      const hex = n.toString(16);
      const b = Buffer.from(hex.length % 2 ? `0${hex}` : hex, "hex");
      len = Buffer.concat([Buffer.from([0x80 | b.length]), b]);
    }
    return Buffer.concat([Buffer.from([tag]), len, content]);
  };
  const seq = (...items: Buffer[]): Buffer => tlv(0x30, Buffer.concat(items));
  const ecdsaSha256 = seq(Buffer.from("06082a8648ce3d040302", "hex"));
  const name = seq(tlv(0x31, seq(Buffer.from("0603550403", "hex"), tlv(0x0c, Buffer.from(cn)))));
  const utc = (d: Date): Buffer => tlv(0x17, Buffer.from(`${d.toISOString().replace(/[-:T]/g, "").slice(2, 14)}Z`));
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const now = Date.now();
  const tbs = seq(
    tlv(0x02, Buffer.from([0x01])),
    ecdsaSha256,
    name,
    seq(utc(new Date(now - 3_600_000)), utc(new Date(now + 3_600_000))),
    name,
    publicKey.export({ type: "spki", format: "der" }),
  );
  const der = seq(tbs, ecdsaSha256, tlv(0x03, Buffer.concat([Buffer.from([0]), sign("sha256", tbs, privateKey)])));
  const b64 = der.toString("base64").match(/.{1,64}/g) ?? [];
  const cert = `-----BEGIN CERTIFICATE-----\n${b64.join("\n")}\n-----END CERTIFICATE-----\n`;
  const spki = new X509Certificate(cert).publicKey.export({ type: "spki", format: "der" });
  return {
    key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    cert,
    // Come la scrive DA-Link nel file dell'istanza (forma di curl, due barre).
    impronta: `sha256//${createHash("sha256").update(spki).digest("base64")}`,
  };
}
