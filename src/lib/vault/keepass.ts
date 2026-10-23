/**
 * «Esporta in KeePass» (piano da-vault 2026-10-23, «DA-IPAM dei clienti»): l'indipendenza del cliente da Domarc,
 * senza tenere vivo un secondo archivio. KeePass è solo un'esportazione, mai l'archivio su cui si lavora.
 *
 * - kdbxweb, KDBX 4 con **Argon2id**; l'implementazione di Argon2 è hash-wasm, collegata con `collegaArgon2()`
 *   (kdbxweb non ne ha una sua). Di serie 64 MiB, 3 passi, 2 corsie.
 * - Il file si apre con la **passphrase del cliente più un key file**. Il key file sta nell'archivio, in un suo slot
 *   (`app/da-ipam/keepass/keyfile` nel backend `locale`, cifrato con la chiave degli slot): resta lo stesso fra
 *   un'esportazione e l'altra, e Domarc lo può riesportare con la sua chiave (`da-vault-recover export-keyfile`).
 * - Prima di esportare si controlla la passphrase sullo slot del cliente: chi esporta deve conoscerla.
 * - Ogni esportazione e ogni scaricamento del key file va nel registro (`vault_visualizzazioni`).
 */
import type Database from "better-sqlite3";
import * as kdbxweb from "kdbxweb";
import { argon2d, argon2id } from "hash-wasm";
import { schemaVaultPresente } from "@/lib/db-tenant";
import { campiVoceDb, type CampoSegreto } from "@/lib/credentials/segreti";
import { apriConPassphrase } from "./archivio";
import { cartellaVault } from "./appliance";
import { LocaleStore, PERCORSO_KEYFILE } from "./locale";
import { registraVisualizzazione, type UtenteSessione } from "./mostra";
import { chiaveDatiAttiva, vaultLocaleAcceso } from "./stato";
import { ErroreVault } from "./tipi";

export { PERCORSO_KEYFILE };
export const ARGON2_DI_SERIE = { memoriaKiB: 64 * 1024, iterazioni: 3, parallelismo: 2 } as const;

type Rifiuto = { ok: false; stato: number; errore: string };
const rifiuto = (stato: number, errore: string): Rifiuto => ({ ok: false, stato, errore });

let collegato = false;

/** Collega hash-wasm come Argon2 di kdbxweb (una volta per processo). Tipo 0 = Argon2d, 2 = Argon2id. */
export function collegaArgon2(): void {
  if (collegato) return;
  kdbxweb.CryptoEngine.setArgon2Impl(async (password, salt, memory, iterations, length, parallelism, type, version) => {
    if (version !== 0x13) throw new Error("Argon2: solo la versione 1.3");
    const f = type === kdbxweb.CryptoEngine.Argon2TypeArgon2id ? argon2id : argon2d;
    const out = await f({
      password: new Uint8Array(password),
      salt: new Uint8Array(salt),
      memorySize: memory,
      iterations,
      hashLength: length,
      parallelism,
      outputType: "binary",
    });
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
  });
  collegato = true;
}

/** Controlli comuni: interruttore, vault aperto, schema, passphrase giusta sullo slot del cliente. */
async function controlla(dbh: Database.Database, passphrase: string): Promise<{ ok: true; chiave: Buffer } | Rifiuto> {
  if (!vaultLocaleAcceso()) return rifiuto(404, "Funzione non attiva su questa installazione");
  const chiave = chiaveDatiAttiva();
  if (!chiave) return rifiuto(423, "Vault bloccato: va sbloccato prima (Impostazioni › Vault)");
  if (!schemaVaultPresente(dbh)) return rifiuto(503, "Lo schema del vault di questo cliente non è aggiornato: vedi il journal del servizio");
  try {
    const dallaPassphrase = await apriConPassphrase(cartellaVault(), passphrase);
    if (!dallaPassphrase.equals(chiave)) return rifiuto(403, "Passphrase del cliente errata");
  } catch (e) {
    if (e instanceof ErroreVault && e.codice === "slot_errato") return rifiuto(403, "Passphrase del cliente errata");
    if (e instanceof ErroreVault && e.codice === "slot_assente") return rifiuto(409, "Lo slot del cliente non c'è: va riscritto (da-vault-recover reset-password)");
    return rifiuto(500, e instanceof ErroreVault ? e.message : "Archivio del vault non leggibile");
  }
  return { ok: true, chiave };
}

/** Il key file dell'archivio; nasce alla prima richiesta (KeePass 2.x, formato XML v2). */
async function keyFileDellArchivio(chiave: Buffer): Promise<Uint8Array> {
  const store = new LocaleStore({ dir: cartellaVault(), chiave: () => chiave });
  try {
    const v = await store.get(PERCORSO_KEYFILE);
    if (v.keyfile) return new Uint8Array(Buffer.from(v.keyfile, "base64"));
  } catch (e) {
    if (!(e instanceof ErroreVault) || e.codice !== "non_trovato") throw e;
  }
  const nuovo = await kdbxweb.Credentials.createRandomKeyFile(2);
  await store.put(PERCORSO_KEYFILE, { keyfile: Buffer.from(nuovo).toString("base64") });
  return nuovo;
}

const CAMPI_IN_PIU: ReadonlyArray<CampoSegreto> = ["private_key", "key_passphrase", "auth_key", "priv_key"];

export async function esportaKeePass(op: {
  dbh: Database.Database;
  utente: UtenteSessione;
  passphrase: string;
  argon2?: { memoriaKiB: number; iterazioni: number; parallelismo: number };
}): Promise<{ ok: true; kdbx: ArrayBuffer; voci: number; saltate: Array<{ nome: string; motivo: string }> } | Rifiuto> {
  const c = await controlla(op.dbh, op.passphrase);
  if (!c.ok) return c;
  collegaArgon2();
  const keyfile = await keyFileDellArchivio(c.chiave);
  const db = kdbxweb.Kdbx.create(new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString(op.passphrase), keyfile), "DA-IPAM");
  db.setVersion(4);
  db.setKdf(kdbxweb.Consts.KdfId.Argon2id);
  const a = op.argon2 ?? ARGON2_DI_SERIE;
  const kdf = db.header.kdfParameters;
  if (!kdf) return rifiuto(500, "Parametri di Argon2 non impostati");
  kdf.set("M", kdbxweb.VarDictionary.ValueType.UInt64, new kdbxweb.Int64(a.memoriaKiB * 1024));
  kdf.set("I", kdbxweb.VarDictionary.ValueType.UInt64, new kdbxweb.Int64(a.iterazioni));
  kdf.set("P", kdbxweb.VarDictionary.ValueType.UInt32, a.parallelismo);

  const gruppo = db.getDefaultGroup();
  const righe = op.dbh
    .prepare("SELECT id, auth_protocol, priv_protocol, security_level FROM credentials ORDER BY name COLLATE NOCASE, id")
    .all() as Array<{ id: number; auth_protocol: string | null; priv_protocol: string | null; security_level: string | null }>;
  let voci = 0;
  const saltate: Array<{ nome: string; motivo: string }> = [];
  for (const r of righe) {
    const e = campiVoceDb(op.dbh, r.id);
    if (!e.ok) {
      saltate.push({ nome: `#${r.id}`, motivo: e.motivo });
      continue;
    }
    const voce = db.createEntry(gruppo);
    voce.fields.set("Title", e.nome);
    voce.fields.set("UserName", e.campi.username ?? "");
    voce.fields.set("Password", kdbxweb.ProtectedValue.fromString(e.campi.password ?? ""));
    const note = [`Tipo: ${e.tipo}`];
    if (e.port !== null) note.push(`porta ${e.port}`);
    if (r.security_level) note.push(`SNMPv3 ${r.security_level}${r.auth_protocol ? ` ${r.auth_protocol}` : ""}${r.priv_protocol ? `/${r.priv_protocol}` : ""}`);
    note.push("esportata da DA-IPAM");
    voce.fields.set("Notes", note.join(" · "));
    for (const k of CAMPI_IN_PIU) {
      const v = e.campi[k];
      if (v) voce.fields.set(k, kdbxweb.ProtectedValue.fromString(v));
    }
    voci += 1;
  }
  const kdbx = await db.save();
  registraVisualizzazione(op.dbh, { utente: op.utente, azione: "esporta_keepass", credentialId: null, credenziale: `${voci} voci` });
  return { ok: true, kdbx, voci, saltate };
}

/** Il key file per aprire le esportazioni (lo stesso per tutte). Vuole la passphrase del cliente. */
export async function esportaKeyFile(op: { dbh: Database.Database; utente: UtenteSessione; passphrase: string }): Promise<{ ok: true; keyfile: Uint8Array } | Rifiuto> {
  const c = await controlla(op.dbh, op.passphrase);
  if (!c.ok) return c;
  const keyfile = await keyFileDellArchivio(c.chiave);
  registraVisualizzazione(op.dbh, { utente: op.utente, azione: "keyfile", credentialId: null, credenziale: null });
  return { ok: true, keyfile };
}
