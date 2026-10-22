/**
 * A-IPAM, Task 4: la fotografia dell'inventario per DA-Vul-can, costruttore puro a
 * lista bianca (spec §5.4). Qui: forma accettata dall'hub (copia dello schema zod
 * in `fixtures/schemi-hub.ts`), ordine e chiavi fisse, preferenze dei campi,
 * limiti dell'hub, `famigliaOs` uguale alla colonna generata `hosts.os_family`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import type { DatiInventario, RigaHostInventario } from "../dati-inventario";
import {
  CAMPI_OGGETTO,
  MAX_OGGETTI,
  SCHEMA_VERSIONE_INVENTARIO,
  corpoInventario,
  famigliaOs,
} from "../corpo-inventario";
import { CHIAVI_OGGETTO_HUB, SchemaInventarioHub } from "./fixtures/schemi-hub";

const ADESSO = new Date("2026-10-22T09:00:00.000Z");
const TESTA = { codcli: "70791", nodo: "nodo-1", versione: "0.9.868", adesso: ADESSO };

function host(over: Partial<RigaHostInventario> = {}): RigaHostInventario {
  return {
    id: 1,
    network_id: 1,
    ip: "10.0.0.2",
    mac: "aa:bb:cc:dd:ee:ff",
    vendor: null,
    hostname: "pc-01",
    dns_reverse: null,
    custom_name: null,
    classification: "workstation",
    status: "online",
    open_ports: null,
    os_info: null,
    os_family: "Unknown",
    model: null,
    serial_number: null,
    firmware: null,
    device_manufacturer: null,
    host_source: "scan",
    first_seen: "2026-04-27 12:49:22",
    last_seen: "2026-10-22 08:15:37",
    created_at: "2026-04-27 12:49:22",
    nd_device_type: null,
    nd_model: null,
    nd_firmware: null,
    nd_serial_number: null,
    ...over,
  };
}

function dati(over: Partial<DatiInventario> = {}): DatiInventario {
  return {
    reti: [{ id: 1, cidr: "10.0.0.0/24", nome: "LAN", vlan: 10, sede: "Sede A" }],
    host: [host()],
    inAd: new Set(),
    wazuh: new Map(),
    osAd: new Map(),
    apparatiSenzaHost: 0,
    ...over,
  };
}

type Ok = { json: string; oggetti: number; porteIllegibili: number; saltati: number };
function ok(r: ReturnType<typeof corpoInventario>): Ok {
  if ("errore" in r) throw new Error(`atteso un corpo, avuto: ${r.errore}`);
  return r;
}
type Oggetto = Record<string, unknown>;
const oggetti = (json: string) => (JSON.parse(json) as { oggetti: Oggetto[] }).oggetti;

test("la lista bianca sta dentro le chiavi ammesse dall'hub", () => {
  for (const k of CAMPI_OGGETTO) assert.ok(CHIAVI_OGGETTO_HUB.includes(k), `${k} non è nello schema dell'hub`);
  assert.equal(SCHEMA_VERSIONE_INVENTARIO, 1);
  assert.equal(MAX_OGGETTI, 50_000);
});

test("testa e oggetto: chiavi in ordine fisso, schema dell'hub valido", () => {
  const r = ok(corpoInventario(dati(), TESTA));
  const j = JSON.parse(r.json) as Record<string, unknown>;
  assert.deepEqual(Object.keys(j), ["schema_versione", "codcli", "nodo", "generato_il", "versione_ipam", "reti", "oggetti"]);
  assert.equal(j.generato_il, "2026-10-22T09:00:00.000Z");
  assert.deepEqual(j.reti, [{ cidr: "10.0.0.0/24", nome: "LAN", vlan: 10, sede: "Sede A" }]);
  assert.deepEqual(Object.keys(oggetti(r.json)[0]), [...CAMPI_OGGETTO]);
  const v = SchemaInventarioHub.safeParse(j);
  assert.ok(v.success, v.success ? "" : JSON.stringify(v.error.issues.slice(0, 3)));
  assert.equal(r.oggetti, 1);
});

test("preferenze: os Wazuh › AD › os_info; hostname custom › hostname › dns; produttore vendor › manufacturer; apparato › host", () => {
  const d = dati({
    host: [
      host({ id: 1, ip: "10.0.0.1", os_info: "Linux 5.x", custom_name: "Nome scelto", vendor: null, device_manufacturer: "Dell",
        model: "modello-host", nd_model: "modello-apparato", nd_device_type: "switch", nd_firmware: "fw-ap", firmware: "fw-host",
        serial_number: "SN-H", nd_serial_number: null }),
      host({ id: 2, ip: "10.0.0.3", os_info: "Windows", hostname: null, dns_reverse: "pc.esempio.local", vendor: "Intel", device_manufacturer: "Dell" }),
      host({ id: 3, ip: "10.0.0.4", os_info: "Windows 10", os_family: "Windows" }),
    ],
    wazuh: new Map([[1, { os: "Ubuntu 22.04.4 LTS" }]]),
    osAd: new Map([[1, "Windows Server 2019 Standard"], [2, "Windows Server 2012 R2 Standard 6.3"]]),
    inAd: new Set([1, 2]),
  });
  const o = oggetti(ok(corpoInventario(d, TESTA)).json);
  assert.equal(o[0].os, "Ubuntu 22.04.4 LTS");
  assert.equal(o[0].os_famiglia, "Linux");
  assert.equal(o[0].fuori_supporto, null);
  assert.equal(o[0].hostname, "Nome scelto");
  assert.equal(o[0].produttore, "Dell");
  assert.equal(o[0].modello, "modello-apparato");
  assert.equal(o[0].tipo_apparato, "switch");
  assert.equal(o[0].firmware, "fw-ap");
  assert.equal(o[0].seriale, "SN-H");
  assert.deepEqual(o[0].fonti, ["scan", "ad", "wazuh"]);
  assert.equal(o[0].in_ad, true);
  assert.equal(o[0].agente_wazuh, true);
  assert.equal(o[1].os, "Windows Server 2012 R2 Standard 6.3");
  assert.equal(o[1].fuori_supporto, true);
  assert.equal(o[1].hostname, "pc.esempio.local");
  assert.equal(o[1].produttore, "Intel");
  assert.equal(o[1].agente_wazuh, false);
  assert.equal(o[2].os, "Windows 10");
  assert.equal(o[2].os_famiglia, "Windows");
  assert.equal(o[2].in_ad, false);
  assert.deepEqual(o[2].fonti, ["scan"]);
});

test("os_famiglia: la colonna se non è Unknown, altrimenti famigliaOs dell'os scelto", () => {
  const d = dati({ host: [host({ os_info: null, os_family: "Unknown" })], osAd: new Map([[1, "Windows 11 Pro"]]) });
  const o = oggetti(ok(corpoInventario(d, TESTA)).json);
  assert.equal(o[0].os_famiglia, "Windows");
  assert.equal(o[0].fuori_supporto, false);
});

test("ordine per rete e ip (numerico), due fotografie dello stesso DB differiscono solo per generato_il", () => {
  const d = dati({
    reti: [
      { id: 2, cidr: "192.168.1.0/24", nome: "B", vlan: null, sede: null },
      { id: 1, cidr: "10.0.0.0/24", nome: "A", vlan: 1, sede: null },
    ],
    host: [
      host({ id: 1, network_id: 2, ip: "192.168.1.5" }),
      host({ id: 2, network_id: 1, ip: "10.0.0.10" }),
      host({ id: 3, network_id: 1, ip: "10.0.0.9" }),
    ],
  });
  const a = ok(corpoInventario(d, TESTA)).json;
  const b = ok(corpoInventario({ ...d, host: [...d.host].reverse(), reti: [...d.reti].reverse() }, { ...TESTA, adesso: new Date("2026-10-23T09:00:00.000Z") })).json;
  assert.deepEqual(oggetti(a).map((o) => o.ip), ["10.0.0.9", "10.0.0.10", "192.168.1.5"]);
  assert.equal(a.replace("2026-10-22T09:00:00.000Z", "X"), b.replace("2026-10-23T09:00:00.000Z", "X"));
  assert.deepEqual((JSON.parse(a) as { reti: { cidr: string }[] }).reti.map((r) => r.cidr), ["10.0.0.0/24", "192.168.1.0/24"]);
});

test("porte: dal JSON di open_ports; storto → [] e conteggio, la fotografia parte lo stesso", () => {
  const porte = JSON.stringify([
    { port: 22, protocol: "tcp", service: "ssh", version: "OpenSSH 9.6" },
    { port: 99999, protocol: "tcp", service: "x", version: null },
    { port: 161, protocol: "udp", service: null, version: null, extra: "SENTINELLA" },
  ]);
  const d = dati({
    host: [
      host({ id: 1, ip: "10.0.0.1", open_ports: porte }),
      host({ id: 2, ip: "10.0.0.2", open_ports: "{non json" }),
      host({ id: 3, ip: "10.0.0.3", open_ports: '{"port":22}' }),
    ],
  });
  const r = ok(corpoInventario(d, TESTA));
  const o = oggetti(r.json);
  assert.deepEqual(o[0].porte, [
    { porta: 22, protocollo: "tcp", servizio: "ssh", versione: "OpenSSH 9.6" },
    { porta: 161, protocollo: "udp", servizio: null, versione: null },
  ]);
  assert.deepEqual(o[1].porte, []);
  assert.deepEqual(o[2].porte, []);
  assert.equal(r.porteIllegibili, 2);
  assert.ok(!r.json.includes("SENTINELLA"));
  assert.ok(SchemaInventarioHub.safeParse(JSON.parse(r.json)).success);
});

test("date: SQLite UTC → ISO; first_seen vuoto → created_at; last_seen vuoto → visto_prima", () => {
  const d = dati({ host: [host({ first_seen: null, last_seen: null, created_at: "2026-04-27 13:14:36" })] });
  const o = oggetti(ok(corpoInventario(d, TESTA)).json)[0];
  assert.equal(o.visto_prima, "2026-04-27T13:14:36.000Z");
  assert.equal(o.visto_ultima, "2026-04-27T13:14:36.000Z");
  const o2 = oggetti(ok(corpoInventario(dati(), TESTA)).json)[0];
  assert.equal(o2.visto_prima, "2026-04-27T12:49:22.000Z");
  assert.equal(o2.visto_ultima, "2026-10-22T08:15:37.000Z");
});

test("data illeggibile → null, mai un testo finto: first_seen → created_at, last_seen → visto_prima", () => {
  const d = dati({ host: [
    host({ id: 1, ip: "10.0.0.1", first_seen: "non è una data", last_seen: "boh", created_at: "2026-04-27 13:14:36" }),
    host({ id: 2, ip: "10.0.0.2", first_seen: "boh", last_seen: "2026-10-22 08:15:37", created_at: "neanche" }),
  ] });
  const r = ok(corpoInventario(d, TESTA));
  const o = oggetti(r.json);
  assert.equal(o.length, 1);
  assert.equal(o[0].visto_prima, "2026-04-27T13:14:36.000Z");
  assert.equal(o[0].visto_ultima, "2026-04-27T13:14:36.000Z");
  assert.equal(r.saltati, 1);
  assert.ok(!r.json.includes("boh") && !r.json.includes("non è una data"));
});

test("testa: nodo e codcli accorciati ai limiti dell'hub (80, 20), la fotografia resta valida", () => {
  const r = ok(corpoInventario(dati(), { ...TESTA, nodo: "n".repeat(200), codcli: "c".repeat(30) }));
  const j = JSON.parse(r.json) as { nodo: string; codcli: string };
  assert.equal(j.nodo.length, 80);
  assert.equal(j.codcli.length, 20);
  assert.ok(SchemaInventarioHub.safeParse(j).success);
});

test("valori oltre i limiti dell'hub si accorciano, stato e classificazione mai vuoti", () => {
  const lungo = "W".repeat(300);
  const d = dati({ host: [host({ os_info: `Windows ${lungo}`, hostname: lungo, vendor: lungo, model: lungo, status: null, classification: null })] });
  const r = ok(corpoInventario(d, TESTA));
  const o = oggetti(r.json)[0];
  assert.equal((o.os as string).length, 200);
  assert.equal((o.hostname as string).length, 255);
  assert.equal((o.produttore as string).length, 120);
  assert.equal(o.stato, "unknown");
  assert.equal(o.classificazione, "unknown");
  assert.ok(SchemaInventarioHub.safeParse(JSON.parse(r.json)).success);
});

test("host senza data né rete nota, o ip impossibile → saltato e contato", () => {
  const d = dati({
    host: [
      host({ id: 1, ip: "10.0.0.1" }),
      host({ id: 2, ip: "10.0.0.2", first_seen: null, last_seen: null, created_at: null }),
      host({ id: 3, ip: "10.0.0.3", network_id: 99 }),
      host({ id: 4, ip: "x" }),
    ],
  });
  const r = ok(corpoInventario(d, TESTA));
  assert.equal(r.oggetti, 1);
  assert.equal(r.saltati, 3);
});

test("oltre 50.000 oggetti → errore, niente corpo", () => {
  const tanti = Array.from({ length: MAX_OGGETTI + 1 }, (_, i) => host({ id: i + 1, ip: `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}` }));
  const r = corpoInventario(dati({ host: tanti }), TESTA);
  assert.ok("errore" in r);
  assert.match(r.errore, /50\.000/);
});

/** 15 stringhe vere (os_info/Wazuh/AD viste sui clienti) contro la colonna generata di SQLite. */
const OS_VERI = [
  "Microsoft Windows Server 2019 Standard",
  "Windows 10 Pro 22H2",
  "Linux 5.15.0-91-generic",
  "Ubuntu 22.04.4 LTS",
  "Debian GNU/Linux 12 (bookworm)",
  "macOS 14.4 Sonoma",
  "Darwin 23.4.0",
  "iOS 17.4",
  "iPadOS 17",
  "Android 14",
  "RouterOS 7.14.2",
  "FreeBSD 13.2",
  "Synology DSM 7.2",
  "   ",
  "VMware ESXi 8.0 (Arch: x86_64)",
];

test("famigliaOs dà lo stesso esito della colonna generata hosts.os_family", () => {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  db.prepare("INSERT INTO networks (id, cidr, name) VALUES (1, '10.0.0.0/24', 'LAN')").run();
  const ins = db.prepare("INSERT INTO hosts (network_id, ip, os_info) VALUES (1, ?, ?)");
  OS_VERI.forEach((s, i) => ins.run(`10.0.0.${i + 1}`, s));
  ins.run("10.0.0.200", null);
  const righe = db.prepare("SELECT os_info, os_family FROM hosts ORDER BY id").all() as { os_info: string | null; os_family: string }[];
  assert.equal(righe.length, OS_VERI.length + 1);
  for (const r of righe) assert.equal(famigliaOs(r.os_info), r.os_family, `os_info=${JSON.stringify(r.os_info)}`);
  db.close();
});
