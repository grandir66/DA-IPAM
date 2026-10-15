// I33 per SNMP (spec §13.5.4, §13.12.3): con la lettura spenta il giro degli switch non manda nessuna richiesta nuova (spia
// sulla funzione di walk); accesa, legge solo gli switch che non sono del controller, una volta l'ora.
//
// In più (livello completo, zona rossa: letture nuove sugli switch dei clienti): a interruttore spento il giro degli switch
// è quello di prima (stesse chiamate al client dello switch, nessun fatto, nessun vicino, nessun esito, stesso resoconto);
// i MikroTik letti via SSH e gli switch senza SNMP non ricevono letture SNMP; un tempo massimo per lettura (10 s); una
// sessione che non si apre non ferma il giro; due giri paralleli → una lettura; sull'agente finto (UDP locale, non un
// apparato) la sessione vera parla la versione dell'apparato e manda solo GETNEXT/GETBULK. Le letture sono DEDOTTE DALLE
// MIB, NON OSSERVATE su un apparato vero.
//
// Hub isolato importato per primo (il perché sta in support/hub-isolato).
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, rileggiSchemaCavi, withTenant } from "@/lib/db-tenant";
import { runArpPoll } from "@/lib/cron/jobs";
import { creaWalkSnmp, type SwitchClient } from "@/lib/devices/switch-client";
import { TEMPO_WALK_MS, type LettoreSnmp, type VoceSnmp } from "@/lib/devices/snmp-walk";
import { leggiSnmpTopologia, TABELLE_SNMP } from "@/lib/devices/snmp-topologia";
import { codiceErrore } from "@/lib/devices/mikrotik-porte";
import { leggiEsiti, scriviInterruttore } from "@/lib/topology/letture/interruttori";
import { avviaAgenteFinto } from "@/lib/protocols/__tests__/support/agente-snmp-finto";
import type { NetworkDevice } from "@/types";

const T = "TESTARPLETTURESNMP";
const db = () => getTenantDb(T);
beforeEach(() => {
  db().exec(`DELETE FROM topology_port_facts; DELETE FROM topology_bridge_facts; DELETE FROM topology_device_macs;
    DELETE FROM device_neighbors; DELETE FROM network_devices; DELETE FROM networks;
    DELETE FROM tenant_settings WHERE key LIKE 'topologia.lettura.%';`);
  db().exec("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, enabled, use_for_arp_poll, community_string) "
    + "VALUES (5, 'SW-5', '192.0.2.5', 'switch', 'cisco', 'snmp_v2', 1, 0, 'public'), (6, 'SW-6', '192.0.2.6', 'switch', 'ubiquiti', 'snmp_v2', 1, 0, 'public')");
  db().exec("UPDATE network_devices SET controller_mac = '02:00:00:00:00:06' WHERE id = 6");
  // Un MikroTik letto via SSH (ha le sue letture, Task 4) e uno switch senza SNMP: niente letture SNMP per loro.
  db().exec("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, enabled, use_for_arp_poll, community_string) "
    + "VALUES (7, 'SW-7', '192.0.2.7', 'switch', 'mikrotik', 'ssh', 1, 0, 'public'), (8, 'SW-8', '192.0.2.8', 'switch', 'hp', 'ssh', 1, 0, NULL)");
  withTenant(T, () => rileggiSchemaCavi());
});
after(() => { deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

const switchFinto = async (): Promise<SwitchClient> => ({ async getMacTable() { return []; }, async getPortSchema() { return []; }, async testConnection() { return true; } });
/** La spia delle letture: le voci per tabella; `muto` = apparati che non rispondono a niente (tempo scaduto). */
function spia(voci: Record<string, VoceSnmp[]> = {}, rotto: Record<number, Error> = {}, muto: number[] = []) {
  const apparati: number[] = [];
  const tempi: Array<number | undefined> = [];
  const oids: string[] = [];
  const tutte = Object.values(voci).flat();
  const crea = async (device: { id: number }, tempoMs?: number): Promise<LettoreSnmp> => {
    apparati.push(device.id);
    tempi.push(tempoMs);
    if (rotto[device.id]) throw rotto[device.id];
    const zitto = (): void => {
      if (muto.includes(device.id)) throw Object.assign(new Error("nessuna risposta"), { code: "TEMPO_SCADUTO" });
    };
    return Object.assign(async (oid: string) => { oids.push(oid); zitto(); return tutte.filter((v) => v.oid.startsWith(`${oid}.`)); }, {
      get: async (lista: string[]) => { oids.push(`get:${lista.join(",")}`); zitto(); return tutte.filter((v) => lista.includes(v.oid)); },
    });
  };
  return { crea, apparati, tempi, oids };
}
const giro = (s: ReturnType<typeof spia>, ora: Date, creaClientSwitch: (device: NetworkDevice) => Promise<SwitchClient> = switchFinto) =>
  withTenant(T, () => runArpPoll(null, { skipDhcpLeases: true, creaClientSwitch, creaWalkSnmp: s.crea, adesso: () => ora }));
const conta = (sql: string): number => (db().prepare(sql).get() as { n: number }).n;
const accendi = () => withTenant(T, () => scriviInterruttore("snmp", true, "admin"));

/** Un client dello switch che registra le chiamate: «apparato:metodo». */
function clientRegistrato(chiamate: string[]) {
  return async (device: NetworkDevice): Promise<SwitchClient> => ({
    async getMacTable() { chiamate.push(`${device.id}:getMacTable`); return []; },
    async getPortSchema() { chiamate.push(`${device.id}:getPortSchema`); return []; },
    async testConnection() { chiamate.push(`${device.id}:testConnection`); return true; },
  });
}

test("spenta: nessuna richiesta SNMP nuova", async () => {
  const s = spia();
  await giro(s, new Date("2026-10-15T08:00:00Z"));
  assert.deepEqual(s.apparati, []);
});

test("accesa: solo lo switch che non è del controller; un'ora dopo di nuovo, mezz'ora dopo no", async () => {
  withTenant(T, () => scriviInterruttore("snmp", true, "admin"));
  const s = spia();
  await giro(s, new Date("2026-10-15T08:00:00Z"));
  await giro(s, new Date("2026-10-15T08:30:00Z"));
  await giro(s, new Date("2026-10-15T09:01:00Z"));
  assert.deepEqual(s.apparati, [5, 5]);
  assert.deepEqual(Object.keys(withTenant(T, () => leggiEsiti("snmp"))), ["5"]);
});

// ── Livello completo: le garanzie in più ─────────────────────────────────────

const IF = TABELLE_SNMP.interfacce, BASE = TABELLE_SNMP.base, STP = TABELLE_SNMP.stp, REM = TABELLE_SNMP.lldpRemoti;
const S = TABELLE_SNMP;
/** Le sedici letture, in ordine (revisione del Task 6, piano «Scelte» 10). */
const SCALARI = [2, 5, 6, 7, 16].map((c) => `${STP}.${c}.0`);
const LETTURE = [`${IF}.2`, `${IF}.3`, `${IF}.6`, `${IF}.8`, S.nomi, BASE, `get:${SCALARI.join(",")}`, `${STP}.15.1.3`, `${STP}.15.1.8`,
  `${STP}.15.1.9`, S.lldpLocali, REM, S.lldpIndirizzi, S.cdp, S.fasci, S.mstpRuoli];
const vb = (oid: string, value: VoceSnmp["value"]): VoceSnmp => ({ oid, value });
/** Uno switch con una porta e un vicino LLDP: forma delle MIB, valori inventati. */
const UNA_PORTA: Record<string, VoceSnmp[]> = {
  [IF]: [vb(`${IF}.2.3`, "GigabitEthernet1/0/3"), vb(`${IF}.3.3`, 6), vb(`${IF}.6.3`, Buffer.from([2, 0, 0xc, 0, 0, 3])), vb(`${IF}.8.3`, 1)],
  [BASE]: [vb(`${BASE}.1.0`, Buffer.from([2, 0, 0xc, 0, 0, 0x40])), vb(`${BASE}.4.1.2.3`, 3)],
  [STP]: [vb(`${STP}.2.0`, 32768), vb(`${STP}.5.0`, Buffer.from([0x10, 0, 2, 0, 0xc, 0, 0, 0x99])), vb(`${STP}.6.0`, 4), vb(`${STP}.7.0`, 3),
    vb(`${STP}.16.0`, 2), vb(`${STP}.15.1.3.3`, 5)],
  [REM]: [vb(`${REM}.4.0.3.1`, 4), vb(`${REM}.5.0.3.1`, Buffer.from([2, 0, 0xc, 0, 0, 0x99])), vb(`${REM}.6.0.3.1`, 5),
    vb(`${REM}.7.0.3.1`, "Gi1/0/48"), vb(`${REM}.9.0.3.1`, "SW-CENTRO")],
};

test("spenta: il giro degli switch è quello di prima — stesse chiamate al client, nessun fatto, vicino, esito; stesso resoconto", async () => {
  const spenta: string[] = [];
  const s = spia(UNA_PORTA);
  const r = await giro(s, new Date("2026-10-15T08:00:00Z"), clientRegistrato(spenta));
  assert.deepEqual(s.apparati, []);
  assert.deepEqual(spenta, ["5:getMacTable", "5:getPortSchema", "6:getMacTable", "6:getPortSchema", "7:getMacTable", "7:getPortSchema",
    "8:getMacTable", "8:getPortSchema"]);
  assert.equal(r.phase, "ARP poll completato");
  assert.equal(conta("SELECT (SELECT COUNT(*) FROM topology_port_facts) + (SELECT COUNT(*) FROM topology_bridge_facts) + (SELECT COUNT(*) FROM topology_device_macs) + (SELECT COUNT(*) FROM device_neighbors) AS n"), 0);
  assert.deepEqual(withTenant(T, () => leggiEsiti("snmp")), {});
  // Accesa, il client dello switch riceve le stesse chiamate: la lettura in più si aggiunge, non sostituisce niente.
  accendi();
  const accesa: string[] = [];
  await giro(spia(UNA_PORTA), new Date("2026-10-15T08:00:00Z"), clientRegistrato(accesa));
  assert.deepEqual(accesa, spenta);
});

test("accesa: fatti e vicini con la fonte snmp, esito 16 su 16, solo le sedici letture, 10 secondi al massimo per lettura", async () => {
  accendi();
  const s = spia(UNA_PORTA);
  const r = await giro(s, new Date("2026-10-15T08:00:00Z"));
  assert.deepEqual(s.oids, LETTURE);
  assert.deepEqual(s.tempi, [TEMPO_WALK_MS]);
  assert.equal(TEMPO_WALK_MS, 10_000);
  assert.equal(conta("SELECT COUNT(*) AS n FROM topology_port_facts WHERE device_id = 5 AND source = 'snmp' AND port_key = 'i:3' AND stp_state = 'forwarding' AND in_bridge = 1"), 1);
  assert.equal(conta("SELECT COUNT(*) AS n FROM topology_bridge_facts WHERE device_id = 5 AND source = 'snmp' AND protocol = 'rstp' AND root_port = 'GigabitEthernet1/0/3'"), 1);
  assert.equal(conta("SELECT COUNT(*) AS n FROM topology_device_macs WHERE device_id = 5 AND source = 'snmp'"), 2);
  assert.equal(conta("SELECT COUNT(*) AS n FROM device_neighbors WHERE device_id = 5 AND source = 'snmp' AND protocol = 'lldp' AND local_port_index = 3"), 1);
  assert.equal(conta("SELECT COUNT(*) AS n FROM device_neighbors WHERE source <> 'snmp'"), 0, "nessuna riga con le fonti di oggi");
  assert.deepEqual(withTenant(T, () => leggiEsiti("snmp"))["5"], { il: "2026-10-15 08:00:00", comandi: 16, riusciti: 16, codice: null });
  assert.match(r.phase ?? "", /letture in più: 1 lette/);
});

test("una sessione che non si apre non ferma il giro: esito col codice, la tabella MAC si legge, lo switch dopo si legge", async () => {
  db().exec("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, enabled, use_for_arp_poll, community_string) "
    + "VALUES (9, 'SW-9', '192.0.2.9', 'switch', 'hp', 'snmp_v2', 1, 0, 'public')");
  accendi();
  const chiamate: string[] = [];
  const s = spia(UNA_PORTA, { 5: Object.assign(new Error("getaddrinfo"), { code: "ENOTFOUND" }) });
  const r = await giro(s, new Date("2026-10-15T08:00:00Z"), clientRegistrato(chiamate));
  const e = withTenant(T, () => leggiEsiti("snmp"));
  assert.deepEqual([e["5"].comandi, e["5"].riusciti, e["5"].codice], [0, 0, "ENOTFOUND"]);
  assert.deepEqual([e["9"].comandi, e["9"].riusciti, e["9"].codice], [16, 16, null]);
  assert.ok(chiamate.includes("5:getMacTable") && chiamate.includes("9:getMacTable"));
  assert.equal(conta("SELECT COUNT(*) AS n FROM topology_port_facts WHERE device_id = 5"), 0);
  assert.match(r.phase ?? "", /1 non riuscita; codici: ENOTFOUND/);
});

test("lucchetto: due giri paralleli → una lettura per apparato", async () => {
  accendi();
  const s = spia();
  await Promise.all([giro(s, new Date("2026-10-15T08:00:00Z")), giro(s, new Date("2026-10-15T08:00:00Z"))]);
  assert.deepEqual(s.apparati, [5]);
});

test("agente finto su UDP locale (non un apparato): sessione vera con la versione dell'apparato, solo GET/GETNEXT/GETBULK; muto → TEMPO_SCADUTO", async () => {
  const a = await avviaAgenteFinto({ versioni: ["1", "2c"], valori: {} });
  const muto = await avviaAgenteFinto({ versioni: [], valori: {} });
  try {
    const apparato = (porta: number, versione: "1" | "2c" | null): NetworkDevice => withTenant(T, () => {
      const id = Number(db().prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, port, enabled, community_string, snmp_version) "
        + "VALUES ('SW-AGENTE', '127.0.0.1', 'switch', 'hp', 'snmp_v2', ?, 0, 'public', ?)").run(porta, versione).lastInsertRowid);
      return db().prepare("SELECT * FROM network_devices WHERE id = ?").get(id) as NetworkDevice;
    });
    for (const [versione, attesa, tipo] of [["2c", "2c", "getbulk"], [null, "1", "getnext"]] as const) {
      a.richieste.length = 0;
      const d = apparato(a.porta, versione);
      const l = await withTenant(T, async () => leggiSnmpTopologia(await creaWalkSnmp(d), { lettoreCisco: false }));
      assert.deepEqual([l.letture, l.riuscite, l.codice], [16, 16, null], `versione ${versione ?? "NULL"}`);
      assert.deepEqual([...new Set(a.richieste.map((q) => q.versione))], [attesa], "la versione dell'apparato (NULL = v1, come prima)");
      assert.deepEqual([...new Set(a.richieste.map((q) => q.tipo))], [tipo, "get"], "solo letture: nessun SET");
      assert.deepEqual(a.richieste.filter((q) => q.tipo !== "get").map((q) => q.oids[0]), LETTURE.filter((x) => !x.startsWith("get:")));
      // Il GET degli scalari: una richiesta con tutti e cinque; in v1 l'agente senza valori risponde «noSuchName» per la
      // richiesta intera, e allora un OID alla volta (chi non c'è manca: letta, senza bridge).
      const get = a.richieste.filter((q) => q.tipo === "get").map((q) => q.oids);
      assert.deepEqual(get, versione === "2c" ? [SCALARI] : [SCALARI, ...SCALARI.map((o) => [o])]);
    }
    const d = apparato(muto.porta, "2c");
    const t0 = Date.now();
    await withTenant(T, async () => {
      const walk = await creaWalkSnmp(d, 150);
      await assert.rejects(walk(TABELLE_SNMP.interfacce), (e: unknown) => codiceErrore(e) === "TEMPO_SCADUTO");
    });
    assert.ok(Date.now() - t0 < 3000, "il tempo massimo della lettura, non quello della sessione (10 s)");
  } finally {
    await a.chiudi();
    await muto.chiudi();
  }
});

// ── Revisione del Task 6 di T2 ───────────────────────────────────────────────

// C2: tutte le letture fallite davano un esito «letto in parte» (0 su 10) e una scrittura vuota, con la potatura. Adesso è
// un errore col codice: niente scrittura, niente potatura, e il resoconto lo conta fra le non riuscite.
test("C2: tutte le letture fallite = errore col codice, niente scrittura; C4: lo switch muto costa una lettura, non sedici", async () => {
  db().exec("INSERT INTO topology_port_facts (device_id, source, port_key, port_name, seen_at) VALUES (5, 'snmp', 'i:9', 'vecchia', '2026-06-01 10:00:00')");
  accendi();
  const s = spia(UNA_PORTA, {}, [5]);
  const r = await giro(s, new Date("2026-10-15T08:00:00Z"));
  const e = withTenant(T, () => leggiEsiti("snmp"))["5"];
  assert.deepEqual([e.comandi, e.riusciti, e.codice], [0, 0, "TEMPO_SCADUTO"]);
  assert.deepEqual(s.oids, [`${IF}.2`], "la prima non risponde: le altre si saltano");
  assert.equal(conta("SELECT COUNT(*) AS n FROM topology_port_facts WHERE device_id = 5"), 1, "nessuna scrittura, nessuna potatura");
  assert.match(r.phase ?? "", /1 non riuscita; codici: TEMPO_SCADUTO/);
});

// C5: le letture nuove partivano da ogni apparato del ramo degli switch con una sessione SNMP (AP, NAS, server): la spec
// (§13.5.4) le vuole sugli switch. Estenderle è una scelta di Riccardo.
test("C5: le letture SNMP nuove solo sugli switch; un AP o un NAS con SNMP non riceve niente", async () => {
  db().exec("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, enabled, use_for_arp_poll, community_string) "
    + "VALUES (10, 'AP-10', '192.0.2.10', 'access_point', 'hp', 'snmp_v2', 1, 0, 'public'), (11, 'NAS-11', '192.0.2.11', 'nas', 'hp', 'snmp_v2', 1, 0, 'public')");
  accendi();
  const s = spia(UNA_PORTA);
  await giro(s, new Date("2026-10-15T08:00:00Z"));
  assert.deepEqual(s.apparati, [5]);
});
