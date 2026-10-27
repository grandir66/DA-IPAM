/**
 * Parser puri del collector `synology-nas` (DSM via SSH). Forma delle uscite dalla documentazione DSM e dal donatore
 * DADude3 `synology.py` (`_get_packages` :798, `_get_shares` :810): **non** viste su un apparato vero.
 * Le condivisioni SMB si leggono con `parseSmbConf` (`qnap-nas-parsers.ts`): `smb.share.conf` ha la stessa forma INI.
 */
import { parseKeyValue } from "./linux-parsers";

/**
 * `/etc.defaults/VERSION` → «DSM 7.2.1-69057 Update 5». Chiavi `productversion` (o `majorversion`.`minorversion`),
 * `buildnumber`, `smallfixnumber`; mai troncata. null se manca la versione.
 */
export function parseVersioneDsm(testo: string): { firmware: string | null; versione: string | null; build: string | null } {
    const kv = parseKeyValue(testo);
    const versione = kv.productversion || (kv.majorversion && kv.minorversion ? `${kv.majorversion}.${kv.minorversion}` : null);
    if (!versione || !/^\d+(\.\d+)+$/.test(versione)) return { firmware: null, versione: null, build: null };
    const build = /^\d+$/.test(kv.buildnumber ?? "") ? kv.buildnumber : null;
    const fix = /^\d+$/.test(kv.smallfixnumber ?? "") && kv.smallfixnumber !== "0" ? ` Update ${kv.smallfixnumber}` : "";
    return { firmware: `DSM ${versione}${build ? `-${build}` : ""}${fix}`, versione, build };
}

/**
 * `cat /var/packages/<pkg>/INFO` di tutti i pacchetti concatenati: ogni INFO comincia con (o contiene) `package="…"`.
 * Nessun limite sul numero (il donatore ne teneva 50 in silenzio). null = nessun pacchetto riconosciuto in un'uscita
 * non vuota.
 */
export function parseInfoPacchetti(testo: string): Array<{ name: string; version: string | null; publisher: string | null; install_date: null; source: string }> | null {
    const out: Array<{ name: string; version: string | null; publisher: string | null; install_date: null; source: string }> = [];
    let corrente: Record<string, string> = {};
    const chiudi = () => { if (corrente.package) out.push({ name: corrente.package, version: corrente.version || null, publisher: corrente.maintainer || null, install_date: null, source: "synopkg" }); };
    for (const riga of testo.split(/\r?\n/)) {
        const m = /^\s*([A-Za-z_][\w-]*)\s*=\s*"?(.*?)"?\s*$/.exec(riga);
        if (!m) continue;
        if (m[1] === "package" && corrente.package) { chiudi(); corrente = {}; }
        if (!(m[1] in corrente)) corrente[m[1]] = m[2];
    }
    chiudi();
    return out.length || testo.trim() === "" ? out : null;
}

/** `synoshare --enum ALL` (o `-enum`): i nomi fra parentesi quadre dopo «Name list». null se la riga non c'è. */
export function parseSynoshareEnum(testo: string): string[] | null {
    const i = testo.search(/Name list/i);
    if (i < 0) return null;
    return [...testo.slice(i).matchAll(/^\s*\[([^\]]+)\]\s*$/gm)].map(m => m[1]);
}
