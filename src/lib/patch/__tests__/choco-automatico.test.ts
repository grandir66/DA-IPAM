/**
 * Chocolatey si installa da solo sugli host Windows con credenziali WinRM
 * (decisione di Riccardo, 21/10/2026). Prima c'era solo il bootstrap a mano,
 * un host alla volta, dalla pagina del dispositivo: chi non lo lanciava
 * restava senza patch.
 *
 * Le prove eseguono il motore su un DB del cliente in memoria e un bootstrap
 * finto (niente WinRM): quali host parte, quali no, l'interruttore, i tentativi
 * notturni e il limite di installazioni insieme.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/patch/__tests__/choco-automatico.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-choco-automatico";

import { encrypt } from "@/lib/crypto";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "@/lib/db-tenant-schema";
import { applyPatchModuleMigrations } from "../schema";
import * as choco from "../choco-automatico";

const TENANT = "T-CHOCO";
let db: Database.Database;
let voceWinrm: number;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(TENANT_SCHEMA_SQL);
  db.exec(TENANT_INDEXES_SQL);
  applyPatchModuleMigrations(db);
  db.prepare("INSERT INTO networks (id, cidr, name) VALUES (1, '10.7.0.0/24', 'Rete')").run();
  voceWinrm = Number(
    db
      .prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES ('win', 'windows', ?, ?)")
      .run(encrypt("admin"), encrypt("segreto")).lastInsertRowid,
  );
});

function host(ip: string, osInfo: string, conWinrm = true): number {
  const id = Number(
    db.prepare("INSERT INTO hosts (network_id, ip, os_info) VALUES (1, ?, ?)").run(ip, osInfo).lastInsertRowid,
  );
  if (conWinrm) {
    db.prepare(
      "INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, sort_order) VALUES (?, ?, 'winrm', 5985, 1, 0)",
    ).run(id, voceWinrm);
  }
  return id;
}

function operazione(hostId: number, action: string, status: string, userId = 0, errore: string | null = null): void {
  db.prepare(
    "INSERT INTO patch_operations (host_id, user_id, action, status, error_message, finished_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(hostId, userId, action, status, errore, new Date().toISOString());
}

/** Bootstrap finto: registra chi parte e, come quello vero, scrive l'esito nello storico. */
function finto(esito: "ok" | "errore" = "ok", attesaMs = 0) {
  const chiamati: number[] = [];
  let attive = 0;
  let massimo = 0;
  const deps: choco.DipendenzeChoco = {
    moduloAttivo: async () => true,
    bootstrap: async (_tenant, hostId) => {
      chiamati.push(hostId);
      attive++;
      massimo = Math.max(massimo, attive);
      await new Promise((r) => setTimeout(r, attesaMs));
      attive--;
      if (esito === "ok") {
        operazione(hostId, "bootstrap", "success");
        return { success: true };
      }
      operazione(hostId, "bootstrap", "failed", 0, "Porte WinRM 5985/5986 chiuse (RST).");
      return { success: false };
    },
  };
  return { deps, chiamati, massimo: () => massimo };
}

describe("Chocolatey automatico", () => {
  it("credenziali WinRM salvate su un host Windows → bootstrap avviato una volta", async () => {
    const h = host("10.7.0.10", "Microsoft Windows Server 2022");
    const f = finto("ok", 20);
    const [a, b] = await Promise.all([
      choco.installaChocoSuHostDb(db, TENANT, [h], { notte: false }, f.deps),
      choco.installaChocoSuHostDb(db, TENANT, [h], { notte: false }, f.deps),
    ]);
    assert.deepEqual(f.chiamati, [h]);
    assert.equal(a.avviati + b.avviati, 1);
    // Dopo il successo l'host è «installato»: un altro salvataggio non riparte.
    const c = await choco.installaChocoSuHostDb(db, TENANT, [h], { notte: false }, f.deps);
    assert.equal(c.avviati, 0);
    assert.deepEqual(f.chiamati, [h]);
  });

  it("host Linux → niente", async () => {
    const h = host("10.7.0.11", "Ubuntu Linux 22.04");
    const f = finto();
    const r = await choco.installaChocoSuHostDb(db, TENANT, [h], { notte: false }, f.deps);
    assert.equal(r.avviati, 0);
    assert.deepEqual(f.chiamati, []);
  });

  it("host Windows senza credenziale WinRM → niente", async () => {
    const h = host("10.7.0.12", "Windows", false);
    const f = finto();
    await choco.installaChocoSuHostDb(db, TENANT, null, { notte: true }, f.deps);
    assert.deepEqual(f.chiamati, []);
    assert.equal(h > 0, true);
  });

  it("interruttore spento → niente, né al salvataggio né di notte; acceso di default", async () => {
    const h = host("10.7.0.13", "Microsoft Windows Server 2022");
    assert.equal(choco.chocoAutomaticoAccesoDb(db), true);
    choco.impostaChocoAutomaticoDb(db, false);
    assert.equal(choco.chocoAutomaticoAccesoDb(db), false);
    const f = finto();
    await choco.installaChocoSuHostDb(db, TENANT, [h], { notte: false }, f.deps);
    await choco.installaChocoSuHostDb(db, TENANT, null, { notte: true }, f.deps);
    assert.deepEqual(f.chiamati, []);
  });

  it("modulo Patch Management spento → niente", async () => {
    const h = host("10.7.0.14", "Microsoft Windows Server 2022");
    const f = finto();
    f.deps.moduloAttivo = async () => false;
    await choco.installaChocoSuHostDb(db, TENANT, [h], { notte: false }, f.deps);
    assert.deepEqual(f.chiamati, []);
  });

  it("Chocolatey già rilevato dal probe → niente; probe «CHOCO_MISSING» → si installa", async () => {
    const gia = host("10.7.0.15", "Microsoft Windows Server 2022");
    operazione(gia, "probe", "success", 5, null);
    const manca = host("10.7.0.16", "Microsoft Windows Server 2022");
    operazione(manca, "probe", "success", 5, "CHOCO_MISSING");
    const f = finto();
    await choco.installaChocoSuHostDb(db, TENANT, null, { notte: true }, f.deps);
    assert.deepEqual(f.chiamati, [manca]);
  });

  it("un'operazione in corso sull'host → niente (mai due insieme)", async () => {
    const h = host("10.7.0.17", "Microsoft Windows Server 2022");
    operazione(h, "upgrade", "running", 5);
    const f = finto();
    await choco.installaChocoSuHostDb(db, TENANT, [h], { notte: false }, f.deps);
    assert.deepEqual(f.chiamati, []);
  });

  it("errore → nello storico col motivo, si ritenta al giro dopo, al massimo 3 notti; poi lo sblocca un admin", async () => {
    const h = host("10.7.0.18", "Microsoft Windows Server 2022");
    const f = finto("errore");
    for (let notte = 1; notte <= 4; notte++) {
      await choco.installaChocoSuHostDb(db, TENANT, null, { notte: true }, f.deps);
    }
    assert.equal(f.chiamati.length, choco.TENTATIVI_NOTTURNI_MAX);
    const storico = db
      .prepare("SELECT status, error_message FROM patch_operations WHERE host_id = ? AND action = 'bootstrap'")
      .all(h) as Array<{ status: string; error_message: string }>;
    assert.equal(storico.length, 3);
    assert.ok(storico.every((r) => r.status === "failed" && /WinRM/.test(r.error_message)));
    assert.equal(choco.riepilogoChocoDb(db).fermi, 1);

    // Un admin lo riprova a mano (user_id ≠ 0, fallisce ancora): la notte dopo si riparte da zero.
    operazione(h, "bootstrap", "failed", 7, "Timeout");
    await choco.installaChocoSuHostDb(db, TENANT, null, { notte: true }, f.deps);
    assert.equal(f.chiamati.length, 4);
  });

  it("al massimo INSTALLAZIONI_PARALLELE_MAX installazioni insieme, e tutte arrivano in fondo", async () => {
    const ids = Array.from({ length: 8 }, (_, i) => host(`10.7.0.${100 + i}`, "Microsoft Windows Server 2022"));
    const f = finto("ok", 15);
    const r = await choco.installaChocoSuHostDb(db, TENANT, null, { notte: true }, f.deps);
    assert.equal(r.avviati, 8);
    assert.deepEqual([...f.chiamati].sort((a, b) => a - b), ids);
    assert.ok(f.massimo() <= choco.INSTALLAZIONI_PARALLELE_MAX, `insieme: ${f.massimo()}`);
    assert.equal(f.massimo(), choco.INSTALLAZIONI_PARALLELE_MAX);
  });

  it("un bootstrap che lancia non ferma gli altri", async () => {
    const a = host("10.7.0.30", "Microsoft Windows Server 2022");
    const b = host("10.7.0.31", "Microsoft Windows Server 2022");
    const f = finto();
    const vero = f.deps.bootstrap;
    f.deps.bootstrap = async (t, id) => {
      if (id === a) throw new Error("bridge python assente");
      return vero(t, id);
    };
    const r = await choco.installaChocoSuHostDb(db, TENANT, null, { notte: true }, f.deps);
    assert.equal(r.avviati, 2);
    assert.deepEqual(f.chiamati, [b]);
  });
});
