/**
 * Parser puri del collector `mikrotik-routeros` che l'app non aveva già. Il resto si riusa dalla scheda MikroTik
 * (`devices/mikrotik-*`): `campiTerse`/`righeDiUscita`, `tabellaMonitor`, interfacce, bridge, porte, monitor delle porte,
 * bonding, vicini, risorse, routerboard, VLAN del bridge, tabella MAC.
 *
 * Requisiti di regressione dai donatori (piano §6): la **tensione PoE non è mai potenza** (DA-MKNET
 * `mikrotik.service.ts:1862` scriveva `poe-out-voltage` nel campo della potenza: qui la potenza viene solo da
 * `poe-out-power`); **`vlan-ids` letto** con gli intervalli (`:1738`); velocità e duplex dal monitor per colonne
 * (`tabellaMonitor`, non per posizione nella riga). Forma delle uscite di monitor dalla documentazione RouterOS 7:
 * non viste su un apparato (collector non collaudato).
 */
import { cella, tabellaMonitor } from "../devices/mikrotik-stp";
import { campiTerse } from "../devices/mikrotik-vicini";

/** «10Mbps», «2.5Gbps», «10G» → bit/s; altro → null. */
export function velocitaRouterOs(s: string | null): number | null {
    const m = /^(\d+(?:\.\d+)?)\s*([MG])(?:bps)?$/i.exec((s ?? "").trim());
    if (!m) return null;
    return Math.round(Number(m[1]) * (m[2].toUpperCase() === "G" ? 1e9 : 1e6));
}

export interface EthernetMk { nome: string; collegata: boolean | null; velocita_bps: number | null; duplex: "full" | "half" | null }

/** `/interface ethernet monitor [find] once`: una colonna per porta, righe `name`, `status`, `rate`, `full-duplex`. */
export function parseMonitorEthernet(out: string): EthernetMk[] {
    const t = tabellaMonitor(out);
    const r: EthernetMk[] = [];
    for (let i = 0; i < t.colonne; i++) {
        const nome = cella(t, "name", i) ?? "";
        if (!nome) continue;
        const stato = (cella(t, "status", i) ?? "").toLowerCase();
        const pieno = (cella(t, "full-duplex", i) ?? "").toLowerCase();
        const collegata = stato === "link-ok" ? true : stato === "no-link" ? false : null;
        r.push({ nome, collegata, velocita_bps: collegata ? velocitaRouterOs(cella(t, "rate", i)) : null, duplex: !collegata ? null : pieno === "yes" ? "full" : pieno === "no" ? "half" : null });
    }
    return r;
}

export interface PoeMk { porta: string; acceso: boolean | null; stato: string | null; potenza_watt: number | null; tensione_volt: number | null }

/**
 * `/interface ethernet poe monitor [find] once`: righe `name`, `poe-out`, `poe-out-status`, `poe-out-voltage`,
 * `poe-out-current`, `poe-out-power`. La potenza SOLO da `poe-out-power` («2.9W»): la tensione resta tensione.
 */
export function parseMonitorPoe(out: string): PoeMk[] {
    const t = tabellaMonitor(out);
    const r: PoeMk[] = [];
    const numero = (s: string | null, unita: string): number | null => {
        const m = new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*${unita}$`, "i").exec((s ?? "").trim());
        return m ? Number(m[1]) : null;
    };
    for (let i = 0; i < t.colonne; i++) {
        const porta = cella(t, "name", i) ?? "";
        if (!porta) continue;
        const modo = (cella(t, "poe-out", i) ?? "").toLowerCase();
        r.push({
            porta, acceso: modo === "auto-on" || modo === "forced-on" ? true : modo === "off" ? false : null,
            stato: (cella(t, "poe-out-status", i) ?? "") || null, potenza_watt: numero(cella(t, "poe-out-power", i), "W"), tensione_volt: numero(cella(t, "poe-out-voltage", i), "V"),
        });
    }
    return r;
}

/** `vlan-ids` di RouterOS («2», «100-110,200») → gli id, ordinati e unici; null se una parte non si capisce. */
export function espandiVlanIdsTutti(s: string): number[] | null {
    const out = new Set<number>();
    for (const parte of s.split(",").map(x => x.trim()).filter(Boolean)) {
        const m = /^(\d{1,4})(?:-(\d{1,4}))?$/.exec(parte);
        if (!m) return null;
        const da = Number(m[1]), a = Number(m[2] ?? m[1]);
        if (da < 1 || a > 4094 || da > a) return null;
        for (let v = da; v <= a; v++) out.add(v);
    }
    return [...out].sort((x, y) => x - y);
}

/**
 * Le righe di una `print terse` letta via ssh exec: una voce per riga che comincia con l'indice, con qualunque rientro
 * (la colonna degli indici si allinea a destra: «   0  C address=…» con 100+ voci). `righeDiUscita` non va bene qui: tratta
 * tre spazi in testa come continuazione di un `print detail`.
 */
function righeTerse(out: string): string[] {
    return out.split(/\r?\n/).filter(r => /^\s*\d+\s/.test(r)).map(r => r.trim());
}

/** `/system identity print` → «name: router». */
export function parseIdentita(out: string): string | null {
    return /^\s*name:\s*(.+?)\s*$/m.exec(out)?.[1] ?? null;
}

/** `/ip address print terse without-paging` → indirizzi con la maschera puntata. Righe spente (X) escluse. */
export function parseIndirizzi(out: string): Array<{ address: string; netmask: string | null; interfaccia: string | null }> {
    const r: Array<{ address: string; netmask: string | null; interfaccia: string | null }> = [];
    for (const riga of righeTerse(out)) {
        if (/^\s*\d+\s+[A-Z]*X/.test(riga)) continue;
        const c = campiTerse(riga);
        const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(c.get("address") ?? "");
        if (!m || Number(m[2]) > 32) continue;
        const bits = Number(m[2]), maschera = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
        r.push({ address: m[1], netmask: [24, 16, 8, 0].map(x => (maschera >>> x) & 255).join("."), interfaccia: c.get("interface") ?? null });
    }
    return r;
}

/** `/ip arp print terse without-paging` → voci ARP; tipo dai segni (D dinamica, altrimenti statica). */
export function parseArp(out: string): Array<{ address: string; mac: string | null; interfaccia: string | null; type: string }> {
    const r: Array<{ address: string; mac: string | null; interfaccia: string | null; type: string }> = [];
    for (const riga of righeTerse(out)) {
        const c = campiTerse(riga);
        const ip = c.get("address") ?? "";
        if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) continue;
        const mac = c.get("mac-address") ?? "";
        const segni = /^\s*\d+\s+([A-Z]+)\s/.exec(riga)?.[1] ?? "";
        r.push({ address: ip, mac: /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(mac) ? mac.toLowerCase() : null, interfaccia: c.get("interface") ?? null, type: segni.includes("D") ? "dynamic" : "static" });
    }
    return r;
}
