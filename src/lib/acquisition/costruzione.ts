/**
 * Mattoni comuni dei collector di sistemi (NAS, server, router letti via shell o WinRM): sezioni, letture, stato globale.
 * Le regole sono quelle dello schema 1.0: una lettura mancata è `error`/`unsupported`/`skipped` con un codice, mai una
 * lista vuota dichiarata `ok`; un formato che il parser non riconosce è `partial` con `FORMAT_UNRECOGNIZED_OR_EMPTY`.
 */
import { redactSnapshot } from "./redact";
import { snapshotSchema } from "./schema";
import type { AcquisitionInput, AcquisitionSnapshot, ReadResult } from "./schema";

export type StatoSezione = "ok" | "partial" | "unsupported" | "error" | "skipped";
export interface Sezione<T> { status: StatoSezione; collected_at: string; sources: string[]; warnings: string[]; data: T }

export function sez<T>(data: T, status: StatoSezione = "skipped", sources: string[] = [], warnings: string[] = []): Sezione<T> {
    return { status, collected_at: new Date().toISOString(), sources, warnings, data };
}

export const nonLetto = (): ReadResult<string> => ({ status: "error", data: "", warnings: ["NOT_COLLECTED"] });

/** Le sezioni da switch che un sistema non ha: `unsupported`, col codice che lo dice. */
export function sezioniDaSwitchNonApplicabili(codice = "NOT_APPLICABLE_TO_FAMILY"): Pick<AcquisitionSnapshot, "vlans" | "forwarding" | "neighbors" | "spanning_tree" | "aggregation" | "poe" | "sensors"> {
    return {
        vlans: sez([], "unsupported", [], [codice]), forwarding: sez([], "unsupported", [], [codice]), neighbors: sez([], "unsupported", [], [codice]),
        spanning_tree: sez({ enabled: null, protocol: null, ports: [] }, "unsupported", [], [codice]), aggregation: sez([], "unsupported", [], [codice]),
        poe: sez([], "unsupported", [], [codice]), sensors: sez([], "unsupported", [], [codice]),
    };
}

/**
 * Una sezione da una lettura: errore o non supportato passano com'è; altrimenti il parser, e `ok` solo se la lettura era
 * `ok` e il valore è riconosciuto. `vuoto` è il dato quando la lettura non c'è.
 */
export function daLettura<T>(r: ReadResult<string>, parser: (s: string) => T | null, vuoto: T, fonte: string, riconosciuto: (v: T) => boolean): Sezione<T> {
    if (r.status === "error" || r.status === "unsupported") return sez(vuoto, r.status, [fonte], r.warnings);
    const v = parser(r.data);
    if (v === null) return sez(vuoto, "partial", [fonte], [...r.warnings, "FORMAT_UNRECOGNIZED_OR_EMPTY"]);
    const buono = riconosciuto(v);
    return sez(v, r.status === "ok" && buono ? "ok" : "partial", [fonte], buono ? r.warnings : [...r.warnings, "FORMAT_UNRECOGNIZED_OR_EMPTY"]);
}

/** Un lettore a script/comandi che non lancia mai: un'eccezione del trasporto diventa un codice, senza il messaggio. */
export async function leggiTutto(op: (ids: readonly string[]) => Promise<Record<string, ReadResult<string>>>, ids: readonly string[], codice: string): Promise<Record<string, ReadResult<string>>> {
    try {
        return await op(ids);
    }
    catch {
        return Object.fromEntries(ids.map(c => [c, { status: "error" as const, data: "", warnings: [codice] }]));
    }
}

/** ok se tutte ok, partial se almeno una ok o partial, altrimenti error. Le sezioni non applicabili non contano. */
export function statoGlobale(sezioni: ReadonlyArray<{ status: StatoSezione }>): AcquisitionSnapshot["status"] {
    const contano = sezioni.filter(s => s.status !== "unsupported" && s.status !== "skipped");
    if (contano.length === 0) return "error";
    if (contano.every(s => s.status === "ok")) return "ok";
    return contano.some(s => s.status === "ok" || s.status === "partial") ? "partial" : "error";
}

export function chiudi(snapshot: AcquisitionSnapshot, input: AcquisitionInput, inizio: number): AcquisitionSnapshot {
    snapshot.duration_ms = Date.now() - inizio;
    return snapshotSchema.parse(redactSnapshot(snapshot, input));
}

/** Il primo testo non vuoto fra le letture `ok`, nell'ordine dato. */
export function primoTesto(...letture: ReadResult<string>[]): string | null {
    for (const r of letture) {
        if (r.status !== "ok") continue;
        const riga = r.data.split(/\r?\n/).map(x => x.trim()).find(x => x.length > 0);
        if (riga) return riga;
    }
    return null;
}
