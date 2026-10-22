/**
 * LibreNMS nella scheda (piano 2026-10-22 LibreNMS, task 7): stato dei sensori, fonte per porta, vicini con le due fonti,
 * voce di «Dati da:». Dati finti (192.0.2.x).
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/scheda/__tests__/librenms-vista.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { conLibrenms, datiAttivi, gruppiSensori, letturaVecchia, nostroGiroVecchio, statoSensore, unisciPorte, unisciVicini, voceLibrenms, type DatiLibrenmsScheda } from "../librenms-vista";

const ADESSO = new Date("2026-10-22T10:20:00Z");
const LETTURE = {} as never;

function dati(over: Record<string, unknown> = {}): DatiLibrenmsScheda {
  return { acceso: true, abbinato: true, librenms_device_id: 1, apparato: { librenms_device_id: 1, ip: "192.0.2.10", hostname: null, sysname: "sw", os: null, hardware: null, version: null, serial: null, status: 1, last_polled: "2026-10-22 10:15:00", last_discovered: null, letto_il: "2026-10-22 10:15:00" },
    porte: [], vicini: [], sensori: [], inventario: [], letture: LETTURE, ...over } as DatiLibrenmsScheda;
}
const ora = (iso: string): string => iso.slice(11, 16);

describe("statoSensore", () => {
  it("dentro i limiti, vicino, oltre, senza limiti", () => {
    assert.equal(statoSensore(46, null, 80), "ok");
    assert.equal(statoSensore(71, null, 75), "vicino");
    assert.equal(statoSensore(83, -5, 80), "oltre");
    assert.equal(statoSensore(212, null, null), "nd");
    assert.equal(statoSensore(null, 1, 2), "nd");
  });
  it("con due limiti il 10% è sull'ampiezza: 12,1 V fra 11,4 e 12,6 è nei limiti", () => {
    assert.equal(statoSensore(12.1, 11.4, 12.6), "ok");
    assert.equal(statoSensore(12.55, 11.4, 12.6), "vicino");
    assert.equal(statoSensore(0, 11.4, 12.6), "oltre");
  });
  it("limite basso soltanto: vicino se entro il 10%", () => {
    assert.equal(statoSensore(21, 20, null), "vicino");
    assert.equal(statoSensore(38, 10, null), "ok");
  });
});

describe("gruppiSensori", () => {
  const s = (classe: string, id: number) => ({ sensor_id: id, librenms_device_id: 1, classe, descrizione: `s${id}`, valore: 1, limite_basso: null, limite_alto: null, aggiornato_il: null, letto_il: "2026-10-22 10:15:00" });
  it("un gruppo per classe nell'ordine della tavola, quelli vuoti non ci sono, le classi ignote in «Altri»", () => {
    const g = gruppiSensori([s("state", 1), s("temperature", 2), s("count", 3), s("dbm", 4), s("fanspeed", 5)]);
    assert.deepEqual(g.map((x) => x.id), ["temperatura", "ventole", "ottiche", "stati", "altri"]);
  });
  it("nessun sensore, nessun gruppo", () => assert.deepEqual(gruppiSensori([]), []));
});

describe("letturaVecchia", () => {
  it("oltre un'ora sì, meno no, senza ora no", () => {
    assert.equal(letturaVecchia("2026-10-22 07:40:00", ADESSO), true);
    assert.equal(letturaVecchia("2026-10-22 10:15:00", ADESSO), false);
    assert.equal(letturaVecchia(null, ADESSO), false);
  });
});

describe("datiAttivi", () => {
  it("spento, non abbinato o assente = null", () => {
    assert.equal(datiAttivi(null), null);
    assert.equal(datiAttivi({ ...dati(), acceso: false } as DatiLibrenmsScheda), null);
    assert.equal(datiAttivi({ acceso: true, abbinato: false, letture: LETTURE }), null);
    assert.notEqual(datiAttivi(dati()), null);
  });
});

describe("unisciPorte", () => {
  const nostra = (id: number, nome: string, timestamp: string) => ({ id, port_name: nome, status: "up" as const, speed: "1000", vlan: 10, timestamp });
  const lp = (port_id: number, if_name: string, extra: Record<string, unknown> = {}) => ({ librenms_device_id: 1, port_id, if_index: port_id, if_name, if_alias: null, if_type: null, oper_status: "up", admin_status: "up", speed: 10_000_000_000, mac: null, vlan: 1, letto_il: "2026-10-22 10:15:00", ...extra });
  it("senza LibreNMS restano le nostre, tutte con la fonte DA-IPAM", () => {
    const r = unisciPorte([nostra(1, "1/0/1", "2026-10-22 10:12:00")], null, ADESSO);
    assert.equal(r.length, 1);
    assert.equal(r[0]!.fonte, "ipam");
    assert.equal(r[0]!.alias, null);
  });
  it("il nostro dato di meno di un'ora vince, l'alias viene da LibreNMS", () => {
    const r = unisciPorte([nostra(1, "1/0/1", "2026-10-22 10:12:00")], datiAttivi(dati({ porte: [lp(7, "1/0/1", { if_alias: "stampante-2p" })] })), ADESSO);
    assert.equal(r[0]!.fonte, "ipam");
    assert.equal(r[0]!.alias, "stampante-2p");
    assert.equal(r[0]!.velocita, "1000");
  });
  it("il nostro dato vecchio cede a LibreNMS, per porta; le porte solo sue entrano con la sua fonte", () => {
    const l = datiAttivi(dati({ porte: [lp(7, "1/0/1"), lp(8, "vlan40", { admin_status: "down" })] }));
    const r = unisciPorte([nostra(1, "1/0/1", "2026-10-22 07:12:00"), nostra(2, "1/0/2", "2026-10-22 07:12:00")], l, ADESSO);
    assert.deepEqual(r.map((p) => [p.nome, p.fonte]), [["1/0/1", "librenms"], ["1/0/2", "ipam"], ["vlan40", "librenms"]]);
    assert.equal(r[0]!.velocita, "10G");
    assert.equal(r[0]!.portaId, 1);
    assert.equal(r[2]!.stato, "disabled");
    assert.equal(r[2]!.portaId, null);
    assert.equal(nostroGiroVecchio(r, [nostra(1, "1/0/1", "2026-10-22 07:12:00")], ADESSO), "2026-10-22 07:12:00");
  });
  it("nessun avviso se il nostro giro è fresco", () => {
    const n = [nostra(1, "1/0/1", "2026-10-22 10:12:00")];
    assert.equal(nostroGiroVecchio(unisciPorte(n, null, ADESSO), n, ADESSO), null);
  });
});

describe("unisciVicini", () => {
  const nostro = (portaLocale: string, nome: string, portaRemota: string) => ({ portaLocale, nome, portaRemota, protocollo: "lldp", ip: "192.0.2.1", mac: null, piattaforma: null, chiave: `${portaLocale}|${nome}` });
  const lv = (local_port_name: string, remote_hostname: string, remote_port: string) => ({ librenms_device_id: 1, link_id: 1, local_port_id: 1, protocol: "lldp", remote_hostname, remote_port, remote_platform: "RouterOS", remote_device_id: 0, remote_port_id: null, letto_il: "2026-10-22 10:15:00", local_port_name });
  it("righe uguali una volta sola con le due fonti, le altre con la propria", () => {
    const r = unisciVicini(
      [nostro("1/0/49", "ccr-core", "sfp1"), nostro("1/0/12", "pve-nodo-2", "eno1")],
      datiAttivi(dati({ vicini: [lv("1/0/49", "CCR-CORE", "sfp1"), lv("1/0/24", "ap-sala", "eth0")] })),
    );
    assert.deepEqual(r.map((v) => [v.portaLocale, v.fonte, v.disaccordo]), [["1/0/12", "ipam", false], ["1/0/24", "librenms", false], ["1/0/49", "entrambe", false]]);
  });
  it("stessa porta locale con vicini diversi: due righe, disaccordo", () => {
    const r = unisciVicini([nostro("1/0/47", "nas-backup", "eth1")], datiAttivi(dati({ vicini: [lv("1/0/47", "nas-backup-2", "eth1")] })));
    assert.deepEqual(r.map((v) => [v.nome, v.fonte, v.disaccordo]), [["nas-backup", "ipam", true], ["nas-backup-2", "librenms", true]]);
  });
  it("senza LibreNMS restano i nostri", () => {
    assert.deepEqual(unisciVicini([nostro("1/0/1", "a", "b")], null).map((v) => v.fonte), ["ipam"]);
  });
});

describe("voceLibrenms", () => {
  const vecchia = { nome: "LibreNMS", esito: "ok" as const };
  it("nessun dato = la voce di prima", () => assert.equal(voceLibrenms(null, vecchia, ora), vecchia));
  it("lettura spenta con l'oggetto già in LibreNMS lo dice; non abbinato resta come prima", () => {
    assert.equal(voceLibrenms({ ...dati(), acceso: false } as DatiLibrenmsScheda, vecchia, ora)?.nota, "lettura spenta");
    const non = { nome: "LibreNMS", esito: "non_abbinato" as const };
    assert.equal(voceLibrenms({ ...dati(), acceso: false } as DatiLibrenmsScheda, non, ora), non);
    assert.equal(voceLibrenms({ acceso: true, abbinato: false, letture: LETTURE }, non, ora), non);
  });
  it("letto = ok con l'ora; mai interrogato; tolto da LibreNMS", () => {
    assert.deepEqual(voceLibrenms(dati(), null, ora), { nome: "LibreNMS", esito: "ok", quando: "10:15" });
    const mai = dati();
    if (mai.abbinato && mai.apparato) mai.apparato.last_polled = null;
    assert.match(voceLibrenms(mai, null, ora)?.nota ?? "", /SNMP non risponde/);
    const tolto = voceLibrenms(dati({ apparato: null, sensori: [{ letto_il: "2026-10-21 18:00:00" }] }), null, ora);
    assert.equal(tolto?.esito, "assente");
    assert.match(tolto?.nota ?? "", /non più in LibreNMS \(ultima lettura 18:00\)/);
  });
});

describe("conLibrenms", () => {
  const altra = { nome: "Discovery", esito: "ok" as const };
  it("sostituisce la voce di prima, o la aggiunge in fondo", () => {
    assert.deepEqual(conLibrenms([{ nome: "LibreNMS", esito: "non_abbinato" as const }, altra], dati(), ora).map((f) => f.esito), ["ok", "ok"]);
    assert.deepEqual(conLibrenms([altra], dati(), ora).map((f) => f.nome), ["Discovery", "LibreNMS"]);
  });
  it("lettura spenta e niente voce di prima: le fonti restano com'erano", () => {
    const f = [altra];
    assert.equal(conLibrenms(f, { ...dati(), acceso: false } as DatiLibrenmsScheda, ora), f);
    assert.equal(conLibrenms(f, null, ora), f);
  });
});
