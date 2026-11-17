/**
 * Archivio del DNS di Active Directory: si riscrive a ogni lettura riuscita, e una lettura
 * fallita non lo svuota (una fetch che su errore dà «lista vuota» è una cancellazione differita).
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/ad/dns/__tests__/archivio.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  withTenant, getTenantDb, deleteTenantDatabase,
  getRecordDnsAd, getRecordDnsAdPaginati, getStatoDnsAd, getZoneDnsAd, sostituisciDnsAd,
  getVolutiDnsAd, segnaVolutoDnsAd, togliVolutoDnsAd,
} from "@/lib/db-tenant";
import { syncAdDns, type connectLdap } from "@/lib/ad/ad-client";
import type { AdIntegration } from "@/lib/db";
import type { VoceDns, ZonaDns } from "../record";

void TEST_DATA_DIR;
const T = "TESTDNSAD";

const ZONE: ZonaDns[] = [
  { nome: "esempio.local", inversa: false, partizione: "dominio" },
  { nome: "4.168.192.in-addr.arpa", inversa: true, partizione: "dominio" },
];
function a(nome: string, ip: string): VoceDns {
  return { zona: "esempio.local", nome, fqdn: `${nome}.esempio.local`, tipo: "A", dato: ip, ip, statica: true, rinnovataIl: null, ttl: 3600 };
}

/** Un record A nella forma vera di AD (statico). */
function recordA(ip: number[]): Buffer {
  const b = Buffer.alloc(28);
  b.writeUInt16LE(4, 0);
  b.writeUInt16LE(1, 2);
  Buffer.from(ip).copy(b, 24);
  return b;
}

/** Collegamento finto: una zona e i nodi dati sulla partizione del dominio, le altre non esistono. */
function collegamento(nodi: Record<string, number[]>, guasto?: Error): typeof connectLdap {
  return (async () => ({
    search: async (base: string, opzioni: { filter: string }) => {
      if (!base.startsWith("DC=DomainDnsZones")) throw Object.assign(new Error("no such object"), { code: 32 });
      if (guasto) throw guasto;
      if (opzioni.filter.includes("dnsZone")) return { searchEntries: [{ dn: "DC=esempio.local,CN=MicrosoftDNS,DC=DomainDnsZones,DC=esempio,DC=local", name: "esempio.local" }] };
      return {
        searchEntries: Object.entries(nodi).map(([nome, ip]) => ({
          dn: `DC=${nome},DC=esempio.local,CN=MicrosoftDNS,DC=DomainDnsZones,DC=esempio,DC=local`,
          dnsRecord: [recordA(ip)],
        })),
      };
    },
    unbind: async () => undefined,
  })) as unknown as typeof connectLdap;
}

describe("archivio del DNS di AD", () => {
  let integrazione: AdIntegration;
  before(() => {
    const d = getTenantDb(T);
    for (const id of [1, 2]) {
      d.prepare("INSERT INTO ad_integrations (id, name, dc_host, domain, base_dn, encrypted_username, encrypted_password) VALUES (?, ?, ?, 'esempio.local', 'DC=esempio,DC=local', '', '')")
        .run(id, `Dominio ${id}`, `10.80.0.${id}`);
    }
    integrazione = d.prepare("SELECT * FROM ad_integrations WHERE id = 1").get() as AdIntegration;
  });
  after(() => deleteTenantDatabase(T));

  it("due integrazioni restano separate e una seconda scrittura sostituisce la prima", () => {
    withTenant(T, () => {
      sostituisciDnsAd(1, ZONE, [a("pc-01", "192.168.4.10"), a("pc-02", "192.168.4.11")]);
      sostituisciDnsAd(2, ZONE, [a("srv", "192.168.4.20")]);
      sostituisciDnsAd(1, ZONE, [a("pc-03", "192.168.4.12")]);
      assert.deepEqual(getRecordDnsAd(1).map((r) => r.fqdn), ["pc-03.esempio.local"]);
      assert.deepEqual(getRecordDnsAd(2).map((r) => r.fqdn), ["srv.esempio.local"]);
      assert.equal(getZoneDnsAd(1).length, 2);
      assert.equal(getRecordDnsAdPaginati(2, 1, 25, { cerca: "192.168.4.2" }).total, 1);
      assert.equal(getRecordDnsAdPaginati(2, 1, 25, { tipo: "PTR" }).total, 0);
    });
  });

  it("sincronizzazione riuscita: record scritti, stato senza errore", async () => {
    const n = await withTenant(T, () => syncAdDns(integrazione, collegamento({ "pc-10": [192, 168, 4, 30], "@": [192, 168, 4, 1], "_ldap._tcp": [192, 168, 4, 1] })));
    assert.equal(n, 1, "apice e servizi di dominio restano fuori");
    withTenant(T, () => {
      assert.deepEqual(getRecordDnsAd(1).map((r) => [r.fqdn, r.ip, r.statica]), [["pc-10.esempio.local", "192.168.4.30", 1]]);
      const stato = getStatoDnsAd(1);
      assert.equal(stato.errore, null);
      assert.match(stato.letto_il ?? "", /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });
  });

  it("lettura fallita: i record di prima restano, l'errore è scritto, l'ultima riuscita non cambia", async () => {
    const prima = withTenant(T, () => getStatoDnsAd(1).letto_il);
    await assert.rejects(withTenant(T, () => syncAdDns(integrazione, collegamento({}, Object.assign(new Error("tempo scaduto"), { code: 85 })))), /tempo scaduto/);
    withTenant(T, () => {
      assert.deepEqual(getRecordDnsAd(1).map((r) => r.fqdn), ["pc-10.esempio.local"]);
      const stato = getStatoDnsAd(1);
      assert.match(stato.errore ?? "", /tempo scaduto/);
      assert.equal(stato.letto_il, prima);
    });
  });

  it("anomalie segnate come volute: si scrivono, si aggiornano, si tolgono", () => {
    withTenant(T, () => {
      segnaVolutoDnsAd(1, "ip_piu_nomi:192.168.4.30", "alias voluto", "riccardo");
      segnaVolutoDnsAd(1, "ip_piu_nomi:192.168.4.30", "due nomi dello stesso server", "riccardo");
      assert.deepEqual(getVolutiDnsAd(1).map((v) => [v.chiave, v.nota]), [["ip_piu_nomi:192.168.4.30", "due nomi dello stesso server"]]);
      assert.equal(togliVolutoDnsAd(1, "ip_piu_nomi:192.168.4.30"), true);
      assert.equal(getVolutiDnsAd(1).length, 0);
    });
  });
});
