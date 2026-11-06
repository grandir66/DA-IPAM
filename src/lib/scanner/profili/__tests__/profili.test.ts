/**
 * Prove dei profili di scansione (04/11/2026). Tutto puro: nessun nmap, nessun DB.
 *
 * Run: node --import tsx --test src/lib/scanner/profili/__tests__/profili.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseNmapXml } from "../../nmap";
import { PROFILI, PROFILO_APPROFONDITO, PROFILO_IOT_OT, SCRIPT_VIETATI, profiloPerId, scriptDelProfilo } from "../profili";
import { argomentiTcp, argomentiUdp, scriptPerProtocollo, scriptMancanti, ScriptVietatoError } from "../comando";
import { tuttiGliScriptCandidati } from "../motore";
import { fattiDaRisultato, fattiDaScript, rilieviDaRisultato } from "../lettura";
import { evidenzeDaScript, evidenzaDaPortaOt, fogliaDaTipoCip, produttoreNoto } from "@/lib/attribution/profilo-evidence";
import { isValidCategory } from "@/lib/attribution/taxonomy";
import type { NmapScriptOutput } from "@/types";
import { AUTHORITATIVE_SOURCES } from "@/lib/attribution/weights";
import { AUTHORITY_MIN_CONFIDENCE } from "@/lib/attribution/types";

/** Un host nmap con le porte e gli script dati, nella forma vera di `-oX`. */
function xml(porte: string, hostscript = ""): string {
  return `<?xml version="1.0"?><nmaprun><host><status state="up"/>
    <address addr="192.168.0.50" addrtype="ipv4"/>
    <ports>${porte}</ports>
    ${hostscript ? `<hostscript>${hostscript}</hostscript>` : ""}
  </host></nmaprun>`;
}

const PORTA_SSL = `<port protocol="tcp" portid="443"><state state="open"/>
  <service name="https"/>
  <script id="ssl-cert" output="Subject: commonName=nas01.azienda.local">
    <table key="subject">
      <elem key="commonName">nas01.azienda.local</elem>
      <elem key="organizationName">Synology Inc.</elem>
    </table>
    <table key="issuer"><elem key="commonName">Synology Inc. CA</elem></table>
    <elem key="md5">aabbccdd</elem>
  </script></port>`;

const PORTA_RDP = `<port protocol="tcp" portid="3389"><state state="open"/>
  <service name="ms-wbt-server"/>
  <script id="rdp-ntlm-info" output="...">
    <elem key="Target_Name">AZIENDA</elem>
    <elem key="NetBIOS_Computer_Name">PC01</elem>
    <elem key="NetBIOS_Domain_Name">AZIENDA</elem>
    <elem key="DNS_Computer_Name">pc01.azienda.local</elem>
    <elem key="DNS_Domain_Name">azienda.local</elem>
    <elem key="Product_Version">10.0.19041</elem>
  </script></port>`;

const PORTA_SSH = `<port protocol="tcp" portid="22"><state state="open"/>
  <service name="ssh"/>
  <script id="ssh-hostkey" output="...">
    <table><elem key="type">ssh-rsa</elem><elem key="fingerprint">11:22:33</elem></table>
    <table><elem key="type">ssh-ed25519</elem><elem key="fingerprint">44:55:66</elem></table>
  </script></port>`;

const PORTA_S7 = `<port protocol="tcp" portid="102"><state state="open"/>
  <service name="iso-tsap"/>
  <script id="s7-info" output="...">
    <elem key="Module">6ES7 315-2EH14-0AB0</elem>
    <elem key="Basic Hardware">6ES7 315-2EH14-0AB0</elem>
    <elem key="Version">3.2.6</elem>
    <elem key="Serial Number">S C-X4UV12345</elem>
    <elem key="Module Name">PLC-Linea1</elem>
  </script></port>`;

const PORTA_ENIP = `<port protocol="tcp" portid="44818"><state state="open"/>
  <service name="EtherNetIP-2"/>
  <script id="enip-info" output="...">
    <elem key="Vendor">Rockwell Automation/Allen-Bradley (1)</elem>
    <elem key="Product Name">1769-L24ER-QB1B/A LOGIX5324ER</elem>
    <elem key="Serial Number">0x60c12345</elem>
    <elem key="Device Type">Programmable Logic Controller (14)</elem>
    <elem key="Revision">21.11</elem>
  </script></port>`;

const PORTA_SNMP = `<port protocol="udp" portid="161"><state state="open"/>
  <service name="snmp"/>
  <script id="snmp-info" output="snmpv3">
    <elem key="sysName">switch01</elem>
    <elem key="sysDescr">Linux switch01 5.10</elem>
    <elem key="sysObjectID">1.3.6.1.4.1.890.1.15</elem>
  </script></port>`;

describe("integrità dei profili", () => {
  it("nessun profilo cita uno script vietato (intrusive o exploit)", () => {
    for (const p of PROFILI) {
      for (const s of scriptDelProfilo(p)) {
        assert.ok(!SCRIPT_VIETATI.includes(s), `${p.id} cita lo script vietato ${s}`);
      }
    }
  });

  it("iec-identify e modbus-discover restano fuori: sono intrusive", () => {
    assert.ok(SCRIPT_VIETATI.includes("iec-identify"));
    assert.ok(SCRIPT_VIETATI.includes("modbus-discover"));
  });

  it("ogni regola ha almeno una porta e almeno uno script", () => {
    for (const p of PROFILI) {
      for (const r of p.regole) {
        assert.ok(r.porte.length > 0, `${p.id}: regola senza porte`);
        assert.ok(r.script.length > 0, `${p.id}: regola senza script`);
      }
    }
  });

  it("le porte OT chieste da Riccardo il 04/11 sono tutte nel profilo IoT/OT", () => {
    for (const porta of [102, 502, 4840, 9600, 18245, 18246, 19999, 20000, 44818, 1883, 8883, 8008, 8009]) {
      assert.ok(PROFILO_IOT_OT.tcp.includes(porta), `TCP ${porta} manca`);
    }
    for (const porta of [47808, 2222, 5683, 5684, 1900, 5353]) {
      assert.ok(PROFILO_IOT_OT.udp.includes(porta), `UDP ${porta} manca`);
    }
  });

  it("l'insieme dei candidati copre OGNI profilo, non solo il primo", () => {
    /* La cache di `scriptDisponibili` vive per tutta la vita del processo:
     * costruita sui soli nomi del profilo eseguito per primo, il secondo
     * profilo si vedrebbe filtrare via tutti i suoi script e girerebbe senza
     * nessuno, in silenzio. Difetto trovato rileggendo il 04/11/2026. */
    const candidati = new Set(tuttiGliScriptCandidati());
    for (const p of PROFILI) {
      for (const s of scriptDelProfilo(p)) {
        assert.ok(candidati.has(s), `${s} (profilo ${p.id}) non è fra i candidati`);
      }
    }
    for (const s of ["s7-info", "enip-info", "bacnet-info", "rdp-ntlm-info", "ssl-cert"]) {
      assert.ok(candidati.has(s), s);
    }
  });

  it("gli script di un profilo sopravvivono al filtro costruito su tutti i profili", () => {
    const disponibili = new Set(tuttiGliScriptCandidati());
    const ot = scriptPerProtocollo(PROFILO_IOT_OT, "tcp", disponibili);
    assert.ok(ot.includes("s7-info"), "s7-info filtrato via");
    assert.ok(ot.includes("enip-info"), "enip-info filtrato via");
    assert.equal(scriptMancanti(PROFILO_IOT_OT, disponibili).length, 0);
  });

  it("profiloPerId riconosce i due profili e rifiuta il resto", () => {
    assert.equal(profiloPerId("approfondito")?.id, "approfondito");
    assert.equal(profiloPerId("iot_ot")?.id, "iot_ot");
    assert.equal(profiloPerId("inesistente"), null);
  });
});

describe("argomenti nmap", () => {
  const tutti = (p = PROFILO_APPROFONDITO) => new Set(scriptDelProfilo(p));

  it("con privilegi passa -O; senza, lo omette e non fallisce", () => {
    const con = argomentiTcp(PROFILO_APPROFONDITO, { privilegi: true, disponibili: tutti() });
    const senza = argomentiTcp(PROFILO_APPROFONDITO, { privilegi: false, disponibili: tutti() });
    assert.ok(con.includes("-O"));
    assert.ok(!senza.includes("-O"));
  });

  it("la fase TCP non contiene mai -sU", () => {
    for (const p of PROFILI) {
      const args = argomentiTcp(p, { privilegi: true, disponibili: tutti(p) });
      assert.ok(!args.includes("-sU"), `${p.id}: -sU nella fase TCP`);
      assert.ok(args.includes("-sT"));
    }
  });

  it("senza privilegi la fase UDP non parte affatto", () => {
    assert.equal(argomentiUdp(PROFILO_IOT_OT, { privilegi: false, disponibili: null }), null);
    assert.ok(argomentiUdp(PROFILO_IOT_OT, { privilegi: true, disponibili: tutti(PROFILO_IOT_OT) }));
  });

  it("gli script assenti sulla macchina si filtrano e si dichiarano", () => {
    const presenti = new Set(["ssl-cert", "ssh-hostkey"]);
    const usati = scriptPerProtocollo(PROFILO_APPROFONDITO, "tcp", presenti);
    assert.deepEqual(usati, ["ssh-hostkey", "ssl-cert"]);
    const mancanti = scriptMancanti(PROFILO_APPROFONDITO, presenti);
    assert.ok(mancanti.includes("rdp-ntlm-info"), "rdp-ntlm-info doveva risultare mancante");
  });

  it("un profilo che citasse uno script vietato lancia invece di eseguirlo", () => {
    const finto = { ...PROFILO_IOT_OT, regole: [{ porte: [502], protocollo: "tcp" as const, script: ["modbus-discover"] }] };
    assert.throws(() => scriptPerProtocollo(finto, "tcp", null), ScriptVietatoError);
  });

  it("il profilo IoT/OT tiene le probe di versione al minimo, l'Approfondito le alza", () => {
    assert.equal(PROFILO_IOT_OT.versionIntensity, 0);
    assert.ok(PROFILO_APPROFONDITO.versionIntensity > 0);
  });
});

describe("parser: raccolta degli script", () => {
  it("appiattisce le table annidate di ssl-cert in chiavi col punto", () => {
    const r = parseNmapXml(xml(PORTA_SSL))[0];
    const s = r.ports[0].scripts?.[0];
    assert.equal(s?.id, "ssl-cert");
    assert.equal(s?.elems["subject.commonName"], "nas01.azienda.local");
    assert.equal(s?.elems["subject.organizationName"], "Synology Inc.");
    assert.equal(s?.elems["issuer.commonName"], "Synology Inc. CA");
    assert.equal(s?.elems["md5"], "aabbccdd");
  });

  it("le table senza key diventano indici: le due chiavi SSH si leggono entrambe", () => {
    const r = parseNmapXml(xml(PORTA_SSH))[0];
    const fatti = fattiDaRisultato(r);
    assert.deepEqual(fatti.chiaviSsh?.sort(), ["11:22:33", "44:55:66"]);
  });

  it("-O: sotto il 95% e' un'ipotesi e non diventa sistema operativo (06/11/2026)", () => {
    const r = (osPrecisione?: number) => ({ ip: "10.0.0.1", alive: true, ports: [], os: "Cisco SG200 or SG300 switch", mac: null, osPrecisione });
    assert.equal(fattiDaRisultato(r(100)).osInfo, "Cisco SG200 or SG300 switch");
    assert.equal(fattiDaRisultato(r(87)).osInfo, undefined);
    assert.equal(fattiDaRisultato(r()).osInfo, "Cisco SG200 or SG300 switch", "chi non dichiara la precisione resta com'era");
  });

  it("snmp-info continua a riempire i tre campi SNMP come prima", () => {
    const r = parseNmapXml(xml(PORTA_SNMP))[0];
    assert.equal(r.snmpHostname, "switch01");
    assert.equal(r.snmpSysDescr, "Linux switch01 5.10");
    assert.equal(r.snmpSysObjectID, "1.3.6.1.4.1.890.1.15");
  });

  it("gli script dell'host finiscono in hostScripts", () => {
    const r = parseNmapXml(xml(PORTA_SSL, `<script id="nbstat" output="NetBIOS name: PC01, NetBIOS user: &lt;unknown&gt;"/>`))[0];
    assert.equal(r.hostScripts?.length, 1);
    assert.equal(r.hostScripts?.[0].id, "nbstat");
  });

  it("l'output si taglia al tetto in byte del profilo", () => {
    const lungo = "x".repeat(5000);
    const r = parseNmapXml(
      xml(`<port protocol="tcp" portid="1883"><state state="open"/><script id="mqtt-subscribe" output="${lungo}"/></port>`),
      { tettoByteOutput: 128 }
    )[0];
    assert.equal(r.ports[0].scripts?.[0].output?.length, 128);
  });

  it("una scansione senza script non guadagna il campo: i giri di sempre non cambiano", () => {
    const r = parseNmapXml(xml(`<port protocol="tcp" portid="80"><state state="open"/><service name="http"/></port>`))[0];
    assert.equal(r.ports[0].scripts, undefined);
    assert.equal(r.hostScripts, undefined);
  });
});

describe("lettura: dagli script ai fatti", () => {
  it("rdp-ntlm-info dà nome DNS, dominio, NetBIOS e build di Windows", () => {
    const f = fattiDaScript(parseNmapXml(xml(PORTA_RDP))[0].ports[0].scripts![0]);
    assert.equal(f.hostname, "pc01.azienda.local");
    assert.equal(f.dominio, "azienda.local");
    assert.equal(f.netbios, "PC01");
    assert.equal(f.osInfo, "Windows build 10.0.19041");
  });

  it("il nome dal servizio RDP vince sul CN del certificato", () => {
    const r = parseNmapXml(xml(PORTA_SSL + PORTA_RDP))[0];
    assert.equal(fattiDaRisultato(r).hostname, "pc01.azienda.local");
  });

  it("s7-info dà modello, firmware e numero di serie del PLC Siemens", () => {
    const f = fattiDaRisultato(parseNmapXml(xml(PORTA_S7))[0]);
    assert.equal(f.protocolloOt, "s7");
    assert.equal(f.produttore, "Siemens");
    assert.equal(f.modello, "6ES7 315-2EH14-0AB0");
    assert.equal(f.seriale, "S C-X4UV12345");
    assert.equal(f.firmware, "3.2.6");
  });

  it("enip-info dà vendor, prodotto e seriale del CIP", () => {
    const f = fattiDaRisultato(parseNmapXml(xml(PORTA_ENIP))[0]);
    assert.equal(f.protocolloOt, "enip");
    assert.equal(f.seriale, "0x60c12345");
    assert.ok(f.modello?.includes("LOGIX5324ER"));
  });

  it("un CN con wildcard o spazi non diventa un nome host", () => {
    assert.equal(fattiDaScript({ id: "ssl-cert", output: null, elems: { "subject.commonName": "*.azienda.local" } }).hostname, undefined);
    assert.equal(fattiDaScript({ id: "ssl-cert", output: null, elems: { "subject.commonName": "Mio NAS" } }).hostname, undefined);
  });

  it("i segnaposto di nmap non diventano dati", () => {
    const f = fattiDaScript({ id: "nbstat", output: "NetBIOS name: <unknown>", elems: {} });
    assert.equal(f.netbios, undefined);
  });

  it("porta di campo aperta senza script: il protocollo si dice comunque", () => {
    const r = parseNmapXml(xml(`<port protocol="tcp" portid="502"><state state="open"/><service name="mbap"/></port>`))[0];
    assert.equal(fattiDaRisultato(r).protocolloOt, "modbus");
  });

  it("un rilievo per script, con porta e protocollo", () => {
    const rilievi = rilieviDaRisultato(parseNmapXml(xml(PORTA_S7 + PORTA_SSL))[0], "iot_ot");
    assert.equal(rilievi.length, 2);
    const s7 = rilievi.find((r) => r.script === "s7-info");
    assert.equal(s7?.porta, 102);
    assert.equal(s7?.protocollo, "tcp");
    assert.equal(s7?.profilo, "iot_ot");
  });
});

describe("evidenze per l'attribuzione", () => {
  it("ogni claim di categoria è uno slug valido della tassonomia", () => {
    const script = [PORTA_S7, PORTA_ENIP, PORTA_RDP, PORTA_SSL]
      .flatMap((p) => parseNmapXml(xml(p))[0].ports[0].scripts ?? []);
    const extra: NmapScriptOutput[] = [
      { id: "bacnet-info", output: null, elems: { "Vendor Name": "Carel" } },
      { id: "omron-info", output: null, elems: { "Controller Model": "CJ2M-CPU31" } },
      { id: "mqtt-subscribe", output: null, elems: {} },
      { id: "nbstat", output: null, elems: { server_name: "PC01" } },
    ];
    for (const s of [...script, ...extra]) {
      for (const e of evidenzeDaScript(s)) {
        if (e.dimension !== "category") continue;
        assert.ok(isValidCategory(e.claim), `claim non valido: ${e.claim} (da ${s.id})`);
      }
    }
  });

  it("s7-info classifica PLC in modo dichiarativo: ot_probe sopra la soglia", () => {
    const ev = evidenzeDaScript(parseNmapXml(xml(PORTA_S7))[0].ports[0].scripts![0]);
    const cat = ev.find((e) => e.dimension === "category");
    assert.equal(cat?.claim, "ot.plc");
    assert.ok(AUTHORITATIVE_SOURCES.category.includes("ot_probe"));
    assert.ok((cat?.confidence ?? 0) >= AUTHORITY_MIN_CONFIDENCE);
  });

  it("un broker MQTT resta sotto la soglia dichiarativa: può essere un server", () => {
    const ev = evidenzeDaScript({ id: "mqtt-subscribe", output: null, elems: {} });
    const cat = ev.find((e) => e.dimension === "category");
    assert.ok((cat?.confidence ?? 1) < AUTHORITY_MIN_CONFIDENCE);
  });

  it("il Device Type del CIP scegle la foglia, e dove non si capisce resta la radice", () => {
    assert.equal(fogliaDaTipoCip("Programmable Logic Controller (14)"), "ot.plc");
    assert.equal(fogliaDaTipoCip("AC Drive (2)"), "ot.drive");
    assert.equal(fogliaDaTipoCip("Human Machine Interface"), "ot.hmi");
    assert.equal(fogliaDaTipoCip("Communications Adapter (12)"), "ot.gateway");
    assert.equal(fogliaDaTipoCip("Qualcosa di mai visto"), "ot");
    assert.equal(fogliaDaTipoCip(undefined), "ot");
  });

  it("una porta di campo senza risposta resta sotto la soglia dichiarativa", () => {
    const ev = evidenzaDaPortaOt([80, 502]);
    assert.equal(ev?.claim, "ot");
    assert.ok((ev?.confidence ?? 1) < AUTHORITY_MIN_CONFIDENCE);
    assert.equal(evidenzaDaPortaOt([80, 443]), null);
  });

  it("un'organizzazione di certificato segnaposto non diventa un produttore", () => {
    assert.equal(produttoreNoto("Internet Widgits Pty Ltd"), null);
    assert.equal(produttoreNoto("Let's Encrypt"), null);
    assert.equal(produttoreNoto("Synology Inc."), "Synology");
    assert.equal(produttoreNoto(undefined), null);
  });
});
