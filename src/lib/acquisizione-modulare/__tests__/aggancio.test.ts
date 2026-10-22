/**
 * Aggancio dell'acquisizione modulare al pulsante d'acquisizione (tavola C1, decisione 4: fonte automatica).
 *
 * Il percorso di sempre resta bit per bit quando l'interruttore è spento o non c'è un collector: `valutaFonte` lo dice
 * senza leggere altro che l'interruttore, e la rotta prosegue col codice di prima (il suo diff è solo un'aggiunta
 * prima del ramo Proxmox, controllato qui sotto sul sorgente).
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d)" node --import tsx --test src/lib/acquisizione-modulare/__tests__/aggancio.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-acquisizione-modulare";

import { encrypt } from "@/lib/crypto";
import * as tenant from "@/lib/db-tenant";
import { collectorPossibili } from "@/lib/acquisition/riconosci";
import { dipendenzeDb, usaPercorsoDiSempre, valutaFonte, type DipendenzeFonte } from "@/lib/acquisizione-modulare/fonte";

const T = "TESTACQAGGANCIO";
const { withTenant, getTenantDb, deleteTenantDatabase } = tenant;

const vietato = (cosa: string) => () => { throw new Error(`con l'interruttore spento non si legge ${cosa}`); };

describe("riconoscimento del collector dal prodotto", () => {
  const casi: Array<[string, Parameters<typeof collectorPossibili>[0], string[]]> = [
    ["ProCurve dal sottotipo", { vendor: "hp", vendor_subtype: "procurve" }, ["hp-procurve"]],
    ["Comware dal profilo", { vendor: "hp", product_profile: "hp_switch_comware" }, ["hp-comware"]],
    ["Comware dal sysDescr", { vendor: "hp", device_type: "switch", sysdescr: "HPE Comware Software Version 7.1.045" }, ["hp-comware"]],
    ["Aruba 2540 dal sysDescr", { vendor: "hp", device_type: "switch", sysdescr: "Aruba JL357A 2540-48G-PoE+-4SFP+ Switch, revision YC.16.11.0020" }, ["hp-procurve"]],
    ["AOS-CX: nessun collector", { vendor: "hp", device_type: "switch", sysdescr: "Aruba JL675A 6100 ArubaOS-CX" }, []],
    ["ArubaOS senza sysDescr: acquisizione di sempre", { vendor: "hp", product_profile: "hp_switch_arubaos" }, []],
    ["HP switch senza indizi: caso dubbio", { vendor: "hp", device_type: "switch" }, ["hp-procurve", "hp-comware"]],
    ["iLO: nessun collector", { vendor: "hp", product_profile: "hp_server_ilo", device_type: "server" }, []],
    ["QNAP QSS", { vendor: "qnap", model: "QSW-M3216R-8S8T" }, ["qnap-switch"]],
    ["QNAP NAS", { vendor: "qnap", device_type: "nas", product_profile: "qnap_storage" }, ["qnap-nas"]],
    ["QNAP router: nessun collector", { vendor: "qnap", product_profile: "qnap_router" }, []],
    ["Synology", { vendor: "synology", product_profile: "synology_storage" }, ["synology-dsm"]],
    ["MikroTik router", { vendor: "mikrotik", product_profile: "mikrotik_router" }, ["mikrotik-routeros"]],
    ["MikroTik SwOS: nessun collector", { vendor: "mikrotik", sysdescr: "SwOS CSS610" }, []],
    ["MikroTik altro: nessun collector", { vendor: "mikrotik", product_profile: "mikrotik_other" }, []],
    ["UniFi access point", { vendor: "ubiquiti", product_profile: "ubiquiti_access_point" }, ["ubiquiti-device"]],
    ["EdgeRouter: nessun collector", { vendor: "ubiquiti", product_profile: "ubiquiti_router" }, []],
    ["Proxmox VE dal profilo", { vendor: "proxmox", product_profile: "proxmox_ve" }, ["proxmox-ve"]],
    ["Proxmox VE dal solo produttore", { vendor: "proxmox", device_type: "hypervisor" }, ["proxmox-ve"]],
    ["Proxmox Backup Server: nessun collector", { vendor: "proxmox", product_profile: "proxmox_pbs" }, []],
    ["Linux", { vendor: "linux", product_profile: "linux_server", device_type: "server" }, ["linux"]],
    ["Linux che è un nodo Proxmox (scelto a mano): collector Proxmox", { vendor: "linux", device_type: "hypervisor", scan_target: "proxmox" }, ["proxmox-ve"]],
    ["Linux hypervisor senza indizi di Proxmox: acquisizione di sempre", { vendor: "linux", device_type: "hypervisor" }, []],
    ["Windows", { vendor: "windows", device_type: "server" }, ["windows"]],
    ["ESXi", { vendor: "vmware", device_type: "hypervisor" }, ["vmware-esxi"]],
    ["vCenter: nessun collector", { vendor: "vmware", sysdescr: "VMware vCenter Server 8.0" }, []],
    ["NetApp dal sysDescr", { vendor: "other", sysdescr: "NetApp Release 9.16.1P11" }, ["netapp-ontap"]],
  ];
  for (const [nome, a, atteso] of casi) it(nome, () => assert.deepEqual(collectorPossibili(a), atteso));
});

describe("valutaFonte (dipendenze finte)", () => {
  const hp = { id: 1, vendor: "hp", vendor_subtype: "procurve", device_type: "switch" };

  it("interruttore spento: «spenta», e non legge né la scelta né le credenziali", () => {
    const deps: DipendenzeFonte = { accesa: () => false, scelta: vietato("la scelta"), candidati: vietato("le credenziali") };
    const v = valutaFonte(hp, deps);
    assert.equal(v.esito, "spenta");
    assert.equal(usaPercorsoDiSempre(v), true);
  });

  it("Proxmox con l'interruttore spento: «spenta», nessuna lettura di scelta o credenziali, resta la scansione Proxmox di oggi", () => {
    const pve = { id: 8, vendor: "proxmox", product_profile: "proxmox_ve", device_type: "hypervisor" };
    const v = valutaFonte(pve, { accesa: () => false, scelta: vietato("la scelta"), candidati: vietato("le credenziali") });
    assert.equal(v.esito, "spenta");
    assert.equal(usaPercorsoDiSempre(v), true);
  });

  it("acceso ma nessun collector per il prodotto: percorso di sempre, senza leggere credenziali", () => {
    const v = valutaFonte({ id: 2, vendor: "cisco", device_type: "router" }, { accesa: () => true, scelta: () => null, candidati: vietato("le credenziali") });
    assert.equal(v.esito, "nessun_collector");
    assert.equal(usaPercorsoDiSempre(v), true);
  });

  it("due collector possibili: dubbio; la scelta di una persona lo scioglie; una scelta non più possibile non vale", () => {
    const base = { id: 3, vendor: "hp", device_type: "switch" };
    const cred = () => [{ protocollo: "ssh" as const, credential_id: 9, nome: "lettura", port: 22 }];
    assert.deepEqual(valutaFonte(base, { accesa: () => true, scelta: () => null, candidati: cred }), { esito: "dubbio", motivo: "due_collector", possibili: ["hp-procurve", "hp-comware"] });
    const scelta = { scelta: "hp-comware", chosen_by_name: "r.admin", chosen_at: "2026-10-22 08:00:00" };
    const v = valutaFonte(base, { accesa: () => true, scelta: () => scelta, candidati: cred });
    assert.equal(v.esito, "pronta");
    if (v.esito === "pronta") assert.equal(v.collector, "hp-comware");
    const vecchia = { ...scelta, scelta: "qnap-switch" };
    assert.equal(valutaFonte(base, { accesa: () => true, scelta: () => vecchia, candidati: cred }).esito, "dubbio");
  });

  it("«classica» scelta: percorso di sempre", () => {
    const v = valutaFonte(hp, { accesa: () => true, scelta: () => ({ scelta: "classica", chosen_by_name: null, chosen_at: "" }), candidati: vietato("le credenziali") });
    assert.equal(v.esito, "classica_scelta");
    assert.equal(usaPercorsoDiSempre(v), true);
  });

  it("nessuna credenziale compatibile: dubbio, mai una ricerca", () => {
    const v = valutaFonte(hp, { accesa: () => true, scelta: () => null, candidati: () => [] });
    assert.equal(v.esito, "dubbio");
    if (v.esito === "dubbio") assert.equal(v.motivo, "credenziali");
  });

  it("Proxmox senza una credenziale SSH nell'archivio: scansione di sempre (API + SSH), mai un 409 al pulsante", () => {
    const pve = { id: 7, vendor: "proxmox", product_profile: "proxmox_ve", device_type: "hypervisor" };
    const v = valutaFonte(pve, { accesa: () => true, scelta: () => null, candidati: () => [] });
    assert.equal(v.esito, "nessun_collector");
    assert.equal(usaPercorsoDiSempre(v), true);
    const conSsh = valutaFonte(pve, { accesa: () => true, scelta: () => null, candidati: () => [{ protocollo: "ssh", credential_id: 3, nome: "root-pve", port: 22 }] });
    assert.equal(conSsh.esito, "pronta");
    // gli altri collector senza credenziale restano un dubbio da sciogliere (il test sopra, per HP)
  });

  it("una credenziale per protocollo, la prima nell'ordine del motore", () => {
    const v = valutaFonte(hp, {
      accesa: () => true, scelta: () => null,
      candidati: (_id, p) => p === "ssh" ? [{ protocollo: "ssh", credential_id: 4, nome: "prima", port: 22 }, { protocollo: "ssh", credential_id: 5, nome: "seconda", port: 22 }] : [],
    });
    assert.equal(v.esito, "pronta");
    if (v.esito === "pronta") assert.deepEqual(Object.keys(v.credenziali), ["ssh"]) ;
    if (v.esito === "pronta") assert.equal(v.credenziali.ssh?.credential_id, 4);
  });
});

describe("valutaFonte sul DB del tenant", () => {
  let hpId = 0;
  before(() => {
    withTenant(T, () => {
      const d = getTenantDb(T);
      hpId = Number(d.prepare("INSERT INTO network_devices (name, host, device_type, vendor, vendor_subtype, protocol, port) VALUES ('sw-lab', '192.0.2.20', 'switch', 'hp', 'procurve', 'ssh', 22)").run().lastInsertRowid);
      const v = (nome: string, tipo: string) => Number(d.prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES (?, ?, ?, ?)").run(nome, tipo, encrypt("lab"), encrypt("segreto-lab")).lastInsertRowid);
      const fallita = v("fallita", "ssh");
      const buona = v("lettura-switch", "ssh");
      const b = d.prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, sort_order, test_status) VALUES (?, ?, 'ssh', 22, ?, ?)");
      b.run(hpId, fallita, 0, "failed");
      b.run(hpId, buona, 1, "untested");
    });
  });
  after(() => deleteTenantDatabase(T));

  it("spenta di default; accesa usa il binding non fallito dell'apparato, col nome e senza segreto", () => {
    withTenant(T, () => {
      const device = tenant.getNetworkDeviceById(hpId);
      assert.ok(device);
      assert.equal(valutaFonte(device, dipendenzeDb()).esito, "spenta");
      tenant.impostaAcquisizioneModulare(true);
      const v = valutaFonte(device, dipendenzeDb());
      assert.equal(v.esito, "pronta");
      if (v.esito !== "pronta") return;
      assert.equal(v.credenziali.ssh?.nome, "lettura-switch", "il binding fallito è escluso (D10)");
      assert.ok(!JSON.stringify(v).includes("segreto-lab"), "la valutazione non porta segreti");
      tenant.impostaAcquisizioneModulare(false);
    });
  });
});

describe("rotta POST /api/devices/[id]/query: l'aggancio è solo un'aggiunta", () => {
  const sorgente = readFileSync(join(process.cwd(), "src/app/api/devices/[id]/query/route.ts"), "utf8");

  it("valuta la fonte una volta, prima del ramo Proxmox, ed esce solo per dubbio o pronta", () => {
    const i = sorgente.indexOf("const fonte = valutaFonte(device, dipendenzeDb());");
    assert.ok(i > 0);
    assert.ok(i < sorgente.indexOf('if (tipo === "proxmox") {'), "prima del percorso di sempre");
    const blocco = sorgente.slice(i, sorgente.indexOf('if (tipo === "proxmox") {'));
    assert.equal((blocco.match(/return /g) ?? []).length, 2, "due sole uscite");
    assert.match(blocco, /if \(fonte\.esito === "dubbio"\) \{/);
    assert.match(blocco, /if \(fonte\.esito === "pronta"\) \{/);
  });

  it("i lettori di sempre non conoscono il collector", () => {
    for (const f of ["runRouterQuery", "runSwitchQuery", "runInfoQuery", "saveDeviceInfo"]) {
      const da = sorgente.indexOf(`async function ${f}(`);
      const resto = sorgente.slice(da + 10);
      const fine = resto.search(/\n(?:(?:async )?function |\/\/ ═)/);
      const corpo = sorgente.slice(da, fine > 0 ? da + 10 + fine : undefined);
      assert.ok(!/collector|acquisizione-modulare|valutaFonte/i.test(corpo), `${f} invariato`);
    }
  });
});
