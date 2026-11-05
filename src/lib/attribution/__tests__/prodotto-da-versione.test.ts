/**
 * Il prodotto letto nella stringa di versione dei servizi (Riccardo, 05/11/2026, provando
 * sul banco: «nmap non ha riconosciuto né proxmox né un server windows»).
 *
 * Le stringhe sono quelle **vere** misurate quella notte sull'appliance 79993-ipam-2:
 * il Proxmox `192.168.99.1` e il server Windows `192.168.99.71`.
 *
 * Run: node --import tsx --test src/lib/attribution/__tests__/prodotto-da-versione.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emitEvidenceFromSignals, prodottoDaVersione } from "../emitters";
import { isValidCategory } from "../taxonomy";
import { ATTR_SOURCE_WEIGHTS } from "../weights";
import { MIN_CLAIM_SCORE } from "../types";
import { fuseAttribution } from "../fuse";
import type { AttributionEvidenceRow } from "../types";

type Porta = { port: number; protocol: string; service: string | null; version: string | null };

const segnali = (porte: Porta[]) => ({
  host: {
    id: 1, ip: "192.168.99.1", mac: null, vendor: null, hostname: null,
    os_info: null, open_ports: JSON.stringify(porte), snmp_data: null, detection_json: null,
  },
  adComputer: null,
  wazuh: null,
  neighborSightings: [],
});

/** Le porte vere del Proxmox del banco, come stanno in `hosts.open_ports`. */
const PORTE_PROXMOX: Porta[] = [
  { port: 22, protocol: "tcp", service: "ssh", version: "OpenSSH 10.0p2 Debian 7+deb13u4" },
  { port: 111, protocol: "tcp", service: "rpcbind", version: null },
  { port: 3128, protocol: "tcp", service: "http", version: "Proxmox Virtual Environment REST API 3.0" },
  { port: 8006, protocol: "tcp", service: "wpl-analytics", version: null },
];

/** Le porte vere del server Windows del banco. */
const PORTE_WINDOWS: Porta[] = [
  { port: 135, protocol: "tcp", service: "msrpc", version: "Microsoft Windows RPC" },
  { port: 139, protocol: "tcp", service: "netbios-ssn", version: "Microsoft Windows netbios-ssn" },
  { port: 445, protocol: "tcp", service: "microsoft-ds", version: null },
  { port: 3389, protocol: "tcp", service: "ms-wbt-server", version: null },
];

const evidenze = (porte: Porta[]) => emitEvidenceFromSignals(segnali(porte)).filter((e) => e.source === "nmap_service");

describe("prodotto dalla versione del servizio", () => {
  it("il Proxmox del banco: hypervisor Proxmox dalla 3128", () => {
    const e = evidenze(PORTE_PROXMOX);
    assert.equal(e.find((x) => x.dimension === "vendor")?.claim, "proxmox");
    assert.equal(e.find((x) => x.dimension === "category")?.claim, "compute.hypervisor");
    assert.ok(
      /* Produttore e categoria vengono dalla 3128; la famiglia ha la sua porta e la
       * controlla la suite «il sistema operativo si ricava da TUTTE le porte». */
      e.filter((x) => x.dimension !== "os").every((x) => (x.raw_value ?? "").startsWith("3128/")),
      "il grezzo dice da quale porta viene: senza, domani non si sa perché",
    );
  });

  it("il server Windows del banco: sistema operativo windows dalla 135", () => {
    const e = evidenze(PORTE_WINDOWS);
    assert.equal(e.find((x) => x.dimension === "os")?.claim, "windows");
    assert.equal(e.find((x) => x.dimension === "vendor"), undefined, "«Microsoft Windows RPC» non dice il produttore dell'hardware");
  });

  it("una porta senza versione non inventa niente", () => {
    assert.deepEqual(evidenze([{ port: 8006, protocol: "tcp", service: "wpl-analytics", version: null }]), []);
  });

  it("un banner generico non diventa un prodotto", () => {
    assert.equal(prodottoDaVersione("nginx 1.24.0"), null);
    assert.equal(prodottoDaVersione("Apache httpd 2.4.62"), null);
    assert.equal(prodottoDaVersione(null), null);
  });

  it("gli altri prodotti della tabella", () => {
    assert.equal(prodottoDaVersione("VMware ESXi 7.0.3 SOAP API")?.vendor, "vmware");
    assert.equal(prodottoDaVersione("Synology DiskStation Manager httpd")?.category, "storage.nas");
    assert.equal(prodottoDaVersione("MikroTik RouterOS FTP server")?.vendor, "mikrotik");
    assert.equal(prodottoDaVersione("HP ETHERNET MULTI-ENVIRONMENT,ROM none")?.category, "peripheral.printer");
  });

  it("ogni categoria della tabella è uno slug valido della tassonomia", () => {
    for (const s of ["compute.hypervisor", "storage.nas", "network.router", "peripheral.printer"]) {
      assert.ok(isValidCategory(s), `${s} non è una categoria valida`);
    }
  });
});

describe("il peso deve bastare, o la regola nasce inerte", () => {
  it("nmap_service da solo supera la soglia", () => {
    assert.ok(
      ATTR_SOURCE_WEIGHTS.nmap_service * 0.8 >= MIN_CLAIM_SCORE,
      `${ATTR_SOURCE_WEIGHTS.nmap_service} x 0.8 = ${ATTR_SOURCE_WEIGHTS.nmap_service * 0.8}, soglia ${MIN_CLAIM_SCORE}`,
    );
  });

  it("il Proxmox arriva davvero a una categoria passando dal motore", () => {
    let id = 1;
    const righe = evidenze(PORTE_PROXMOX).map(
      (e) =>
        ({
          id: id++, host_id: 1, source: e.source, phase: e.phase, dimension: e.dimension,
          claim: e.claim, confidence: e.confidence, weight: ATTR_SOURCE_WEIGHTS[e.source],
          raw_value: e.raw_value ?? null, observed_at: "2026-11-05T03:00:00Z",
          expires_at: null, superseded_by: null,
        }) as AttributionEvidenceRow,
    );
    const r = fuseAttribution(righe, "2026-11-05T03:00:00Z");
    assert.equal(r.category.claim, "compute.hypervisor");
    assert.equal(r.vendor.claim, "proxmox");
  });
});

describe("il sistema operativo si ricava da TUTTE le porte", () => {
  /* Trovato misurando il 192.168.99.1 (PX-NAS) dopo l'«Attribuzione» del 05/11: aveva
   * la categoria `compute.hypervisor` dalla 3128 e la famiglia VUOTA, perche' la
   * lettura si fermava alla prima porta con un prodotto noto e non tornava sulla 22,
   * dove «OpenSSH 10.0p2 Debian» dice `linux`. */
  const osEmesso = (porte: Porta[]) =>
    evidenze(porte).filter((e) => e.dimension === "os");

  it("PX-NAS: categoria dalla 3128 e famiglia linux dalla 22", () => {
    const e = evidenze(PORTE_PROXMOX);
    assert.equal(e.find((x) => x.dimension === "category")?.claim, "compute.hypervisor");
    const os = e.filter((x) => x.dimension === "os");
    assert.equal(os.length, 1, "una sola famiglia, non una per porta");
    assert.equal(os[0].claim, "linux");
    assert.ok((os[0].raw_value ?? "").startsWith("22/"), "il grezzo dice da quale porta viene la famiglia");
  });

  it("il sistema operativo dichiarato dal prodotto batte il banner di un'altra porta", () => {
    const os = osEmesso([
      { port: 22, protocol: "tcp", service: "ssh", version: "OpenSSH 8.4 Debian" },
      { port: 443, protocol: "tcp", service: "https", version: "VMware ESXi SOAP API 7.0.3" },
    ]);
    assert.equal(os.length, 1);
    assert.equal(os[0].claim, "esxi", "ESXi lo dice il prodotto, Debian e' solo il banner di OpenSSH");
  });

  it("nessuna porta che parli di un sistema operativo: niente famiglia inventata", () => {
    assert.deepEqual(
      osEmesso([{ port: 80, protocol: "tcp", service: "http", version: "nginx 1.24.0" }]),
      [],
    );
  });

  it("il server Windows resta windows (il prodotto lo dichiara)", () => {
    const os = osEmesso(PORTE_WINDOWS);
    assert.equal(os.length, 1);
    assert.equal(os[0].claim, "windows");
  });
});
