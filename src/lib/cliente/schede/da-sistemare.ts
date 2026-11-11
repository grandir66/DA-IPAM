import { cache } from "react";
import type Database from "better-sqlite3";
import { getTenantDb, withTenant } from "@/lib/db-tenant";
import { barreReteDiSerie, cvssPerRotte } from "@/lib/rilievi/barre-di-serie";
import type { GruppoRilievi } from "@/lib/rilievi/gruppi";
import { elencoRilievi } from "@/lib/rilievi/unione";
import { exploitPerRotte } from "@/lib/vuln/exploit-feed/archivio";
import type { ContestoCliente } from "../contesto";
import { moduloAttivo } from "../contesto";
import type { RiquadroCliente, SchedaCliente, VoceAttenzione } from "../registro";

export interface ProgrammaDaAggiornare {
  chiave: string;
  nome: string;
  apparati: number;
  gravita: "grave" | "attenzione";
  sfruttato: boolean;
}

export interface DaSistemare {
  /** Gravi e alte per rete, dalle stesse barre della Dashboard: servono al grafico della casa. */
  perRete: Array<{ nome: string; gravi: number; alte: number }>;
  ultimoControllo: string | null;
  gravi: number;
  alte: number;
  /** Al più 100, nell'ordine dei gruppi. */
  programmi: ProgrammaDaAggiornare[];
  totaleProgrammi: number;
  daCorreggere: { titoli: string[]; rilievi: number; apparati: number } | null;
  altri: { rilievi: number; apparati: number } | null;
}

const MASSIMO_PROGRAMMI = 100;
const MASSIMO_VOCI = 3;

type GruppoSoftware = Pick<GruppoRilievi, "chiave" | "tipo" | "nome" | "host" | "rilievi" | "gravita" | "kev" | "anteprima">;

/** Dai gruppi per software alle tre parti della scheda. L'ordine dei programmi è quello dei gruppi. */
export function daGruppi(gruppi: readonly GruppoSoftware[]): Pick<DaSistemare, "programmi" | "totaleProgrammi" | "daCorreggere" | "altri"> {
  const software = gruppi.filter((g) => g.tipo === "software");
  const senza = gruppi.find((g) => g.tipo === "senza" && g.rilievi > 0);
  const edge = gruppi.find((g) => g.tipo === "edge" && g.rilievi > 0);
  return {
    programmi: software.slice(0, MASSIMO_PROGRAMMI).map((g) => ({
      chiave: g.chiave,
      nome: g.nome,
      apparati: g.host,
      gravita: g.gravita.Critical > 0 ? "grave" : "attenzione",
      sfruttato: g.kev > 0,
    })),
    totaleProgrammi: software.length,
    daCorreggere: senza ? { titoli: [...senza.anteprima], rilievi: senza.rilievi, apparati: senza.host } : null,
    altri: edge ? { rilievi: edge.rilievi, apparati: edge.host } : null,
  };
}

function tabella(db: Database.Database, nome: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(nome);
}

function ultimoControllo(db: Database.Database): string | null {
  if (!tabella(db, "vuln_findings")) return null;
  const riga = db.prepare("SELECT MAX(scanned_at) AS t FROM vuln_findings").get() as { t: string | null };
  return riga.t;
}

/**
 * Una lettura per richiesta: la casa chiama la scheda due volte e la pagina una terza.
 * La chiave è il codice del cliente.
 */
const leggi = cache((tenantCode: string): DaSistemare => {
  return withTenant(tenantCode, () => {
    const elenco = elencoRilievi({
      gravita: ["Critical", "High"],
      raggruppa: "software",
      pageSize: 1,
      exploitDi: exploitPerRotte().exploitDi,
      cvssDi: cvssPerRotte(),
    });
    const barre = barreReteDiSerie();
    return {
      ultimoControllo: ultimoControllo(getTenantDb(tenantCode)),
      gravi: barre.reduce((n, b) => n + b.critical, 0),
      alte: barre.reduce((n, b) => n + b.high, 0),
      perRete: barre
        .filter((b) => b.critical + b.high > 0)
        .map((b) => ({ nome: b.network_name, gravi: b.critical, alte: b.high }))
        .sort((x, y) => y.gravi - x.gravi || y.alte - x.alte),
      ...daGruppi(elenco.gruppi ?? []),
    };
  });
});

/** Lettura della scheda, dentro il contesto del cliente. Se la lettura lancia, lancia anche lei. */
export function daSistemare(c: ContestoCliente): DaSistemare {
  return leggi(c.tenantCode);
}

function suApparati(n: number): string {
  return n === 1 ? "su 1 apparato" : `su ${n} apparati`;
}

export function fraseProgramma(programma: ProgrammaDaAggiornare): string {
  const coda = programma.sfruttato ? ": già usato negli attacchi" : "";
  return `${programma.nome} da aggiornare ${suApparati(programma.apparati)}${coda}`;
}

function fraseDaCorreggere(rilievi: number, apparati: number): string {
  const cose = rilievi === 1 ? "1 cosa da correggere" : `${rilievi} cose da correggere`;
  return `${cose} ${suApparati(apparati)}`;
}

function contestoRiquadro(gravi: number, alte: number, programmi: number): string {
  const n = programmi === 1 ? "1 programma" : `${programmi} programmi`;
  return `${gravi} gravi · ${alte} alte · ${n}`;
}

function riquadroDaSistemare(c: ContestoCliente): RiquadroCliente {
  const dati = daSistemare(c);
  const aperti = dati.gravi + dati.alte;
  return {
    numero: String(aperti),
    contesto: contestoRiquadro(dati.gravi, dati.alte, dati.totaleProgrammi),
    aperti,
    stato: dati.gravi > 0 ? "grave" : dati.alte > 0 ? "attenzione" : "a_posto",
  };
}

function attenzioneDaSistemare(c: ContestoCliente): VoceAttenzione[] {
  const dati = daSistemare(c);
  const gravi = dati.programmi.filter((p) => p.gravita === "grave");
  const voci: VoceAttenzione[] = [...gravi.filter((p) => p.sfruttato), ...gravi.filter((p) => !p.sfruttato)]
    .slice(0, MASSIMO_VOCI)
    .map((p) => ({
      gravita: "grave" as const,
      testo: fraseProgramma(p),
      href: "/cliente/da-sistemare",
      scheda: "Da sistemare",
    }));
  if (dati.daCorreggere) {
    voci.push({
      gravita: "attenzione",
      testo: fraseDaCorreggere(dati.daCorreggere.rilievi, dati.daCorreggere.apparati),
      href: "/cliente/da-sistemare",
      scheda: "Da sistemare",
    });
  }
  return voci;
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
