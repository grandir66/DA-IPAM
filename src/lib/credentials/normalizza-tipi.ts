/**
 * Tappa 2c credenziali (T11): i tipi dell'archivio per esteso.
 *
 * Gira dopo la ricostruzione senza CHECK (`migra-credenziali-tipi.ts`), in una
 * transazione, ed è idempotente. Regole:
 * - `linux` → `ssh` (dalla 2c non esistono più voci `linux`);
 * - `snmp` con `security_level` e senza community → `snmp_v3`;
 * - **ibrida** (`snmp` con livello E community): si divide. L'originale resta
 *   `snmp` con lo stesso id e la sola community (binding e catene la usano
 *   così); i campi v3 e l'utente v3 passano a una voce nuova
 *   «<nome> (v3)» di tipo `snmp_v3`, copiati cifrati come sono. Gli usi degli
 *   apparati SNMPv3 (colonne e binding `snmp`) passano alla voce nuova: dalla 2a
 *   la leggevano come v3;
 * - **v3 vecchia** (`snmp` senza livello, con utente e password leggibili,
 *   usata da un apparato SNMPv3): dalla 2a si legge come authNoPriv/MD5 con la
 *   chiave da `encrypted_password`. Se tutti i suoi usi sono di apparati
 *   SNMPv3 si converte sul posto (`snmp_v3`, authNoPriv, MD5, la chiave copiata
 *   cifrata da `encrypted_password`); se ha anche altri usi (apparati v2c,
 *   catene, righe host), dove fa da community, si divide come l'ibrida;
 * - tipo sconosciuto → lasciato com'è ed elencato in `lasciate` (il segno
 *   diventa `parziale:`). Anche una `snmp` con utente e password che un
 *   apparato SNMPv3 usa, ma che non si decifrano, resta com'è e si elenca: non
 *   si indovina se è una v3.
 *
 * Gli usi si contano su tutte le colonne che puntano a `credentials`
 * (`colonneFiglie`): un uso che qui non si riconosce come «apparato SNMPv3»
 * vale come «altro», cioè si divide invece di convertire. È il lato sicuro:
 * l'originale resta com'era per chi non è un apparato SNMPv3.
 *
 * Non importa né `db.ts` né `db-tenant.ts`: riceve l'handle.
 */
import type Database from "better-sqlite3";
import { safeDecrypt } from "@/lib/crypto";
import { colonneFiglie } from "./migra-credenziali-tipi";
import { normalizzaTipo } from "./tipi";

export interface EsitoNormalizza {
  linuxInSsh: number;
  snmpInV3: number;
  /** Ibride divise: id dell'originale (resta `snmp`) e della voce `snmp_v3` nata. */
  ibrideDivise: Array<{ id: number; nuova: number }>;
  /** v3 vecchie convertite sul posto. */
  v3Vecchie: number;
  /** v3 vecchie con altri usi, divise come le ibride. */
  v3VecchieDivise: Array<{ id: number; nuova: number }>;
  /** Colonne e binding di apparati SNMPv3 passati alle voci nuove. */
  usiSpostati: number;
  lasciate: Array<{ id: number; motivo: string }>;
}

type Riga = {
  id: number;
  name: string;
  credential_type: string | null;
  encrypted_username: string | null;
  encrypted_password: string | null;
  encrypted_auth_key: string | null;
  auth_protocol: string | null;
  encrypted_priv_key: string | null;
  priv_protocol: string | null;
  security_level: string | null;
  port: number | null;
};

const pieno = (v: string | null | undefined): v is string => typeof v === "string" && v.trim() !== "";

/** Usi della voce da parte di apparati SNMPv3: le due colonne e i binding `snmp`. */
function usiV3(db: Database.Database, id: number): number {
  return (
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM network_devices WHERE protocol = 'snmp_v3' AND credential_id = ?) +
           (SELECT COUNT(*) FROM network_devices WHERE protocol = 'snmp_v3' AND snmp_credential_id = ?) +
           (SELECT COUNT(*) FROM device_credential_bindings b JOIN network_devices d ON d.id = b.device_id
             WHERE d.protocol = 'snmp_v3' AND b.protocol_type = 'snmp' AND b.credential_id = ?) AS n`
      )
      .get(id, id, id) as { n: number }
  ).n;
}

/** Tutti gli usi della voce, su ogni colonna che punta a `credentials`. */
function usiTotali(db: Database.Database, figlie: Array<{ tabella: string; colonna: string }>, id: number): number {
  let n = 0;
  for (const { tabella, colonna } of figlie) {
    n += (db.prepare(`SELECT COUNT(*) AS n FROM "${tabella}" WHERE "${colonna}" = ?`).get(id) as { n: number }).n;
  }
  return n;
}

/** Sposta sulla voce nuova gli usi degli apparati SNMPv3; restituisce quanti. */
function spostaUsiV3(db: Database.Database, da: number, a: number): number {
  let n = 0;
  n += db.prepare("UPDATE network_devices SET credential_id = ? WHERE protocol = 'snmp_v3' AND credential_id = ?").run(a, da).changes;
  n += db.prepare("UPDATE network_devices SET snmp_credential_id = ? WHERE protocol = 'snmp_v3' AND snmp_credential_id = ?").run(a, da).changes;
  n += db
    .prepare(
      `UPDATE device_credential_bindings SET credential_id = ?
       WHERE credential_id = ? AND protocol_type = 'snmp'
         AND device_id IN (SELECT id FROM network_devices WHERE protocol = 'snmp_v3')`
    )
    .run(a, da).changes;
  return n;
}

function nomeLibero(nomi: Set<string>, base: string, idOriginale: number): string {
  const nome = nomi.has(base) ? `${base} (voce #${idOriginale})` : base;
  nomi.add(nome);
  return nome;
}

/** La voce `snmp_v3` nata da una divisione. */
function creaV3(
  db: Database.Database,
  nome: string,
  v: {
    encrypted_username: string | null;
    encrypted_auth_key: string | null;
    auth_protocol: string | null;
    encrypted_priv_key: string | null;
    priv_protocol: string | null;
    security_level: string;
    port: number | null;
  }
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password, encrypted_auth_key, auth_protocol,
                                  encrypted_priv_key, priv_protocol, security_level, port)
         VALUES (?, 'snmp_v3', ?, NULL, ?, ?, ?, ?, ?, ?)`
      )
      .run(nome, v.encrypted_username, v.encrypted_auth_key, v.auth_protocol, v.encrypted_priv_key, v.priv_protocol, v.security_level, v.port)
      .lastInsertRowid
  );
}

export function normalizzaTipiCredenziali(db: Database.Database): EsitoNormalizza {
  return db.transaction((): EsitoNormalizza => {
    const esito: EsitoNormalizza = { linuxInSsh: 0, snmpInV3: 0, ibrideDivise: [], v3Vecchie: 0, v3VecchieDivise: [], usiSpostati: 0, lasciate: [] };
    const righe = db.prepare("SELECT * FROM credentials ORDER BY id").all() as Riga[];
    const nomi = new Set(righe.map((r) => r.name));
    const figlie = colonneFiglie(db);

    for (const r of righe) {
      const codice = (r.credential_type ?? "").trim().toLowerCase();
      if (codice === "linux") {
        db.prepare("UPDATE credentials SET credential_type = 'ssh', updated_at = datetime('now') WHERE id = ?").run(r.id);
        esito.linuxInSsh++;
        continue;
      }
      if (codice !== "snmp") {
        if (!normalizzaTipo(codice)) esito.lasciate.push({ id: r.id, motivo: `tipo sconosciuto «${r.credential_type ?? ""}»` });
        continue;
      }

      const livello = pieno(r.security_level) ? r.security_level.trim() : null;
      if (livello) {
        if (!pieno(r.encrypted_password)) {
          db.prepare("UPDATE credentials SET credential_type = 'snmp_v3', updated_at = datetime('now') WHERE id = ?").run(r.id);
          esito.snmpInV3++;
          continue;
        }
        // Ibrida: la community resta sull'originale, il v3 va sulla voce nuova.
        const nuova = creaV3(db, nomeLibero(nomi, `${r.name} (v3)`, r.id), {
          encrypted_username: r.encrypted_username,
          encrypted_auth_key: r.encrypted_auth_key,
          auth_protocol: r.auth_protocol,
          encrypted_priv_key: r.encrypted_priv_key,
          priv_protocol: r.priv_protocol,
          security_level: livello,
          port: r.port,
        });
        db.prepare(
          `UPDATE credentials SET encrypted_username = NULL, encrypted_auth_key = NULL, auth_protocol = NULL,
             encrypted_priv_key = NULL, priv_protocol = NULL, security_level = NULL, updated_at = datetime('now')
           WHERE id = ?`
        ).run(r.id);
        esito.usiSpostati += spostaUsiV3(db, r.id, nuova);
        esito.ibrideDivise.push({ id: r.id, nuova });
        continue;
      }

      // snmp senza livello: una community, salvo la v3 vecchia.
      const v3 = usiV3(db, r.id);
      if (v3 === 0 || !pieno(r.encrypted_username) || !pieno(r.encrypted_password)) continue;
      const utente = safeDecrypt(r.encrypted_username);
      const chiave = safeDecrypt(r.encrypted_password);
      if (!utente?.trim() || !chiave?.trim()) {
        esito.lasciate.push({
          id: r.id,
          motivo: "SNMP con utente e password usata da un apparato SNMPv3, ma utente o password non si decifrano: non si sa se è una v3",
        });
        continue;
      }
      if (usiTotali(db, figlie, r.id) === v3) {
        db.prepare(
          `UPDATE credentials SET credential_type = 'snmp_v3', security_level = 'authNoPriv', auth_protocol = 'MD5',
             encrypted_auth_key = encrypted_password, encrypted_password = NULL, updated_at = datetime('now')
           WHERE id = ?`
        ).run(r.id);
        esito.v3Vecchie++;
        continue;
      }
      const nuova = creaV3(db, nomeLibero(nomi, `${r.name} (v3)`, r.id), {
        encrypted_username: r.encrypted_username,
        encrypted_auth_key: r.encrypted_password,
        auth_protocol: "MD5",
        encrypted_priv_key: null,
        priv_protocol: null,
        security_level: "authNoPriv",
        port: r.port,
      });
      db.prepare("UPDATE credentials SET encrypted_username = NULL, updated_at = datetime('now') WHERE id = ?").run(r.id);
      esito.usiSpostati += spostaUsiV3(db, r.id, nuova);
      esito.v3VecchieDivise.push({ id: r.id, nuova });
    }
    return esito;
  })();
}

/** Valore del segno `credenziali_t2_tipi` per un esito: `parziale:` se qualcosa è stato lasciato. */
export function segnoTipi(e: EsitoNormalizza, quando: Date = new Date()): string {
  const stato = e.lasciate.length > 0 ? "parziale" : "done";
  const conteggi = [
    `linux_ssh=${e.linuxInSsh}`,
    `snmp_v3=${e.snmpInV3}`,
    `ibride=${e.ibrideDivise.length}`,
    `v3_vecchie=${e.v3Vecchie}`,
    `v3_vecchie_divise=${e.v3VecchieDivise.length}`,
    `usi_spostati=${e.usiSpostati}`,
    `lasciate=${e.lasciate.length}`,
  ].join(",");
  return `${stato}:${quando.toISOString()}:${conteggi}`;
}

/** Una riga per il journal e per la risposta dell'import: per id, senza nomi. */
export function descriviNormalizza(e: EsitoNormalizza): string {
  const coppie = (xs: Array<{ id: number; nuova: number }>) => (xs.length ? ` [${xs.map((x) => `#${x.id}→#${x.nuova}`).join(", ")}]` : "");
  const lasciate = e.lasciate.length ? ` [${e.lasciate.map((l) => `#${l.id}: ${l.motivo}`).join("; ")}]` : "";
  return (
    `linux → ssh ${e.linuxInSsh}, snmp → snmp_v3 ${e.snmpInV3}, ibride divise ${e.ibrideDivise.length}${coppie(e.ibrideDivise)}, ` +
    `v3 vecchie sul posto ${e.v3Vecchie}, v3 vecchie divise ${e.v3VecchieDivise.length}${coppie(e.v3VecchieDivise)}, ` +
    `usi spostati ${e.usiSpostati}, lasciate ${e.lasciate.length}${lasciate}`
  );
}
