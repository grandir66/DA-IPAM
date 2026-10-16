/**
 * Una firma di porte non è un modello (appliance pilota, 16/10).
 *
 * Incidente: 192.168.99.250, un UniFi Cloud Gateway Fiber, classificato bene
 * (router, Ubiquiti) ma con hosts.model = «QNAP QTS». L'impronta aveva solo
 * porte (22, 53, 80, 443, 8080, 8443, 9443) e la firma «QNAP QTS» (8080+22+443)
 * vinceva su «UniFi Controller»: final_device finiva tale e quale nel modello.
 * Poi le scansioni con preserve_existing non lo sostituivano più, nemmeno con
 * il modello letto dal sysDescr SNMP («Ubiquiti UniFi UCG-Fiber 5.1.33 …»).
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/__tests__/modello-da-impronta.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { DeviceFingerprintSnapshot } from "@/types";
import { applicaProfiloVendor, modelloDaImpronta } from "@/lib/device-fingerprint-classification";
import { parseModelFromSysDescr } from "@/lib/scanner/discovery";
import { withTenant, getTenantDb, deleteTenantDatabase, upsertHost as upsertTenant } from "@/lib/db-tenant";
import { upsertHost as upsertFacciata } from "@/lib/db";

/** detection_json vero del gateway sul pilota (16/10), stessa forma dei campi. */
const IMPRONTA_GATEWAY: DeviceFingerprintSnapshot = {
  ip: "192.168.99.250",
  hostname: null,
  mac: null,
  ttl: 64,
  os_hint: "Linux/Unix (TTL 64)",
  open_ports: [22, 53, 80, 443, 8080, 8443, 9443],
  matches: [
    { name: "Linux generico", confidence: 0.85, matched_ports: [22, 80, 443] },
    { name: "QNAP QTS", confidence: 0.825, matched_ports: [8080, 22, 443] },
    { name: "UniFi Controller", confidence: 0.7833, matched_ports: [8443, 8080, 22] },
  ],
  banner_http: null,
  banner_ssh: null,
  snmp_sysdescr: null,
  snmp_vendor_oid: null,
  final_device: "QNAP QTS",
  final_confidence: 0.825,
  detection_sources: ["ttl", "port_signature", "rule:ports"],
  generated_at: "2026-10-16T01:27:00.000Z",
};

const SYSDESCR_GATEWAY = "Ubiquiti UniFi UCG-Fiber 5.1.33 Linux 5.4.213 ipq9574";

describe("modelloDaImpronta: l'etichetta diventa modello solo con una fonte che non sia di porte", () => {
  it("caso vero: solo ttl + port_signature + rule:ports → nessun modello", () => {
    assert.equal(modelloDaImpronta(IMPRONTA_GATEWAY), undefined);
  });

  it("regola di sole porte e ttl (rule:ports+ttl) → nessun modello", () => {
    assert.equal(
      modelloDaImpronta({ ...IMPRONTA_GATEWAY, detection_sources: ["ttl", "port_signature", "rule:ports+ttl"] }),
      undefined,
    );
  });

  it("con una regola sul sysDescr o sull'OID → l'etichetta resta modello", () => {
    assert.equal(
      modelloDaImpronta({ ...IMPRONTA_GATEWAY, detection_sources: ["ttl", "port_signature", "rule:ports+sysdescr"] }),
      "QNAP QTS",
    );
    assert.equal(
      modelloDaImpronta({ ...IMPRONTA_GATEWAY, detection_sources: ["ttl", "port_signature", "snmp", "rule:oid"] }),
      "QNAP QTS",
    );
  });

  it("banner, snmp, smb e nmap_os non decidono l'etichetta → nessun modello", () => {
    // In device-fingerprint.ts queste fonti entrano in detection_sources appena la sonda
    // risponde, ma final_device lo decide solo una rule:<x> oppure matches[0] (le porte):
    // col banner SSH della porta 22 la firma «QNAP QTS» tornava modello.
    assert.equal(
      modelloDaImpronta({ ...IMPRONTA_GATEWAY, detection_sources: ["port_signature", "banner_http"] }),
      undefined,
    );
    assert.equal(
      modelloDaImpronta({ ...IMPRONTA_GATEWAY, detection_sources: ["ttl", "port_signature", "banner_ssh", "rule:ports"] }),
      undefined,
    );
    assert.equal(
      modelloDaImpronta({
        ...IMPRONTA_GATEWAY,
        detection_sources: ["ttl", "port_signature", "snmp", "smb_os_discovery", "nmap_os", "rule:ports"],
      }),
      undefined,
    );
  });

  it("profilo vendor che ha sostituito l'etichetta → resta modello", () => {
    assert.equal(
      modelloDaImpronta({
        ...IMPRONTA_GATEWAY,
        final_device: "Ubiquiti UniFi Switch",
        final_confidence: 0.92,
        detection_sources: ["ttl", "port_signature", "snmp_vendor_profile"],
      }),
      "Ubiquiti UniFi Switch",
    );
  });

  it("sotto la soglia di confidenza → nessun modello, come prima", () => {
    assert.equal(
      modelloDaImpronta({ ...IMPRONTA_GATEWAY, final_confidence: 0.4, detection_sources: ["rule:sysdescr"] }),
      undefined,
    );
  });

  it("nessuna impronta → nessun modello", () => {
    assert.equal(modelloDaImpronta(null), undefined);
  });
});

describe("applicaProfiloVendor: l'etichetta del profilo vendor diventa modello", () => {
  it("impronta generica di porte + profilo a 0,92 → «Ubiquiti UniFi Switch» è modello", () => {
    const generica: DeviceFingerprintSnapshot = {
      ...IMPRONTA_GATEWAY,
      final_device: "Linux generico",
      final_confidence: 0.85,
      detection_sources: ["ttl", "port_signature"],
    };
    const snap = applicaProfiloVendor(generica, "Ubiquiti UniFi Switch", 0.92, false);
    assert.equal(snap?.final_device, "Ubiquiti UniFi Switch");
    assert.equal(modelloDaImpronta(snap), "Ubiquiti UniFi Switch");
  });

  it("impronta specifica, profilo generico o sotto 0,90 → l'impronta resta com'era", () => {
    assert.equal(applicaProfiloVendor(IMPRONTA_GATEWAY, "Ubiquiti UniFi Switch", 0.92, false), IMPRONTA_GATEWAY);
    const generica = { ...IMPRONTA_GATEWAY, final_device: "Linux generico" };
    assert.equal(applicaProfiloVendor(generica, "Linux", 0.95, true), generica);
    assert.equal(applicaProfiloVendor(generica, "Ubiquiti UniFi Switch", 0.85, false), generica);
    assert.equal(applicaProfiloVendor(null, "Ubiquiti UniFi Switch", 0.92, false), null);
  });
});

describe("parseModelFromSysDescr", () => {
  it("Cloud Gateway UniFi: «Ubiquiti UniFi <MODELLO> <versione> …» → modello e firmware", () => {
    assert.deepEqual(parseModelFromSysDescr(SYSDESCR_GATEWAY), { model: "UCG-Fiber", firmware: "5.1.33" });
  });

  it("i casi che c'erano non cambiano (switch e AP UniFi, MikroTik, Cisco, HP)", () => {
    assert.deepEqual(parseModelFromSysDescr("USW-Flex 7.2.123.16565"), { model: "USW-Flex", firmware: "7.2.123.16565" });
    assert.deepEqual(
      parseModelFromSysDescr("USW-Pro-48-PoE, 7.2.123.16565, Linux 3.6"),
      { model: "USW-Pro-48-PoE", firmware: "7.2.123.16565" },
    );
    assert.deepEqual(parseModelFromSysDescr("U7-Pro 8.4.6.18068"), { model: "U7-Pro", firmware: "8.4.6.18068" });
    assert.deepEqual(parseModelFromSysDescr("RouterOS CCR2004-1G-12S+2XS"), { model: "CCR2004-1G-12S+2XS", firmware: null });
    assert.deepEqual(
      parseModelFromSysDescr("Cisco IOS Software, C2960 Software (C2960-LANBASEK9-M), Version 15.0(2)SE"),
      { model: "C2960", firmware: "15.0(2)SE" },
    );
    assert.deepEqual(parseModelFromSysDescr("ProCurve J9729A 2920-48G-POE+ Switch"), { model: "J9729A 2920-48G-POE+", firmware: null });
    assert.deepEqual(parseModelFromSysDescr(null), { model: null, firmware: null });
  });
});

const T = "TESTMODELLODAIMPRONTA";

type Upsert = typeof upsertTenant;

function modello(ip: string): string | null {
  return (getTenantDb(T).prepare("SELECT model FROM hosts WHERE ip = ?").get(ip) as { model: string | null }).model;
}

/** Riga come la lascia oggi il pilota: modello = etichetta dell'impronta di porte. */
function host(reteId: number, ip: string, model: string, detection: DeviceFingerprintSnapshot | null = IMPRONTA_GATEWAY): void {
  getTenantDb(T)
    .prepare("INSERT INTO hosts (network_id, ip, status, model, detection_json) VALUES (?, ?, 'online', ?, ?)")
    .run(reteId, ip, model, detection ? JSON.stringify(detection) : null);
}

/** Come la chiama la scansione (discovery.ts): preserve_existing e impronta nuova. */
function scansione(upsert: Upsert, reteId: number, ip: string, model: string | undefined): void {
  withTenant(T, () =>
    upsert({
      network_id: reteId,
      ip,
      status: "online",
      model,
      preserve_existing: true,
      detection_json: JSON.stringify({ ...IMPRONTA_GATEWAY, ip, generated_at: "2026-10-17T01:27:00.000Z" }),
    }),
  );
}

for (const [nome, upsert] of [["db-tenant", upsertTenant], ["facciata db.ts", upsertFacciata]] as const) {
  describe(`upsertHost (${nome}): un modello che è solo un'etichetta di porte non si preserva`, () => {
    let reteId = 0;
    before(() => {
      deleteTenantDatabase(T);
      reteId = withTenant(T, () =>
        Number(
          getTenantDb(T)
            .prepare("INSERT INTO networks (cidr, name) VALUES ('192.168.99.0/24', 'pilota')")
            .run().lastInsertRowid,
        ),
      );
    });
    after(() => deleteTenantDatabase(T));

    it("scansione con modello SNMP: «QNAP QTS» lascia il posto a «UCG-Fiber»", () => {
      withTenant(T, () => host(reteId, "192.168.99.250", "QNAP QTS"));
      scansione(upsert, reteId, "192.168.99.250", "UCG-Fiber");
      assert.equal(modello("192.168.99.250"), "UCG-Fiber");
    });

    it("scansione senza modello: «QNAP QTS» si azzera", () => {
      withTenant(T, () => host(reteId, "192.168.99.251", "QNAP QTS"));
      scansione(upsert, reteId, "192.168.99.251", undefined);
      assert.equal(modello("192.168.99.251"), null);
    });

    it("l'etichetta è riconosciuta anche dall'impronta nuova, se la salvata manca", () => {
      withTenant(T, () => host(reteId, "192.168.99.252", "QNAP QTS", null));
      scansione(upsert, reteId, "192.168.99.252", undefined);
      assert.equal(modello("192.168.99.252"), null);
    });

    it("un modello diverso dall'etichetta (a mano, SNMP, agente) non si tocca", () => {
      withTenant(T, () => host(reteId, "192.168.99.253", "UCG-Fiber"));
      scansione(upsert, reteId, "192.168.99.253", undefined);
      assert.equal(modello("192.168.99.253"), "UCG-Fiber");
      scansione(upsert, reteId, "192.168.99.253", "Altro");
      assert.equal(modello("192.168.99.253"), "UCG-Fiber");
    });

    it("modello da una regola OID, poi scansione senza SNMP (impronta di porte con la stessa etichetta) → resta", () => {
      // Le regole del seed condividono l'etichetta fra porte e OID/sysDescr/banner/MAC: scan_naabu e
      // scan_nmap_base non interrogano l'SNMP e passano un'impronta di sole porte «QNAP QTS».
      const daOid = { ...IMPRONTA_GATEWAY, detection_sources: ["ttl", "port_signature", "snmp", "rule:oid"] };
      withTenant(T, () => host(reteId, "192.168.99.249", "QNAP QTS", daOid));
      scansione(upsert, reteId, "192.168.99.249", undefined);
      assert.equal(modello("192.168.99.249"), "QNAP QTS");
    });

    it("etichetta di un'impronta con fonti vere (sysDescr) → resta, come prima", () => {
      const vera = { ...IMPRONTA_GATEWAY, detection_sources: ["ttl", "port_signature", "rule:ports+sysdescr"] };
      withTenant(T, () => host(reteId, "192.168.99.254", "QNAP QTS", vera));
      withTenant(T, () =>
        upsert({
          network_id: reteId,
          ip: "192.168.99.254",
          status: "online",
          model: undefined,
          preserve_existing: true,
          detection_json: JSON.stringify(vera),
        }),
      );
      assert.equal(modello("192.168.99.254"), "QNAP QTS");
    });
  });
}
