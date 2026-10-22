/**
 * Esecuzione di un'acquisizione con collector (C1.2-C1.3): richiesta costruita nel backend dalle voci della fonte, un
 * tentativo solo, snapshot salvato anche in errore, nessun segreto nel DB, lucchetto per apparato, apparato popolato.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d)" node --import tsx --test src/lib/acquisizione-modulare/__tests__/esegui.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-acquisizione-modulare";

import { encrypt } from "@/lib/crypto";
import * as tenant from "@/lib/db-tenant";
import { collectDevice, type AcquisitionRequest, type AcquisitionTransports } from "@/lib/acquisition";
import type { ReadResult } from "@/lib/acquisition/schema";
import { dipendenzeDb, valutaFonte } from "@/lib/acquisizione-modulare/fonte";
import { lettoreDb } from "@/lib/acquisizione-modulare/richiesta";
import { eseguiAcquisizioneModulare, prendiLucchetto, acquisizioneInCorso, type DipendenzeEsecuzione } from "@/lib/acquisizione-modulare/esegui";

const T = "TESTACQESEGUI";
const SEGRETO = "Segreto-Di-Prova-Mai-Nel-DB";
const COMMUNITY = "community-di-prova-mai-nel-db";
const { withTenant, getTenantDb, deleteTenantDatabase } = tenant;
let dev = 0;
let credSsh = 0;

const ok = <T>(data: T): ReadResult<T> => ({ status: "ok", data, warnings: [] });

/** Uscite ProCurve con la forma vera (dati inventati); il nome di sistema contiene il segreto, come un'eco dell'apparato. */
function trasportiProcurve(contatore: { shell: number; sessioniAperte: number }, guasto = false): AcquisitionTransports {
  return {
    get: async () => ok([{ oid: "1.3.6.1.2.1.1.1.0", value: "Aruba JL357A 2540-48G-PoE+-4SFP+ Switch, revision YC.16.11.0020, ROM YC.16.01.0003" }, { oid: "1.3.6.1.2.1.1.5.0", value: `sw-${SEGRETO}` }]),
    walk: async () => ok([]),
    shell: async (comandi) => {
      contatore.shell++;
      contatore.sessioniAperte++;
      try {
        if (guasto && contatore.shell > 1) throw new Error(`caduta a metà ${SEGRETO}`);
        return Object.fromEntries(comandi.map((c) => [c, ok(
          c === "show system" ? `System Name : sw-${SEGRETO}\nSoftware revision : YC.16.11.0020 Base MAC Addr : 020000-000001\nSerial Number : LAB001`
            : c === "show version" ? "YC.16.11.0020"
              : c === "show interfaces brief" ? "1 100/1000T | No Yes Up 1000FDx Auto off 0\n2 100/1000T | No Yes Down 1000FDx Auto off 0"
                : "")]));
      } finally {
        contatore.sessioniAperte--; // come withSshClient: la sessione si chiude anche su eccezione
      }
    },
  };
}

function deps(contatore: { collect: number; shell: number; sessioniAperte: number }, guasto = false, lancia = false): DipendenzeEsecuzione {
  return {
    collect: async (r: AcquisitionRequest) => {
      contatore.collect++;
      if (lancia) throw new Error(`eccezione con ${SEGRETO}`);
      return collectDevice(r, trasportiProcurve(contatore, guasto));
    },
    leggi: lettoreDb(getTenantDb(T)),
    adesso: () => new Date("2026-10-22T08:00:00.000Z"),
  };
}

function fontePronta() {
  const d = tenant.getNetworkDeviceById(dev);
  assert.ok(d);
  const v = valutaFonte(d, dipendenzeDb());
  assert.equal(v.esito, "pronta");
  if (v.esito !== "pronta") throw new Error("fonte non pronta");
  return { d, v };
}

async function esegui(c: { collect: number; shell: number; sessioniAperte: number }, guasto = false, lancia = false) {
  const { d, v } = fontePronta();
  assert.ok(prendiLucchetto(dev));
  return eseguiAcquisizioneModulare({ deviceId: dev, device: d, collector: v.collector, credenziali: v.credenziali, utente: { id: 7, nome: "r.admin" } }, deps(c, guasto, lancia));
}

const payloadDi = (id: number): string => gunzipSync((getTenantDb(T).prepare("SELECT payload FROM acquisition_snapshots WHERE id = ?").get(id) as { payload: Buffer }).payload).toString("utf8");

describe("eseguiAcquisizioneModulare", () => {
  before(() => {
    withTenant(T, () => {
      const d = getTenantDb(T);
      dev = Number(d.prepare("INSERT INTO network_devices (name, host, device_type, vendor, vendor_subtype, protocol, port) VALUES ('sw-lab', '192.0.2.30', 'switch', 'hp', 'procurve', 'ssh', 22)").run().lastInsertRowid);
      credSsh = Number(d.prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES ('lettura-switch', 'ssh', ?, ?)").run(encrypt("lab"), encrypt(SEGRETO)).lastInsertRowid);
      const credSnmp = Number(d.prepare("INSERT INTO credentials (name, credential_type, encrypted_password) VALUES ('community-rete', 'snmp', ?)").run(encrypt(COMMUNITY)).lastInsertRowid);
      d.prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, sort_order, test_status) VALUES (?, ?, 'ssh', 22, 0, 'success')").run(dev, credSsh);
      d.prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, sort_order, test_status) VALUES (?, ?, 'snmp', 161, 1, 'untested')").run(dev, credSnmp);
      tenant.impostaAcquisizioneModulare(true);
    });
  });
  after(() => deleteTenantDatabase(T));

  it("legge con le voci della fonte, salva lo snapshot senza segreti e coi nomi delle credenziali", async () => {
    await withTenant(T, async () => {
      const c = { collect: 0, shell: 0, sessioniAperte: 0 };
      const e = await esegui(c);
      assert.equal(c.collect, 1, "un tentativo solo");
      assert.notEqual(e.status, "error");
      const json = payloadDi(e.snapshotId);
      assert.ok(!json.includes(SEGRETO) && !json.includes(COMMUNITY), "nessun segreto nel payload");
      const r = getTenantDb(T).prepare("SELECT credenziali, requested_by_name FROM acquisition_snapshots WHERE id = ?").get(e.snapshotId) as { credenziali: string; requested_by_name: string };
      assert.deepEqual(Object.keys(JSON.parse(r.credenziali)).sort(), ["snmp", "ssh"]);
      assert.ok(!r.credenziali.includes(SEGRETO));
      assert.equal(r.requested_by_name, "r.admin");
      assert.equal(acquisizioneInCorso(dev), false, "lucchetto lasciato");
    });
  });

  it("caduta a metà della lettura: sessioni chiuse, snapshot salvato com'è, nessuna seconda credenziale", async () => {
    await withTenant(T, async () => {
      const c = { collect: 0, shell: 0, sessioniAperte: 0 };
      const e = await esegui(c, true);
      assert.equal(c.sessioniAperte, 0, "ogni sessione aperta è stata chiusa");
      assert.equal(c.collect, 1);
      assert.ok(!payloadDi(e.snapshotId).includes(SEGRETO));
    });
  });

  it("eccezione del collector: snapshot d'errore col solo codice, lucchetto lasciato", async () => {
    await withTenant(T, async () => {
      const c = { collect: 0, shell: 0, sessioniAperte: 0 };
      const e = await esegui(c, false, true);
      assert.equal(e.status, "error");
      assert.equal(e.errore, "COLLECTOR_EXCEPTION");
      const json = payloadDi(e.snapshotId);
      assert.ok(json.includes("COLLECTOR_EXCEPTION") && !json.includes(SEGRETO));
      assert.equal(acquisizioneInCorso(dev), false);
    });
  });

  it("credenziale illeggibile: errore detto, il collector non parte, nessun ripiego su un'altra voce", async () => {
    await withTenant(T, async () => {
      getTenantDb(T).prepare("UPDATE credentials SET encrypted_password = 'non-cifrato' WHERE id = ?").run(credSsh);
      const c = { collect: 0, shell: 0, sessioniAperte: 0 };
      const e = await esegui(c);
      assert.equal(c.collect, 0, "nessuna lettura con credenziali a metà");
      assert.equal(e.errore, "CREDENTIAL_UNREADABLE");
      getTenantDb(T).prepare("UPDATE credentials SET encrypted_password = ? WHERE id = ?").run(encrypt(SEGRETO), credSsh);
    });
  });

  it("una sola acquisizione per apparato alla volta", () => {
    withTenant(T, () => {
      assert.equal(prendiLucchetto(dev), true);
      assert.equal(prendiLucchetto(dev), false, "la seconda richiesta trova il lucchetto");
    });
  });

  it("lo snapshot letto popola l'apparato (C2): porte, firmware e modifiche registrate con lo snapshot", () => {
    withTenant(T, () => {
      const d = getTenantDb(T);
      const n = (sql: string) => (d.prepare(sql).get() as { n: number }).n;
      assert.equal(n("SELECT COUNT(*) AS n FROM switch_ports"), 2, "le due porte lette");
      assert.equal((d.prepare("SELECT firmware FROM network_devices WHERE id = ?").get(dev) as { firmware: string | null }).firmware, "YC.16.11.0020");
      assert.ok(n("SELECT COUNT(*) AS n FROM acquisition_changes c JOIN acquisition_snapshots s ON s.id = c.snapshot_id") > 0);
      const json = JSON.stringify(d.prepare("SELECT * FROM acquisition_changes").all());
      assert.ok(!json.includes(SEGRETO) && !json.includes(COMMUNITY), "nessun segreto nelle modifiche");
    });
  });
});
