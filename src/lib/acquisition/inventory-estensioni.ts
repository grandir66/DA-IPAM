/**
 * Ciò che il collector del giro 3 leggeva in più del motore d'inventario collaudato (`inventory-collector.ts`) e serve
 * all'app: firmware QNAP vero, condivisioni e pacchetti dei NAS, e per MikroTik velocità/duplex, PoE, FDB e STP per porta.
 * Funzioni sincrone sulle letture già fatte con la stessa shell (un login): nessun comando fuori dall'allowlist del catalogo.
 *
 * Il motore resta quello collaudato: qui si aggiunge soltanto, e solo dove il motore non ha già il dato. Le letture di questo
 * file **non sono ancora state provate su un apparato vero** (vedi `collaudati` nel catalogo).
 */
import { parseQnapVersione } from "../devices/nas/qnap-versione";
import { erroreRouterOs, parseBridge, parseInterfacce, parseMonitorPorte, parsePorteBridge } from "../devices/mikrotik-stp";
import { parseRisorse } from "../devices/mikrotik-scheda";
import { parseMikrotikMacTable } from "../devices/mikrotik-porte";
import { daLettura, sez } from "./costruzione";
import type { StatoSezione } from "./costruzione";
import { parseExports, parseQpkgConf, parseSmbConf, unisciCondivisioni } from "./qnap-nas-parsers";
import { parseInfoPacchetti, parseSynoshareEnum } from "./synology-nas-parsers";
import { parseArp, parseIndirizzi, parseMonitorEthernet, parseMonitorPoe } from "./mikrotik-routeros-parsers";
import type { AcquisitionSnapshot, ReadResult } from "./schema";

export type Lettore = (comando: string) => ReadResult<string>;
const testo = (r: ReadResult<string>) => (r.status === "ok" ? r.data : "");

/** QNAP: firmware da `getsysinfo firmver`/`/etc/version` più la build; il valore di `getcfg` resta se questi non rispondono. */
export function estendiNas(s: AcquisitionSnapshot, profilo: "qnap-nas" | "synology-dsm", leggi: Lettore): void {
    if (profilo === "qnap-nas" && s.identity.data) {
        const v = parseQnapVersione({ firmver: testo(leggi("getsysinfo firmver")), etcVersion: testo(leggi("cat /etc/version")), build: testo(leggi("cat /etc/default_config/WEBAPP.build")) });
        if (v.firmware) {
            s.identity.data.firmware = v.firmware;
            s.identity.sources = [...s.identity.sources, "ssh:getsysinfo firmver", "ssh:cat /etc/version"];
        }
    }
    if (profilo === "synology-dsm" && s.identity.data) {
        // Modello e seriale dai file del kernel DSM, solo dove l'SNMP non li ha dati.
        const primo = (c: string) => testo(leggi(c)).split(/\r?\n/).map(x => x.trim()).find(x => x.length > 0) ?? null;
        s.identity.data.model ??= primo("cat /proc/sys/kernel/syno_hw_version");
        s.identity.data.serial_number ??= primo("cat /proc/sys/kernel/syno_serial");
    }
    const fileSmb = profilo === "qnap-nas" ? "cat /etc/config/smb.conf" : "cat /etc/samba/smb.share.conf";
    const smb = daLettura(leggi(fileSmb), parseSmbConf, [], "ssh:" + fileSmb, () => true);
    const exp = leggi("cat /etc/exports");
    const condivise = unisciCondivisioni(smb.data, exp.status === "ok" ? parseExports(exp.data) : []);
    const fonti = [...smb.sources, "ssh:cat /etc/exports"];
    const avvisi = [...smb.warnings, ...(exp.status === "ok" ? [] : ["NFS_EXPORTS_NOT_READ"])];
    if (profilo === "synology-dsm") {
        // `synoshare` si prova nelle due forme; i nomi che trova aggiungono le cartelle senza SMB. Quale forma vale sulla DSM vera è da verificare.
        const lette = [leggi("synoshare --enum ALL"), leggi("synoshare -enum ALL")].find(x => x.status === "ok" && parseSynoshareEnum(x.data) !== null);
        for (const n of lette ? parseSynoshareEnum(lette.data) ?? [] : []) if (!condivise.some(c => c.name === n)) condivise.push({ name: n, path: null, protocols: ["other"], comment: null, public: null });
        fonti.push("ssh:synoshare");
        if (!lette) avvisi.push("SYNOSHARE_NOT_READ");
    }
    const statoCondivise: StatoSezione = smb.status === "ok" && exp.status === "ok" ? "ok" : condivise.length ? "partial" : smb.status;
    s.shares = sez(condivise, statoCondivise, fonti, avvisi);
    const fileSw = profilo === "qnap-nas" ? "cat /etc/config/qpkg.conf" : "cat /var/packages/*/INFO";
    s.software = daLettura(leggi(fileSw), profilo === "qnap-nas" ? parseQpkgConf : parseInfoPacchetti, [], "ssh:" + fileSw, () => true);
}

/** RouterOS scrive gli errori su stdout con exit 0: un'uscita `ok` che è un errore diventa `unsupported` (comando che il modello non ha) o `error`. */
const SCONOSCIUTO = new Set(["NO_SUCH_ITEM", "BAD_COMMAND", "SYNTAX_ERROR", "EXPECTED_END", "INPUT_DOES_NOT_MATCH"]);
function conErroriRouterOs(r: ReadResult<string>): ReadResult<string> {
    if (r.status !== "ok" && r.status !== "partial") return r;
    const codice = erroreRouterOs(r.data);
    if (!codice) return r;
    return { status: SCONOSCIUTO.has(codice) ? "unsupported" : "error", data: "", warnings: [...r.warnings, "ROUTEROS_" + codice] };
}
/** Voci di una lettura `ok`; `capita` = il formato è stato riconosciuto (un'uscita vuota vale «nessuna voce»). */
function voci<T>(r: ReadResult<string>, parse: (t: string) => T[]): { dati: T[]; capita: boolean } {
    if (r.status !== "ok") return { dati: [], capita: false };
    const v = parse(r.data);
    return v.length || r.data.trim() === "" ? { dati: v, capita: true } : { dati: [], capita: false };
}
const statoLettura = (r: ReadResult<string>, capita: boolean): StatoSezione => (r.status === "ok" ? (capita ? "ok" : "partial") : r.status === "partial" ? "partial" : r.status);
const ignoto = (r: ReadResult<string>, capita: boolean): string[] => (r.status === "ok" && !capita ? ["FORMAT_UNRECOGNIZED_OR_EMPTY"] : []);

export function estendiMikrotik(s: AcquisitionSnapshot, leggi: Lettore): void {
    const r = (c: string) => conErroriRouterOs(leggi(c));
    const fonte = (c: string) => "ssh:" + c;

    // Stato amministrativo e operativo dalle bandiere di `/interface print terse` (il motore non le interpreta).
    const ip = r("/interface print terse without-paging"), ipV = voci(ip, parseInterfacce);
    for (const i of s.interfaces.data) {
        const x = ipV.dati.find(v => v.nome === i.name);
        if (!x) continue;
        i.admin_status ??= x.spenta ? "down" : "up";
        i.oper_status ??= x.accesa ? "up" : "down";
    }
    for (const l of s.aggregation.data) {
        const i = s.interfaces.data.find(x => x.name === l.name);
        l.admin_status ??= i?.admin_status ?? null;
        l.oper_status ??= i?.oper_status ?? null;
    }

    // Risorse e uptime da `/system resource print`.
    const risorse = r("/system resource print"), ris = risorse.status === "ok" ? parseRisorse(risorse.data) : null;
    if (ris && !s.resources) s.resources = sez({ cpu_percent: ris.cpu_carico ?? null, memory_total_bytes: ris.memoria_totale_b ?? null, memory_free_bytes: ris.memoria_libera_b ?? null }, ris.memoria_totale_b !== null ? "ok" : "partial", [fonte("/system resource print")]);
    if (ris && s.identity.data) s.identity.data.uptime_seconds ??= ris.uptime_s ?? null;

    // Indirizzi e ARP dai terse, dove l'SNMP non li ha dati (via SSH il motore li tiene solo nelle tabelle d'inventario).
    if (!s.network.data.ipv4_addresses.length && !s.network.data.arp.length) {
        const ind = r("/ip address print terse without-paging"), indV = voci(ind, parseIndirizzi);
        const arp = r("/ip arp print terse without-paging"), arpV = voci(arp, parseArp);
        s.network = sez({ ipv4_addresses: indV.dati.map(a => ({ address: a.address, netmask: a.netmask, if_index: null })), arp: arpV.dati.map(a => ({ address: a.address, mac: a.mac, if_index: null, type: a.type })) },
            indV.capita && arpV.capita ? "ok" : indV.capita || arpV.capita ? "partial" : statoLettura(ind, false),
            [fonte("/ip address print terse without-paging"), fonte("/ip arp print terse without-paging")], [...ind.warnings, ...arp.warnings, ...ignoto(ind, indV.capita), ...ignoto(arp, arpV.capita), "INTERFACE_NAMES_NOT_INDEXED"]);
    }

    // Velocità e duplex dal monitor ethernet, PVID dalle porte del bridge: solo dove l'interfaccia non li ha già.
    const eth = r("/interface ethernet monitor [find] once"), ethV = voci(eth, parseMonitorEthernet);
    const pb = r("/interface bridge port print terse without-paging"), pbV = voci(pb, parsePorteBridge);
    for (const i of s.interfaces.data) {
        const e = ethV.dati.find(x => x.nome === i.name);
        if (e) {
            i.speed_bps ??= e.velocita_bps;
            i.reported_speed_bps ??= e.velocita_bps;
            i.duplex ??= e.duplex;
        }
        i.pvid ??= pbV.dati.find(p => p.porta === i.name)?.pvid ?? null;
    }
    // Il motore dichiara «bandiere e velocità non interpretate» quando le interfacce vengono dal terse: se le bandiere sono lette
    // sopra e il monitor è capito, l'avviso non è più vero (collaudo `192.168.15.254`, 22/10).
    const NON_INTERPRETATE = "TERSE_FLAGS_AND_NEGOTIATED_SPEED_NOT_INTERPRETED";
    if (s.interfaces.warnings.includes(NON_INTERPRETATE)) {
        const resto = s.interfaces.warnings.filter(w => w !== NON_INTERPRETATE);
        s.interfaces.warnings = ipV.capita && ethV.capita ? resto : ipV.capita ? [...resto, "NEGOTIATED_SPEED_NOT_INTERPRETED"] : s.interfaces.warnings;
    }
    if (s.interfaces.data.length) {
        if (!ethV.capita) s.interfaces.warnings = [...s.interfaces.warnings, "ETHERNET_MONITOR_NOT_READ"];
        if (!pbV.capita) s.interfaces.warnings = [...s.interfaces.warnings, "BRIDGE_PORTS_NOT_READ"];
    }

    // PoE: la potenza viene solo da `poe-out-power` (la tensione non è mai potenza). Un modello senza PoE risponde con un errore: `unsupported`.
    const poe = r("/interface ethernet poe monitor [find] once"), poeV = voci(poe, parseMonitorPoe);
    // Un apparato senza PoE (router, CCR) non ha le righe `poe-out*`: l'uscita non ha il formato del PoE e non è un guasto. «Non presente»,
    // non `FORMAT_UNRECOGNIZED_OR_EMPTY`.
    const senzaPoe = poe.status === "ok" && !poeV.dati.some(p => p.acceso !== null || p.stato !== null || p.potenza_watt !== null) && !/poe-out/i.test(poe.data);
    if (senzaPoe) s.poe = sez([], "unsupported", [fonte("/interface ethernet poe monitor [find] once")], ["POE_NOT_PRESENT"]);
    else s.poe = sez(poeV.dati.map(p => ({ port: p.porta, enabled: p.acceso, status: p.stato, power_watts: p.potenza_watt })), statoLettura(poe, poeV.capita), [fonte("/interface ethernet poe monitor [find] once")], [...poe.warnings, ...ignoto(poe, poeV.capita)]);

    // FDB dal bridge host (gli indirizzi locali non entrano).
    const host = daLettura(r("/interface bridge host print terse without-paging"), t => { const v = parseMikrotikMacTable(t); return v.length || t.trim() === "" ? v : null; }, [], fonte("/interface bridge host print terse without-paging"), () => true);
    s.forwarding = sez(host.data.map(h => ({ mac: h.mac.toLowerCase(), vlan_id: h.vlan, fdb_id: null, bridge_port: null, if_index: null, port: h.port_name, status: null })), host.status, host.sources, host.warnings);

    // STP: modo del bridge e, per porta, ruolo e stato dal monitor (istanza comune: CIST).
    const br = r("/interface bridge print terse without-paging"), pm = r("/interface bridge port monitor [find] once");
    const brV = voci(br, parseBridge), pmV = voci(pm, parseMonitorPorte);
    const modi = brV.dati.map(b => b.modo).filter((m): m is NonNullable<typeof m> => m !== null);
    s.spanning_tree = sez({
        enabled: modi.length ? modi.some(m => m !== "none") : null, protocol: modi.find(m => m !== "none") ?? null,
        ports: pmV.dati.filter(p => p.attiva).map(p => ({ port: p.porta, instance: "CIST", state: p.stato, role: p.ruolo })),
    }, brV.capita && pmV.capita ? (brV.dati.length === 0 || pmV.dati.length > 0 ? "ok" : "partial") : brV.capita || pmV.capita ? "partial" : statoLettura(br, false),
        [fonte("/interface bridge print terse without-paging"), fonte("/interface bridge port monitor [find] once")], [...br.warnings, ...pm.warnings, ...ignoto(br, brV.capita), ...ignoto(pm, pmV.capita), "MSTI_NOT_COLLECTED"]);
}
