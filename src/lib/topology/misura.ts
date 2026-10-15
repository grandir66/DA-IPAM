/**
 * Le misure della topologia sulle copie (spec topologia §13.12.1, pezzo T1.0): contano, non disegnano. Lo script
 * `scripts/misura-cavi.ts` legge una copia, chiama queste funzioni e stampa i numeri; i nomi solo con `--nomi`, a
 * terminale. Le stesse funzioni misurano il codice di prima e quello di dopo: per questo il confronto delle porte usa
 * una normalizzazione sua (`chiaveMisura`), che vale sia per i nomi grezzi di prima sia per quelli tradotti di dopo.
 * Logica pura.
 */
import type { MapComputed } from "@/lib/topology/map-compute";
import {
  attraversa, candidatiLati, drawableLinks, latiVicini, lineaAlbero, ostacoli, percorso, redundantEnds, rettangoli, siGuardano, troncoPossibile,
  type Lato, type Pt, type Rect,
} from "@/lib/topology/map-screen";
import { parseDbDate } from "@/lib/db-date";
import { PROVE_AGGIUNTE, proveDiRuolo } from "@/lib/topology/cavi/ruolo";
import { nodeClass } from "@/lib/topology/identity";
import { haTraduttore, traduciPorta, type ComeLetto } from "@/lib/topology/lettori/traduci";
import type { MapLink, MapOrientation, MapVm, ModelDeviceRow, TopologyModel, TopologyModelInput } from "@/lib/topology/model-types";
import { addNodeMacs, buildNodeIndex, resolveNode } from "@/lib/topology/node-index";
import { stepPoints } from "@/lib/topology/print-draw";
import { proposeHead, type TreeResult } from "@/lib/topology/tree";
import { resolveScanHosts } from "@/lib/topology/vms";

const DAY_MS = 86_400_000;

/** Una porta per il confronto fra prima e dopo: «ether3,bridge» e «ether3», «bridge/ether3» ed «ether3», «SFP_ 9» e «SFP+ 9». */
export function chiaveMisura(nome: string): string {
  const primo = nome.split(",")[0];
  const ultimo = primo.split("/").pop() ?? primo;
  return ultimo.replace(/^sfp_(?=\s)/i, "sfp+").replace(/\s+/g, "").toLowerCase();
}

/**
 * C4 — le linee «cucite»: due porte piene che nessuna prova sola ha. Una prova sola è la riga di un vicino (porta
 * locale e porta remota, per IP, MAC o nome), l'uplink del controller (porta del figlio e porta del padre, se il
 * controller la sa) o una correzione «aggiungi». La porta riempita dalle VM non è una prova delle due porte.
 */
export function lineeCucite(input: TopologyModelInput, model: Pick<TopologyModel, "links" | "canonical">): MapLink[] {
  const idx = buildNodeIndex(input.devices, input.hosts, input.knownMacs, input.neighbors);
  // Gli stessi abbinamenti del modello (model.ts): i MAC delle schede di un hypervisor vengono dalla sua scansione. Senza, una
  // riga LLDP del firmware di una scheda (senza nome) non si abbinava qui, e la linea vera risultava «cucita» (famiglia 4 delle
  // reti-campione, 15/10).
  for (const { row, nodeId } of resolveScanHosts(input.scanHosts, idx)) if (nodeId) addNodeMacs(idx, nodeId, row.macs);
  const canon = (id: string) => model.canonical[id] ?? id;
  const prove = new Set<string>();
  const aggiungi = (x: string, px: string, y: string, py: string): void => {
    if (!px.trim() || !py.trim()) return;
    prove.add(`${canon(x)}|${chiaveMisura(px)}|${canon(y)}|${chiaveMisura(py)}`);
    prove.add(`${canon(y)}|${chiaveMisura(py)}|${canon(x)}|${chiaveMisura(px)}`);
  };
  for (const n of input.neighbors) {
    const x = `dev:${n.device_id}`;
    for (const ref of [{ ip: n.remote_ip }, { mac: n.remote_mac }, { name: n.remote_device_name }]) {
      const y = resolveNode(idx, ref);
      if (y && y !== x) aggiungi(x, n.local_port, y, n.remote_port);
    }
  }
  const primaPorta = new Map<number, string>();
  for (const p of [...input.uplinkPorts].sort((a, b) => a.device_id - b.device_id || a.port_index - b.port_index)) {
    if (!primaPorta.has(p.device_id)) primaPorta.set(p.device_id, p.port_name);
  }
  for (const d of input.devices) {
    if (!d.uplink_mac || d.uplink_remote_port == null) continue;
    const y = resolveNode(idx, { mac: d.uplink_mac });
    if (y) {
      aggiungi(`dev:${d.id}`, primaPorta.get(d.id) ?? "", y, `Port ${d.uplink_remote_port}`);
      const nomeInElenco = (input.ports ?? []).find((p) => `dev:${p.device_id}` === y && p.port_index === d.uplink_remote_port)?.port_name;
      if (nomeInElenco) aggiungi(`dev:${d.id}`, primaPorta.get(d.id) ?? "", y, nomeInElenco);
    }
  }
  for (const o of input.overrides) if (o.action === "add") aggiungi(o.a_node, o.a_port, o.b_node, o.b_port);
  return model.links.filter((l) => l.aPort.trim() && l.bPort.trim() && !prove.has(`${l.a}|${chiaveMisura(l.aPort)}|${l.b}|${chiaveMisura(l.bPort)}`));
}

/**
 * C2 — rami dell'albero che percorrono un uplink del controller al contrario: il padre è il figlio secondo il
 * controller. Solo le linee con la fonte `unifi_uplink`: anche «tabella MAC» e «dalle VM» hanno `uplinkFrom`, con un
 * altro senso. Il caso «non c'è un'altra via di pari rango» della spec non si calcola: si guarda nell'elenco `--nomi`.
 */
export function ramiControVerso(tree: Pick<TreeResult, "via" | "children">): number {
  const padre = new Map<string, string>();
  for (const [p, figli] of tree.children) for (const f of figli) padre.set(f, p);
  let n = 0;
  for (const [figlio, l] of tree.via) if (l.sources.includes("unifi_uplink") && l.uplinkFrom !== null && l.uplinkFrom === padre.get(figlio)) n++;
  return n;
}

/** Il padre di ogni oggetto dell'albero (le radici: null), in ordine di id. */
export function padriDi(tree: Pick<TreeResult, "children" | "roots">): Record<string, string | null> {
  const out = new Map<string, string | null>();
  for (const r of tree.roots) out.set(r, null);
  for (const [p, figli] of tree.children) for (const f of figli) out.set(f, p);
  return Object.fromEntries([...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Chi ha un altro padre; `undefined` da una parte = l'oggetto entra o esce dall'albero. */
export function padriCambiati(prima: Readonly<Record<string, string | null>>, dopo: Readonly<Record<string, string | null>>):
  Array<{ id: string; prima: string | null | undefined; dopo: string | null | undefined }> {
  const ids = [...new Set([...Object.keys(prima), ...Object.keys(dopo)])].sort();
  return ids.filter((id) => prima[id] !== dopo[id]).map((id) => ({ id, prima: prima[id], dopo: dopo[id] }));
}

export interface LineaMisurata { a: Rect; la: Lato; b: Rect; lb: Lato; punti: Pt[]; tra: [string, string] }

/**
 * Le linee che il lato più vicino cambia: le ridondanze fra due riquadri e le linee dei figli spostati a mano dall'altra
 * parte. «oggi»: i lati di prima (in «Verticale» da destra a sinistra, in «Orizzontale» dal fondo alla cima) col
 * percorso che disegna la pagina di prima (`percorsoOggi`, dallo script) o i gradini della stampa; «nuova»: `latiVicini`.
 */
export function lineeDaMisurare(c: Pick<MapComputed<TopologyModel>, "tree" | "layout">, regola: "oggi" | "nuova",
  percorsoOggi: (s: Rect, la: Lato, t: Rect, lb: Lato) => Pt[]): LineaMisurata[] {
  const { tree, layout } = c;
  const o = layout.orientation;
  const tutti = rettangoli(layout);
  const oggi: { da: Lato; a: Lato } = o === "lr" ? { da: "dx", a: "sx" } : { da: "giu", a: "su" };
  const out: LineaMisurata[] = [];
  for (const l of drawableLinks(tree.links, layout.nodes)) {
    if (!l.redundant) continue;
    const [s, t] = redundantEnds(o, layout.nodes.get(l.a)!, layout.nodes.get(l.b)!);
    const rs = layout.nodes.get(s)!, rt = layout.nodes.get(t)!;
    const lati = regola === "oggi" ? oggi : latiVicini(rs, rt, o, ostacoli(tutti, [s, t]));
    const punti = regola === "oggi" ? percorsoOggi(rs, lati.da, rt, lati.a) : percorso(rs, lati.da, rt, lati.a);
    out.push({ a: rs, la: lati.da, b: rt, lb: lati.a, punti, tra: [s, t] });
  }
  for (const [figlio] of tree.via) {
    const f = layout.nodes.get(figlio);
    const p = f?.parent ? layout.nodes.get(f.parent) : undefined;
    if (!f || !p || f.role !== "box" || troncoPossibile(o, p, f)) continue;
    const la = regola === "oggi" ? { tronco: true as const } : lineaAlbero(o, p, f, ostacoli(tutti, [p.id, f.id]));
    out.push(la.tronco
      ? { a: p, la: oggi.da, b: f, lb: oggi.a, punti: stepPoints(o, p, f), tra: [p.id, f.id] }
      : { a: p, la: la.lati.da, b: f, lb: la.lati.a, punti: percorso(p, la.lati.da, f, la.lati.a), tra: [p.id, f.id] });
  }
  return out;
}

/** C10 (linee che fanno il giro) e C11 (linee che attraversano un riquadro quando uno dei quattro candidati non lo fa). */
export function giriEAttraversamenti(linee: readonly LineaMisurata[], ostacoliDi: (l: LineaMisurata) => readonly Rect[], o: MapOrientation):
  { giri: number; attraversamenti: number } {
  let giri = 0, attraversamenti = 0;
  for (const l of linee) {
    if (!siGuardano(l.a, l.la, l.b, l.lb)) giri++;
    const ost = ostacoliDi(l);
    if (attraversa(l.punti, ost) && candidatiLati(l.a, l.b, o).some((c) => !attraversa(percorso(l.a, c.da, l.b, c.a), ost))) attraversamenti++;
  }
  return { giri, attraversamenti };
}

/** Gli scenari costruiti in memoria sull'ingresso del modello (spec §13.12.1). S2b è il codice di T1 sul dato vero (S0). */
export type Scenario =
  | { nome: "S0" }
  | { nome: "S1" }
  | { nome: "S3"; apparato: number }
  | { nome: "S4" }
  | { nome: "S9"; apparato: number; porta: string; fonte: string }
  | { nome: "S12"; apparato: number; vmid: number };

/** «S0», «S1», «S3:‹id›», «S4», «S9:‹id›:‹porta›:‹fonte›», «S12:‹apparato scansionato›:‹vmid›»; altrimenti null. */
export function leggiScenario(testo: string): Scenario | null {
  const [nome, ...resto] = testo.split(":");
  if (nome === "S0" || nome === "S1" || nome === "S4") return resto.length === 0 ? { nome } : null;
  if (nome === "S3" && resto.length === 1 && /^\d+$/.test(resto[0])) return { nome, apparato: Number(resto[0]) };
  if (nome === "S9" && resto.length === 3 && /^\d+$/.test(resto[0]) && resto[1] && resto[2]) return { nome, apparato: Number(resto[0]), porta: resto[1], fonte: resto[2] };
  if (nome === "S12" && resto.length === 2 && resto.every((x) => /^\d+$/.test(x))) return { nome, apparato: Number(resto[0]), vmid: Number(resto[1]) };
  return null;
}

/**
 * `--adesso` di misura-cavi (revisione finale di T1): l'ora a cui il modello giudica «non visto», in UTC come la scrive il DB
 * («AAAA-MM-GG HH:MM:SS»), in millisecondi; null se è scritta in un altro modo. Il «prima» e il «dopo» sulla stessa copia
 * vanno misurati con lo stesso orologio: con l'ora vera una riga che scade fra i due giri cambia i numeri da sola.
 */
export function leggiAdesso(testo: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(testo)) return null;
  const t = Date.parse(`${testo.replace(" ", "T")}Z`);
  return Number.isNaN(t) ? null : t;
}

export function applicaScenario(input: TopologyModelInput, s: Scenario): TopologyModelInput {
  switch (s.nome) {
    case "S0":
      return input;
    case "S1": // senza correzioni
      return { ...input, overrides: [] };
    case "S3": // senza l'uplink del controller di un apparato (core 1): C3
      return {
        ...input,
        devices: input.devices.map((d) => (d.id === s.apparato ? { ...d, uplink_mac: null, uplink_remote_port: null, uplink_seen_at: null } : d)),
        uplinkPorts: input.uplinkPorts.filter((p) => p.device_id !== s.apparato),
      };
    case "S4": { // caso peggiore di R6: lldp su tutte le righe fra router, dai due lati
      const idx = buildNodeIndex(input.devices, input.hosts, input.knownMacs, input.neighbors);
      const router = (id: string | null): boolean => !!id && ["router", "firewall"].includes(idx.nodes.get(id)?.type ?? "");
      return {
        ...input,
        neighbors: input.neighbors.map((n) => (router(`dev:${n.device_id}`) && router(resolveNode(idx, { ip: n.remote_ip, mac: n.remote_mac, name: n.remote_device_name }))
          ? { ...n, protocol: "lldp" } : n)),
      };
    }
    case "S9": { // cavo spostato: sulla porta il vicino di ieri, non visto da più della soglia, accanto a quello di oggi
      const ieri = new Date(input.nowMs - (input.staleDays + 1) * DAY_MS).toISOString().slice(0, 19).replace("T", " ");
      return {
        ...input,
        neighbors: [...input.neighbors, {
          device_id: s.apparato, local_port: s.porta, remote_device_name: "S9-VICINO-DI-IERI", remote_port: "Port 1", protocol: "lldp",
          remote_ip: null, remote_mac: "02:00:00:5e:09:09", timestamp: ieri, source: s.fonte,
        }],
      };
    }
    case "S12": { // lettura delle VM rinnovata (R1, H15): la VM indicata spenta; al suo posto una accesa, con gli stessi MAC
      const vecchia = input.vms.find((v) => v.scannedDeviceId === s.apparato && v.vmid === s.vmid);
      if (!vecchia) return input;
      const ora = new Date(input.nowMs).toISOString();
      return {
        ...input,
        vms: [...input.vms.map((v) => (v === vecchia ? { ...v, status: "stopped", scannedAt: ora } : v)),
          { ...vecchia, vmid: vecchia.vmid + 100000, name: `${vecchia.name}-nuova`, status: "running", scannedAt: ora }],
      };
    }
  }
}

/**
 * C19 e H17 (spec §13.3.2, §13.3.3): la testa che il sistema propone per la mappa automatica (`proposeHead`, quando nessuno
 * l'ha scelta) e quella di ogni sede. La misura le confronta prima e dopo ogni regola del passaggio universale (§13.16).
 */
export function teste(model: TopologyModel): { proposta: string | null; sedi: Record<string, string | null> } {
  return { proposta: proposeHead(model), sedi: Object.fromEntries(model.sites.map((s) => [String(s.locationId), s.headNodeId])) };
}

/** Dove la testa cambia: «mappa automatica» o «sede ‹id›»; `undefined` da una parte = la sede non c'era. */
export function testeCambiate(prima: ReturnType<typeof teste>, dopo: ReturnType<typeof teste>):
  Array<{ dove: string; prima: string | null | undefined; dopo: string | null | undefined }> {
  const out: Array<{ dove: string; prima: string | null | undefined; dopo: string | null | undefined }> = [];
  if (prima.proposta !== dopo.proposta) out.push({ dove: "mappa automatica", prima: prima.proposta, dopo: dopo.proposta });
  for (const id of [...new Set([...Object.keys(prima.sedi), ...Object.keys(dopo.sedi)])].sort()) {
    if (prima.sedi[id] !== dopo.sedi[id]) out.push({ dove: `sede ${id}`, prima: prima.sedi[id], dopo: dopo.sedi[id] });
  }
  return out;
}

/**
 * R1 (spec §13.3.4): su quale lettura delle VM è fatta la misura — per ogni apparato scansionato, la data della scansione
 * più recente (VM e host del cluster). Un job che rilegge le VM ogni notte cambia la base da solo (l'hub dal 15/10).
 */
export function lettureVm(input: Pick<TopologyModelInput, "vms" | "scanHosts">): Record<string, string | null> {
  const out = new Map<string, string | null>();
  for (const r of [...input.vms, ...input.scanHosts]) {
    const k = `dev:${r.scannedDeviceId}`;
    const t = r.scannedAt ?? null;
    const cur = out.get(k);
    const ms = (x: string | null | undefined) => (x ? parseDbDate(x).getTime() : NaN);
    if (cur === undefined || (t !== null && (cur === null || ms(t) > ms(cur)))) out.set(k, t);
  }
  return Object.fromEntries([...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** H15 (spec §13.7.8): gli hypervisor che stanno sotto una loro VM. Dopo T1 nessuno. */
export function sottoUnaSuaVm(model: Pick<TopologyModel, "vms">, padri: Readonly<Record<string, string | null>>): string[] {
  const vmDi = new Set(model.vms.flatMap((v: MapVm) => (v.nodeId && v.hypervisorNodeId ? [`${v.hypervisorNodeId}|${v.nodeId}`] : [])));
  return Object.entries(padri).filter(([id, p]) => p !== null && vmDi.has(`${id}|${p}`)).map(([id]) => id).sort();
}

/**
 * H7 (spec §13.3.3): le linee dei dati con un capo su un router il cui lato locale passa dal traduttore del suo prodotto
 * (`haTraduttore`: la stessa scelta della regola «nome-scelto-non-fisico») e, da quel capo, una porta che il traduttore non
 * riconosce (un nome scelto dal cliente: «non noto»). Vale sui nomi grezzi di prima e su quelli tradotti di dopo; le
 * correzioni a mano non contano. La via di lettura viene dall'ingresso (dal Task 5); l'ingresso del codice di prima non la
 * porta, e allora si suppone SSH, la via delle righe di `/ip neighbor` (sulle due copie del 14/10 ogni MikroTik è un router
 * letto via SSH). Verifica del 15/10: prima la misura guardava la marca e il traduttore MikroTik, cioè contava anche un
 * MikroTik letto via SNMP, che la regola lascia stare. Dopo T1 nessuna.
 */
export function lineeDaNomeScelto(
  input: { devices: ReadonlyArray<Pick<ModelDeviceRow, "id" | "vendor" | "device_type" | "controller_mac"> & { via?: string | null }> },
  model: Pick<TopologyModel, "links">,
): MapLink[] {
  const come = new Map(input.devices.filter((d) => ["router", "firewall"].includes(d.device_type)).map((d): [string, ComeLetto] => [
    `dev:${d.id}`, { vendor: d.vendor, via: d.via === undefined ? "ssh" : d.via, fonte: d.controller_mac ? "unifi" : "device", piattaforma: null },
  ]));
  const scelto = (nodo: string, porta: string): boolean => {
    const c = come.get(nodo);
    if (!c || porta.trim() === "" || !haTraduttore(c)) return false;
    const l = traduciPorta(porta, "locale", c);
    return l.fisica === null && l.senzaFili !== true;
  };
  return model.links.filter((l) => !l.sources.includes("manual") && (scelto(l.a, l.aPort) || scelto(l.b, l.bPort)));
}

/** Gli oggetti di rete nell'albero tenuti SOLO da una prova aggiunta il 14/10 sera (da guardare a parte con Riccardo, §13.8.2). */
export function soloProveAggiunte(input: TopologyModelInput, model: TopologyModel): string[] {
  const idx = buildNodeIndex(input.devices, input.hosts, input.knownMacs, input.neighbors);
  const prove = proveDiRuolo(input, idx, { vms: model.vms });
  return model.nodes
    .filter((n) => ["infra", "ap"].includes(model.classiMappa?.[n.id] ?? nodeClass(n)))
    .filter((n) => { const p = prove.get(n.id) ?? []; return p.length > 0 && p.every((x) => PROVE_AGGIUNTE.has(x)); })
    .map((n) => n.id).sort();
}

/** I numeri della tappa (spec §13.12.1, §13.3.2): niente nomi. */
export function conteggi(input: TopologyModelInput, model: TopologyModel, c: Pick<MapComputed<TopologyModel>, "tree" | "layout">,
  percorsoOggi: (s: Rect, la: Lato, t: Rect, lb: Lato) => Pt[]): Record<string, number> {
  const o = c.layout.orientation;
  const tutti = rettangoli(c.layout);
  const ost = (l: LineaMisurata) => ostacoli(tutti, l.tra);
  const oggi = giriEAttraversamenti(lineeDaMisurare(c, "oggi", percorsoOggi), ost, o);
  const nuova = giriEAttraversamenti(lineeDaMisurare(c, "nuova", percorsoOggi), ost, o);
  return {
    collegamenti: model.counts.links,
    ...Object.fromEntries(Object.entries(model.counts.linksBySource).map(([k, v]) => [`fonte_${k}`, v])),
    fra_apparati: model.counts.deviceLinks,
    attaccati: model.counts.attachedLinks,
    vicini_non_abbinati: model.counts.unmatchedNeighbors,
    non_visti: model.counts.staleLinks,
    una_porta_vuota: model.links.filter((l) => (l.aPort.trim() === "") !== (l.bPort.trim() === "")).length,
    cucite: lineeCucite(input, model).length,
    correzioni_orfane: model.correzioniOrfane?.length ?? 0,
    porte_di_segmento: Object.keys(model.segmenti ?? {}).length,
    linee_da_nome_scelto: lineeDaNomeScelto(input, model).length,
    sotto_una_sua_vm: sottoUnaSuaVm(model, padriDi(c.tree)).length,
    contro_verso: ramiControVerso(c.tree),
    radici: c.tree.roots.length,
    ridondanze: c.tree.links.filter((l) => l.redundant).length,
    da_sistemare_isolati: model.isolated.length,
    da_sistemare_tipi_sospetti: model.suspicious.length,
    senza_prove: model.daSistemare?.length ?? 0,
    host_da_promuovere: model.promote.length,
    giri_oggi: oggi.giri, attraversamenti_oggi: oggi.attraversamenti,
    giri_regola_nuova: nuova.giri, attraversamenti_regola_nuova: nuova.attraversamenti,
  };
}
