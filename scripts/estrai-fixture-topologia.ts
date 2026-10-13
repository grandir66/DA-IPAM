/**
 * Estrae una fixture ANONIMA del modello della topologia da una COPIA del DB di
 * un tenant (piano topologia fase 1, Task 9). Copia della copia in una cartella
 * temporanea (stesse guardie di prova-giri-sovrapposti), migrazione applicata
 * lì, sola lettura. Tiene solo gli host che servono al modello. Stampa solo
 * conteggi.
 *
 * Uso:  npx tsx scripts/estrai-fixture-topologia.ts <copia.db> --cartella <scratchpad> --uscita <file.json>
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { controllaPercorsi } from "../src/lib/scanner/__tests__/support/percorsi-prova";

function uso(msg?: string): number {
  if (msg) process.stderr.write(`${msg}\n`);
  process.stderr.write("Uso: npx tsx scripts/estrai-fixture-topologia.ts <copia.db> --cartella <scratchpad> --uscita <file.json>\n");
  return 2;
}

async function main(): Promise<number> {
  const a = process.argv.slice(2);
  const val = (k: string) => (a.indexOf(k) >= 0 ? a[a.indexOf(k) + 1] : undefined);
  const cartella = val("--cartella");
  const uscita = val("--uscita");
  const liberi = a.filter((x, i) => !x.startsWith("--") && a[i - 1] !== "--cartella" && a[i - 1] !== "--uscita");
  if (!cartella || !uscita || liberi.length !== 1) return uso();
  const sorgente = path.resolve(liberi[0]);
  const tenant = path.basename(sorgente).replace(/\.db$/i, "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(tenant)) return uso("Nome del file non valido come codice tenant.");

  const lavoro = path.join(path.resolve(cartella), `fixture-topologia-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const dataDir = path.join(lavoro, "data");
  const hubDb = path.join(lavoro, "hub.db");
  const errori = controllaPercorsi({ scratchpad: cartella, sorgente, dataDir, hubDb, repo: process.cwd() });
  if (errori.length > 0) return uso(`Non parto:\n${errori.map((e) => `  - ${e}`).join("\n")}`);

  // Copia della copia: il file dato si legge e basta.
  const dest = path.join(dataDir, "tenants", `${tenant}.db`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(sorgente, dest);
  const wal = `${sorgente}-wal`;
  if (fs.existsSync(wal) && fs.statSync(wal).size > 0) fs.copyFileSync(wal, `${dest}-wal`);
  process.env.DA_INVENT_DATA_DIR = dataDir;
  process.env.DA_IPAM_HUB_DB_PATH = hubDb;
  process.env.ENCRYPTION_KEY ||= crypto.randomBytes(16).toString("hex");
  // I registri dell'app contengono nomi e indirizzi: non escono a schermo.
  for (const k of ["log", "info", "warn", "debug", "error"] as const) console[k] = () => {};

  const { withTenant, getTopologyModelInput } = await import("../src/lib/db-tenant");
  const { anonimizzaInput } = await import("../src/lib/topology/anonimizza");
  const { buildNodeIndex, resolveNode } = await import("../src/lib/topology/node-index");
  const { PROMOTE_CLASSES, buildTopologyModel } = await import("../src/lib/topology/model");
  const { normalizeName } = await import("../src/lib/topology/match");
  const { normalizeMacForStorage } = await import("../src/lib/utils");

  const input = withTenant(tenant, () => getTopologyModelInput(2));
  // Solo gli host che servono al modello: fusi, abbinati da un vicino o da un uplink,
  // candidati alla promozione, citati da una correzione, col MAC di un apparato
  // (testa della sede), e quelli che contendono una chiave cercata da un vicino o da
  // un uplink (toglierli renderebbe unica una chiave contesa e cambierebbe il modello).
  const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
  const MAC = /^[0-9a-f]{2}([:-]?)[0-9a-f]{2}(\1[0-9a-f]{2}){4}$/i;
  const nameKey = (raw: string | null | undefined): string | null => {
    const s = raw?.trim();
    if (!s || IPV4.test(s) || MAC.test(s)) return null;
    return normalizeName(s) || null;
  };
  const idx = buildNodeIndex(input.devices, input.hosts, input.knownMacs);
  const servono = new Set<number>([...idx.alias.keys()].map((k) => Number(k.slice(5))));
  const keepHost = (id: string | null) => {
    if (id?.startsWith("host:")) servono.add(Number(id.slice(5)));
  };
  const ipCercati = new Set<string>();
  const macCercati = new Set<string>();
  const nomiCercati = new Set<string>();
  for (const n of input.neighbors) {
    keepHost(resolveNode(idx, { ip: n.remote_ip, mac: n.remote_mac, name: n.remote_device_name }));
    const nome = n.remote_device_name?.trim() ?? "";
    if (n.remote_ip) ipCercati.add(n.remote_ip);
    if (IPV4.test(nome)) ipCercati.add(nome);
    for (const m of [normalizeMacForStorage(n.remote_mac), MAC.test(nome) ? normalizeMacForStorage(nome) : null]) if (m) macCercati.add(m);
    const k = nameKey(nome);
    if (k) nomiCercati.add(k);
  }
  for (const d of input.devices) {
    if (!d.uplink_mac) continue;
    keepHost(resolveNode(idx, { mac: d.uplink_mac }));
    const m = normalizeMacForStorage(d.uplink_mac);
    if (m) macCercati.add(m);
  }
  for (const o of input.overrides) for (const id of [o.a_node, o.b_node]) keepHost(id);
  for (const h of input.hosts) {
    const m = normalizeMacForStorage(h.mac);
    const owner = m ? idx.byMac.get(m) : undefined;
    if (
      (PROMOTE_CLASSES as readonly string[]).includes(h.classification ?? "") ||
      (typeof owner === "string" && owner.startsWith("dev:")) ||
      (h.ip && ipCercati.has(h.ip)) ||
      (m && macCercati.has(m)) ||
      [nameKey(h.hostname), nameKey(h.custom_name)].some((k) => k !== null && nomiCercati.has(k))
    ) {
      servono.add(h.id);
    }
  }
  const ridotto = { ...input, hosts: input.hosts.filter((h) => servono.has(h.id)) };
  const anonimo = anonimizzaInput(ridotto);

  // Il modello della fixture dev'essere quello vero: stessi conteggi, o niente fixture.
  const vero = JSON.stringify(buildTopologyModel(input).counts);
  const conteggiRidotto = JSON.stringify(buildTopologyModel(ridotto).counts);
  const conteggiAnonimo = JSON.stringify(buildTopologyModel(anonimo).counts);
  process.stdout.write(`conteggi del modello: ${vero}\n`);
  if (conteggiRidotto !== vero || conteggiAnonimo !== vero) {
    process.stderr.write(`Conteggi diversi, fixture NON scritta.\n  ridotto: ${conteggiRidotto}\n  anonimo: ${conteggiAnonimo}\n`);
    return 1;
  }
  fs.writeFileSync(path.resolve(uscita), `${JSON.stringify(anonimo, null, 1)}\n`);
  process.stdout.write(
    `apparati ${anonimo.devices.length} · host ${anonimo.hosts.length} (di ${input.hosts.length}) · vicini ${anonimo.neighbors.length} · reti ${anonimo.networks.length} · ubicazioni ${anonimo.locations.length}\n`,
  );
  return 0;
}

main().then((c) => process.exit(c), (e) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exit(2); });
