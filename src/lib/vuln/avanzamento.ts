/**
 * Avanzamento per IP di una scansione aperta sulla sonda Edge (06/11/2026, piano host lenti Task 2).
 *
 * Solo tipi e funzioni pure, senza database né rete: li importano il client, il bridge, la rotta e
 * (poi) il pannello. La fonte è `GET /api/v1/scans/in-corso` della sonda.
 */

/** Un IP in analisi e da quando (data della sonda, UTC). */
export interface IpInAnalisi {
  ip: string;
  /** `null` se la sonda non sa da quando. */
  da: string | null;
}

/** Un host fuori standard (job separato, Task 4): quanto ci ha messo, quante volte, quando l'ultima. */
export interface HostLento {
  ip: string;
  durata_s: number | null;
  volte: number;
  visto_at: string;
}

/** Una scansione aperta come la dice la sonda. `percento` è `null` finché Greenbone non lo dà. */
export interface AvanzamentoScan {
  scan_id: number;
  network_id: number | null;
  /** `null` per una scansione senza rete: non si abbina a nessuna rete, ma non rompe l'elenco. */
  cidr: string | null;
  percento: number | null;
  partita_at: string | null;
  totale: number;
  finiti: number;
  in_analisi: IpInAnalisi[];
  da_fare: string[];
  lenti: HostLento[];
}

/**
 * Esito della lettura per una rete. Ogni esito ha il suo nome: «sonda da aggiornare» non è un errore
 * e nessun guasto diventa «nessuna scansione». `null` (fuori da questo tipo) = sonda a posto, la
 * rete non ha scansioni aperte.
 */
export type AvanzamentoRete =
  | ({ stato: "ok" } & AvanzamentoScan)
  | { stato: "da_aggiornare" }
  | { stato: "sonda_assente"; messaggio: string }
  | { stato: "errore"; messaggio: string };

const eOggetto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const eNumero = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const eHostLento = (x: unknown): x is HostLento =>
  eOggetto(x) && typeof x.ip === "string" && (x.durata_s === null || eNumero(x.durata_s)) && eNumero(x.volte) && typeof x.visto_at === "string";
const testoOnull = (v: unknown): v is string | null => v === null || typeof v === "string";

/** Controlla la forma della risposta: una forma diversa è un errore detto, non un pannello vuoto. */
export function leggiRispostaInCorso(raw: unknown): { ok: true; scans: AvanzamentoScan[] } | { ok: false; error: string } {
  const male = (cosa: string) => ({ ok: false as const, error: `Risposta della sonda non riconosciuta: ${cosa}.` });
  if (!Array.isArray(raw)) return male("non è un elenco");
  const scans: AvanzamentoScan[] = [];
  for (const r of raw) {
    if (!eOggetto(r)) return male("una scansione non è un oggetto");
    if (!Number.isInteger(r.scan_id)) return male("manca «scan_id»");
    if (!testoOnull(r.cidr ?? null)) return male("«cidr» illeggibile");
    if (!(r.percento === null || r.percento === undefined || eNumero(r.percento))) return male("«percento» non è un numero");
    if (!eNumero(r.totale) || !eNumero(r.finiti)) return male("mancano «totale» e «finiti»");
    if (!testoOnull(r.partita_at ?? null)) return male("«partita_at» illeggibile");
    if (!Array.isArray(r.in_analisi) || !r.in_analisi.every((x) => eOggetto(x) && typeof x.ip === "string" && testoOnull(x.da ?? null))) {
      return male("«in_analisi» non è un elenco di {ip, da}");
    }
    if (!Array.isArray(r.da_fare) || !r.da_fare.every((x) => typeof x === "string")) return male("«da_fare» non è un elenco di IP");
    if (!Array.isArray(r.lenti) || !r.lenti.every(eHostLento)) return male("«lenti» non è un elenco di {ip, durata_s, volte, visto_at}");
    scans.push({
      scan_id: r.scan_id as number,
      network_id: Number.isInteger(r.network_id) ? (r.network_id as number) : null,
      cidr: (r.cidr as string | null | undefined) ?? null,
      percento: eNumero(r.percento) ? r.percento : null,
      partita_at: (r.partita_at as string | null | undefined) ?? null,
      totale: r.totale,
      finiti: r.finiti,
      in_analisi: (r.in_analisi as Array<{ ip: string; da?: string | null }>).map((x) => ({ ip: x.ip, da: x.da ?? null })),
      da_fare: r.da_fare as string[],
      lenti: r.lenti as HostLento[],
    });
  }
  return { ok: true, scans };
}

/** Host lenti di una rete come li dà la sonda (`GET /networks/{id}/host-lenti`). */
export interface RispostaHostLenti {
  escludi_lenti: boolean;
  host: HostLento[];
}

export function leggiRispostaHostLenti(raw: unknown): { ok: true; dati: RispostaHostLenti } | { ok: false; error: string } {
  const male = (cosa: string) => ({ ok: false as const, error: `Risposta della sonda non riconosciuta: ${cosa}.` });
  if (!eOggetto(raw)) return male("non è un oggetto");
  if (typeof raw.escludi_lenti !== "boolean") return male("manca «escludi_lenti»");
  if (!Array.isArray(raw.host) || !raw.host.every(eHostLento)) return male("«host» non è un elenco di {ip, durata_s, volte, visto_at}");
  return { ok: true, dati: { escludi_lenti: raw.escludi_lenti, host: raw.host.map((h) => ({ ip: h.ip, durata_s: h.durata_s, volte: h.volte, visto_at: h.visto_at })) } };
}
