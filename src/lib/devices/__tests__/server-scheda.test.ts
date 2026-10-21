/**
 * Dipendenze e Active Directory di un host per la scheda dei server (T7): le due GET
 * `/api/hosts/[id]/dipendenze` e `/api/hosts/[id]/ad` chiamano queste funzioni.
 *
 * Incidente evitato: i rilievi AD di un DC scritti su un server che DC non è (la sezione AD si legge solo se il
 * server è domain controller), e un host senza asset trattato come errore invece che come «nessun servizio».
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/devices/__tests__/server-scheda.test.ts
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-server-scheda";

import {
  withTenant, deleteTenantDatabase, createNetworkDevice, createService, createInventoryAsset, attachAssetToService,
  createAdIntegration, upsertAdComputer,
} from "@/lib/db-tenant";
import { getDb } from "@/lib/db";
import { ensureAdHealthSchema, finishRun, insertFindings, insertRun } from "@/lib/ad/health/persist";
import { adDelHost, dipendenzeDelHost } from "../server-scheda";

const T = "TESTSERVERSCHEDA";
after(() => deleteTenantDatabase(T));

let seq = 0;
/** Un host nel database del tenant (rete propria per host: l'IP è unico per rete). */
function nuovoHost(ip: string, nome: string): number {
  const db = getDb();
  const net = db.prepare("INSERT INTO networks (cidr, name) VALUES (?, ?)").run(`10.${200 + (seq++)}.0.0/24`, `rete-${seq}`);
  const r = db.prepare("INSERT INTO hosts (network_id, ip, hostname) VALUES (?, ?, ?)").run(Number(net.lastInsertRowid), ip, nome);
  return Number(r.lastInsertRowid);
}
const dispositivo = (hostId: number, ip: string, ruoli?: string[], info?: Record<string, unknown>) => {
  const d = createNetworkDevice({ name: `srv-${ip}`, host: ip, device_type: "server", vendor: "windows", protocol: "winrm", api_url: null, port: 5985, enabled: 1, classification: "server", host_id: hostId } as never);
  getDb().prepare("UPDATE network_devices SET server_roles = ?, last_device_info_json = ? WHERE id = ?")
    .run(ruoli ? JSON.stringify(ruoli) : null, info ? JSON.stringify(info) : null, d.id);
  return d;
};

describe("dipendenzeDelHost", () => {
  it("servizi che dipendono dall'host (via asset), il più critico per primo, con il tipo di dipendenza più forte", () => {
    withTenant(T, () => {
      const hostId = nuovoHost("10.50.0.10", "sql");
      const d = dispositivo(hostId, "10.50.0.10");
      const a1 = createInventoryAsset({ host_id: hostId, hostname: "sql" } as never);
      // secondo asset dello stesso apparato, collegato solo per network_device_id
      const a2 = createInventoryAsset({ network_device_id: d.id, hostname: "sql-bis" } as never);
      const gest = createService({ name: "Gestionale", criticita_servizio: "critica" });
      const doc = createService({ name: "GestDoc", criticita_servizio: "bassa" });
      const vecchio = createService({ name: "Vecchio", stato: "dismesso" });
      attachAssetToService(gest.id, { asset_id: a1.id, dependency_type: "supporto" });
      attachAssetToService(gest.id, { asset_id: a2.id, dependency_type: "primario" });
      attachAssetToService(doc.id, { asset_id: a1.id, dependency_type: "secondario" });
      attachAssetToService(vecchio.id, { asset_id: a1.id });

      const r = dipendenzeDelHost(hostId);
      assert.ok(r);
      assert.deepEqual(r.servizi, [
        { id: gest.id, nome: "Gestionale", criticita: "critica", tipo: "primario" },
        { id: doc.id, nome: "GestDoc", criticita: "bassa", tipo: "secondario" },
      ]);
    });
  });

  it("host senza asset: nessun servizio, non un errore", () => {
    withTenant(T, () => {
      const hostId = nuovoHost("10.50.0.11", "nuovo");
      assert.deepEqual(dipendenzeDelHost(hostId), { servizi: [] });
    });
  });

  it("host inesistente: null (la rotta risponde 404)", () => {
    withTenant(T, () => assert.equal(dipendenzeDelHost(999999), null));
  });
});

describe("adDelHost", () => {
  function integrazione(dc: string) {
    return createAdIntegration({ name: `ad-${dc}`, dc_host: dc, domain: "lab.local", base_dn: "DC=lab,DC=local", encrypted_username: "x", encrypted_password: "x" });
  }
  function controllo(integrationId: number, rilievi: Array<[string, string] | [string, string, string]>, quando = "2026-10-20T08:00:00.000Z", stato: "ok" | "error" = "ok") {
    const db = getDb();
    ensureAdHealthSchema(db);
    const run = insertRun(db, { integrationId, startedAt: quando, statsJson: {} });
    insertFindings(db, run, rilievi.map(([severity, title, regola]) => ({
      ruleId: regola ?? `r-${title}`, axis: "stale" as const, points: 1, severity: severity as "High", title, description: "d", objectCount: 1, sampleDns: [],
    })));
    finishRun(db, run, { status: stato, finishedAt: quando, ...(stato === "ok" ? {} : { errorMessage: "boom" }) });
  }

  it("DC con computer in AD e controllo: OU, sistema, ultimo logon, rilievi (anche con la gravità) e la data del controllo", () => {
    withTenant(T, () => {
      const hostId = nuovoHost("10.50.1.1", "dc01");
      dispositivo(hostId, "10.50.1.1", ["dc", "dns"]);
      const ig = integrazione("10.50.1.1");
      upsertAdComputer(ig.id, { object_guid: "g1", sam_account_name: "DC01$", distinguished_name: "CN=DC01,OU=Domain Controllers,DC=lab,DC=local", operating_system: "Windows Server 2022", last_logon_at: "2026-10-21T07:00:00Z", enabled: 1, host_id: hostId, ou: "Domain Controllers" });
      controllo(ig.id, [["High", "krbtgt: password vecchia"], ["Medium", "Password che non scade"], ["Low", "Indicatore del dominio", "DA-A-DomainScore"]]);

      const r = adDelHost(hostId);
      assert.ok(r);
      assert.deepEqual(r.computer, { ou: "Domain Controllers", os: "Windows Server 2022", ultimo_logon: "2026-10-21T07:00:00Z", abilitato: true });
      assert.deepEqual(r.rilievi, [{ gravita: "High", titolo: "krbtgt: password vecchia" }, { gravita: "Medium", titolo: "Password che non scade" }]);
      assert.equal(r.dc, true);
      assert.equal(r.controllo, "2026-10-20T08:00:00.000Z");
    });
  });

  it("l'ultimo controllo riuscito conta: uno fallito dopo non cancella i rilievi", () => {
    withTenant(T, () => {
      const hostId = nuovoHost("10.50.1.2", "dc02");
      dispositivo(hostId, "10.50.1.2", ["dc"]);
      const ig = integrazione("10.50.1.2");
      upsertAdComputer(ig.id, { object_guid: "g2", sam_account_name: "DC02$", distinguished_name: "CN=DC02,OU=Domain Controllers,DC=lab,DC=local", host_id: hostId, ou: "Domain Controllers" });
      controllo(ig.id, [["Low", "uno"]], "2026-10-19T08:00:00.000Z");
      controllo(ig.id, [], "2026-10-20T08:00:00.000Z", "error");
      assert.deepEqual(adDelHost(hostId)?.rilievi, [{ gravita: "Low", titolo: "uno" }]);
    });
  });

  it("DC con controllo senza rilievi: lista vuota (≠ null, che vuol dire «non so»)", () => {
    withTenant(T, () => {
      const hostId = nuovoHost("10.50.1.3", "dc03");
      dispositivo(hostId, "10.50.1.3", ["dc"]);
      const ig = integrazione("10.50.1.3");
      controllo(ig.id, []);
      assert.deepEqual(adDelHost(hostId)?.rilievi, []);
    });
  });

  it("DC riconosciuto dall'OU anche se server_roles è vuoto; senza controlli rilievi = null", () => {
    withTenant(T, () => {
      const hostId = nuovoHost("10.50.1.4", "dc04");
      dispositivo(hostId, "10.50.1.4");
      const ig = integrazione("10.50.1.99");
      upsertAdComputer(ig.id, { object_guid: "g4", sam_account_name: "DC04$", distinguished_name: "CN=DC04,OU=Domain Controllers,DC=lab,DC=local", host_id: hostId, ou: "Domain Controllers" });
      const r = adDelHost(hostId);
      assert.equal(r?.dc, true);
      assert.equal(r?.rilievi, null);
      assert.ok(r?.computer);
    });
  });

  it("server che non è DC: computer sì, rilievi null anche se l'integrazione ha un controllo", () => {
    withTenant(T, () => {
      const hostId = nuovoHost("10.50.1.5", "app01");
      dispositivo(hostId, "10.50.1.5", ["database"]);
      const ig = integrazione("10.50.1.98");
      upsertAdComputer(ig.id, { object_guid: "g5", sam_account_name: "APP01$", distinguished_name: "CN=APP01,OU=Servers,DC=lab,DC=local", operating_system: "Windows Server 2019", enabled: 0, host_id: hostId, ou: "Servers" });
      controllo(ig.id, [["High", "non suo"]]);
      const r = adDelHost(hostId);
      assert.equal(r?.dc, false);
      assert.equal(r?.rilievi, null);
      assert.deepEqual(r?.computer, { ou: "Servers", os: "Windows Server 2019", ultimo_logon: null, abilitato: false });
    });
  });

  it("host non presente in AD: computer null, rilievi null; OU ricavata dal DN se la colonna è vuota", () => {
    withTenant(T, () => {
      const hostId = nuovoHost("10.50.1.6", "lin01");
      assert.deepEqual(adDelHost(hostId), { computer: null, rilievi: null, dc: false, controllo: null });
      const h2 = nuovoHost("10.50.1.7", "app02");
      const ig = integrazione("10.50.1.97");
      upsertAdComputer(ig.id, { object_guid: "g7", sam_account_name: "APP02$", distinguished_name: "CN=APP02,OU=Servers,OU=Sede,DC=lab,DC=local", host_id: h2 });
      assert.equal(adDelHost(h2)?.computer?.ou, "Sede/Servers");
    });
  });

  it("host inesistente: null (404)", () => {
    withTenant(T, () => assert.equal(adDelHost(999999), null));
  });
});
