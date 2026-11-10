/**
 * Findings a gruppi (revisione d'uso del 10/11/2026, Riccardo: «Sì, scrivila»).
 *
 * Sull'hub c'erano 2.705 rilievi da rivedere e nessuno rivisto: una riga per CVE non si
 * smaltisce. Qui le CVE si raccolgono per **cosa aggiornare** (il software che le chiude),
 * così un aggiornamento solo si prende in carico in un colpo. Modulo puro: niente database,
 * lo stato resta per CVE in `triage_rilievi` (la scheda Vulnerabilità continua a vederlo).
 */
import { SEVERITY_RANK } from "@/lib/severity-style";
import type { StatoTriage } from "@/lib/triage/db";
import type { RilievoUnito, RollupRilievi } from "./tipi";

export type TipoGruppo = "software" | "edge" | "senza";

export interface GruppoRilievi {
  /** Chiave stabile del gruppo (`sw:<nome minuscolo>`, `edge`, `senza`). */
  chiave: string;
  tipo: TipoGruppo;
  nome: string;
  /** Quanti rilievi raccoglie. */
  rilievi: number;
  /** Host della CVE più diffusa del gruppo: non è la somma (gli stessi host si ripetono). */
  hostMax: number;
  gravita: RollupRilievi;
  /** Rilievi sfruttati attivamente (CISA KEV) e con exploit pubblico (Exploit-DB). */
  kev: number;
  edb: number;
  triage: Record<StatoTriage, number>;
  /** Le chiavi di triage di tutti i rilievi del gruppo: servono all'azione sul gruppo. */
  chiavi: string[];
  /** Solo quelle ancora «Da rivedere»: «Prendi in carico» non tocca ciò che è già deciso. */
  chiaviDaFare: string[];
  /** I primi titoli (CVE), i più gravi in testa: l'anteprima del gruppo aperto. */
  anteprima: string[];
}

const ANTEPRIMA = 12;

/**
 * Il nome del software da un'etichetta «nome versione» di Wazuh: si toglie l'ultima parola
 * se è una versione. «Google Chrome 120.0.6099.71» → «Google Chrome»; un nome senza
 * versione resta com'è.
 */
export function nomeSoftware(etichetta: string | null | undefined): string | null {
  const t = (etichetta ?? "").trim().replace(/\s+/g, " ");
  if (!t) return null;
  const parole = t.split(" ");
  if (parole.length > 1 && /^v?\d[\w.+~:-]*$/i.test(parole[parole.length - 1])) parole.pop();
  return parole.join(" ");
}

function gruppoDi(r: RilievoUnito): { chiave: string; tipo: TipoGruppo; nome: string } {
  const sw = nomeSoftware(r.pacchetto);
  if (sw) return { chiave: `sw:${sw.toLowerCase()}`, tipo: "software", nome: sw };
  if (r.cve_key) return { chiave: "edge", tipo: "edge", nome: "Vulnerabilità senza un pacchetto indicato" };
  return { chiave: "senza", tipo: "senza", nome: "Senza un aggiornamento da fare" };
}

/** Raccoglie i rilievi per cosa aggiornare. Ordine: sfruttate attivamente, exploit pubblico, critiche × host. */
export function raggruppaPerSoftware(righe: readonly RilievoUnito[]): GruppoRilievi[] {
  const mappa = new Map<string, GruppoRilievi & { ordinati: RilievoUnito[] }>();
  for (const r of righe) {
    const g = gruppoDi(r);
    let gr = mappa.get(g.chiave);
    if (!gr) {
      gr = {
        ...g,
        rilievi: 0,
        hostMax: 0,
        gravita: { Critical: 0, High: 0, Medium: 0, Low: 0 },
        kev: 0,
        edb: 0,
        triage: { da_fare: 0, in_corso: 0, fatto: 0, ignorato: 0 },
        chiavi: [],
        chiaviDaFare: [],
        anteprima: [],
        ordinati: [],
      };
      mappa.set(g.chiave, gr);
    }
    gr.rilievi += 1;
    gr.hostMax = Math.max(gr.hostMax, r.host_count);
    if (r.gravita in gr.gravita) gr.gravita[r.gravita as keyof RollupRilievi] += 1;
    if (r.exploit?.kev) gr.kev += 1;
    if (r.exploit?.edb) gr.edb += 1;
    gr.triage[r.triage?.stato ?? "da_fare"] += 1;
    gr.chiavi.push(r.chiaveTriage);
    if ((r.triage?.stato ?? "da_fare") === "da_fare") gr.chiaviDaFare.push(r.chiaveTriage);
    gr.ordinati.push(r);
  }
  const gruppi = [...mappa.values()].map(({ ordinati, ...g }) => {
    ordinati.sort((a, b) => (SEVERITY_RANK[b.gravita] ?? 0) - (SEVERITY_RANK[a.gravita] ?? 0) || a.titolo.localeCompare(b.titolo));
    return { ...g, chiavi: [...new Set(g.chiavi)], chiaviDaFare: [...new Set(g.chiaviDaFare)], anteprima: ordinati.slice(0, ANTEPRIMA).map((r) => r.titolo) };
  });
  // I due gruppi-contenitore stanno in fondo: non sono «un aggiornamento da fare».
  const peso = (g: GruppoRilievi) => (g.tipo === "software" ? 0 : g.tipo === "edge" ? 1 : 2);
  gruppi.sort(
    (a, b) =>
      peso(a) - peso(b) ||
      Number(b.kev > 0) - Number(a.kev > 0) ||
      Number(b.edb > 0) - Number(a.edb > 0) ||
      b.gravita.Critical * b.hostMax - a.gravita.Critical * a.hostMax ||
      b.gravita.High * b.hostMax - a.gravita.High * a.hostMax ||
      b.rilievi - a.rilievi ||
      a.nome.localeCompare(b.nome),
  );
  return gruppi;
}
