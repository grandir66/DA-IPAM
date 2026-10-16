/**
 * Le catene vecchie non si leggono più dopo la conversione della 2d (tappa 2
 * credenziali, T17 del piano `plans/2026-10-15-tappa2-archivio-credenziali.md`).
 *
 * Perché:
 * - il T16 copia catene vecchie, pin e (con un tenant attivo) chiavi dell'hub
 *   nella lista della rete e nelle righe dell'host, ma le tabelle vecchie
 *   restano congelate fino alla 2g. Se il motore continuasse a leggerle, una
 *   voce che l'utente toglie dalla lista tornerebbe dalla catena congelata, e
 *   sull'hub (due tenant attivi, D3 = (a)) la chiave «di default» si
 *   accoderebbe ancora in ogni rete;
 * - l'anteprima edge metteva prima le voci della lista, in ordine di lista, e
 *   poi le catene: le stesse voci, spostate dalla catena alla lista, uscivano
 *   in un altro ordine. Ora gli slot si fanno dalla catena del motore per
 *   protocollo, e l'anteprima è la stessa prima e dopo la conversione;
 * - `detect_credentials` (il pin per ruolo dalla scheda dell'host) non ha più
 *   lettori: mandarlo è un 400 «campo superato», non un campo ignorato.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/credentials/__tests__/catene-chiuse.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { encrypt } from "@/lib/crypto";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "@/lib/db-tenant-schema";
import { deleteTenantDatabase, getTenantDb, withTenant, getHostById as hostTenant } from "@/lib/db-tenant";
import { getHostById as hostFacciata } from "@/lib/db";
import { closeHubDb, getSetting, setSetting } from "@/lib/db-hub";
import { catenaReteDb, credenzialiApparatoDb, resolveCredentialsForDb, type ResolvedCredentialSource } from "@/lib/credentials/resolve";
import { convertiCateneVecchie, segnoCatene } from "@/lib/credentials/converti-catene";
import { SEGNO_CATENE, scriviSegno } from "@/lib/credentials/segni-t2";
import { collectEdgeCredentialsForNetwork } from "@/lib/vuln/edge-credentials-bridge";
import { HostUpdateSchema } from "@/lib/validators";

void TEST_DATA_DIR;

// ── Il motore col segno della 2d ────────────────────────────────────────────

function nuovoDb(): Database.Database {
  const d = new Database(":memory:");
  d.pragma("foreign_keys = ON");
  d.exec(TENANT_SCHEMA_SQL);
  d.exec(TENANT_INDEXES_SQL);
  // Colonne che getTenantDb aggiunge con ALTER (stesso appoggio di resolve.test.ts).
  for (const c of ["fail_count INTEGER NOT NULL DEFAULT 0", "last_error TEXT", "last_attempt_at TEXT", "backoff_until TEXT"]) {
    try { d.exec(`ALTER TABLE host_credentials ADD COLUMN ${c}`); } catch { /* già presente */ }
  }
  try { d.exec("ALTER TABLE network_devices ADD COLUMN host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL"); } catch { /* già presente */ }
  return d;
}

function voce(d: Database.Database, name: string, tipo: string): number {
  return Number(d.prepare("INSERT INTO credentials (name, credential_type) VALUES (?, ?)").run(name, tipo).lastInsertRowid);
}

interface Scena {
  d: Database.Database;
  rete: number;
  host: number;
  apparato: number;
  N: number;
  V: number;
  P: number;
  K: number;
}

/** Lista [N]; catena vecchia ssh [V]; pin dell'host ssh → P; chiave Linux dell'hub → K; un apparato SNMP sull'host. */
function scena(): Scena {
  const d = nuovoDb();
  const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.60.0.0/24', 'Rete')").run().lastInsertRowid);
  const host = Number(d.prepare("INSERT INTO hosts (network_id, ip) VALUES (?, '10.60.0.5')").run(rete).lastInsertRowid);
  const apparato = Number(
    d.prepare(
      `INSERT INTO network_devices (name, host, device_type, vendor, protocol, host_id) VALUES ('Server', '10.60.0.5', 'server', 'other', 'snmp_v2', ?)`
    ).run(host).lastInsertRowid
  );
  const N = voce(d, "N della lista", "ssh");
  const V = voce(d, "V della catena vecchia", "ssh");
  const P = voce(d, "P del pin", "ssh");
  const K = voce(d, "K chiave dell'hub", "ssh");
  d.prepare("INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, 0)").run(rete, N);
  d.prepare("INSERT INTO network_host_credentials (network_id, credential_id, role, sort_order) VALUES (?, ?, 'ssh', 0)").run(rete, V);
  d.prepare("INSERT INTO host_detect_credential (host_id, role, credential_id) VALUES (?, 'ssh', ?)").run(host, P);
  return { d, rete, host, apparato, N, V, P, K };
}

const fonti = (r: Array<{ source: ResolvedCredentialSource; credential_id: number | null }>) => r.map((c) => [c.source, c.credential_id]);

describe("motore: catene vecchie e chiave dell'hub col segno credenziali_t2_catene", () => {
  it("senza segno (2d non ancora girata) le legge, come prima", () => {
    const s = scena();
    const r = resolveCredentialsForDb(s.d, { hostId: s.host, networkId: s.rete }, "ssh", { globaliHub: { windows: null, linux: s.K } });
    assert.deepEqual(fonti(r), [
      ["network_chain", s.N],
      ["legacy_chain", s.P],
      ["legacy_chain", s.V],
      ["hub_default", s.K],
    ]);
  });

  for (const segno of ["done:2026-10-16T08:00:00.000Z:lista=1", "parziale:2026-10-16T08:00:00.000Z:saltate=1"]) {
    it(`col segno ${segno.split(":")[0]}: niente legacy_chain né hub_default, per host, rete e apparato`, () => {
      const s = scena();
      scriviSegno(s.d, SEGNO_CATENE, segno);
      const globaliHub = { windows: null, linux: s.K };
      const perHost = resolveCredentialsForDb(s.d, { hostId: s.host, networkId: s.rete }, "ssh", { globaliHub });
      assert.deepEqual(fonti(perHost), [["network_chain", s.N]]);
      assert.deepEqual(catenaReteDb(s.d, s.rete, "ssh", { globaliHub, registra: false }), [s.N]);
      const perApparato = credenzialiApparatoDb(s.d, s.apparato, "ssh", { globaliHub });
      assert.deepEqual(fonti(perApparato), [["network_chain", s.N]]);
    });
  }

  it("col segno errore: (conversione da rifare) le legge ancora", () => {
    const s = scena();
    scriviSegno(s.d, SEGNO_CATENE, "errore:UNIQUE constraint failed");
    const r = resolveCredentialsForDb(s.d, { hostId: s.host, networkId: s.rete }, "ssh", { globaliHub: { windows: null, linux: s.K } });
    assert.deepEqual(
      r.map((c) => c.source),
      ["network_chain", "legacy_chain", "legacy_chain", "hub_default"]
    );
  });

  it("un DB senza tenant_settings (copia vecchia aperta in sola lettura): nessun segno, quindi le legge", () => {
    const s = scena();
    s.d.exec("DROP TABLE tenant_settings");
    const r = resolveCredentialsForDb(s.d, { networkId: s.rete }, "ssh", {});
    assert.deepEqual(fonti(r), [["network_chain", s.N], ["legacy_chain", s.V]]);
  });
});

// ── Anteprima edge prima e dopo la conversione ──────────────────────────────

const TE = "TESTEDGE2D";

describe("anteprima edge: uguale prima e dopo la conversione della 2d", () => {
  let chiavePrima: string | null = null;
  before(() => {
    chiavePrima = getSetting("host_windows_credential_id");
  });
  after(() => {
    setSetting("host_windows_credential_id", chiavePrima ?? "");
    deleteTenantDatabase(TE);
    closeHubDb();
  });

  it("stessi slot, stesso ordine, stesse voci selezionate (chiave Windows dell'hub compresa, un tenant attivo)", () => {
    withTenant(TE, () => {
      const d = getTenantDb(TE);
      // Uno stato di prima della 2d: il segno l'ha scritto l'apertura su un DB vuoto.
      d.prepare("DELETE FROM tenant_settings WHERE key = ?").run(SEGNO_CATENE);
      const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.61.0.0/24', 'Rete edge')").run().lastInsertRowid);
      const ins = d.prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES (?, ?, ?, ?)");
      const nuova = (nome: string, tipo: string, utente: string | null, segreto: string) =>
        Number(ins.run(nome, tipo, utente == null ? null : encrypt(utente), encrypt(segreto)).lastInsertRowid);
      const A = nuova("A ssh della lista", "ssh", "op-a", "pa");
      const E = nuova("E community della lista", "snmp", null, "comm-e");
      const C = nuova("C windows vecchia", "windows", "DOM\\op-c", "pc");
      const D = nuova("D ssh vecchia", "ssh", "op-d", "pd");
      const L = nuova("L linux vecchia", "ssh", "op-l", "pl");
      const S = nuova("S community vecchia", "snmp", null, "comm-s");
      const W = nuova("W chiave Windows dell'hub", "windows", "DOM\\op-w", "pw");
      const lista = d.prepare("INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, ?)");
      lista.run(rete, A, 0);
      lista.run(rete, E, 1);
      const vecchia = d.prepare("INSERT INTO network_host_credentials (network_id, credential_id, role, sort_order) VALUES (?, ?, ?, 0)");
      vecchia.run(rete, C, "windows");
      vecchia.run(rete, D, "ssh");
      vecchia.run(rete, L, "linux");
      vecchia.run(rete, S, "snmp");
      setSetting("host_windows_credential_id", String(W));

      const prima = collectEdgeCredentialsForNetwork(rete, { registra: false });
      const esito = convertiCateneVecchie(d, { windows: W, linux: null, tenantAttivi: 1 }, { aVuoto: false });
      scriviSegno(d, SEGNO_CATENE, segnoCatene(esito));
      const dopo = collectEdgeCredentialsForNetwork(rete, { registra: false });

      assert.deepEqual(dopo, prima, "l'anteprima edge cambia con la conversione");
      assert.deepEqual(
        dopo.preview.filter((p) => p.selected_for_scan).map((p) => [p.slot, p.credential_id]),
        [["ssh", A], ["smb", C], ["ad", C], ["snmp", E]],
        "la prima voce di ogni slot"
      );
      assert.deepEqual(
        dopo.transfer.map((t) => [t.slot, t.ipam_credential_id ?? null]),
        [["ssh", A], ["ssh", D], ["ssh", L], ["smb", C], ["smb", W], ["ad", C], ["ad", W], ["snmp", E], ["snmp", S]]
      );
    });
  });
});

// ── detect_credentials: campo superato ──────────────────────────────────────

const TH = "TESTHOST2D";

describe("detect_credentials (pin per ruolo dell'host): campo superato", () => {
  after(() => deleteTenantDatabase(TH));

  it("PUT dell'host con detect_credentials → errore di validazione «campo superato», non un campo ignorato", () => {
    const r = HostUpdateSchema.safeParse({ notes: "x", detect_credentials: { windows: 5, linux: null, ssh: null, snmp: null } });
    assert.equal(r.success, false, "detect_credentials passa la validazione");
    if (!r.success) assert.match(r.error.issues[0].message, /campo superato/);
    // Senza il campo, il resto si valida come prima.
    assert.equal(HostUpdateSchema.safeParse({ notes: "x" }).success, true);
  });

  it("getHostById (le due gemelle) non restituisce più detect_credentials", () => {
    withTenant(TH, () => {
      const d = getTenantDb(TH);
      const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.62.0.0/24', 'Rete host')").run().lastInsertRowid);
      const host = Number(d.prepare("INSERT INTO hosts (network_id, ip) VALUES (?, '10.62.0.7')").run(rete).lastInsertRowid);
      for (const [nome, leggi] of [["db-tenant", hostTenant], ["facciata", hostFacciata]] as const) {
        const h = leggi(host);
        assert.ok(h, `${nome}: host non trovato`);
        assert.equal("detect_credentials" in h, false, `${nome}: detect_credentials ancora nella risposta`);
      }
    });
  });
});
