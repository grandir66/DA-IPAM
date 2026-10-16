/**
 * La pulizia dei dati vecchi (tappa 2g credenziali, T27 del piano
 * `plans/2026-10-15-tappa2-archivio-credenziali.md`), la parte con l'handle.
 *
 * Perché: dal T26 nessuno legge più colonne degli apparati, catene vecchie e
 * colonne di controller e AD, ma i segreti sono ancora lì, fuori
 * dall'archivio. La pulizia li toglie con uno script (mai in getTenantDb: su
 * un'appliance che riceve `main` girerebbe senza prova, backup e conferma).
 * Decisioni di Riccardo del 16/10: i lasciati accettati (`--lasciati-accettati`)
 * si svuotano come gli altri e il loro elenco va nel segno; un apparato con una
 * colonna piena fuori dall'elenco blocca il tenant. Rischi coperti:
 *   1. si svuota solo quello che ha già un binding equivalente (definizione
 *      della 2e): un apparato accettato con una colonna senza equivalente, uno
 *      fuori dall'elenco o un binding inline bloccano il tenant, col perché;
 *   2. controller e AD si svuotano solo dove c'è la voce; quelli senza voce
 *      restano com'erano e si elencano;
 *   3. le due DROP stanno nella stessa transazione delle UPDATE e del segno:
 *      se la seconda fallisce torna indietro tutto, prima DROP compresa;
 *   4. la seconda pulizia non ha effetti; un DB cambiato fra la prova e la
 *      scrittura non si scrive;
 *   5. il backup sta accanto al DB, col nome `.bak-YYYYMMDD-HHMMSS`, non
 *      sovrascrive e non parte senza spazio;
 *   6. lo schema dei tenant nuovi non crea più le due tabelle vecchie, e un
 *      tenant nuovo si apre lo stesso (la 2d non ha niente da convertire).
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/credentials/__tests__/pulizia-t2.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import { encrypt } from "@/lib/crypto";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "@/lib/db-tenant-schema";
import { closeTenantDb, deleteTenantDatabase, getTenantDb } from "@/lib/db-tenant";
import { contenutoDb, creaTenantDopo2f, DATA_2F, type TenantDopo2f } from "./support/tenant-dopo-2f";
import { leggiSegno, SEGNO_CATENE, SEGNO_PULIZIA } from "@/lib/credentials/segni-t2";
import { applicaPuliziaDb, misuraCondizioniDb, pianoPuliziaDb, puliziaFatta } from "@/lib/credentials/pulizia-t2";
import { backupAccanto, nomeBackup } from "@/lib/credentials/backup-accanto";

void TEST_DATA_DIR;

const T = "T2GPROVA";
const radice = fs.mkdtempSync(path.join(os.tmpdir(), "pulizia-t2-"));
after(() => fs.rmSync(radice, { recursive: true, force: true }));

let n = 0;
/** Un DB tenant come quello dell'hub dopo la 2f (support/tenant-dopo-2f.ts), ognuno nella sua cartella. */
function nuovoTenant(): TenantDopo2f {
  return creaTenantDopo2f(path.join(radice, `t${++n}`, `${T}.db`));
}

const tabella = (d: Database.Database, nome: string) => !!d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(nome);
const colonneApparato = (d: Database.Database, id: number) =>
  d.prepare("SELECT credential_id, snmp_credential_id, username, encrypted_password, community_string, api_token FROM network_devices WHERE id = ?").get(id) as Record<string, unknown>;
const controller = (d: Database.Database, id: number) =>
  d.prepare("SELECT username, password_enc, api_key_enc, credential_id FROM network_controllers WHERE id = ?").get(id) as Record<string, unknown>;
const ad = (d: Database.Database, id: number) =>
  d.prepare("SELECT encrypted_username, encrypted_password, credential_id FROM ad_integrations WHERE id = ?").get(id) as Record<string, unknown>;

const contenuto = contenutoDb;

describe("pianoPuliziaDb", () => {
  it("il lasciato accettato si svuota; controller e AD con la voce si svuotano, quello senza voce resta elencato; le due tabelle vecchie si tolgono", () => {
    const p = nuovoTenant();
    const piano = pianoPuliziaDb(p.d, T, [p.lasciato]);
    assert.deepEqual(piano.bloccanti, []);
    assert.deepEqual(piano.apparati.map((a) => [a.device_id, a.nome, a.colonne]), [[p.lasciato, "Server lasciato", ["credential_id"]]]);
    assert.deepEqual(piano.controller.map((c) => c.id), [p.ctrlVoce]);
    assert.deepEqual(piano.controllerSenzaVoce.map((c) => [c.id, c.nome]), [[p.ctrlSenza, "Magazzino"]]);
    assert.deepEqual(piano.ad.map((a) => a.id), [p.adVoce]);
    assert.deepEqual(piano.adSenzaVoce, []);
    assert.deepEqual(piano.tabelle, [
      { nome: "network_host_credentials", righe: 1 },
      { nome: "host_detect_credential", righe: 1 },
    ]);
    assert.deepEqual(piano.lasciatiAccettati, [p.lasciato]);
  });

  it("un apparato con una colonna piena fuori dall'elenco blocca il tenant, anche col binding equivalente", () => {
    const p = nuovoTenant();
    const piano = pianoPuliziaDb(p.d, T, []);
    assert.deepEqual(piano.apparati, []);
    assert.equal(piano.bloccanti.length, 1);
    assert.equal(piano.bloccanti[0].device_id, p.lasciato);
    assert.match(piano.bloccanti[0].motivo, /fuori dai lasciati accettati/);
  });

  it("un apparato accettato con utente e password nelle colonne senza un binding uguale blocca, col perché", () => {
    const p = nuovoTenant();
    p.d.prepare("UPDATE network_devices SET username = 'root', encrypted_password = ? WHERE id = ?").run(encrypt("altra-password"), p.lasciato);
    const piano = pianoPuliziaDb(p.d, T, [p.lasciato]);
    assert.deepEqual(piano.apparati, []);
    assert.equal(piano.bloccanti.length, 1);
    assert.match(piano.bloccanti[0].motivo, /username\+encrypted_password senza un binding equivalente/);
    assert.doesNotMatch(JSON.stringify(piano), /altra-password|pw-root/);
  });

  it("un binding inline (segreto senza voce) blocca: la pulizia non lo tratta", () => {
    const p = nuovoTenant();
    p.d.prepare(
      "INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, sort_order, test_status, inline_username, inline_encrypted_password) VALUES (?, NULL, 'snmp', 161, 0, 'untested', NULL, ?)",
    ).run(p.lasciato, encrypt("comunita"));
    const piano = pianoPuliziaDb(p.d, T, [p.lasciato]);
    assert.equal(piano.bloccanti.length, 1);
    assert.match(piano.bloccanti[0].motivo, /binding inline/);
  });
});

describe("applicaPuliziaDb", () => {
  it("svuota colonne, controller e AD, toglie le due tabelle e scrive il segno coi lasciati accettati; la seconda non ha effetti", () => {
    const p = nuovoTenant();
    const piano = pianoPuliziaDb(p.d, T, [p.lasciato]);
    const quando = new Date("2026-10-16T15:00:00.000Z");
    const e = applicaPuliziaDb(p.d, piano, { ripieghiConfermati: 3, quando });
    assert.deepEqual(colonneApparato(p.d, p.lasciato), {
      credential_id: null, snmp_credential_id: null, username: null, encrypted_password: null, community_string: null, api_token: null,
    });
    const c = controller(p.d, p.ctrlVoce);
    assert.deepEqual([c.username, c.password_enc, c.api_key_enc], ["", "", ""]);
    assert.notEqual(c.credential_id, null);
    assert.equal(controller(p.d, p.ctrlSenza).username, "admin", "il controller senza voce è stato toccato");
    const a = ad(p.d, p.adVoce);
    assert.deepEqual([a.encrypted_username, a.encrypted_password], ["", ""]);
    assert.notEqual(a.credential_id, null);
    assert.equal(tabella(p.d, "network_host_credentials"), false);
    assert.equal(tabella(p.d, "host_detect_credential"), false);
    // Il binding fallito resta: è la strada per tornare ad avere accesso (una Prova che riesce).
    assert.equal((p.d.prepare("SELECT COUNT(*) AS n FROM device_credential_bindings WHERE device_id = ?").get(p.lasciato) as { n: number }).n, 1);
    const segno = leggiSegno(p.d, SEGNO_PULIZIA) ?? "";
    assert.equal(segno, e.segno);
    assert.match(segno, /^done:2026-10-16T15:00:00\.000Z:/);
    assert.match(segno, new RegExp(`lasciati_accettati=${p.lasciato}(,|$)`));
    assert.match(segno, /ripieghi_confermati=3/);
    assert.match(segno, /apparati_svuotati=1/);
    assert.match(segno, /tabelle_tolte=2/);
    assert.equal(puliziaFatta(p.d), segno);

    const dopo = contenuto(p.d);
    assert.throws(() => applicaPuliziaDb(p.d, pianoPuliziaDb(p.d, T, [p.lasciato]), { ripieghiConfermati: 0 }), /già fatta/);
    assert.equal(contenuto(p.d), dopo, "la seconda pulizia ha cambiato qualcosa");
  });

  it("se la seconda DROP fallisce, torna indietro tutto: prima tabella, colonne e segno come prima", () => {
    const p = nuovoTenant();
    // Una tabella che punta a host_detect_credential: con le chiavi esterne attive la sua DROP fallisce.
    p.d.exec("CREATE TABLE rif_pin (h INTEGER, r TEXT, FOREIGN KEY (h, r) REFERENCES host_detect_credential(host_id, role))");
    const pin = p.d.prepare("SELECT host_id, role FROM host_detect_credential").get() as { host_id: number; role: string };
    p.d.prepare("INSERT INTO rif_pin (h, r) VALUES (?, ?)").run(pin.host_id, pin.role);
    const prima = contenuto(p.d);
    const piano = pianoPuliziaDb(p.d, T, [p.lasciato]);
    assert.throws(() => applicaPuliziaDb(p.d, piano, { ripieghiConfermati: 0 }), /FOREIGN KEY/);
    assert.equal(tabella(p.d, "network_host_credentials"), true, "la prima DROP non è tornata indietro");
    assert.equal(contenuto(p.d), prima);
    assert.equal(leggiSegno(p.d, SEGNO_PULIZIA), null);
  });

  it("con dei bloccanti non scrive niente", () => {
    const p = nuovoTenant();
    const prima = contenuto(p.d);
    const piano = pianoPuliziaDb(p.d, T, []);
    assert.throws(() => applicaPuliziaDb(p.d, piano, { ripieghiConfermati: 0 }), /blocc/);
    assert.equal(contenuto(p.d), prima);
  });

  it("se il DB cambia fra la prova e la scrittura non scrive niente", () => {
    const p = nuovoTenant();
    const piano = pianoPuliziaDb(p.d, T, [p.lasciato]);
    p.d.prepare("UPDATE network_controllers SET credential_id = (SELECT id FROM credentials WHERE name = 'UniFi · Sede') WHERE id = ?").run(p.ctrlSenza);
    const prima = contenuto(p.d);
    assert.throws(() => applicaPuliziaDb(p.d, piano, { ripieghiConfermati: 0 }), /cambiato/);
    assert.equal(contenuto(p.d), prima);
  });
});

describe("misuraCondizioniDb", () => {
  it("segni della copia così com'è e lasciati della 2e ricalcolati a vuoto, coi nomi; non scrive", () => {
    const p = nuovoTenant();
    const prima = contenuto(p.d);
    const m = misuraCondizioniDb(p.d, T);
    assert.equal(m.stato.segni.apparati, `parziale:${DATA_2F}:lasciati=1`);
    assert.deepEqual(m.stato.lasciatiApparati.map((l) => l.device_id), [p.lasciato]);
    assert.equal(m.nomiApparati[p.lasciato], "Server lasciato");
    assert.deepEqual(m.nonMisurabili, []);
    assert.equal(contenuto(p.d), prima);
  });
});

describe("backupAccanto", () => {
  it("copia accanto al DB col nome .bak-YYYYMMDD-HHMMSS e lo stesso contenuto; un .bak che c'è già non si sovrascrive", async () => {
    const p = nuovoTenant();
    const quando = new Date(2026, 9, 16, 17, 4, 5);
    assert.equal(nomeBackup(p.file, quando), `${p.file}.bak-20261016-170405`);
    const b = await backupAccanto(p.d, p.file, { quando });
    assert.equal(b.percorso, `${p.file}.bak-20261016-170405`);
    const copia = new Database(b.percorso, { readonly: true });
    try {
      assert.equal(contenuto(copia), contenuto(p.d));
    } finally {
      copia.close();
    }
    await assert.rejects(() => backupAccanto(p.d, p.file, { quando }), /esiste già/);
  });

  it("senza spazio libero non copia", async () => {
    const p = nuovoTenant();
    const quando = new Date(2026, 9, 16, 17, 4, 6);
    await assert.rejects(() => backupAccanto(p.d, p.file, { quando, libero: () => 10 }), /[Ss]pazio libero insufficiente/);
    assert.equal(fs.existsSync(nomeBackup(p.file, quando)), false);
  });
});

describe("schema dei tenant nuovi dopo la 2g", () => {
  it("TENANT_SCHEMA_SQL non crea più le due tabelle vecchie né il loro indice", () => {
    const d = new Database(":memory:");
    d.exec(TENANT_SCHEMA_SQL);
    d.exec(TENANT_INDEXES_SQL);
    assert.equal(tabella(d, "network_host_credentials"), false);
    assert.equal(tabella(d, "host_detect_credential"), false);
    assert.equal(d.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_network_host_credentials_net_role'").get(), undefined);
    d.close();
  });

  it("un tenant nuovo si apre con getTenantDb e la 2d chiude done: (niente da convertire)", () => {
    const code = "T2GNUOVO";
    try {
      const d = getTenantDb(code);
      assert.equal(tabella(d, "network_host_credentials"), false);
      assert.match(leggiSegno(d, SEGNO_CATENE) ?? "", /^done:/);
    } finally {
      closeTenantDb(code);
      deleteTenantDatabase(code);
    }
  });
});
