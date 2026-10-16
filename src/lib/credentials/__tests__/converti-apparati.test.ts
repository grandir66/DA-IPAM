/**
 * Credenziali degli apparati nell'archivio (tappa 2e credenziali, T19 del
 * piano `plans/2026-10-15-tappa2-archivio-credenziali.md`).
 *
 * Perché: un apparato ha ancora tre posti per le credenziali oltre ai binding
 * d'archivio. I binding inline (segreto scritto nel binding, senza voce) e le
 * colonne di `network_devices` (`credential_id`, `snmp_credential_id`,
 * `username` + `encrypted_password`, `community_string`, `api_token`). Le
 * colonne sono l'unico accesso per 6 apparati in H1 e 1 in A, e la pagina non
 * le mostra: la 2g smetterà di leggerle. La 2e le porta in binding e voci
 * d'archivio e, nella stessa transazione, le svuota. Rischi coperti:
 *   1. la proprietà della sotto-tappa: per ogni apparato la scelta
 *      dell'acquisizione (login e SNMP) ha la stessa porta e lo stesso segreto
 *      prima, con tutte le fonti, e dopo, con le sole fonti della 2g (niente
 *      inline, niente colonne);
 *   2. SNMP mai su `device.port` (F3: 6 `snmp_v2` di H1 a porta 22): il
 *      binding nasce sulla 161;
 *   3. Proxmox `api` con una voce `ssh` in colonna (F1): il binding è `api`,
 *      sulla porta dell'apparato; una voce `windows` su un apparato SNMP (F2)
 *      diventa un binding WinRM sulla 5985, elencato;
 *   4. nomi doppi (in A due apparati hanno lo stesso nome): « (apparato #id)»,
 *      e i segreti uguali non si raggruppano;
 *   5. una forma che la conversione non tratta, o una scelta che cambierebbe,
 *      lascia l'apparato com'era (SAVEPOINT), elencato col motivo, e il segno
 *      dice `parziale:`; il controllo non scrive ripieghi;
 *   6. col segno chiuso la conversione non si richiama: un binding tolto
 *      dall'utente non torna da una colonna riscritta dal codice vecchio;
 *   7. la prova a vuoto sulla copia elenca per nome quello che nasce.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/credentials/__tests__/converti-apparati.test.ts
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
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb, getHubDb } from "@/lib/db-hub";
import { decrypt, encrypt } from "@/lib/crypto";
import { riepilogoRipieghi } from "@/lib/db-maintenance/ripieghi";
import {
  credenzialeSnmpApparatoDb,
  FONTI_ACQUISIZIONE,
  FONTI_ACQUISIZIONE_2G,
  sceltaLoginApparatoDb,
  type ResolvedCredentialSource,
} from "@/lib/credentials/resolve";
import { opzioniSsh } from "@/lib/credentials/segreti";
import { convertiCredenzialiApparati, descriviApparati, segnoApparati, type EsitoApparati } from "@/lib/credentials/converti-apparati";
import { righeConversioni } from "@/lib/transfer/esito-import";
import type { NetworkDevice } from "@/types";

// ── Appoggio ────────────────────────────────────────────────────────────────

function nuovoDb(): Database.Database {
  const d = new Database(":memory:");
  d.pragma("foreign_keys = ON");
  d.exec(TENANT_SCHEMA_SQL);
  d.exec(TENANT_INDEXES_SQL);
  return d;
}

function voce(
  d: Database.Database,
  nome: string,
  tipo: string,
  o: { utente?: string; segreto?: string; port?: number | null; metodo?: string } = {}
): number {
  return Number(
    d
      .prepare("INSERT INTO credentials (name, credential_type, auth_method, encrypted_username, encrypted_password, port) VALUES (?, ?, ?, ?, ?, ?)")
      .run(nome, tipo, o.metodo ?? null, o.utente != null ? encrypt(o.utente) : null, o.segreto != null ? encrypt(o.segreto) : null, o.port ?? null)
      .lastInsertRowid
  );
}

interface CampiApparato {
  protocol: string;
  port?: number;
  vendor?: string;
  device_type?: string;
  credential_id?: number;
  snmp_credential_id?: number;
  username?: string;
  encrypted_password?: string;
  community_string?: string;
  api_token?: string;
}

let indirizzo = 0;

function apparato(d: Database.Database, nome: string, c: CampiApparato): number {
  indirizzo++;
  return Number(
    d
      .prepare(
        `INSERT INTO network_devices (name, host, device_type, vendor, protocol, port, credential_id, snmp_credential_id, username, encrypted_password, community_string, api_token)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        nome,
        `10.50.${Math.floor(indirizzo / 250)}.${(indirizzo % 250) + 1}`,
        c.device_type ?? "switch",
        c.vendor ?? "hp",
        c.protocol,
        c.port ?? 22,
        c.credential_id ?? null,
        c.snmp_credential_id ?? null,
        c.username ?? null,
        c.encrypted_password ?? null,
        c.community_string ?? null,
        c.api_token ?? null
      ).lastInsertRowid
  );
}

interface CampiBinding {
  credential_id?: number;
  inline_username?: string;
  inline_encrypted_password?: string;
  test_status?: "success" | "failed" | "untested";
  tested_at?: string;
  sort_order?: number;
  auto_detected?: number;
}

function binding(d: Database.Database, deviceId: number, protocollo: string, porta: number, c: CampiBinding = {}): number {
  return Number(
    d
      .prepare(
        `INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, sort_order, inline_username, inline_encrypted_password, test_status, tested_at, auto_detected)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        deviceId,
        c.credential_id ?? null,
        protocollo,
        porta,
        c.sort_order ?? 0,
        c.inline_username ?? null,
        c.inline_encrypted_password ?? null,
        c.test_status ?? "untested",
        c.tested_at ?? null,
        c.auto_detected ?? 0
      ).lastInsertRowid
  );
}

const COLONNE = ["credential_id", "snmp_credential_id", "username", "encrypted_password", "community_string", "api_token"] as const;

function colonne(d: Database.Database, id: number): Record<(typeof COLONNE)[number], unknown> {
  return d.prepare(`SELECT ${COLONNE.join(", ")} FROM network_devices WHERE id = ?`).get(id) as Record<(typeof COLONNE)[number], unknown>;
}

type RigaBinding = {
  id: number;
  credential_id: number | null;
  protocol_type: string;
  port: number;
  sort_order: number;
  inline_username: string | null;
  inline_encrypted_password: string | null;
  test_status: string;
  tested_at: string | null;
  auto_detected: number;
};

function bindingDi(d: Database.Database, deviceId: number): RigaBinding[] {
  return d
    .prepare(
      `SELECT id, credential_id, protocol_type, port, sort_order, inline_username, inline_encrypted_password, test_status, tested_at, auto_detected
       FROM device_credential_bindings WHERE device_id = ? ORDER BY protocol_type, sort_order, id`
    )
    .all(deviceId) as RigaBinding[];
}

type RigaVoce = { id: number; name: string; credential_type: string; auth_method: string | null; encrypted_username: string | null; encrypted_password: string | null; port: number | null };

function voceDi(d: Database.Database, id: number | null): RigaVoce {
  const r = d.prepare("SELECT id, name, credential_type, auth_method, encrypted_username, encrypted_password, port FROM credentials WHERE id = ?").get(id) as RigaVoce | undefined;
  assert.ok(r, `manca la voce #${id}`);
  return r;
}

function istantanea(d: Database.Database): string {
  return JSON.stringify({
    voci: d.prepare("SELECT * FROM credentials ORDER BY id").all(),
    binding: d.prepare("SELECT * FROM device_credential_bindings ORDER BY id").all(),
    apparati: d.prepare(`SELECT id, ${COLONNE.join(", ")} FROM network_devices ORDER BY id`).all(),
  });
}

function riga(d: Database.Database, id: number): NetworkDevice {
  return d.prepare("SELECT * FROM network_devices WHERE id = ?").get(id) as NetworkDevice;
}

/**
 * La scelta dell'acquisizione per login e SNMP, con le fonti date: porta e
 * segreto (in memoria, mai stampati), e a parte la fonte.
 */
function scelte(d: Database.Database, id: number, fonti: readonly ResolvedCredentialSource[]): { firma: string; fonti: string[] } {
  const dev = riga(d, id);
  const login = sceltaLoginApparatoDb(d, dev, { registra: false, fonti });
  const snmp = credenzialeSnmpApparatoDb(d, dev, { registra: false, fonti });
  const a = login.ok ? { porta: login.candidato.port, segreto: opzioniSsh(login.segreto) } : null;
  const s = snmp.ok ? { porta: snmp.port, cred: snmp.cred } : null;
  return {
    firma: JSON.stringify({ login: a, snmp: s }),
    fonti: [login.ok ? login.candidato.source : "nessuna", snmp.ok ? snmp.fonte : "nessuna"],
  };
}

const vuoto = (): EsitoApparati => ({ bindingDaColonne: [], vociNuove: [], colonneSvuotate: [], inlineRimasti: 0, lasciati: [] });

// ── La conversione ──────────────────────────────────────────────────────────

describe("convertiCredenzialiApparati", () => {
  it("snmp_v2 a porta 22 con una voce SNMP in colonna e nessun binding → binding snmp sulla 161, colonna a NULL", () => {
    const d = nuovoDb();
    const V = voce(d, "Community sede", "snmp", { segreto: "c-sede" });
    const A = apparato(d, "Switch sede", { protocol: "snmp_v2", port: 22, credential_id: V });

    const e = convertiCredenzialiApparati(d, { aVuoto: false });

    const b = bindingDi(d, A);
    assert.equal(b.length, 1);
    assert.equal(b[0].protocol_type, "snmp");
    assert.equal(b[0].port, 161, "SNMP sulla 161, mai su device.port");
    assert.equal(b[0].credential_id, V);
    assert.equal(b[0].test_status, "untested");
    assert.equal(colonne(d, A).credential_id, null);
    assert.deepEqual(e.bindingDaColonne, [{ device_id: A, protocollo: "snmp", credential_id: V, porta: 161, colonna: "credential_id", fuoriProtocollo: false }]);
    assert.deepEqual(e.colonneSvuotate, [{ device_id: A, colonne: ["credential_id"] }]);
    assert.deepEqual(e.vociNuove, []);
    assert.deepEqual(e.lasciati, []);
  });

  it("le due colonne SNMP: nell'ordine del motore, la stessa voce una volta, e una colonna con il binding equivalente si svuota soltanto", () => {
    const d = nuovoDb();
    const V1 = voce(d, "Community uno", "snmp", { segreto: "c-uno" });
    const V2 = voce(d, "Community due", "snmp", { segreto: "c-due" });
    // Apparato SSH: per SNMP il motore legge prima snmp_credential_id, poi credential_id.
    const A = apparato(d, "Router uno", { protocol: "ssh", credential_id: V1, snmp_credential_id: V2 });
    const B = apparato(d, "Router due", { protocol: "snmp_v2", port: 161, credential_id: V1, snmp_credential_id: V1 });
    const C = apparato(d, "Router tre", { protocol: "snmp_v2", port: 161, snmp_credential_id: V2 });
    binding(d, C, "snmp", 1161, { credential_id: V2, test_status: "success" });

    const e = convertiCredenzialiApparati(d, { aVuoto: false });

    assert.deepEqual(
      bindingDi(d, A).map((b) => [b.credential_id, b.port]),
      [
        [V2, 161],
        [V1, 161],
      ]
    );
    assert.ok(bindingDi(d, A)[0].sort_order < bindingDi(d, A)[1].sort_order);
    assert.deepEqual(
      bindingDi(d, B).map((b) => [b.credential_id, b.port]),
      [[V1, 161]]
    );
    assert.deepEqual(
      bindingDi(d, C).map((b) => [b.credential_id, b.port, b.test_status]),
      [[V2, 1161, "success"]],
      "nessun binding nuovo accanto all'equivalente"
    );
    for (const id of [A, B, C]) {
      assert.equal(colonne(d, id).credential_id, null);
      assert.equal(colonne(d, id).snmp_credential_id, null);
    }
    assert.equal(e.bindingDaColonne.find((x) => x.device_id === A && x.credential_id === V1)?.fuoriProtocollo, true, "voce SNMP su un apparato SSH: elencata");
    assert.equal(e.bindingDaColonne.find((x) => x.device_id === B)?.colonna, "credential_id+snmp_credential_id");
    assert.deepEqual(e.colonneSvuotate.find((x) => x.device_id === C), { device_id: C, colonne: ["snmp_credential_id"] });
  });

  it("Proxmox api con una voce ssh in colonna e solo un binding ssh:22 → binding api sulla porta dell'apparato (F1)", () => {
    const d = nuovoDb();
    const S = voce(d, "Root Proxmox", "ssh", { utente: "root", segreto: "pw-root" });
    const P = apparato(d, "Proxmox uno", { protocol: "api", port: 8006, vendor: "proxmox", device_type: "hypervisor", credential_id: S });
    binding(d, P, "ssh", 22, { credential_id: S });

    const e = convertiCredenzialiApparati(d, { aVuoto: false });

    assert.deepEqual(
      bindingDi(d, P).map((b) => [b.protocol_type, b.port, b.credential_id]),
      [
        ["api", 8006, S],
        ["ssh", 22, S],
      ]
    );
    assert.equal(colonne(d, P).credential_id, null);
    assert.deepEqual(e.bindingDaColonne, [{ device_id: P, protocollo: "api", credential_id: S, porta: 8006, colonna: "credential_id", fuoriProtocollo: false }]);
  });

  it("voce Windows in colonna su un apparato snmp_v2 → binding WinRM sulla 5985, elencato fuori protocollo (F2)", () => {
    const d = nuovoDb();
    const W = voce(d, "Dominio", "windows", { utente: "dom\\svc", segreto: "pw-dom" });
    const A = apparato(d, "Server stampa", { protocol: "snmp_v2", port: 161, credential_id: W });

    const e = convertiCredenzialiApparati(d, { aVuoto: false });

    assert.deepEqual(
      bindingDi(d, A).map((b) => [b.protocol_type, b.port, b.credential_id]),
      [["winrm", 5985, W]]
    );
    assert.deepEqual(e.bindingDaColonne, [{ device_id: A, protocollo: "winrm", credential_id: W, porta: 5985, colonna: "credential_id", fuoriProtocollo: true }]);
    assert.equal(colonne(d, A).credential_id, null);
  });

  it("binding inline SSH completo → voce «<nome> · SSH»; il binding la punta e tiene stato, data, ordine, porta e auto_detected", () => {
    const d = nuovoDb();
    const A = apparato(d, "Firewall nord", { protocol: "ssh", port: 2222, vendor: "stormshield", device_type: "firewall" });
    const b = binding(d, A, "ssh", 2222, {
      inline_username: "admin",
      inline_encrypted_password: encrypt("pw-fw"),
      test_status: "success",
      tested_at: "2026-10-01 10:00:00",
      sort_order: 3,
      auto_detected: 1,
    });

    const e = convertiCredenzialiApparati(d, { aVuoto: false });

    const [r] = bindingDi(d, A);
    assert.equal(r.id, b);
    assert.notEqual(r.credential_id, null);
    assert.equal(r.inline_username, null);
    assert.equal(r.inline_encrypted_password, null);
    assert.deepEqual([r.test_status, r.tested_at, r.sort_order, r.port, r.auto_detected], ["success", "2026-10-01 10:00:00", 3, 2222, 1]);
    const v = voceDi(d, r.credential_id);
    assert.equal(v.name, "Firewall nord · SSH");
    assert.equal(v.credential_type, "ssh");
    assert.equal(decrypt(v.encrypted_username ?? ""), "admin");
    assert.equal(decrypt(v.encrypted_password ?? ""), "pw-fw");
    assert.equal(v.port, 2222, "porta fuori standard: resta sulla voce");
    assert.deepEqual(e.vociNuove, [{ id: v.id, nome: "Firewall nord · SSH", tipo: "ssh", device_id: A, da: "inline" }]);
    assert.equal(e.inlineRimasti, 0);
  });

  it("community inline → voce SNMP con lo stesso testo cifrato, porta NULL perché standard", () => {
    const d = nuovoDb();
    const A = apparato(d, "AP corridoio", { protocol: "snmp_v2", port: 161, device_type: "access_point", vendor: "ubiquiti" });
    const cifrata = encrypt("comm-inline");
    binding(d, A, "snmp", 161, { inline_encrypted_password: cifrata });

    convertiCredenzialiApparati(d, { aVuoto: false });

    const [r] = bindingDi(d, A);
    const v = voceDi(d, r.credential_id);
    assert.equal(v.name, "AP corridoio · SNMP");
    assert.equal(v.credential_type, "snmp");
    assert.equal(v.encrypted_password, cifrata, "il testo cifrato si copia com'è");
    assert.equal(v.encrypted_username, null);
    assert.equal(v.port, null);
  });

  it("due apparati con lo stesso nome → il secondo ha « (apparato #id)»; un nome già nell'archivio pure; segreti uguali non si raggruppano", () => {
    const d = nuovoDb();
    const pw = encrypt("stessa");
    const A1 = apparato(d, "Switch piano 1", { protocol: "ssh" });
    const A2 = apparato(d, "Switch piano 1", { protocol: "ssh" });
    binding(d, A1, "ssh", 22, { inline_username: "admin", inline_encrypted_password: pw });
    binding(d, A2, "ssh", 22, { inline_username: "admin", inline_encrypted_password: pw });
    voce(d, "Router · SSH", "ssh", { utente: "x", segreto: "y" });
    const R = apparato(d, "Router", { protocol: "ssh" });
    binding(d, R, "ssh", 22, { inline_username: "root", inline_encrypted_password: encrypt("pw-r") });

    const e = convertiCredenzialiApparati(d, { aVuoto: false });

    const nomi = Object.fromEntries(e.vociNuove.map((v) => [v.device_id, v.nome]));
    assert.equal(nomi[A1], "Switch piano 1 · SSH");
    assert.equal(nomi[A2], `Switch piano 1 · SSH (apparato #${A2})`);
    assert.equal(nomi[R], `Router · SSH (apparato #${R})`);
    assert.notEqual(bindingDi(d, A1)[0].credential_id, bindingDi(d, A2)[0].credential_id, "due voci, una per binding");
  });

  it("utente e password in colonna: uguali a un binding (decifrati) → nessuna voce; diversi → voce «nome · SSH» e binding sulla porta dell'apparato", () => {
    const d = nuovoDb();
    const S = voce(d, "Admin switch", "ssh", { utente: "admin", segreto: "pw-uguale" });
    const U = apparato(d, "Switch uguale", { protocol: "ssh", port: 22, username: "admin", encrypted_password: encrypt("pw-uguale") });
    binding(d, U, "ssh", 22, { credential_id: S, test_status: "success" });
    const D = apparato(d, "Switch diverso", { protocol: "ssh", port: 2022, username: "admin", encrypted_password: encrypt("pw-colonna") });
    binding(d, D, "ssh", 2022, { credential_id: S });
    // snmp_v2 con utente e password: il login è SSH, sulla 22 (device.port vale per SNMP no).
    const N = apparato(d, "Switch snmp", { protocol: "snmp_v2", port: 161, username: "ro", encrypted_password: encrypt("pw-ro") });

    const e = convertiCredenzialiApparati(d, { aVuoto: false });

    assert.equal(bindingDi(d, U).length, 1, "equivalente: nessun binding nuovo");
    assert.deepEqual(colonne(d, U), { credential_id: null, snmp_credential_id: null, username: null, encrypted_password: null, community_string: null, api_token: null });
    const nuovoD = bindingDi(d, D).find((b) => b.credential_id !== S);
    assert.ok(nuovoD);
    assert.equal(nuovoD.port, 2022);
    assert.ok(nuovoD.sort_order > bindingDi(d, D).find((b) => b.credential_id === S)!.sort_order, "dopo i binding che c'erano");
    const vD = voceDi(d, nuovoD.credential_id);
    assert.equal(vD.name, "Switch diverso · SSH");
    assert.equal(decrypt(vD.encrypted_username ?? ""), "admin");
    assert.equal(decrypt(vD.encrypted_password ?? ""), "pw-colonna");
    assert.deepEqual(
      bindingDi(d, N).map((b) => [b.protocol_type, b.port]),
      [["ssh", 22]]
    );
    assert.equal(e.vociNuove.filter((v) => v.da === "colonne").length, 2);
    assert.equal(e.bindingDaColonne.find((x) => x.device_id === D)?.colonna, "username+encrypted_password");
  });

  it("community in colonna: senza fonte SNMP → voce e binding 161 (in chiaro → cifrata); con un binding SNMP → solo svuotata", () => {
    const d = nuovoDb();
    const S = voce(d, "Community rete", "snmp", { segreto: "c-rete" });
    const senza = apparato(d, "Stampante 1", { protocol: "snmp_v2", port: 161, community_string: encrypt("c-stampante") });
    const chiaro = apparato(d, "Stampante 2", { protocol: "snmp_v2", port: 161, community_string: "c-in-chiaro" });
    const con = apparato(d, "Stampante 3", { protocol: "snmp_v2", port: 161, community_string: encrypt("c-vecchia") });
    binding(d, con, "snmp", 161, { credential_id: S });

    const e = convertiCredenzialiApparati(d, { aVuoto: false });

    const [b1] = bindingDi(d, senza);
    assert.equal(b1.port, 161);
    const v1 = voceDi(d, b1.credential_id);
    assert.equal(v1.name, "Stampante 1 · SNMP");
    assert.equal(decrypt(v1.encrypted_password ?? ""), "c-stampante");
    const v2 = voceDi(d, bindingDi(d, chiaro)[0].credential_id);
    assert.equal(decrypt(v2.encrypted_password ?? ""), "c-in-chiaro", "la community in chiaro entra cifrata");
    assert.deepEqual(
      bindingDi(d, con).map((b) => b.credential_id),
      [S]
    );
    for (const id of [senza, chiaro, con]) assert.equal(colonne(d, id).community_string, null);
    assert.deepEqual(
      e.bindingDaColonne.filter((x) => x.colonna === "community_string").map((x) => x.device_id),
      [senza, chiaro]
    );
  });

  it("api_token → voce API col metodo token e binding api sulla porta dell'apparato", () => {
    const d = nuovoDb();
    const cifrato = encrypt("tok-omada");
    const O = apparato(d, "Omada gw", { protocol: "api", port: 443, vendor: "omada", device_type: "router", api_token: cifrato });

    const e = convertiCredenzialiApparati(d, { aVuoto: false });

    const [b] = bindingDi(d, O);
    assert.deepEqual([b.protocol_type, b.port], ["api", 443]);
    const v = voceDi(d, b.credential_id);
    assert.deepEqual([v.name, v.credential_type, v.auth_method, v.encrypted_password, v.encrypted_username], ["Omada gw · API", "api", "token", cifrato, null]);
    assert.equal(colonne(d, O).api_token, null);
    assert.equal(e.bindingDaColonne[0].colonna, "api_token");
  });

  it("le scelte di login e SNMP hanno la stessa porta e lo stesso segreto prima (tutte le fonti) e dopo (fonti della 2g)", () => {
    const d = nuovoDb();
    const V = voce(d, "Community sede", "snmp", { segreto: "c-sede" });
    const S = voce(d, "Root Proxmox", "ssh", { utente: "root", segreto: "pw-root" });
    const W = voce(d, "Dominio", "windows", { utente: "svc", segreto: "pw-dom" });
    const ids = [
      apparato(d, "Switch sede", { protocol: "snmp_v2", port: 22, credential_id: V }),
      apparato(d, "Proxmox", { protocol: "api", port: 8006, vendor: "proxmox", device_type: "hypervisor", credential_id: S }),
      apparato(d, "Server", { protocol: "winrm", port: 5986, credential_id: W }),
      apparato(d, "Switch colonne", { protocol: "ssh", port: 2022, username: "admin", encrypted_password: encrypt("pw-col"), community_string: encrypt("c-col") }),
      apparato(d, "Switch chiaro", { protocol: "snmp_v3", port: 161, community_string: "c-chiaro" }),
    ];
    const F = apparato(d, "Firewall", { protocol: "ssh", port: 22 });
    binding(d, F, "ssh", 22, { inline_username: "admin", inline_encrypted_password: encrypt("pw-fw"), test_status: "success" });
    binding(d, F, "snmp", 1161, { inline_encrypted_password: encrypt("c-fw") });
    ids.push(F);
    const prima = Object.fromEntries(ids.map((id) => [id, scelte(d, id, FONTI_ACQUISIZIONE)]));
    // La prova vale: senza la conversione, le fonti della 2g cambiano le scelte.
    assert.ok(ids.some((id) => scelte(d, id, FONTI_ACQUISIZIONE_2G).firma !== prima[id].firma));

    const e = convertiCredenzialiApparati(d, { aVuoto: false });

    assert.deepEqual(e.lasciati, []);
    for (const id of ids) {
      const dopo = scelte(d, id, FONTI_ACQUISIZIONE_2G);
      assert.equal(dopo.firma, prima[id].firma, `apparato #${id}: porta o segreto cambiati`);
      for (const f of dopo.fonti) assert.ok(f === "device_binding" || f === "snmp_ripiego" || f === "nessuna", `apparato #${id}: fonte ${f} dopo`);
    }
  });

  it("una forma che la conversione non tratta (community in colonna, unico binding SNMP fallito) → lasciato com'era, col motivo; il resto si converte; segno parziale:", () => {
    const d = nuovoDb();
    const S = voce(d, "Community vecchia", "snmp", { segreto: "c-binding" });
    const A = apparato(d, "Stampante ufficio", { protocol: "snmp_v2", port: 161, community_string: encrypt("c-colonna") });
    binding(d, A, "snmp", 161, { credential_id: S, test_status: "failed" });
    binding(d, A, "ssh", 22, { inline_username: "admin", inline_encrypted_password: encrypt("pw-a") });
    const ok = apparato(d, "Switch ok", { protocol: "ssh" });
    binding(d, ok, "ssh", 22, { inline_username: "admin", inline_encrypted_password: encrypt("pw-ok") });
    const primaA = JSON.stringify({ c: colonne(d, A), b: bindingDi(d, A) });

    const e = convertiCredenzialiApparati(d, { aVuoto: false });

    assert.equal(e.lasciati.length, 1);
    assert.equal(e.lasciati[0].device_id, A);
    assert.match(e.lasciati[0].motivo, /^la scelta SNMP cambierebbe: prima colonne col segreto porta 161, dopo «public» porta 161$/);
    assert.doesNotMatch(e.lasciati[0].motivo, /c-colonna|c-binding|pw-a/, "il motivo non contiene segreti");
    assert.equal(JSON.stringify({ c: colonne(d, A), b: bindingDi(d, A) }), primaA, "colonne e binding dell'apparato lasciato intatti");
    assert.notEqual(bindingDi(d, ok)[0].credential_id, null, "l'altro apparato si converte");
    assert.equal(e.inlineRimasti, 0, "l'inline dell'apparato lasciato non conta");
    assert.match(segnoApparati(e), /^parziale:/);
  });

  it("utente senza password, voce AD in colonna, inline incompleto o vuoto → lasciati coi motivi, intatti", () => {
    const d = nuovoDb();
    const AD = voce(d, "Account AD", "ad", { utente: "ldap", segreto: "pw-ldap" });
    const solo = apparato(d, "Switch utente", { protocol: "ssh", username: "admin" });
    const conAd = apparato(d, "Server AD", { protocol: "winrm", port: 5985, credential_id: AD });
    const incompleto = apparato(d, "Switch inline", { protocol: "ssh" });
    binding(d, incompleto, "ssh", 22, { inline_username: "admin" });
    const vuotoInline = apparato(d, "Switch vuoto", { protocol: "ssh" });
    binding(d, vuotoInline, "winrm", 5985, {});
    const prima = istantanea(d);

    const e = convertiCredenzialiApparati(d, { aVuoto: false });

    assert.deepEqual(
      e.lasciati.map((l) => l.device_id).sort((a, b) => a - b),
      [solo, conAd, incompleto, vuotoInline]
    );
    for (const l of e.lasciati) assert.ok(l.motivo.trim().length > 0);
    assert.match(e.lasciati.find((l) => l.device_id === conAd)?.motivo ?? "", /Active Directory/);
    assert.equal(istantanea(d), prima, "niente scritto");
    assert.equal(e.inlineRimasti, 0);
    assert.match(segnoApparati(e), /^parziale:.*lasciati=4/);
  });

  it("il controllo non scrive nel registro dei ripieghi", () => {
    const d = nuovoDb();
    const V = voce(d, "Community", "snmp", { segreto: "c" });
    apparato(d, "Switch colonna", { protocol: "snmp_v2", port: 161, credential_id: V, username: "u", encrypted_password: encrypt("p") });
    const F = apparato(d, "Firewall inline", { protocol: "ssh" });
    binding(d, F, "ssh", 22, { inline_username: "admin", inline_encrypted_password: encrypt("pw") });
    const totale = riepilogoRipieghi(500).totale;

    convertiCredenzialiApparati(d, { aVuoto: false });

    assert.equal(riepilogoRipieghi(500).totale, totale);
  });

  it("seconda chiamata → nessun effetto", () => {
    const d = nuovoDb();
    const V = voce(d, "Community", "snmp", { segreto: "c" });
    apparato(d, "Switch", { protocol: "snmp_v2", port: 22, credential_id: V, community_string: encrypt("c2") });
    const F = apparato(d, "Firewall", { protocol: "ssh" });
    binding(d, F, "ssh", 22, { inline_username: "admin", inline_encrypted_password: encrypt("pw") });
    convertiCredenzialiApparati(d, { aVuoto: false });
    const dopo = istantanea(d);

    const e2 = convertiCredenzialiApparati(d, { aVuoto: false });

    assert.equal(istantanea(d), dopo);
    assert.deepEqual(e2, vuoto());
    assert.match(segnoApparati(e2), /^done:.*binding_colonne=0,voci_nuove=0/);
  });

  it("a vuoto: lo stesso esito, niente scritto", () => {
    const prepara = (d: Database.Database): void => {
      const V = voce(d, "Community", "snmp", { segreto: "c" });
      apparato(d, "Switch", { protocol: "snmp_v2", port: 22, credential_id: V, username: "u", encrypted_password: encrypt("p") });
      const F = apparato(d, "Firewall", { protocol: "ssh" });
      binding(d, F, "ssh", 22, { inline_username: "admin", inline_encrypted_password: encrypt("pw") });
    };
    const d1 = nuovoDb();
    prepara(d1);
    const prima = istantanea(d1);
    const aVuoto = convertiCredenzialiApparati(d1, { aVuoto: true });
    assert.equal(istantanea(d1), prima, "a vuoto non scrive");
    const d2 = nuovoDb();
    prepara(d2);
    const vero = convertiCredenzialiApparati(d2, { aVuoto: false });
    assert.deepEqual(aVuoto, vero);
    assert.ok(vero.vociNuove.length > 0);
  });

  it("una ENCRYPTION_KEY che non decifra nessun segreto → errore, niente scritto (si riprova)", () => {
    const d = nuovoDb();
    const A = apparato(d, "Switch", { protocol: "ssh", username: "admin", encrypted_password: encrypt("pw") });
    binding(d, A, "ssh", 22, { inline_username: "root", inline_encrypted_password: encrypt("pw2") });
    const prima = istantanea(d);
    const chiave = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = "un-altra-chiave-che-non-decifra";
    try {
      assert.throws(() => convertiCredenzialiApparati(d, { aVuoto: false }), /ENCRYPTION_KEY/);
    } finally {
      process.env.ENCRYPTION_KEY = chiave;
    }
    assert.equal(istantanea(d), prima);
  });
});

describe("segnoApparati e descriviApparati", () => {
  const e: EsitoApparati = {
    bindingDaColonne: [{ device_id: 4, protocollo: "snmp", credential_id: 7, porta: 161, colonna: "credential_id", fuoriProtocollo: false }],
    vociNuove: [{ id: 9, nome: "Switch · SSH", tipo: "ssh", device_id: 5, da: "inline" }],
    colonneSvuotate: [{ device_id: 4, colonne: ["credential_id"] }],
    inlineRimasti: 0,
    lasciati: [],
  };
  it("done: coi conteggi; parziale: con un lasciato", () => {
    assert.equal(
      segnoApparati(e, new Date("2026-10-16T10:00:00.000Z")),
      "done:2026-10-16T10:00:00.000Z:binding_colonne=1,voci_nuove=1,da_inline=1,fuori_protocollo=0,apparati_svuotati=1,inline_rimasti=0,lasciati=0"
    );
    assert.match(segnoApparati({ ...e, lasciati: [{ device_id: 3, motivo: "x" }] }), /^parziale:/);
  });
  it("la riga del journal dice id e motivi, mai i nomi", () => {
    const riga = descriviApparati({ ...e, lasciati: [{ device_id: 3, motivo: "utente senza password nelle colonne" }] });
    assert.match(riga, /apparato #4 snmp\/161 → #7 \(credential_id\)/);
    assert.match(riga, /#9 \(apparato #5, inline\)/);
    assert.match(riga, /apparato #3: utente senza password nelle colonne/);
    assert.doesNotMatch(riga, /Switch/);
  });
});

// ── All'apertura del tenant ─────────────────────────────────────────────────

function segno(d: Database.Database): string | null {
  const r = d.prepare("SELECT value FROM tenant_settings WHERE key = 'credenziali_t2_apparati'").get() as { value: string } | undefined;
  return r?.value ?? null;
}

function riapri(code: string): Database.Database {
  closeTenantDb(code);
  return withTenant(code, () => getTenantDb(code));
}

describe("getTenantDb: conversione degli apparati col segno credenziali_t2_apparati", () => {
  const CODE = "TESTAPPARATI2E";
  after(() => deleteTenantDatabase(CODE));

  it("conversione fatta; l'utente toglie il binding nato dalla colonna; il codice vecchio riscrive la colonna; alla seconda apertura il binding non torna", () => {
    let d = withTenant(CODE, () => getTenantDb(CODE));
    assert.match(segno(d) ?? "", /^done:/);
    // Uno stato di prima della 2e: una voce SNMP in colonna, segno assente.
    d.prepare("DELETE FROM tenant_settings WHERE key = 'credenziali_t2_apparati'").run();
    const V = voce(d, "Community prova 2e", "snmp", { segreto: "c-2e" });
    const A = apparato(d, "Switch prova 2e", { protocol: "snmp_v2", port: 22, credential_id: V });

    d = riapri(CODE);
    assert.deepEqual(
      bindingDi(d, A).map((b) => [b.protocol_type, b.port, b.credential_id]),
      [["snmp", 161, V]]
    );
    assert.equal(colonne(d, A).credential_id, null);
    assert.match(segno(d) ?? "", /^done:.*binding_colonne=1/);

    d.prepare("DELETE FROM device_credential_bindings WHERE device_id = ?").run(A);
    d.prepare("UPDATE network_devices SET credential_id = ? WHERE id = ?").run(V, A);
    d = riapri(CODE);
    assert.deepEqual(bindingDi(d, A), [], "il binding tolto è tornato: la conversione si è richiamata col segno chiuso");
    assert.equal(colonne(d, A).credential_id, V);
  });
});

describe("righeConversioni: il nome della conversione degli apparati", () => {
  it("si legge in italiano, non la chiave", () => {
    const [r] = righeConversioni({ credenziali_t2_apparati: { segno: "done:2026-10-16T10:00:00.000Z:binding_colonne=1,voci_nuove=0", dettaglio: "x" } });
    assert.equal(r.testo, "Colonne e binding inline degli apparati convertiti: x");
  });
});

// ── prova-a-vuoto.ts: la sezione «apparati (2e)» ────────────────────────────

const REPO = process.cwd();
const SCRIPT = path.join(REPO, "scripts", "credenziali", "prova-a-vuoto.ts");
const TPAV = "TESTPROVA2E";

describe("prova-a-vuoto.ts: la conversione degli apparati sulla copia", () => {
  let radice = "";
  let servizio = "";
  let copia = "";
  before(() => {
    getHubDb();
    closeHubDb();
    radice = fs.mkdtempSync(path.join(os.tmpdir(), "prova-a-vuoto-2e-"));
    servizio = path.join(radice, "servizio");
    copia = path.join(radice, "copia");
    for (const dir of [servizio, copia]) {
      fs.mkdirSync(path.join(dir, "tenants"), { recursive: true });
      fs.copyFileSync(path.join(TEST_DATA_DIR, "hub.db"), path.join(dir, "hub.db"));
    }
    const d = new Database(path.join(copia, "tenants", `${TPAV}.db`));
    d.exec(TENANT_SCHEMA_SQL);
    d.exec(TENANT_INDEXES_SQL);
    const V = voce(d, "Community della copia", "snmp", { segreto: "c-copia" });
    apparato(d, "Switch della copia", { protocol: "snmp_v2", port: 22, credential_id: V });
    apparato(d, "Stampante della copia", { protocol: "snmp_v2", port: 161, community_string: encrypt("c-stampa") });
    const F = apparato(d, "Firewall della copia", { protocol: "ssh", port: 22 });
    binding(d, F, "ssh", 22, { inline_username: "admin", inline_encrypted_password: encrypt("pw-copia"), test_status: "success" });
    apparato(d, "Switch con solo utente", { protocol: "ssh", username: "admin" });
    d.close();
  });
  after(() => {
    if (radice) fs.rmSync(radice, { recursive: true, force: true });
  });

  it("stampa binding nati per protocollo e porta, voci nuove, community diventate voce, colonne svuotate, inline rimasti e lasciati per nome", () => {
    const env: NodeJS.ProcessEnv = { ...process.env, DA_INVENT_DATA_DIR: servizio };
    delete env.DA_IPAM_HUB_DB_PATH;
    const r = spawnSync(process.execPath, ["--import", "tsx", SCRIPT, "--dati", copia], { cwd: REPO, env, encoding: "utf8", timeout: 180_000 });
    // Il lasciato rende il segno parziale: uscita 1, da guardare.
    assert.equal(r.status, 1, `uscita ${r.status}\n${r.stdout}\n${r.stderr}`);
    const blocco = r.stdout.split(`== Tenant ${TPAV}`)[1] ?? "";
    assert.match(blocco, /apparati \(2e\): binding 1 → 3, inline 1 → 0, apparati con colonne piene 3 → 1/);
    assert.match(blocco, /binding nati dalle colonne:\n(?:.*\n)*?  apparato «Switch della copia» \(#1\): SNMP\/161 → «Community della copia» \(#1\)/);
    assert.match(blocco, /  apparato «Stampante della copia» \(#2\): SNMP\/161 → «Stampante della copia · SNMP» \(#\d+\), voce nuova/);
    assert.match(blocco, /voci nuove:\n(?:.*\n)*?  «Firewall della copia · SSH» \(#\d+\): apparato «Firewall della copia» \(#3\), da binding inline/);
    assert.match(blocco, /community diventate voce:\n  apparato «Stampante della copia» \(#2\): «Stampante della copia · SNMP» \(#\d+\)\n/);
    assert.match(blocco, /colonne svuotate:\n(?:.*\n)*?  apparato «Switch della copia» \(#1\): credential_id/);
    assert.match(blocco, /inline rimasti: 0\n/);
    assert.match(blocco, /lasciati:\n  apparato «Switch con solo utente» \(#4\): .+/);
    assert.match(blocco, /credenziali_t2_apparati: \(assente\) → parziale:/);
    assert.doesNotMatch(r.stdout, /c-copia|c-stampa|pw-copia/, "nessun segreto a terminale");
  });
});
