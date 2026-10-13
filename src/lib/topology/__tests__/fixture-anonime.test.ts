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
const NOME = /^(RTR|SW|AP|FW|HV|NAS|SRV|DEV|host|ext|Sede|Ubicazione|Rete)-\d+$/;
const IP_FINTO = /^(10\.\d{1,3}|172\.31)\.\d{1,3}\.\d{1,3}$/;
const IPV6_FINTO = /^fd00::[0-9a-f]+$/;
const MAC_FINTO = /^02:00:00(:[0-9a-f]{2}){3}$/;
const DATA = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

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
  overrides: {
    id: num, action: tra(["add", "ignore"]), a_node: s(/^(dev|host):\d+$/), a_port: porta, b_node: s(/^(dev|host):\d+$/), b_port: porta,
  },
};

test("ci sono le due fixture", () => {
  assert.deepEqual(FILES.sort(), ["topologia-cliente-a.json", "topologia-domarc.json"]);
});

for (const f of FILES) {
  test(`${f}: solo indirizzi finti e nomi pseudonimi`, () => {
    const testo = fs.readFileSync(path.join(DIR, f), "utf8");
    const ipVeri = (testo.match(IP) ?? []).filter((ip) => !(ip.startsWith("10.") || ip.startsWith("172.31."))).length;
    assert.equal(ipVeri, 0, `${ipVeri} IP non finti`);
    for (const re of MAC_FORME) {
      const veri = (testo.match(re) ?? []).filter((m) => !m.replace(/[^0-9a-f]/gi, "").toLowerCase().startsWith("020000")).length;
      assert.equal(veri, 0, `${veri} MAC non finti (${re.source})`);
    }
    assert.equal(testo.toLowerCase().includes("domarc"), false, "domarc");
  });

  test(`${f}: la forma è fissata campo per campo`, () => {
    const j = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")) as Record<string, unknown>;
    assert.deepEqual(Object.keys(j).sort(), [...Object.keys(FORMA), "nowMs", "staleDays"].sort(), "chiavi di primo livello");
    assert.ok(num(j.nowMs) && num(j.staleDays), "nowMs/staleDays");
    for (const [sezione, campi] of Object.entries(FORMA)) {
      const righe = j[sezione];
      assert.ok(Array.isArray(righe), `${sezione} non è un elenco`);
      (righe as Array<Record<string, unknown>>).forEach((r, i) => {
        assert.deepEqual(Object.keys(r).sort(), Object.keys(campi).sort(), `${sezione}[${i}]: chiavi`);
        for (const [k, regola] of Object.entries(campi)) assert.ok(regola(r[k]), `${sezione}[${i}].${k}: valore fuori forma`);
      });
    }
  });
}
