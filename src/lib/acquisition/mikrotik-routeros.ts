/**
 * Collector `mikrotik-routeros` (piano 2026-10-21 C3, E03-E05): un MikroTik RouterOS 7 letto via SSH exec su una
 * connessione sola, solo comandi dell'allowlist `MIKROTIK_ROUTEROS_COMMANDS`. Coordinato con la scheda MikroTik: i parser
 * delle forme `terse` e dei monitor sono quelli di `devices/mikrotik-*` (uscite vere anonime nel repo), qui si aggiungono
 * solo velocità/duplex, PoE, indirizzi e ARP (`mikrotik-routeros-parsers.ts`).
 *
 * RouterOS scrive gli errori su stdout con ssh uscito a 0: ogni uscita passa da `erroreRouterOs` prima del parser (comando
 * sconosciuto = `unsupported`, permessi = `error`).
 *
 * **Non collaudato** e non agganciato al riconoscimento del prodotto (`riconosci.ts`): i giri di oggi continuano a leggere i
 * MikroTik col percorso storico; questo si usa dalla CLI finché un RouterOS vero non l'ha letto.
 */
import { erroreRouterOs, parseBridge, parseFasci, parseInterfacce, parseMonitorPorte, parsePorteBridge, tipoNeutro } from "../devices/mikrotik-stp";
import { parseRisorse, parseRouterboard, parseVlanBridge } from "../devices/mikrotik-scheda";
import { parseMikrotikNeighbors } from "../devices/mikrotik-vicini";
import { parseMikrotikMacTable } from "../devices/mikrotik-porte";
import { versioneCollector } from "./catalogo";
import { MIKROTIK_ROUTEROS_COMMANDS } from "./comandi";
import { chiudi, daLettura, leggiTutto, nonLetto, sez, statoGlobale } from "./costruzione";
import { espandiVlanIdsTutti, parseArp, parseIdentita, parseIndirizzi, parseMonitorEthernet, parseMonitorPoe } from "./mikrotik-routeros-parsers";
import { acquisitionInputSchema } from "./schema";
import type { AcquisitionRequest, AcquisitionSnapshot, AcquisitionTransports, DeviceInterface, ReadResult, Vlan } from "./schema";
import { createTransports } from "./transports";

type Comando = (typeof MIKROTIK_ROUTEROS_COMMANDS)[number];
const SCONOSCIUTO = new Set(["NO_SUCH_ITEM", "BAD_COMMAND", "SYNTAX_ERROR", "EXPECTED_END", "INPUT_DOES_NOT_MATCH"]);

/** Un'uscita `ok` che è un errore di RouterOS diventa `unsupported` (comando che questo modello non ha) o `error`. */
function conErroriRouterOs(r: ReadResult<string>): ReadResult<string> {
    if (r.status !== "ok" && r.status !== "partial") return r;
    const codice = erroreRouterOs(r.data);
    if (!codice) return r;
    return { status: SCONOSCIUTO.has(codice) ? "unsupported" : "error", data: "", warnings: [...r.warnings, "ROUTEROS_" + codice] };
}

const pieno = <T>(v: T[]): T[] | null => (v.length ? v : null);
/** Un parser `terse`/monitor che non trova voci: vale «nessuna voce» solo se l'uscita è vuota, altrimenti formato ignoto (null). */
const vociOVuota = <T>(parse: (t: string) => T[]) => (t: string): T[] | null => { const v = parse(t); return v.length || t.trim() === "" ? v : null; };
/** Le voci di una lettura `ok` con l'esito del riconoscimento; non `ok` = nessuna voce. */
function voci<T>(r: ReadResult<string>, parse: (t: string) => T[]): { dati: T[]; capita: boolean } {
    if (r.status !== "ok") return { dati: [], capita: false };
    const v = vociOVuota(parse)(r.data);
    return v === null ? { dati: [], capita: false } : { dati: v, capita: true };
}
const stato = (r: ReadResult<string>, capita: boolean): "ok" | "partial" | "unsupported" | "error" | "skipped" => (r.status === "ok" ? (capita ? "ok" : "partial") : r.status);
const ignoto = (r: ReadResult<string>, capita: boolean): string[] => (r.status === "ok" && !capita ? ["FORMAT_UNRECOGNIZED_OR_EMPTY"] : []);

export async function collectMikrotikRouteros(request: AcquisitionRequest, transports?: AcquisitionTransports): Promise<AcquisitionSnapshot> {
    const input = acquisitionInputSchema.parse(request);
    if (input.collector !== "mikrotik-routeros") throw Error("COLLECTOR_MISMATCH");
    const inizio = Date.now(), io = transports ?? createTransports(input);
    const letture = await leggiTutto(c => io.shell(c), MIKROTIK_ROUTEROS_COMMANDS, "SSH_TRANSPORT_EXCEPTION");
    const r = (c: Comando) => conErroriRouterOs(letture[c] ?? nonLetto());
    const fonte = (c: Comando) => "ssh:" + c;

    const risorse = r("/system resource print"), rb = r("/system routerboard print");
    const ris = risorse.status === "ok" ? parseRisorse(risorse.data) : null;
    const hw = rb.status === "ok" ? parseRouterboard(rb.data) : null;
    const riconosciuto = !!ris?.versione;
    const nome = r("/system identity print");
    const snapshot: AcquisitionSnapshot = {
        schema_version: "1.0", collector: "mikrotik-routeros", collector_version: versioneCollector("mikrotik-routeros"), target: input.host,
        collected_at: new Date(inizio).toISOString(), duration_ms: 0, status: "error",
        identity: sez(riconosciuto ? {
            manufacturer: "MikroTik", model: hw?.modello ?? ris?.board ?? null, firmware: `RouterOS ${ris!.versione}`, serial_number: hw?.seriale ?? null,
            hostname: nome.status === "ok" ? parseIdentita(nome.data) : null, mac: null, sys_object_id: null, uptime_seconds: ris?.uptime_s ?? null,
            boot_rom: hw?.firmware_corrente ?? null,
        } : null, riconosciuto ? ((hw?.modello ?? ris?.board) ? "ok" : "partial") : "error",
        [fonte("/system resource print"), fonte("/system routerboard print"), fonte("/system identity print")],
        riconosciuto ? (rb.status === "ok" ? [] : ["ROUTERBOARD_NOT_READ", ...rb.warnings]) : ["DEVICE_NOT_IDENTIFIED_AS_ROUTEROS", ...risorse.warnings]),
        interfaces: sez([]), vlans: sez([]), forwarding: sez([]), neighbors: sez([]), spanning_tree: sez({ enabled: null, protocol: null, ports: [] }),
        aggregation: sez([]), poe: sez([]), sensors: sez([], "skipped", [], ["HEALTH_NOT_IMPLEMENTED"]), network: sez({ ipv4_addresses: [], arp: [] }),
    };
    if (!riconosciuto) {
        for (const k of ["interfaces", "vlans", "forwarding", "neighbors", "aggregation", "poe"] as const) snapshot[k] = sez([], "skipped", [], ["DEVICE_NOT_IDENTIFIED_AS_ROUTEROS"]);
        snapshot.spanning_tree = sez({ enabled: null, protocol: null, ports: [] }, "skipped", [], ["DEVICE_NOT_IDENTIFIED_AS_ROUTEROS"]);
        snapshot.network = sez({ ipv4_addresses: [], arp: [] }, "skipped", [], ["DEVICE_NOT_IDENTIFIED_AS_ROUTEROS"]);
        return chiudi(snapshot, input, inizio);
    }
    snapshot.resources = sez({ cpu_percent: ris?.cpu_carico ?? null, memory_total_bytes: ris?.memoria_totale_b ?? null, memory_free_bytes: ris?.memoria_libera_b ?? null },
        ris?.memoria_totale_b !== null ? "ok" : "partial", [fonte("/system resource print")]);

    // Interfacce: tipo e stato da `/interface print terse`, velocità e duplex dal monitor ethernet, PVID dalle porte del bridge.
    const intf = daLettura(r("/interface print terse"), t => pieno(parseInterfacce(t)), [], fonte("/interface print terse"), v => v.length > 0);
    const eth = r("/interface ethernet monitor [find] once"), ethV = voci(eth, parseMonitorEthernet), ethernet = ethV.dati;
    const pb = r("/interface bridge port print terse without-paging"), pbV = voci(pb, parsePorteBridge), porteBridge = pbV.dati;
    const interfacce: DeviceInterface[] = intf.data.map(i => {
        const e = ethernet.find(x => x.nome === i.nome);
        const neutro = tipoNeutro(i.tipo);
        return {
            name: i.nome, if_index: null, description: i.commento, kind: neutro === "physical" ? "physical" : neutro === "lag" ? "aggregate" : "other",
            admin_status: i.spenta ? "down" : "up", oper_status: i.accesa ? "up" : "down", speed_bps: e?.velocita_bps ?? null, reported_speed_bps: e?.velocita_bps ?? null,
            duplex: e?.duplex ?? null, mtu: i.mtu, mac: i.mac?.toLowerCase() ?? null, counters: {}, pvid: porteBridge.find(p => p.porta === i.nome)?.pvid ?? null,
        };
    });
    const avvisiIntf = [...intf.warnings, ...(ethV.capita ? [] : ["ETHERNET_MONITOR_NOT_READ", ...eth.warnings]), ...(pbV.capita ? [] : ["BRIDGE_PORTS_NOT_READ"])];
    snapshot.interfaces = sez(interfacce, intf.status === "ok" && ethV.capita && pbV.capita ? "ok" : intf.status === "ok" ? "partial" : intf.status,
        [...intf.sources, fonte("/interface ethernet monitor [find] once"), fonte("/interface bridge port print terse without-paging")], avvisiIntf);

    // VLAN del bridge: `vlan-ids` con gli intervalli; porte attuali (current-*) se RouterOS le dice, altrimenti quelle configurate.
    const bv = r("/interface bridge vlan print terse without-paging");
    const vlans = new Map<number, Vlan>();
    const bvV = voci(bv, parseVlanBridge);
    const avvisiVlan = [...bv.warnings, ...ignoto(bv, bvV.capita)];
    if (bvV.capita) {
        for (const riga of bvV.dati) {
            if (riga.disabled) continue;
            const ids = espandiVlanIdsTutti(riga.vlan_ids);
            if (!ids) { avvisiVlan.push("VLAN_IDS_UNRECOGNIZED"); continue; }
            const tagged = riga.current_tagged.length ? riga.current_tagged : riga.tagged;
            const untagged = riga.current_untagged.length ? riga.current_untagged : riga.untagged;
            for (const id of ids) {
                const v = vlans.get(id) ?? { id, name: null, description: riga.comment, tagged_ports: [], untagged_ports: [], forbidden_ports: [] };
                v.tagged_ports = [...new Set([...v.tagged_ports, ...tagged])];
                v.untagged_ports = [...new Set([...v.untagged_ports, ...untagged])];
                vlans.set(id, v);
            }
        }
    }
    snapshot.vlans = sez([...vlans.values()].sort((a, b) => a.id - b.id), bvV.capita ? (avvisiVlan.includes("VLAN_IDS_UNRECOGNIZED") ? "partial" : "ok") : stato(bv, false),
        [fonte("/interface bridge vlan print terse without-paging")], avvisiVlan);

    const host = daLettura(r("/interface bridge host print terse without-paging"), vociOVuota(parseMikrotikMacTable), [], fonte("/interface bridge host print terse without-paging"), () => true);
    snapshot.forwarding = sez(host.data.map(h => ({ mac: h.mac.toLowerCase(), vlan_id: h.vlan, fdb_id: null, bridge_port: null, if_index: null, port: h.port_name, status: null })), host.status, host.sources, host.warnings);

    const vic = daLettura(r("/ip neighbor print terse"), vociOVuota(parseMikrotikNeighbors), [], fonte("/ip neighbor print terse"), () => true);
    snapshot.neighbors = sez(vic.data.map(n => ({
        local_port: n.localPort, remote_chassis: n.remoteMac ?? n.remoteDevice, remote_port: n.remotePort, system_name: n.remoteDevice || null,
        system_description: [n.remotePlatform, n.remoteVersion].filter(Boolean).join(" ") || null, management_addresses: n.remoteIp ? [n.remoteIp] : [],
        capabilities: (n.remoteCaps ?? "").split(",").filter(Boolean), ttl_seconds: null,
    })), vic.status, vic.sources, [...vic.warnings, "MNDP_AND_CDP_INCLUDED"]);

    // Spanning tree: modo del bridge e, per porta, ruolo e stato dal monitor (istanza comune: CIST).
    const br = r("/interface bridge print terse without-paging"), pm = r("/interface bridge port monitor [find] once");
    const brV = voci(br, parseBridge), pmV = voci(pm, parseMonitorPorte);
    const bridge = brV.dati, monitor = pmV.dati;
    const modi = bridge.map(b => b.modo).filter((m): m is NonNullable<typeof m> => m !== null);
    snapshot.spanning_tree = sez({
        enabled: modi.length ? modi.some(m => m !== "none") : null, protocol: modi.find(m => m !== "none") ?? null,
        ports: monitor.filter(p => p.attiva).map(p => ({ port: p.porta, instance: "CIST", state: p.stato, role: p.ruolo })),
    }, brV.capita && pmV.capita ? (bridge.length === 0 || monitor.length > 0 ? "ok" : "partial") : brV.capita || pmV.capita ? "partial" : stato(br, false),
        [fonte("/interface bridge print terse without-paging"), fonte("/interface bridge port monitor [find] once")], [...br.warnings, ...pm.warnings, ...ignoto(br, brV.capita), ...ignoto(pm, pmV.capita), "MSTI_NOT_COLLECTED"]);

    const bond = daLettura(r("/interface bonding print terse without-paging"), vociOVuota(parseFasci), [], fonte("/interface bonding print terse without-paging"), () => true);
    snapshot.aggregation = sez(bond.data.map(f => {
        const i = interfacce.find(x => x.name === f.nome);
        return { name: f.nome, protocol: f.modo === "802.3ad" ? "lacp" : f.modo, admin_status: i?.admin_status ?? null, oper_status: i?.oper_status ?? null, members: f.membri };
    }), bond.status, bond.sources, bond.warnings);

    // PoE: potenza solo da `poe-out-power`. Un modello senza PoE risponde al comando con un errore: `unsupported`.
    const poe = r("/interface ethernet poe monitor [find] once");
    const poeV = voci(poe, parseMonitorPoe);
    snapshot.poe = sez(poeV.dati.map(p => ({ port: p.porta, enabled: p.acceso, status: p.stato, power_watts: p.potenza_watt })), stato(poe, poeV.capita), [fonte("/interface ethernet poe monitor [find] once")], [...poe.warnings, ...ignoto(poe, poeV.capita)]);

    const ind = r("/ip address print terse without-paging"), arp = r("/ip arp print terse without-paging");
    const indV = voci(ind, parseIndirizzi), arpV = voci(arp, parseArp);
    const indirizzi = indV.dati, arpDati = arpV.dati;
    snapshot.network = sez({ ipv4_addresses: indirizzi.map(a => ({ address: a.address, netmask: a.netmask, if_index: null })), arp: arpDati.map(a => ({ address: a.address, mac: a.mac, if_index: null, type: a.type })) },
        indV.capita && arpV.capita ? "ok" : indV.capita || arpV.capita ? "partial" : stato(ind, false),
        [fonte("/ip address print terse without-paging"), fonte("/ip arp print terse without-paging")], [...ind.warnings, ...arp.warnings, ...ignoto(ind, indV.capita), ...ignoto(arp, arpV.capita), "INTERFACE_NAMES_NOT_INDEXED"]);

    snapshot.status = statoGlobale([snapshot.identity, snapshot.interfaces, snapshot.vlans, snapshot.forwarding, snapshot.neighbors, snapshot.spanning_tree, snapshot.aggregation, snapshot.network, snapshot.resources!]);
    return chiudi(snapshot, input, inizio);
}
