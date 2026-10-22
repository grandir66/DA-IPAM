/**
 * Parser puri delle uscite di una shell Unix (Linux, QTS, DSM): testo in, dati dello snapshot fuori, nessuna rete.
 * Li usano i collector `qnap-nas`, `linux` e `synology-nas`. Regole della guida «Aggiungere una famiglia»: colonne lette
 * per nome (chiavi `K=V`, JSON, campi di `-o`), mai per posizione dove l'uscita ha un'intestazione; byte e inode come
 * stringhe decimali (oltre 2^53); `null` = ignoto, zero e `false` sono dati.
 */
import type { DeviceInterface } from "./schema";

type Iface = DeviceInterface;

/** `KEY=valore` per riga (os-release, `timedatectl show`, platform.conf), virgolette tolte. Le chiavi ripetute: vince l'ultima. */
export function parseKeyValue(testo: string, separatore = "="): Record<string, string> {
    const out: Record<string, string> = {};
    for (const riga of testo.split(/\r?\n/)) {
        const i = riga.indexOf(separatore);
        if (i <= 0) continue;
        const k = riga.slice(0, i).trim();
        if (!k || k.startsWith("#")) continue;
        out[k] = riga.slice(i + separatore.length).trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    }
    return out;
}

export function primaRiga(testo: string): string | null {
    return testo.split(/\r?\n/).map(r => r.trim()).find(r => r.length > 0) ?? null;
}

/** /etc/os-release → nome e versione. */
export function parseOsRelease(testo: string): { os_name: string | null; os_version: string | null } {
    const kv = parseKeyValue(testo);
    return { os_name: kv.PRETTY_NAME || kv.NAME || null, os_version: kv.VERSION_ID || kv.VERSION || null };
}

/** `uname -srm` → «Linux 6.1.0-18-amd64 x86_64». Tre parole o niente. */
export function parseUname(testo: string): { kernel: string | null; architecture: string | null } {
    const parole = (primaRiga(testo) ?? "").split(/\s+/);
    if (parole.length !== 3) return { kernel: null, architecture: null };
    return { kernel: `${parole[0]} ${parole[1]}`, architecture: parole[2] };
}

/** /proc/uptime → secondi dall'avvio (primo numero). */
export function parseUptime(testo: string): number | null {
    const m = /^\s*(\d+(?:\.\d+)?)\s/.exec(testo + " ");
    return m ? Number(m[1]) : null;
}

/** /proc/meminfo → totale e disponibile in byte (righe per nome, unità kB). */
export function parseMeminfo(testo: string): { memory_total_bytes: number | null; memory_free_bytes: number | null } {
    const kb = (nome: string): number | null => {
        const m = new RegExp(`^${nome}:\\s+(\\d+)\\s*kB`, "m").exec(testo);
        return m ? Number(m[1]) * 1024 : null;
    };
    return { memory_total_bytes: kb("MemTotal"), memory_free_bytes: kb("MemAvailable") ?? kb("MemFree") };
}

const VIRTUALI = /^(lo|docker\d*|veth|br-|virbr|tun|tap|qvs|lxcbr|dummy|bond_master)/;

/**
 * `ip -o link show` → interfacce. Una riga per interfaccia: «2: eth0: <FLAGS> mtu 1500 ... state UP ... link/ether MAC brd ...».
 * Stato da `state`, amministrativo dal flag UP; il tipo dal nome solo per dire `other` (loopback, bridge di container).
 */
export function parseIpLink(testo: string): Iface[] {
    const out: Iface[] = [];
    for (const riga of testo.split(/\r?\n/)) {
        const m = /^(\d+):\s+([^:@\s]+)(?:@[^:\s]+)?:\s+<([^>]*)>(.*)$/.exec(riga.trim());
        if (!m) continue;
        const [, indice, nome, flag, resto] = m;
        const stato = /\bstate\s+(\S+)/.exec(resto)?.[1]?.toLowerCase() ?? null;
        const mtu = /\bmtu\s+(\d+)/.exec(resto)?.[1];
        const mac = /link\/ether\s+([0-9a-f:]{17})/i.exec(resto)?.[1]?.toLowerCase() ?? null;
        const flags = flag.split(",");
        out.push({
            name: nome, if_index: Number(indice), description: null,
            kind: /^(bond|team)\d*/.test(nome) ? "aggregate" : VIRTUALI.test(nome) || /link\/loopback/.test(resto) ? "other" : "physical",
            admin_status: flags.includes("UP") ? "up" : "down",
            oper_status: stato === "up" || stato === "down" ? stato : stato === "unknown" ? null : stato,
            speed_bps: null, reported_speed_bps: null, duplex: null, mtu: mtu ? Number(mtu) : null, mac, counters: {}, pvid: null,
        });
    }
    return out;
}

/** `ip -o -4 addr show` → indirizzi IPv4 con la maschera in notazione puntata e l'indice dell'interfaccia. */
export function parseIpAddr(testo: string): Array<{ address: string; netmask: string | null; if_index: number | null }> {
    const out: Array<{ address: string; netmask: string | null; if_index: number | null }> = [];
    for (const riga of testo.split(/\r?\n/)) {
        const m = /^(\d+):\s+\S+\s+inet\s+(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})\b/.exec(riga.trim());
        if (!m) continue;
        const bits = Number(m[3]);
        if (bits > 32) continue;
        const maschera = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
        out.push({ address: m[2], netmask: [24, 16, 8, 0].map(s => (maschera >>> s) & 255).join("."), if_index: Number(m[1]) });
    }
    return out;
}

const intero = (v: unknown): string | null => {
    if (typeof v === "number" && Number.isInteger(v) && v >= 0) return String(v);
    if (typeof v === "string" && /^\d+$/.test(v.trim())) return v.trim();
    return null;
};
const testoONull = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const booleano = (v: unknown): boolean | null => (v === true || v === "1" || v === 1 ? true : v === false || v === "0" || v === 0 ? false : null);

/** `lsblk -J -b -d -o NAME,SIZE,MODEL,SERIAL,ROTA,TRAN` → dischi. null = JSON illeggibile. Campi per nome. */
export function parseLsblk(testo: string): Array<{ name: string; model: string | null; serial_number: string | null; size_bytes: string | null; rotational: boolean | null; transport: string | null }> | null {
    let json: unknown;
    try { json = JSON.parse(testo); } catch { return null; }
    const devs = (json as { blockdevices?: unknown }).blockdevices;
    if (!Array.isArray(devs)) return null;
    return devs.filter((d): d is Record<string, unknown> => !!d && typeof d === "object" && typeof (d as { name?: unknown }).name === "string")
        .filter(d => !/^(loop|ram|zram)/.test(d.name as string))
        .map(d => ({ name: d.name as string, model: testoONull(d.model), serial_number: testoONull(d.serial), size_bytes: intero(d.size), rotational: booleano(d.rota), transport: testoONull(d.tran) }));
}

export interface Filesystem { device: string | null; mount_point: string; type: string | null; size_bytes: string | null; used_bytes: string | null; available_bytes: string | null; inodes_total: string | null; inodes_used: string | null; inodes_free: string | null }

/** Le colonne di `df -P` per nome d'intestazione (POSIX: «Filesystem», «1024-blocks», «Used», «Available», «Mounted on»). */
function righeDf(testo: string): Array<Record<string, string>> | null {
    const righe = testo.split(/\r?\n/).filter(r => r.trim() !== "");
    if (righe.length === 0) return null;
    const testa = righe[0].replace("Mounted on", "Mounted_on").trim().split(/\s+/);
    if (!testa.includes("Filesystem") || !testa.includes("Mounted_on")) return null;
    const out: Array<Record<string, string>> = [];
    for (const r of righe.slice(1)) {
        const campi = r.trim().split(/\s+/);
        // Il punto di montaggio può avere spazi: è tutto ciò che resta dopo le colonne prima di lui.
        const prima = testa.length - 1;
        if (campi.length < testa.length) continue;
        const riga: Record<string, string> = {};
        testa.slice(0, prima).forEach((h, i) => { riga[h] = campi[i]; });
        riga.Mounted_on = campi.slice(prima).join(" ");
        out.push(riga);
    }
    return out;
}

const perMille = (v: string | undefined, fattore: bigint): string | null => (v && /^\d+$/.test(v) ? (BigInt(v) * fattore).toString() : null);
const cifra = (v: string | undefined): string | null => (v && /^\d+$/.test(v) ? v : null);

/**
 * `df -P -k` (blocchi da 1024) e `df -P -i` → filesystem con byte e inode, uniti per punto di montaggio. null = intestazione
 * di `df -P -k` non riconosciuta. Gli inode mancano (null) se la seconda uscita non c'è o non ha quel montaggio.
 */
export function parseDf(kb: string, inode: string): Filesystem[] | null {
    const blocchi = righeDf(kb);
    if (!blocchi) return null;
    const colonnaBlocchi = Object.keys(blocchi[0] ?? {}).find(h => /^(1024|1K)-blocks$/i.test(h)) ?? "1024-blocks";
    const inodi = new Map((righeDf(inode) ?? []).map(r => [r.Mounted_on, r]));
    return blocchi.map(r => {
        const i = inodi.get(r.Mounted_on);
        return {
            device: r.Filesystem ?? null, mount_point: r.Mounted_on, type: null,
            size_bytes: perMille(r[colonnaBlocchi], BigInt(1024)), used_bytes: perMille(r.Used, BigInt(1024)), available_bytes: perMille(r.Available, BigInt(1024)),
            inodes_total: cifra(i?.Inodes), inodes_used: cifra(i?.IUsed), inodes_free: cifra(i?.IFree),
        };
    });
}

/** Righe `nome<TAB>versione` (formato scelto da noi in `dpkg-query -f`/`rpm --qf`): software. */
export function parseNomeVersione(testo: string, fonte: string): Array<{ name: string; version: string | null; publisher: null; install_date: null; source: string }> {
    return testo.split(/\r?\n/).map(r => r.split("\t")).filter(c => c.length >= 2 && c[0].trim() !== "")
        .map(([nome, versione]) => ({ name: nome.trim(), version: versione.trim() || null, publisher: null, install_date: null, source: fonte }));
}
