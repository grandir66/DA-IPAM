/**
 * Credenziali di controller e AD nell'archivio (tappa 2f credenziali, T22 del
 * piano `plans/2026-10-15-tappa2-archivio-credenziali.md`).
 *
 * Perché: un controller (`network_controllers`) tiene i segreti nella sua
 * riga (`username` in chiaro, `password_enc`, `api_key_enc`) e un'AD
 * (`ad_integrations`) l'account LDAP (`encrypted_username`,
 * `encrypted_password`). La pagina Credenziali non li vede e la 2g smetterà di
 * leggerli. La 2f li porta in voci d'archivio puntate da `credential_id`.
 * Forme vere misurate il 16/10: H1 un controller `udm` con la chiave e un AD;
 * A un `self_hosted` con utente e password e un AD; il pilota un `udm` con
 * utente locale e password (ADR 0019: un `udm` ha la chiave OPPURE utente e
 * password, e la regola del piano «udm → chiave» non basta più). Rischi
 * coperti:
 *   1. il segreto della voce, decifrato, è quello delle colonne (confronto
 *      «uguale»); un confronto «diverso» annulla tutto (ROLLBACK);
 *   2. come il client di oggi (`validateUnifiOs`): su un `udm` la chiave, se
 *      c'è, vince sulla password;
 *   3. un segreto in chiaro si cifra; le colonne vecchie restano piene (il
 *      ritorno al codice di prima le legge); il WinRM dell'AD non cambia (in A
 *      fa da ripiego per le patch di 161 host);
 *   4. una forma non riconosciuta (Omada, che non si legge ancora; un segreto
 *      che non si decifra; utente senza password) resta com'è, elencata, e il
 *      segno dice `parziale:`;
 *   5. la voce di un controller o l'account LDAP di un AD risultano in uso:
 *      senza, si eliminerebbero (ON DELETE SET NULL) e dopo la 2g il segreto
 *      sarebbe perso;
 *   6. col segno chiuso la conversione non si richiama: un controller spostato
 *      (voce scollegata) non si ricollega da solo a una voce ricreata dalle
 *      colonne ancora piene;
 *   7. la prova a vuoto sulla copia elenca per nome le voci nuove, il
 *      confronto per riga e i lasciati.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/credentials/__tests__/converti-integrazioni.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "@/lib/db-tenant-schema";
import { cartellaTenant, closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb, getHubDb } from "@/lib/db-hub";
import { decrypt, encrypt } from "@/lib/crypto";
import { leggiSegretoDb } from "@/lib/credentials/segreti";
import { eliminaVoceDb } from "@/lib/credentials/archivio";
import { totaleUsi, usiCredenzialeDb, usiTotaliDb } from "@/lib/credentials/usi";
import {
  confrontoIntegrazioni,
  convertiControllerEAd,
  descriviIntegrazioni,
  segnoIntegrazioni,
  type EsitoIntegrazioni,
} from "@/lib/credentials/converti-integrazioni";
import { righeConversioni } from "@/lib/transfer/esito-import";

// ── Appoggio ────────────────────────────────────────────────────────────────

const FORMATO_CIFRATO = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]*$/i;

function nuovoDb(): Database.Database {
  const d = new Database(":memory:");
  d.pragma("foreign_keys = ON");
  d.exec(TENANT_SCHEMA_SQL);
  d.exec(TENANT_INDEXES_SQL);
  return d;
}

function voce(d: Database.Database, nome: string, tipo: string, o: { utente?: string; segreto?: string } = {}): number {
  return Number(
    d
      .prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES (?, ?, ?, ?)")
      .run(nome, tipo, o.utente != null ? encrypt(o.utente) : null, o.segreto != null ? encrypt(o.segreto) : null).lastInsertRowid
  );
}

/** Le colonne come le scrive `service.ts`: utente in chiaro, segreti cifrati (o, per le prove, in chiaro). */
function controller(d: Database.Database, nome: string, kind: string, c: { username?: string; password_enc?: string; api_key_enc?: string; url?: string } = {}): number {
  return Number(
    d
      .prepare(
        `INSERT INTO network_controllers (name, vendor, kind, url, site, username, password_enc, api_key_enc)
         VALUES (?, ?, ?, ?, 'default', ?, ?, ?)`
      )
      .run(nome, kind === "omada" ? "omada" : "unifi", kind, c.url ?? "https://10.0.0.1", c.username ?? "", c.password_enc ?? "", c.api_key_enc ?? "").lastInsertRowid
  );
}

/** Le colonne come le scrive `api/ad/route.ts`: utente e password cifrati (o, per le prove, in chiaro). */
function ad(d: Database.Database, nome: string, c: { utente: string; password: string; winrm?: number | null; dc?: string }): number {
  return Number(
    d
      .prepare(
        `INSERT INTO ad_integrations (name, dc_host, domain, base_dn, encrypted_username, encrypted_password, winrm_credential_id)
         VALUES (?, ?, 'ad.local', 'DC=ad,DC=local', ?, ?, ?)`
      )
      .run(nome, c.dc ?? `dc-${nome}`, c.utente, c.password, c.winrm ?? null).lastInsertRowid
  );
}

type RigaVoce = { id: number; name: string; credential_type: string; auth_method: string | null; encrypted_username: string | null; encrypted_password: string | null; port: number | null };

function voceDi(d: Database.Database, id: number | null): RigaVoce {
  const r = d.prepare("SELECT id, name, credential_type, auth_method, encrypted_username, encrypted_password, port FROM credentials WHERE id = ?").get(id) as RigaVoce | undefined;
  assert.ok(r, `manca la voce #${id}`);
  return r;
}

function rigaController(d: Database.Database, id: number): { credential_id: number | null; username: string; password_enc: string; api_key_enc: string } {
  return d.prepare("SELECT credential_id, username, password_enc, api_key_enc FROM network_controllers WHERE id = ?").get(id) as {
    credential_id: number | null;
    username: string;
    password_enc: string;
    api_key_enc: string;
  };
}

function rigaAd(d: Database.Database, id: number): { credential_id: number | null; encrypted_username: string; encrypted_password: string; winrm_credential_id: number | null } {
  return d.prepare("SELECT credential_id, encrypted_username, encrypted_password, winrm_credential_id FROM ad_integrations WHERE id = ?").get(id) as {
    credential_id: number | null;
    encrypted_username: string;
    encrypted_password: string;
    winrm_credential_id: number | null;
  };
}

function istantanea(d: Database.Database): string {
  return JSON.stringify({
    voci: d.prepare("SELECT * FROM credentials ORDER BY id").all(),
    controller: d.prepare("SELECT * FROM network_controllers ORDER BY id").all(),
    ad: d.prepare("SELECT * FROM ad_integrations ORDER BY id").all(),
  });
}

const vuoto = (): EsitoIntegrazioni => ({ controller: [], ad: [], lasciati: [] });

// ── La conversione ──────────────────────────────────────────────────────────

describe("convertiControllerEAd", () => {
  it("forme vere (H1, A, pilota): udm con chiave, self-hosted e udm con utente e password, AD → voci coi metodi giusti, segreti uguali, colonne piene, WinRM invariato", () => {
    const d = nuovoDb();
    const W = voce(d, "Dominio WinRM", "windows", { utente: "DOM\\svc", segreto: "pw-winrm" });
    const chiaveCifrata = encrypt("chiave-udm-h1");
    const passwordA = encrypt("pw-self-hosted");
    const passwordPilota = encrypt("pw-pilota");
    const H1 = controller(d, "Sede H1", "udm", { api_key_enc: chiaveCifrata });
    const A = controller(d, "Network A", "self_hosted", { username: "admin", password_enc: passwordA });
    const P = controller(d, "Pilota", "udm", { username: "rgadmin", password_enc: passwordPilota });
    const utenteAd = encrypt("DOM\\ldap");
    const passwordAd = encrypt("pw-ldap");
    const D = ad(d, "dominio", { utente: utenteAd, password: passwordAd, winrm: W });

    const e = convertiControllerEAd(d, { aVuoto: false });

    assert.deepEqual(
      e.controller.map((c) => [c.id, c.metodo]),
      [
        [H1, "chiave"],
        [A, "utente"],
        [P, "utente"],
      ]
    );
    assert.deepEqual(e.ad.map((a) => a.id), [D]);
    assert.deepEqual(e.lasciati, []);

    const vH1 = voceDi(d, rigaController(d, H1).credential_id);
    assert.equal(vH1.name, "UniFi · Sede H1");
    assert.equal(vH1.credential_type, "unifi");
    assert.equal(vH1.auth_method, "chiave");
    assert.equal(vH1.encrypted_password, chiaveCifrata, "la chiave è copiata byte per byte");
    assert.equal(vH1.encrypted_username, null);
    assert.equal(vH1.port, null);

    const vA = voceDi(d, rigaController(d, A).credential_id);
    assert.equal(vA.name, "UniFi · Network A");
    assert.equal(vA.credential_type, "unifi");
    assert.equal(vA.auth_method, "utente");
    assert.equal(vA.encrypted_password, passwordA);
    assert.equal(decrypt(vA.encrypted_username as string), "admin");

    const vP = voceDi(d, rigaController(d, P).credential_id);
    assert.equal(vP.name, "UniFi · Pilota");
    assert.equal(vP.auth_method, "utente", "un udm con utente locale e password è una voce UniFi a utente (ADR 0019)");
    assert.equal(decrypt(vP.encrypted_username as string), "rgadmin");

    const vD = voceDi(d, rigaAd(d, D).credential_id);
    assert.equal(vD.name, "AD · dominio");
    assert.equal(vD.credential_type, "ad");
    assert.equal(vD.encrypted_username, utenteAd, "utente copiato byte per byte");
    assert.equal(vD.encrypted_password, passwordAd, "password copiata byte per byte");

    // Il segreto letto dalla voce è quello delle colonne.
    const sH1 = leggiSegretoDb(d, vH1.id, "controller_unifi");
    assert.ok(sH1.ok);
    assert.deepEqual(sH1.segreto, { forma: "chiave_api", chiave: "chiave-udm-h1" });
    const sP = leggiSegretoDb(d, vP.id, "controller_unifi");
    assert.ok(sP.ok);
    assert.deepEqual(sP.segreto, { forma: "utente", username: "rgadmin", password: "pw-pilota" });
    const sD = leggiSegretoDb(d, vD.id, "ldap");
    assert.ok(sD.ok);
    assert.deepEqual(sD.segreto, { forma: "utente", username: "DOM\\ldap", password: "pw-ldap" });
    assert.deepEqual(
      confrontoIntegrazioni(d).map((c) => [c.tabella, c.id, c.esito]),
      [
        ["network_controllers", H1, "uguale"],
        ["network_controllers", A, "uguale"],
        ["network_controllers", P, "uguale"],
        ["ad_integrations", D, "uguale"],
      ]
    );

    // Le colonne vecchie restano piene fino alla 2g; il WinRM dell'AD non cambia.
    assert.equal(rigaController(d, H1).api_key_enc, chiaveCifrata);
    assert.equal(rigaController(d, A).password_enc, passwordA);
    assert.equal(rigaController(d, A).username, "admin");
    assert.equal(rigaAd(d, D).encrypted_password, passwordAd);
    assert.equal(rigaAd(d, D).winrm_credential_id, W);
    assert.equal((d.prepare("SELECT COUNT(*) AS n FROM credentials").get() as { n: number }).n, 5);

    // Idempotente: le righe hanno la voce, la seconda chiamata non fa niente.
    const dopo = istantanea(d);
    const e2 = convertiControllerEAd(d, { aVuoto: false });
    assert.deepEqual(e2, vuoto());
    assert.equal(istantanea(d), dopo);
  });

  it("udm con la chiave e una password rimasta: vince la chiave, come il client di oggi", () => {
    const d = nuovoDb();
    const C = controller(d, "Console", "udm", { username: "vecchio", password_enc: encrypt("pw-vecchia"), api_key_enc: encrypt("chiave-buona") });
    const e = convertiControllerEAd(d, { aVuoto: false });
    assert.deepEqual(e.controller.map((c) => c.metodo), ["chiave"]);
    const s = leggiSegretoDb(d, rigaController(d, C).credential_id as number, "controller_unifi");
    assert.ok(s.ok);
    assert.deepEqual(s.segreto, { forma: "chiave_api", chiave: "chiave-buona" });
  });

  it("un segreto in chiaro viene cifrato nella voce", () => {
    const d = nuovoDb();
    const C = controller(d, "Self", "self_hosted", { username: "admin", password_enc: "pw-in-chiaro" });
    const K = controller(d, "Console", "udm", { api_key_enc: "chiave-in-chiaro" });
    const D = ad(d, "dominio", { utente: "DOM\\in-chiaro", password: encrypt("pw-ldap") });

    convertiControllerEAd(d, { aVuoto: false });

    const vC = voceDi(d, rigaController(d, C).credential_id);
    assert.match(vC.encrypted_password as string, FORMATO_CIFRATO);
    assert.equal(decrypt(vC.encrypted_password as string), "pw-in-chiaro");
    const vK = voceDi(d, rigaController(d, K).credential_id);
    assert.match(vK.encrypted_password as string, FORMATO_CIFRATO);
    assert.equal(decrypt(vK.encrypted_password as string), "chiave-in-chiaro");
    const vD = voceDi(d, rigaAd(d, D).credential_id);
    assert.match(vD.encrypted_username as string, FORMATO_CIFRATO);
    assert.equal(decrypt(vD.encrypted_username as string), "DOM\\in-chiaro");
    assert.ok(confrontoIntegrazioni(d).every((c) => c.esito === "uguale"));
  });

  it("un confronto «diverso» (la voce scritta non ridà il segreto delle colonne) → errore, ROLLBACK: nessuna voce, nessun collegamento", () => {
    const d = nuovoDb();
    controller(d, "Sede", "udm", { api_key_enc: encrypt("chiave-vera") });
    ad(d, "dominio", { utente: encrypt("DOM\\ldap"), password: encrypt("pw-ldap") });
    // Un guasto simulato: ogni voce nuova si ritrova un altro segreto.
    d.exec(`CREATE TRIGGER guasta_voce AFTER INSERT ON credentials BEGIN
              UPDATE credentials SET encrypted_password = '${encrypt("un-altro-segreto")}' WHERE id = NEW.id;
            END`);
    const prima = istantanea(d);

    let messaggio = "";
    assert.throws(
      () => convertiControllerEAd(d, { aVuoto: false }),
      (e: unknown) => {
        messaggio = e instanceof Error ? e.message : String(e);
        return /diverso/.test(messaggio);
      }
    );
    assert.equal(istantanea(d), prima, "il confronto diverso non ha annullato tutto");
    assert.doesNotMatch(messaggio, /chiave-vera|un-altro-segreto|pw-ldap/, "il messaggio non dice i segreti");
  });

  it("forme non riconosciute → lasciate com'erano, col motivo; il resto si converte; segno parziale:", () => {
    const d = nuovoDb();
    const buono = controller(d, "Buono", "udm", { api_key_enc: encrypt("chiave") });
    const senzaUtente = controller(d, "Senza utente", "udm", { password_enc: encrypt("pw") });
    const omada = controller(d, "Omada", "omada", { username: "client-id", api_key_enc: encrypt("secret") });
    const rotta = controller(d, "Rotta", "self_hosted", { username: "admin", password_enc: "00ff:00ff:00ff" });
    const selfConChiave = controller(d, "Self con chiave", "self_hosted", { api_key_enc: encrypt("chiave") });
    const adVuoto = ad(d, "vuoto", { utente: encrypt("DOM\\ldap"), password: encrypt("   ") });
    const prima = { senzaUtente: rigaController(d, senzaUtente), omada: rigaController(d, omada), adVuoto: rigaAd(d, adVuoto) };

    const e = convertiControllerEAd(d, { aVuoto: false });

    assert.deepEqual(e.controller.map((c) => c.id), [buono]);
    assert.deepEqual(
      e.lasciati.map((l) => [l.tabella, l.id]),
      [
        ["network_controllers", senzaUtente],
        ["network_controllers", omada],
        ["network_controllers", rotta],
        ["network_controllers", selfConChiave],
        ["ad_integrations", adVuoto],
      ]
    );
    for (const l of e.lasciati) assert.ok(l.motivo.trim().length > 10, `motivo vuoto per #${l.id}`);
    assert.match(e.lasciati[1].motivo, /Omada/);
    assert.match(e.lasciati[2].motivo, /non si decifra/);
    assert.deepEqual(rigaController(d, senzaUtente), prima.senzaUtente);
    assert.deepEqual(rigaController(d, omada), prima.omada);
    assert.deepEqual(rigaAd(d, adVuoto), prima.adVuoto);
    assert.match(segnoIntegrazioni(e), /^parziale:.*lasciati=5/);
  });

  it("una riga senza segreti non è un lasciato: non c'è niente da portare", () => {
    const d = nuovoDb();
    controller(d, "Spento", "udm", {});
    const e = convertiControllerEAd(d, { aVuoto: false });
    assert.deepEqual(e, vuoto());
    assert.match(segnoIntegrazioni(e), /^done:/);
  });

  it("un nome già nell'archivio → « (controller #id)» / « (AD #id)»", () => {
    const d = nuovoDb();
    voce(d, "UniFi · Sede", "unifi", { segreto: "altra" });
    voce(d, "AD · dominio", "ad", { utente: "x", segreto: "y" });
    const C = controller(d, "Sede", "udm", { api_key_enc: encrypt("k") });
    const D = ad(d, "dominio", { utente: encrypt("u"), password: encrypt("p") });
    convertiControllerEAd(d, { aVuoto: false });
    assert.equal(voceDi(d, rigaController(d, C).credential_id).name, `UniFi · Sede (controller #${C})`);
    assert.equal(voceDi(d, rigaAd(d, D).credential_id).name, `AD · dominio (AD #${D})`);
  });

  it("a vuoto: lo stesso esito, niente scritto", () => {
    const prepara = (d: Database.Database): void => {
      controller(d, "Sede", "udm", { api_key_enc: encrypt("k") });
      controller(d, "Self", "self_hosted", { username: "admin", password_enc: encrypt("p") });
      controller(d, "Omada", "omada", { username: "c", api_key_enc: encrypt("s") });
      ad(d, "dominio", { utente: encrypt("u"), password: encrypt("p") });
    };
    const d1 = nuovoDb();
    prepara(d1);
    const prima = istantanea(d1);
    const aVuoto = convertiControllerEAd(d1, { aVuoto: true });
    assert.equal(istantanea(d1), prima, "a vuoto non scrive");
    const d2 = nuovoDb();
    prepara(d2);
    const vero = convertiControllerEAd(d2, { aVuoto: false });
    assert.deepEqual(aVuoto, vero);
    assert.equal(vero.controller.length, 2);
    assert.equal(vero.ad.length, 1);
  });

  it("una ENCRYPTION_KEY che non decifra nessun segreto → errore, niente scritto (si riprova)", () => {
    const d = nuovoDb();
    controller(d, "Sede", "udm", { api_key_enc: encrypt("k") });
    ad(d, "dominio", { utente: encrypt("u"), password: encrypt("p") });
    const prima = istantanea(d);
    const chiave = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = "un-altra-chiave-che-non-decifra";
    try {
      assert.throws(() => convertiControllerEAd(d, { aVuoto: false }), /ENCRYPTION_KEY/);
    } finally {
      process.env.ENCRYPTION_KEY = chiave;
    }
    assert.equal(istantanea(d), prima);
  });
});

// ── Gli usi delle voci nuove (D8 = (a)) ─────────────────────────────────────

describe("usi: la voce di un controller e l'account LDAP di un AD sono in uso", () => {
  it("DELETE della voce di un controller → 409 con il controller elencato; lo stesso per la voce LDAP di un AD; i totali coincidono", () => {
    const d = nuovoDb();
    const W = voce(d, "WinRM", "windows", { utente: "u", segreto: "p" });
    const C = controller(d, "Sede", "udm", { api_key_enc: encrypt("k") });
    const D = ad(d, "dominio", { utente: encrypt("u"), password: encrypt("p"), winrm: W });
    convertiControllerEAd(d, { aVuoto: false });
    const vC = rigaController(d, C).credential_id as number;
    const vD = rigaAd(d, D).credential_id as number;

    const eC = eliminaVoceDb(d, vC);
    assert.ok(!eC.ok);
    assert.equal(eC.stato, 409);
    assert.deepEqual(eC.usi?.controller, [{ id: C, nome: "Sede" }]);
    assert.match(eC.errore, /controller \(«Sede»\)/);

    const eD = eliminaVoceDb(d, vD);
    assert.ok(!eD.ok);
    assert.equal(eD.stato, 409);
    assert.deepEqual(eD.usi?.ad, [{ id: D, nome: "dominio", come: "ldap" }]);
    assert.match(eD.errore, /Active Directory «dominio» \(account LDAP\)/);

    // La voce WinRM dell'AD resta in uso come prima.
    assert.deepEqual(usiCredenzialeDb(d, W).ad, [{ id: D, nome: "dominio", come: "winrm" }]);

    const totali = usiTotaliDb(d);
    for (const v of [vC, vD, W]) assert.equal(totali.get(v) ?? 0, totaleUsi(usiCredenzialeDb(d, v)), `voce #${v}`);
    assert.equal(totali.get(vC), 1);
    assert.equal(totali.get(vD), 1);
    assert.ok(voceDi(d, vC));
    assert.ok(voceDi(d, vD));
  });
});

// ── Segno e journal ─────────────────────────────────────────────────────────

describe("segnoIntegrazioni e descriviIntegrazioni", () => {
  const e: EsitoIntegrazioni = {
    controller: [
      { id: 1, voce: 12, metodo: "chiave" },
      { id: 2, voce: 13, metodo: "utente" },
    ],
    ad: [{ id: 1, voce: 14 }],
    lasciati: [],
  };
  it("done: coi conteggi; parziale: con un lasciato", () => {
    assert.equal(segnoIntegrazioni(e, new Date("2026-10-16T10:00:00.000Z")), "done:2026-10-16T10:00:00.000Z:controller=2,chiave=1,utente=1,ad=1,lasciati=0");
    assert.match(segnoIntegrazioni({ ...e, lasciati: [{ tabella: "network_controllers", id: 3, motivo: "x" }] }), /^parziale:/);
  });
  it("la riga del journal dice id, metodo, confronto e motivi, mai nomi o segreti", () => {
    const riga = descriviIntegrazioni({ ...e, lasciati: [{ tabella: "ad_integrations", id: 4, motivo: "account LDAP senza utente o senza password" }] });
    assert.match(riga, /controller #1 → voce #12 \(chiave, uguale\)/);
    assert.match(riga, /AD #1 → voce #14 \(uguale\)/);
    assert.match(riga, /AD #4: account LDAP senza utente o senza password/);
  });
});

describe("righeConversioni: il nome della conversione di controller e AD", () => {
  it("si legge in italiano, non la chiave", () => {
    const [r] = righeConversioni({ credenziali_t2_integrazioni: { segno: "done:2026-10-16T10:00:00.000Z:controller=1,ad=1", dettaglio: "x" } });
    assert.equal(r.testo, "Account di controller e Active Directory convertiti: x");
  });
});

// ── All'apertura del tenant ─────────────────────────────────────────────────

/** Le definizioni di prima della 2f (senza `credential_id`), come in un DB che non ha ancora visto la 2f. */
const CONTROLLER_PRIMA_2F = `CREATE TABLE network_controllers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  vendor TEXT NOT NULL,
  kind TEXT NOT NULL,
  url TEXT NOT NULL,
  site TEXT NOT NULL DEFAULT 'default',
  username TEXT NOT NULL DEFAULT '',
  password_enc TEXT NOT NULL DEFAULT '',
  api_key_enc TEXT NOT NULL DEFAULT '',
  cert_pin TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  last_ok INTEGER,
  last_message TEXT,
  last_devices INTEGER,
  last_ports INTEGER,
  last_neighbors INTEGER,
  origin TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const AD_PRIMA_2F = `CREATE TABLE ad_integrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  dc_host TEXT NOT NULL,
  domain TEXT NOT NULL,
  base_dn TEXT NOT NULL,
  encrypted_username TEXT NOT NULL,
  encrypted_password TEXT NOT NULL,
  use_ssl INTEGER NOT NULL DEFAULT 1,
  port INTEGER NOT NULL DEFAULT 636,
  enabled INTEGER NOT NULL DEFAULT 1,
  winrm_credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
  dhcp_leases_count INTEGER DEFAULT 0,
  last_sync_at TEXT,
  last_sync_status TEXT,
  computers_count INTEGER DEFAULT 0,
  users_count INTEGER DEFAULT 0,
  groups_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(dc_host, domain)
)`;

function segno(d: Database.Database): string | null {
  const r = d.prepare("SELECT value FROM tenant_settings WHERE key = 'credenziali_t2_integrazioni'").get() as { value: string } | undefined;
  return r?.value ?? null;
}

function riapri(code: string): Database.Database {
  closeTenantDb(code);
  return withTenant(code, () => getTenantDb(code));
}

describe("getTenantDb: colonne e conversione di controller e AD col segno credenziali_t2_integrazioni", () => {
  const CODE = "TESTINTEGRAZIONI2F";
  after(() => deleteTenantDatabase(CODE));

  it("prima apertura dopo la 2f: credential_id nasce, le voci pure; il controller si sposta senza voce; alla seconda apertura nessuna voce ricreata dalle colonne", () => {
    fs.mkdirSync(cartellaTenant(), { recursive: true });
    const f = new Database(path.join(cartellaTenant(), `${CODE}.db`));
    f.exec(CONTROLLER_PRIMA_2F);
    f.exec(AD_PRIMA_2F);
    // Il resto dello schema di oggi: le due tabelle ci sono già e restano senza credential_id.
    f.exec(TENANT_SCHEMA_SQL);
    f.prepare("INSERT INTO network_controllers (name, vendor, kind, url, api_key_enc) VALUES ('Sede', 'unifi', 'udm', 'https://10.0.0.1', ?)").run(encrypt("chiave-2f"));
    f.prepare(
      "INSERT INTO ad_integrations (name, dc_host, domain, base_dn, encrypted_username, encrypted_password) VALUES ('dominio', 'dc1', 'ad.local', 'DC=ad', ?, ?)"
    ).run(encrypt("DOM\\ldap"), encrypt("pw-ldap"));
    f.close();

    let d = withTenant(CODE, () => getTenantDb(CODE));
    for (const t of ["network_controllers", "ad_integrations"]) {
      const colonne = (d.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);
      assert.ok(colonne.includes("credential_id"), `${t}.credential_id non aggiunta`);
    }
    assert.match(segno(d) ?? "", /^done:.*controller=1,chiave=1,utente=0,ad=1,lasciati=0/);
    const c = d.prepare("SELECT id, credential_id FROM network_controllers").get() as { id: number; credential_id: number | null };
    const a = d.prepare("SELECT id, credential_id FROM ad_integrations").get() as { id: number; credential_id: number | null };
    assert.equal(voceDi(d, c.credential_id).name, "UniFi · Sede");
    assert.equal(voceDi(d, a.credential_id).name, "AD · dominio");
    const voci = (d.prepare("SELECT COUNT(*) AS n FROM credentials").get() as { n: number }).n;

    // Il controller si sposta su un altro indirizzo e l'AD su un altro DC
    // senza scegliere una voce: credential_id NULL. Le colonne restano piene
    // (il caso peggiore: il codice di prima, o uno scollegamento voluto).
    d.prepare("UPDATE network_controllers SET credential_id = NULL, url = 'https://10.9.9.9' WHERE id = ?").run(c.id);
    d.prepare("UPDATE ad_integrations SET credential_id = NULL, dc_host = 'dc-nuovo' WHERE id = ?").run(a.id);

    d = riapri(CODE);
    assert.equal((d.prepare("SELECT COUNT(*) AS n FROM credentials").get() as { n: number }).n, voci, "la conversione si è richiamata col segno chiuso");
    assert.equal(rigaController(d, c.id).credential_id, null);
    assert.equal(rigaAd(d, a.id).credential_id, null);
  });
});

// ── prova-a-vuoto.ts: la sezione «controller e AD (2f)» ─────────────────────

const REPO = process.cwd();
const SCRIPT = path.join(REPO, "scripts", "credenziali", "prova-a-vuoto.ts");
const TPAV = "TESTPROVA2F";

describe("prova-a-vuoto.ts: la conversione di controller e AD sulla copia", () => {
  let radice = "";
  let servizio = "";
  let copia = "";
  before(() => {
    getHubDb();
    closeHubDb();
    radice = fs.mkdtempSync(path.join(os.tmpdir(), "prova-a-vuoto-2f-"));
    servizio = path.join(radice, "servizio");
    copia = path.join(radice, "copia");
    for (const dir of [servizio, copia]) {
      fs.mkdirSync(path.join(dir, "tenants"), { recursive: true });
      fs.copyFileSync(path.join(TEST_DATA_DIR, "hub.db"), path.join(dir, "hub.db"));
    }
    // La copia ha lo schema di prima della 2f: le tabelle senza credential_id.
    const d = new Database(path.join(copia, "tenants", `${TPAV}.db`));
    d.exec(CONTROLLER_PRIMA_2F);
    d.exec(AD_PRIMA_2F);
    d.exec(TENANT_SCHEMA_SQL);
    d.exec(TENANT_INDEXES_SQL);
    const W = voce(d, "WinRM della copia", "windows", { utente: "DOM\\svc", segreto: "pw-winrm-copia" });
    d.prepare("INSERT INTO network_controllers (name, vendor, kind, url, api_key_enc) VALUES ('Console della copia', 'unifi', 'udm', 'https://10.0.0.1', ?)").run(
      encrypt("chiave-copia")
    );
    d.prepare("INSERT INTO network_controllers (name, vendor, kind, url, username, password_enc) VALUES ('Senza utente', 'unifi', 'udm', 'https://10.0.0.2', '', ?)").run(
      encrypt("pw-orfana")
    );
    d.prepare(
      "INSERT INTO ad_integrations (name, dc_host, domain, base_dn, encrypted_username, encrypted_password, winrm_credential_id) VALUES ('Dominio della copia', 'dc1', 'ad.local', 'DC=ad', ?, ?, ?)"
    ).run(encrypt("DOM\\ldap"), encrypt("pw-ldap-copia"), W);
    d.close();
  });
  after(() => {
    if (radice) fs.rmSync(radice, { recursive: true, force: true });
  });

  it("stampa voci nuove, confronto decifrato per riga, WinRM dell'AD e lasciati per nome, mai i segreti", () => {
    const env: NodeJS.ProcessEnv = { ...process.env, DA_INVENT_DATA_DIR: servizio };
    delete env.DA_IPAM_HUB_DB_PATH;
    const r = spawnSync(process.execPath, ["--import", "tsx", SCRIPT, "--dati", copia], { cwd: REPO, env, encoding: "utf8", timeout: 180_000 });
    // Il lasciato rende il segno parziale: uscita 1, da guardare.
    assert.equal(r.status, 1, `uscita ${r.status}\n${r.stdout}\n${r.stderr}`);
    const blocco = r.stdout.split(`== Tenant ${TPAV}`)[1] ?? "";
    assert.match(blocco, /controller e AD \(2f\): controller con voce 0 → 1 su 2, AD con voce 0 → 1 su 1\n/);
    assert.match(blocco, /voci nuove \(2f\):\n  controller «Console della copia» \(#1\): «UniFi · Console della copia» \(#\d+\), UniFi con chiave\n  AD «Dominio della copia» \(#1\): «AD · Dominio della copia» \(#\d+\)\n/);
    assert.match(blocco, /confronto decifrato \(colonne e voce\):\n  controller «Console della copia» \(#1\): uguale\n  AD «Dominio della copia» \(#1\): uguale\n/);
    assert.match(blocco, /WinRM dell'AD: invariato\n/);
    assert.match(blocco, /lasciati \(2f\):\n  controller «Senza utente» \(#2\): .+\n/);
    assert.match(blocco, /credenziali_t2_integrazioni: \(assente\) → parziale:/);
    assert.doesNotMatch(blocco, /UniFi · Console della copia» \(#\d+\): nessun binding la punta/, "la voce del controller finisce fra le voci degli apparati");
    assert.match(blocco, /seconda apertura: nessun cambiamento/);
    assert.doesNotMatch(r.stdout, /chiave-copia|pw-orfana|pw-ldap-copia|pw-winrm-copia/, "nessun segreto a terminale");
  });
});
