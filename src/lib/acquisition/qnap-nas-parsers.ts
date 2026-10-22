/**
 * Parser puri del collector `qnap-nas` (QTS / QuTS hero via SSH): cartelle condivise da `smb.conf` ed `/etc/exports`,
 * pacchetti da `qpkg.conf`, modello da `platform.conf`. Forma delle uscite dalla documentazione e dal donatore
 * DADude3 `qnap.py` (`_get_platform_info` :176, `_get_shares` :779): **non** viste su un apparato vero (collector non
 * collaudato). Il firmware si legge con `devices/nas/qnap-versione.ts`, lo stesso del percorso storico (S2).
 */
import { parseKeyValue } from "./linux-parsers";

type Condivisione = { name: string; path: string | null; protocols: Array<"smb" | "nfs" | "afp" | "ftp" | "other">; comment: string | null; public: boolean | null };

/** Un file INI in sezioni `[nome]` con righe `chiave = valore`. */
export function parseIni(testo: string): Array<{ sezione: string; valori: Record<string, string> }> {
    const out: Array<{ sezione: string; valori: Record<string, string> }> = [];
    let corrente: { sezione: string; valori: Record<string, string> } | null = null;
    for (const grezza of testo.split(/\r?\n/)) {
        const riga = grezza.trim();
        if (!riga || riga.startsWith("#") || riga.startsWith(";")) continue;
        const s = /^\[(.+)\]$/.exec(riga);
        if (s) {
            corrente = { sezione: s[1].trim(), valori: {} };
            out.push(corrente);
            continue;
        }
        if (!corrente) continue;
        const i = riga.indexOf("=");
        if (i <= 0) continue;
        corrente.valori[riga.slice(0, i).trim().toLowerCase()] = riga.slice(i + 1).trim();
    }
    return out;
}

const SPECIALI = new Set(["global", "homes", "home", "printers", "print$"]);
const si = (v: string | undefined): boolean | null => (v === undefined ? null : /^(yes|true|1)$/i.test(v) ? true : /^(no|false|0)$/i.test(v) ? false : null);

/**
 * `smb.conf` → condivisioni SMB (senza le sezioni speciali di Samba). null = nessuna sezione: formato non riconosciuto.
 * «public» da `public` o `guest ok`.
 */
export function parseSmbConf(testo: string): Condivisione[] | null {
    const sezioni = parseIni(testo);
    if (sezioni.length === 0) return null;
    return sezioni.filter(s => !SPECIALI.has(s.sezione.toLowerCase())).map(s => ({
        name: s.sezione, path: s.valori.path ?? null, protocols: ["smb"], comment: s.valori.comment || null,
        public: si(s.valori.public) ?? si(s.valori["guest ok"]),
    }));
}

/** `/etc/exports` → percorsi esportati via NFS (righe `"percorso" client(opzioni)` o `percorso client(opzioni)`). */
export function parseExports(testo: string): string[] {
    const out: string[] = [];
    for (const grezza of testo.split(/\r?\n/)) {
        const riga = grezza.trim();
        if (!riga || riga.startsWith("#")) continue;
        const m = /^"([^"]+)"/.exec(riga) ?? /^(\/\S+)/.exec(riga);
        if (m) out.push(m[1]);
    }
    return out;
}

/** Unisce SMB e NFS per percorso: un percorso esportato e condiviso è una cartella sola con due protocolli. */
export function unisciCondivisioni(smb: Condivisione[], nfs: string[]): Condivisione[] {
    const out = smb.map(c => ({ ...c, protocols: [...c.protocols] }));
    for (const percorso of nfs) {
        const gia = out.find(c => c.path === percorso);
        if (gia) { if (!gia.protocols.includes("nfs")) gia.protocols.push("nfs"); continue; }
        out.push({ name: percorso.split("/").filter(Boolean).at(-1) ?? percorso, path: percorso, protocols: ["nfs"], comment: null, public: null });
    }
    return out;
}

/** `qpkg.conf` → pacchetti (una sezione per pacchetto: `Name`, `Version`, `Author`). null = nessuna sezione. */
export function parseQpkgConf(testo: string): Array<{ name: string; version: string | null; publisher: string | null; install_date: string | null; source: string }> | null {
    const sezioni = parseIni(testo);
    if (sezioni.length === 0) return null;
    return sezioni.map(s => ({ name: s.valori.name || s.sezione, version: s.valori.version || null, publisher: s.valori.author || null, install_date: s.valori.date || null, source: "qpkg" }));
}

/** `platform.conf` → nome commerciale del modello e piattaforma. */
export function parsePlatformConf(testo: string): { model: string | null; platform: string | null } {
    const kv = parseKeyValue(testo);
    return { model: kv.DISPLAY_NAME || null, platform: kv.Platform || kv.PLATFORM || null };
}
