// Il repo è pubblico: una fixture con un nome, un IP o un MAC vero non passa.
// La forma è fissata campo per campo: un campo nuovo, un valore fuori dal
// vocabolario dell'app o un testo libero fanno fallire la prova. I valori veri
// li cerca uno per uno lo script d'estrazione, che senza zero non scrive.
// I messaggi dicono dove, mai il valore.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PORTA_GENERICA, VOCABOLARIO } from "@/lib/topology/anonimizza";

const DIR = path.join(__dirname, "fixtures");
const FILES = fs.readdirSync(DIR).filter((f) => f.startsWith("topologia-") && f.endsWith(".json"));
const IP = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
const MAC_FORME = [
  /\b[0-9a-f]{2}([:-])[0-9a-f]{2}(?:\1[0-9a-f]{2}){4}\b/gi,
  /\b[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}\b/gi,
  /\b[0-9a-f]{12}\b/gi,
];
const NOME = /^(((RTR|SW|AP|FW|HV|NAS|SRV|DEV|host|ext|Sede|Ubicazione|Rete)-)|fab)\d+$/;
const IP_FINTO = /^(10\.\d{1,3}|172\.31)\.\d{1,3}\.\d{1,3}$/;
const IPV6_FINTO = /^fd00::[0-9a-f]+$/;
// I MAC virtuali (VRRP/HSRP) restano virtuali con l'ultimo byte finto: il modello li tratta a parte e non identificano nessuno.
const MAC_VIRTUALE_COMPATTO = /^(00005e0001|00005e0002|00000c07ac)[0-9a-f]{2}$/;
const MAC_FINTO = /^(02:0[0-9a-f](:[0-9a-f]{2}){4}|(00:00:5e:00:0[12]|00:00:0c:07:ac):[0-9a-f]{2})$/;
const DATA = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const NODO = /^(dev|host|vm):\d+(:\d+)?$/;

type Regola = (v: unknown) => boolean;
const s = (re: RegExp): Regola => (v) => typeof v === "string" && re.test(v);
const o = (...r: Regola[]): Regola => (v) => r.some((f) => f(v));
const nul: Regola = (v) => v === null;
const num: Regola = (v) => typeof v === "number" && Number.isFinite(v);
const numN = o(num, nul);
const tra = (vs: readonly string[]): Regola => (v) => typeof v === "string" && vs.includes(v);
const indirizzo = o(s(IP_FINTO), s(IPV6_FINTO), s(NOME));
const porta: Regola = o((v) => v === "", s(PORTA_GENERICA), s(/^porta-\d+$/), s(IP_FINTO), s(MAC_FINTO));
const nomeHost = o(nul, s(NOME), s(IP_FINTO), s(MAC_FINTO));

const FORMA: Record<string, Record<string, Regola>> = {
  devices: {
    id: num, name: s(NOME), host: indirizzo, device_type: tra(VOCABOLARIO.device_type), vendor: tra(VOCABOLARIO.vendor), model: nul,
    enabled: num, host_id: numN, physical_device_id: numN, location_id: numN, controller_mac: o(nul, s(MAC_FINTO)),
    uplink_mac: o(nul, s(MAC_FINTO)), uplink_remote_port: numN, uplink_seen_at: o(nul, s(DATA)), topology_hidden: num, port_count: num,
  },
  hosts: {
    id: num, network_id: num, ip: indirizzo, mac: o(nul, s(MAC_FINTO)), hostname: nomeHost, custom_name: nomeHost,
    classification: o(nul, tra(VOCABOLARIO.classification)), status: o(nul, tra(VOCABOLARIO.status)), physical_device_id: numN,
  },
  neighbors: {
    device_id: num, local_port: porta, remote_device_name: o((v) => v === "", s(NOME), s(IP_FINTO), s(MAC_FINTO)), remote_port: porta,
    protocol: tra(VOCABOLARIO.protocol), remote_ip: o(nul, s(IP_FINTO), s(IPV6_FINTO)), remote_mac: o(nul, s(MAC_FINTO)),
    timestamp: o(nul, s(DATA)), source: tra(VOCABOLARIO.source),
  },
  uplinkPorts: { device_id: num, port_index: num, port_name: porta },
  locations: { id: num, name: s(NOME), parent_id: numN, head_device_id: numN },
  networks: {
    id: num, cidr: s(/^((10\.\d{1,3}|172\.31)\.\d{1,3}\.\d{1,3}\/\d{1,2}|fd00:[0-9a-f]+::\/64)$/), name: s(NOME),
    gateway: o(nul, s(IP_FINTO), s(IPV6_FINTO), s(NOME)), location_id: numN,
  },
  knownMacs: { device_id: num, mac: s(MAC_FINTO) },
  macPorts: { device_id: num, mac: s(MAC_FINTO), port_name: porta, timestamp: s(DATA), source: tra(VOCABOLARIO.source) },
  overrides: {
    id: num, action: tra(["add", "ignore"]), a_node: s(NODO), a_port: porta, b_node: s(NODO), b_port: porta,
  },
};

// Fase 2b: campi e sezioni che le fixture estratte prima della fase 2b non hanno. Se ci sono hanno questa
// forma; le fixture si rigenerano dai dati veri anonimizzati (lo fa il controllore), finché non succede mancano.
const FASE_2B_CAMPI: Record<string, Record<string, Regola>> = {
  devices: { uplink_type: o(nul, tra(["wire", "wireless"])) },
  overrides: { medium: o(nul, tra(["cavo", "fibra", "wireless"])) },
};
const FASE_2B_SEZIONI: Record<string, Record<string, Regola> | null> = {
  primaries: { node_id: s(NODO), other_node: s(NODO), node_port: porta, other_port: porta },
  portInfo: {
    device_id: num, port_name: porta, speed: o(nul, s(/^\d+(\.\d+)?\s?(Mbps|Gbps|M|G)?$/)),
    poe_status: o(nul, tra(["delivering", "searching", "disabled", "fault", "off", "on", "auto", "enabled"])), poe_power_mw: numN,
  },
  vms: null, // nessuna riga ammessa: VM e host dei cluster portano nomi, IP e MAC veri
  scanHosts: null,
};

/** Gli scarti di forma di una fixture (vuoto = va bene). Dice dove, mai il valore. */
function scartiDiForma(j: Record<string, unknown>): string[] {
  const out: string[] = [];
  const attese = new Set([...Object.keys(FORMA), "nowMs", "staleDays"]);
  for (const k of attese) if (!(k in j)) out.push(`manca ${k}`);
  for (const k of Object.keys(j)) if (!attese.has(k) && !(k in FASE_2B_SEZIONI)) out.push(`chiave di primo livello in più: ${k}`);
  if (!num(j.nowMs) || !num(j.staleDays)) out.push("nowMs/staleDays");
  const sezioni: Array<[string, Record<string, Regola> | null, Record<string, Regola>]> = [
    ...Object.entries(FORMA).map(([k, c]): [string, Record<string, Regola>, Record<string, Regola>] => [k, c, FASE_2B_CAMPI[k] ?? {}]),
    ...Object.entries(FASE_2B_SEZIONI).filter(([k]) => k in j).map(([k, c]): [string, Record<string, Regola> | null, Record<string, Regola>] => [k, c, {}]),
  ];
  for (const [sezione, campi, facoltativi] of sezioni) {
    const righe = j[sezione];
    if (!Array.isArray(righe)) { out.push(`${sezione} non è un elenco`); continue; }
    if (campi === null) { if (righe.length > 0) out.push(`${sezione}: deve essere vuoto`); continue; }
    (righe as Array<Record<string, unknown>>).forEach((r, i) => {
      const chiavi = Object.keys(r).filter((k) => !(k in facoltativi)).sort();
      if (JSON.stringify(chiavi) !== JSON.stringify(Object.keys(campi).sort())) out.push(`${sezione}[${i}]: chiavi`);
      for (const [k, regola] of Object.entries({ ...campi, ...Object.fromEntries(Object.entries(facoltativi).filter(([f]) => f in r)) })) {
        if (!regola(r[k])) out.push(`${sezione}[${i}].${k}: valore fuori forma`);
      }
    });
  }
  return out;
}

test("ci sono le due fixture", () => {
  assert.deepEqual(FILES.sort(), ["topologia-cliente-a.json", "topologia-domarc.json"]);
});

for (const f of FILES) {
  test(`${f}: solo indirizzi finti e nomi pseudonimi`, () => {
    const testo = fs.readFileSync(path.join(DIR, f), "utf8");
    const ipVeri = (testo.match(IP) ?? []).filter((ip) => !(ip.startsWith("10.") || ip.startsWith("172.31."))).length;
    assert.equal(ipVeri, 0, `${ipVeri} IP non finti`);
    for (const re of MAC_FORME) {
      const veri = (testo.match(re) ?? []).filter((m) => !/^020[0-9a-f]/.test(m.replace(/[^0-9a-f]/gi, "").toLowerCase()) && !MAC_VIRTUALE_COMPATTO.test(m.replace(/[^0-9a-f]/gi, "").toLowerCase())).length;
      assert.equal(veri, 0, `${veri} MAC non finti (${re.source})`);
    }
    assert.equal(testo.toLowerCase().includes("domarc"), false, "domarc");
  });

  test(`${f}: la forma è fissata campo per campo`, () => {
    const j = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")) as Record<string, unknown>;
    assert.deepEqual(scartiDiForma(j), []);
  });
}

test("forma della fase 2b: i campi nuovi, se ci sono, si controllano; VM e host dei cluster non entrano mai", () => {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, FILES[0]), "utf8")) as Record<string, Array<Record<string, unknown>>>;
  const nuova = {
    ...j,
    devices: j.devices.map((d, i) => ({ ...d, uplink_type: i === 0 ? "wireless" : null })),
    overrides: [{ id: 1, action: "add", a_node: "vm:3:100", a_port: "porta-1", b_node: "dev:1", b_port: "", medium: "fibra" }],
    primaries: [{ node_id: "dev:2", other_node: "dev:1", node_port: "porta-1", other_port: "" }],
    portInfo: [{ device_id: 1, port_name: "porta-2", speed: "1000 Mbps", poe_status: "delivering", poe_power_mw: 4500 }],
    vms: [],
    scanHosts: [],
  };
  assert.deepEqual(scartiDiForma(nuova), []);
  assert.deepEqual(scartiDiForma({ ...nuova, vms: [{ vmid: 100 }] }), ["vms: deve essere vuoto"]);
  assert.deepEqual(scartiDiForma({ ...nuova, overrides: [{ ...nuova.overrides[0], medium: "rame" }] }), ["overrides[0].medium: valore fuori forma"]);
  assert.deepEqual(scartiDiForma({ ...nuova, primaries: [{ ...nuova.primaries[0], node_port: "Gi0/1 di 192.0.2.1" }] }), ["primaries[0].node_port: valore fuori forma"]);
  assert.deepEqual(scartiDiForma({ ...nuova, altro: [] }), ["chiave di primo livello in più: altro"]);
});
