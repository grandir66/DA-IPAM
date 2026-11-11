import { withTenant } from "@/lib/db-tenant";
import { parseDbDate } from "@/lib/db-date";
import { barreReteDiSerie, cvssPerRotte } from "@/lib/rilievi/barre-di-serie";
import type { GruppoRilievi } from "@/lib/rilievi/gruppi";
import type { RilievoUnito } from "@/lib/rilievi/tipi";
import { elencoRilievi } from "@/lib/rilievi/unione";
import { exploitPerRotte } from "@/lib/vuln/exploit-feed/archivio";
import type { ContestoCliente } from "../contesto";
import { moduloAttivo } from "../contesto";
import type { RiquadroCliente, SchedaCliente, VoceAttenzione } from "../registro";

export interface DaSistemareApparato {
  chiave: string;
  nome: string;
  dettaglio: string | null;
  gravi: number;
  alte: number;
  cosa: string;
  rimedio: string | null;
}

export interface DaSistemare {
  ultimoControllo: string | null;
  gravi: number;
  alte: number;
  apparati: DaSistemareApparato[];
}

const MASSIMO_APPARATI = 100;
const MASSIMO_VOCI = 5;
const SENZA_TITOLO = "Rilievo senza titolo";

type GruppoApparato = Pick<GruppoRilievi, "chiave" | "tipo" | "nome" | "dettaglio" | "gravita" | "anteprima">;

/** Dai gruppi per host e dalle righe (per i rimedi) alle righe della scheda. */
export function perApparato(
  gruppi: readonly GruppoApparato[],
  righe: readonly Pick<RilievoUnito, "titolo" | "rimedio">[],
): DaSistemareApparato[] {
  const rimedioDelTitolo = new Map<string, string | null>();
  for (const riga of righe) {
    if (rimedioDelTitolo.has(riga.titolo)) continue;
    const rimedio = riga.rimedio.trim();
    rimedioDelTitolo.set(riga.titolo, rimedio ? rimedio : null);
  }

  return gruppi
    .filter((g) => g.tipo === "host" && g.gravita.Critical + g.gravita.High > 0)
    .map((g) => {
      const primo = g.anteprima[0];
      const cosa = primo && primo.trim() ? primo : SENZA_TITOLO;
      return {
        chiave: g.chiave,
        nome: g.nome,
        dettaglio: g.dettaglio,
        gravi: g.gravita.Critical,
        alte: g.gravita.High,
        cosa,
        rimedio: rimedioDelTitolo.get(cosa) ?? null,
      };
    })
    .sort((a, b) => b.gravi - a.gravi || b.alte - a.alte || a.nome.localeCompare(b.nome, "it"))
    .slice(0, MASSIMO_APPARATI);
}

function ultimoVisto(righe: readonly Pick<RilievoUnito, "visto">[]): string | null {
  let migliore: { raw: string; istante: number } | null = null;
  for (const riga of righe) {
    if (!riga.visto) continue;
    const istante = parseDbDate(riga.visto).getTime();
    if (Number.isNaN(istante)) continue;
    if (!migliore || istante > migliore.istante) migliore = { raw: riga.visto, istante };
  }
  return migliore?.raw ?? null;
}

/** Lettura della scheda, dentro il contesto del cliente. Se la lettura lancia, lancia anche lei. */
export function daSistemare(c: ContestoCliente): DaSistemare {
  return withTenant(c.tenantCode, () => {
    const elenco = elencoRilievi({
      gravita: ["Critical", "High"],
      raggruppa: "host",
      conIndicatori: true,
      pageSize: 200,
      exploitDi: exploitPerRotte().exploitDi,
      cvssDi: cvssPerRotte(),
    });
    const barre = barreReteDiSerie();
    return {
      ultimoControllo: ultimoVisto(elenco.data),
      gravi: barre.reduce((n, b) => n + b.critical, 0),
      alte: barre.reduce((n, b) => n + b.high, 0),
      apparati: perApparato(elenco.gruppi ?? [], elenco.data),
    };
  });
}

function testoGrave(gravi: number, nome: string): string {
  return gravi === 1 ? `1 problema grave su ${nome}` : `${gravi} problemi gravi su ${nome}`;
}

function riquadroDaSistemare(c: ContestoCliente): RiquadroCliente {
  const dati = daSistemare(c);
  const aperti = dati.gravi + dati.alte;
  return {
    numero: String(aperti),
    contesto: `${dati.gravi} gravi · ${dati.alte} alte`,
    aperti,
    stato: dati.gravi > 0 ? "grave" : dati.alte > 0 ? "attenzione" : "a_posto",
  };
}

function attenzioneDaSistemare(c: ContestoCliente): VoceAttenzione[] {
  return daSistemare(c).apparati
    .filter((a) => a.gravi > 0)
    .slice(0, MASSIMO_VOCI)
    .map((a) => ({
      gravita: "grave" as const,
      testo: testoGrave(a.gravi, a.nome),
      href: "/cliente/da-sistemare",
      scheda: "Da sistemare",
    }));
}

export const schedaDaSistemare: SchedaCliente = {
  id: "da-sistemare",
  titolo: "Da sistemare",
  ordine: 30,
  icona: "Wrench",
  attiva: (c) => moduloAttivo(c, "va") || moduloAttivo(c, "siem"),
  riquadro: riquadroDaSistemare,
  attenzione: attenzioneDaSistemare,
};
