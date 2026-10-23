/**
 * Dati di prova per le prove della ricifra (correzioni della revisione del 23/10): un cliente con credenziali vere
 * (funzioni di scrittura dell'app, forma vera degli schemi), una voce cancellata (il suo valore resta nelle pagine
 * libere finché non c'è un VACUUM), un segreto di sistema nell'hub e un segreto TOTP (che resta sulla chiave
 * d'installazione). Si usa con `@/lib/__tests__/support/data-dir-isolata` importato PER PRIMO dal file di prova.
 */
import Database from "better-sqlite3";
import { cifraAccesso, decifraConChiave, encrypt } from "@/lib/crypto";
import { getHubDb, createUser } from "@/lib/db-hub";
import { getTenantDb, withTenant } from "@/lib/db-tenant";
import { creaCredenzialeDb } from "@/lib/credentials/archivio";
import { campiVoceDb } from "@/lib/credentials/segreti";
import { createCredential } from "@/lib/credentials-vault";

export const SEGRETI_PROVA = {
  ssh: "Ssh-Pw-correzioni-1a2b",
  community: "community-correzioni-5e6f",
  sistema: "sistema-pw-correzioni-9a0b",
  totp: "JBSWY3DPEHPK3PXP",
};

export interface DatiProva {
  idVoci: number[];
  campiPrima: string;
  /** Valore di una voce cancellata prima della ricifra (cifrato con la chiave d'installazione). */
  cancellato: string;
  totpCifrato: string;
}

export function popola(tenant: string): DatiProva {
  let idVoci: number[] = [];
  let campiPrima = "";
  let cancellato = "";
  withTenant(tenant, () => {
    const d = getTenantDb(tenant);
    idVoci = [
      creaCredenzialeDb(d, { name: "Firewall ssh", credential_type: "ssh", auth_method: "password", encrypted_username: encrypt("admin"), encrypted_password: encrypt(SEGRETI_PROVA.ssh), port: 22 }).id,
      creaCredenzialeDb(d, { name: "Switch v2c", credential_type: "snmp", encrypted_password: encrypt(SEGRETI_PROVA.community) }).id,
    ];
    campiPrima = JSON.stringify(idVoci.map((id) => campiVoceDb(d, id)));
    cancellato = encrypt("password-di-una-voce-cancellata-correzioni");
    const via = creaCredenzialeDb(d, { name: "Vecchio router", credential_type: "ssh", encrypted_username: encrypt("admin"), encrypted_password: cancellato }).id;
    d.prepare("DELETE FROM credentials WHERE id = ?").run(via);
  });
  createCredential({ kind: "librenms", label: "LibreNMS", url: "https://librenms.prova", username: "admin", password: SEGRETI_PROVA.sistema });
  const u = createUser(`admin-totp-${tenant.toLowerCase()}`, "$2b$04$hashfinto", "admin", null);
  const totpCifrato = cifraAccesso(SEGRETI_PROVA.totp);
  getHubDb().prepare("UPDATE users SET totp_richiesta = 1, totp_segreto = ? WHERE id = ?").run(totpCifrato, u.id);
  return { idVoci, campiPrima, cancellato, totpCifrato };
}

const RE_CIFRATO = /(?<![0-9a-f])[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]*/g;

/**
 * I valori che si aprono con la chiave `chiave`, ESATTAMENTE come stanno nelle colonne di un database (non estratti
 * dai byte del file, dove il valore dopo potrebbe allungare la corrispondenza). `escludi`: valori da non contare.
 */
export function valoriDellaChiave(file: string, chiave: Buffer, escludi: string[] = []): string[] {
  const out: string[] = [];
  const db = new Database(file, { readonly: true });
  try {
    const tabelle = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
    for (const { name } of tabelle) {
      for (const r of db.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[]) {
        for (const v of Object.values(r)) {
          if (typeof v !== "string") continue;
          for (const m of v.match(RE_CIFRATO) ?? []) {
            if (escludi.includes(m)) continue;
            try {
              decifraConChiave(chiave, m);
              out.push(m);
            } catch {
              /* non di questa chiave */
            }
          }
        }
      }
    }
  } finally {
    db.close();
  }
  return out;
}
