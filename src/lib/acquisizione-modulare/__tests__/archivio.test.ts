/**
 * Archivio degli snapshot dell'acquisizione modulare (C1.3, D5): tabelle nel DB del tenant, JSON gzip senza
 * segreti, retention «ultimi 20 + primo e ultimo ok», scelta del caso dubbio, interruttore spento di default.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d)" node --import tsx --test src/lib/acquisizione-modulare/__tests__/archivio.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import * as tenant from "@/lib/db-tenant";
import { salvaSnapshot, leggiPayload } from "@/lib/acquisizione-modulare/archivio";
import { snapshotDiErrore } from "@/lib/acquisizione-modulare/snapshot-errore";

const T = "TESTACQARCHIVIO";
const ALTRO = "TESTACQARCHIVIO2";
const { withTenant, getTenantDb, deleteTenantDatabase } = tenant;
let dev = 0;

function nuovoApparato(code: string, nome: string): number {
  return Number(getTenantDb(code).prepare(
    "INSERT INTO network_devices (name, host, device_type, vendor, protocol, port) VALUES (?, '192.0.2.10', 'switch', 'hp', 'ssh', 22)",
  ).run(nome).lastInsertRowid);
}

function salva(status: "ok" | "partial" | "error", minuto: number): number {
  const s = snapshotDiErrore("hp-procurve", "192.0.2.10", "PROVA");
  s.status = status;
  s.collected_at = new Date(Date.UTC(2026, 9, 22, 8, minuto)).toISOString();
  return salvaSnapshot(dev, s, { credenziali: { ssh: { credential_id: 1, nome: "lettura" } }, utente: { id: 7, nome: "r.admin" } });
}

describe("archivio degli snapshot", () => {
  before(() => {
    withTenant(T, () => { dev = nuovoApparato(T, "sw-lab-01"); });
    withTenant(ALTRO, () => { nuovoApparato(ALTRO, "sw-altro"); });
  });
  after(() => { deleteTenantDatabase(T); deleteTenantDatabase(ALTRO); });

  it("le tabelle esistono nel DB del tenant, non nell'altro tenant i dati", () => {
    withTenant(T, () => {
      const id = salva("ok", 0);
      assert.ok(id > 0);
      const n = getTenantDb(T).prepare("SELECT COUNT(*) AS n FROM acquisition_snapshots").get() as { n: number };
      assert.equal(n.n, 1);
    });
    withTenant(ALTRO, () => {
      const n = getTenantDb(ALTRO).prepare("SELECT COUNT(*) AS n FROM acquisition_snapshots").get() as { n: number };
      assert.equal(n.n, 0, "lo snapshot di un tenant non finisce nell'altro");
    });
  });

  it("payload gzip, impronta del JSON, dimensioni e stati per sezione", () => {
    withTenant(T, () => {
      const id = salva("partial", 1);
      const r = getTenantDb(T).prepare("SELECT * FROM acquisition_snapshots WHERE id = ?").get(id) as Record<string, unknown>;
      const json = gunzipSync(r.payload as Buffer).toString("utf8");
      assert.equal(r.payload_bytes, Buffer.byteLength(json));
      assert.equal(r.status, "partial");
      assert.equal(JSON.parse(String(r.section_status)).identity, "error");
      assert.equal(r.requested_by_name, "r.admin");
      assert.equal(JSON.parse(String(r.credenziali)).ssh.nome, "lettura");
      const letto = leggiPayload(dev, id);
      assert.ok(letto.ok);
      if (letto.ok) assert.equal(letto.snapshot.collector, "hp-procurve");
    });
  });

  it("un payload che non passa lo schema non si salva", () => {
    withTenant(T, () => {
      const s = snapshotDiErrore("hp-procurve", "192.0.2.10", "PROVA") as unknown as Record<string, unknown>;
      s.status = "inventato";
      assert.throws(() => salvaSnapshot(dev, s as never, { credenziali: {}, utente: null }));
    });
  });

  it("retention D5: ultimi 20, più il primo e l'ultimo ok; un errore non spinge fuori l'ultimo riuscito", () => {
    withTenant(T, () => {
      getTenantDb(T).prepare("DELETE FROM acquisition_snapshots").run();
      const primoOk = salva("ok", 2);
      salva("partial", 3);
      const ultimoOk = salva("ok", 4);
      for (let i = 0; i < 25; i++) salva("error", 10 + i);
      const ids = (getTenantDb(T).prepare("SELECT id FROM acquisition_snapshots WHERE device_id = ? ORDER BY id").all(dev) as Array<{ id: number }>).map((r) => r.id);
      assert.equal(ids.length, 22, "20 recenti + primo ok + ultimo ok");
      assert.ok(ids.includes(primoOk), "il primo ok resta");
      assert.ok(ids.includes(ultimoOk), "l'ultimo ok resta");
    });
  });

  it("scelta della fonte nel caso dubbio e interruttore spento di default", () => {
    withTenant(T, () => {
      assert.equal(tenant.acquisizioneModulareAccesa(), false, "assente = spento");
      tenant.impostaAcquisizioneModulare(true);
      assert.equal(tenant.acquisizioneModulareAccesa(), true);
      tenant.impostaAcquisizioneModulare(false);
      assert.equal(tenant.acquisizioneModulareAccesa(), false);
      assert.equal(tenant.sceltaFonteAcquisizione(dev), null);
      tenant.salvaSceltaFonteAcquisizione(dev, "hp-comware", { id: 7, nome: "r.admin" });
      assert.equal(tenant.sceltaFonteAcquisizione(dev)?.scelta, "hp-comware");
      tenant.salvaSceltaFonteAcquisizione(dev, "classica", { id: 7, nome: "r.admin" });
      assert.equal(tenant.sceltaFonteAcquisizione(dev)?.scelta, "classica");
    });
  });

  it("elenco paginato con le sole colonne piccole", () => {
    withTenant(T, () => {
      const p = tenant.elencoSnapshotAcquisizione(dev, 5, 0);
      assert.equal(p.righe.length, 5);
      assert.equal(p.totale, 22);
      assert.ok(!("payload" in p.righe[0]), "la lista non porta il payload");
    });
  });
});
