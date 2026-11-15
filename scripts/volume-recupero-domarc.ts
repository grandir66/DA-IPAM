/**
 * Volume cifrato (P0-3): cifra la chiave di recupero del volume verso la chiave pubblica Domarc (age X25519).
 * La chiave arriva sullo stdin, il file cifrato va dove dice l'argomento. La chiama `scripts/volume-cifrato.sh`.
 *   node --import tsx scripts/volume-recupero-domarc.ts <file di uscita>   (DA_VAULT_CHIAVE_DOMARC nell'ambiente)
 * Per aprirlo serve la chiave privata Domarc: `age -d -i <identità> <file>` dà la chiave da passare a cryptsetup.
 */
import { writeFileSync } from "node:fs";
import { destinatarioValido } from "../src/lib/vault/archivio";

async function main(): Promise<void> {
  const uscita = process.argv[2];
  const destinatario = (process.env.DA_VAULT_CHIAVE_DOMARC ?? "").trim();
  if (!uscita) throw new Error("Uso: volume-recupero-domarc.ts <file di uscita>");
  if (!destinatarioValido(destinatario)) throw new Error("DA_VAULT_CHIAVE_DOMARC manca o non è una chiave age1…");
  const parti: Buffer[] = [];
  for await (const p of process.stdin) parti.push(p as Buffer);
  const chiave = Buffer.concat(parti);
  if (chiave.length < 32) throw new Error("Sullo stdin serve la chiave di recupero");
  const { Encrypter } = await import("age-encryption");
  const e = new Encrypter();
  e.addRecipient(destinatario);
  writeFileSync(uscita, await e.encrypt(chiave), { mode: 0o600, flag: "wx" });
}
main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
