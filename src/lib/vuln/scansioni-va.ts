/**
 * Lettura e lancio della pagina Scansioni VA. Riusa il bridge del pannello VA Scan: stesse chiamate
 * alla sonda, una rete alla volta. Una rete che non riesce non ferma le altre: l'esito è per rete.
 */
import { z } from "zod";
import { getAllHostsFlat, getHostsByNetwork, getNetworkById, getNetworks } from "@/lib/db";
import { getActiveEdgeScanner } from "@/lib/vuln/edge-scanner-db";
import { listEdgeSchedules, type EdgeScheduleConfig } from "@/lib/vuln/edge-schedule-store";
import { edgeApiGet, leggiSaluteEdge, listEdgeProfiles } from "@/lib/vuln/scanner-edge-client";
import {
  leggiFinestra,
  saveEdgeSubnetSchedule,
  triggerSubnetEdgeScan,
  type EdgeSubnetLastScan,
} from "@/lib/vuln/edge-subnet-bridge";
import { assessmentProfileIdSchema, type EdgeAssessmentProfile } from "@/lib/vuln/edge-profiles";
import { buildCron, describeCron, describeFinestra, slugifyJobName, type Frequency } from "@/lib/vuln/cron-builder";
import { salvaFinestraRotta, finestraSchema } from "@/lib/vuln/finestra-rotte";
import { SONDA_DA_AGGIORNARE } from "@/lib/vuln/finestra";
import { impiantiDellaRete, impiantiPerRete, type ImpiantiRete } from "@/lib/vuln/impianti-in-rete";
import {
  attivitaDaScansione,
  profiliFuoriDalleVoci,
  risolviVoci,
  type ConsensoRete,
  type EsitoRete,
  type PianoRete,
  type QuadroScansioni,
  type ReteScansione,
} from "@/lib/vuln/scansioni-va-regole";

const LETTURE_INSIEME = 4;
const ATTESA_SALUTE_MS = 5000;

type ScannerAttivo = NonNullable<ReturnType<typeof getActiveEdgeScanner>>;

function messaggio(e: unknown): string {
  return e instanceof Error ? e.message : "errore sconosciuto";
}

/** Come `map`, con al massimo `limite` chiamate alla sonda insieme. */
async function aGruppi<A, B>(voci: readonly A[], limite: number, fn: (v: A) => Promise<B>): Promise<B[]> {
  const esiti = new Array<B>(voci.length);
  let prossimo = 0;
  const lavora = async () => {
    while (prossimo < voci.length) {
      const i = prossimo++;
      esiti[i] = await fn(voci[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, voci.length) }, lavora));
  return esiti;
}

interface LookupRete {
  found: boolean;
  last_scan?: EdgeSubnetLastScan | null;
  /** La chiave manca su una sonda che non sa del consenso. */
  consenso?: ConsensoRete | null;
}

interface ReteLetta {
  sonda: ReteScansione["sonda"];
  ultima: EdgeSubnetLastScan | null;
  consenso: ConsensoRete | null;
  consensoFuturo?: ConsensoRete | null;
  consensoNoto: boolean;
}

/** Una rete mai vista dalla sonda non dice niente sulla versione della sonda: la risposta non ha `consenso`
 *  perché la rete non c'è, e «Sonda da aggiornare» su una sonda aggiornata toglieva il pulsante del consenso
 *  (VLAN 102 di 79993-ipam-2, 07/11/2026). Se la sonda è davvero vecchia lo dice il POST, con il suo 404. */
export function reteDaLookup(l: LookupRete): ReteLetta {
  if (!l.found) return { sonda: "sconosciuta", ultima: null, consenso: null, consensoNoto: true };
  // Tappa 2: la sonda manda anche il consenso che comincia più tardi; `consenso` resta «quello che vale adesso».
  const c = l.consenso ?? null;
  const futuro = c !== null && c.in_vigore === false;
  return { sonda: "nota", ultima: l.last_scan ?? null, consenso: futuro ? null : c, consensoFuturo: futuro ? c : null, consensoNoto: "consenso" in l };
}

/** Tre esiti: la sonda la conosce, non la conosce, non ha risposto. Un guasto non diventa «mai». */
async function leggiReteSullaSonda(scanner: ScannerAttivo, cidr: string): Promise<ReteLetta> {
  try {
    return reteDaLookup(await edgeApiGet<LookupRete>(scanner, `/api/v1/networks/lookup?cidr=${encodeURIComponent(cidr)}`));
  } catch {
    return { sonda: "errore", ultima: null, consenso: null, consensoNoto: false };
  }
}

function pianoDa(s: EdgeScheduleConfig | undefined): PianoRete | null {
  if (!s) return null;
  if (s.modo === "finestra") {
    if (!s.fascia_attiva || !s.fascia_dalle || !s.fascia_alle) return null;
    try {
      const testo = describeFinestra({
        giorni: (s.fascia_giorni ?? "").match(/\d/g)?.map(Number) ?? [],
        dalle: s.fascia_dalle,
        alle: s.fascia_alle,
        ripeti: s.ripeti === "settimana" ? "settimana" : "mese",
      });
      return { modo: "finestra", testo };
    } catch {
      return { modo: "finestra", testo: "Finestra illeggibile" };
    }
  }
  if (!s.enabled) return null;
  const grezzo = s.cron_expr ? `cron ${s.cron_expr}` : "Orario non leggibile";
  if (!s.frequency || !s.at_time) return { modo: "orario", testo: grezzo };
  try {
    return {
      modo: "orario",
      testo: describeCron({
        frequency: s.frequency as Frequency,
        at: s.at_time,
        daysOfWeek: (s.days_of_week ?? "").match(/\d/g)?.map(Number),
        dayOfMonth: s.day_of_month ?? undefined,
      }),
    };
  } catch {
    return { modo: "orario", testo: grezzo };
  }
}

function reteSenzaSonda(n: ReturnType<typeof getNetworks>[number], piano: PianoRete | null, impianti: ImpiantiRete | undefined): ReteScansione {
  return {
    id: n.id,
    nome: n.name || n.cidr,
    cidr: n.cidr,
    vlan: n.vlan_id ?? null,
    hostOnline: n.online_count,
    sonda: "sconosciuta",
    ultimaVa: null,
    ultimaVaStato: null,
    attivita: null,
    piano,
    assessmentId: Number(n.assessment_enabled ?? 0) === 1 ? (n.assessment_profile_id || null) : null,
    impianti: impianti?.host ?? 0,
    impiantiEsempi: impianti?.esempi ?? [],
  };
}

export async function leggiQuadroScansioni(): Promise<QuadroScansioni> {
  const reti = getNetworks();
  const piani = new Map(listEdgeSchedules().map((s) => [s.network_id, s]));
  // Se l'inventario non si legge la pagina va in errore: il freno non si salta in silenzio.
  const impianti = impiantiPerRete(getAllHostsFlat());
  const base = reti.map((n) => reteSenzaSonda(n, pianoDa(piani.get(n.id)), impianti.get(n.id)));
  const scanner = getActiveEdgeScanner();
  if (!scanner || scanner.enabled !== 1) {
    return {
      edge: { stato: "spento", nome: scanner?.name ?? null, versione: null, messaggio: null },
      voci: risolviVoci([]),
      catalogoErrore: null,
      altriProfili: 0,
      finestraDisponibile: true,
      reti: base,
    };
  }

  let versione: string | null = null;
  try {
    const salute = (await leggiSaluteEdge(scanner.base_url, scanner.cert_pin ?? null, ATTESA_SALUTE_MS)) as { version?: unknown };
    versione = typeof salute?.version === "string" ? salute.version : null;
  } catch (e) {
    return {
      edge: { stato: "non_risponde", nome: scanner.name, versione: null, messaggio: messaggio(e) },
      voci: risolviVoci([]),
      catalogoErrore: messaggio(e),
      altriProfili: 0,
      finestraDisponibile: true,
      reti: base.map((r) => ({ ...r, sonda: "errore" as const })),
    };
  }

  let catalogo: EdgeAssessmentProfile[] = [];
  let catalogoErrore: string | null = null;
  try {
    catalogo = (await listEdgeProfiles(scanner)).profiles;
  } catch (e) {
    catalogoErrore = messaggio(e);
  }

  const lette = await aGruppi(base, LETTURE_INSIEME, async (r): Promise<ReteScansione> => {
    const { sonda, ultima, consenso, consensoFuturo, consensoNoto } = await leggiReteSullaSonda(scanner, r.cidr);
    return {
      ...r,
      sonda,
      consenso,
      consensoFuturo: consensoFuturo ?? null,
      consensoNoto,
      ultimaVa: ultima?.finished_at ?? ultima?.started_at ?? null,
      ultimaVaStato: ultima?.status ?? null,
      attivita: attivitaDaScansione(ultima),
    };
  });

  // Basta chiedere per una rete che la sonda conosce: la rotta c'è o non c'è per tutte.
  const conosciuta = lette.find((r) => r.sonda === "nota");
  const finestra = conosciuta ? await leggiFinestra(conosciuta.id) : null;

  return {
    edge: { stato: "acceso", nome: scanner.name, versione, messaggio: null },
    voci: risolviVoci(catalogo),
    catalogoErrore,
    altriProfili: profiliFuoriDalleVoci(catalogo),
    finestraDisponibile: finestra?.stato !== "da_aggiornare",
    reti: lette,
  };
}

const orario = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "Orario non valido: scrivi HH:MM");

const comune = {
  voce: z.enum(["veloce", "bilanciato", "profondo", "formale"]),
  ambito: z.enum(["full_subnet", "found_ips", "populated_24"]),
  reti: z.array(z.number().int().positive()).min(1, "Scegli almeno una rete").max(500),
  /** Lo stesso id che la pagina ha letto: se nel frattempo la sonda è cambiata, ci si ferma. */
  assessment_id: assessmentProfileIdSchema,
  autorizzazione: z.boolean().optional(),
};

export const lancioSchema = z.discriminatedUnion("modo", [
  z.object({
    modo: z.literal("immediata"),
    ...comune,
    sync_hosts: z.boolean().optional(),
    sync_credentials: z.boolean().optional(),
  }),
  z.object({
    modo: z.literal("pianificata"),
    ...comune,
    frequency: z.enum(["daily", "weekly", "monthly"]),
    at_time: orario,
    days_of_week: z.array(z.number().int().min(0).max(6)).optional(),
    day_of_month: z.number().int().min(1).max(28).optional(),
  }),
  z.object({
    modo: z.literal("finestra"),
    ...comune,
    giorni: finestraSchema.shape.giorni,
    dalle: orario,
    alle: orario,
    ripeti: finestraSchema.shape.ripeti,
    invio: finestraSchema.shape.invio,
    ip_per_gruppo: finestraSchema.shape.ip_per_gruppo,
    tentativi: finestraSchema.shape.tentativi,
  }),
]);

export type Lancio = z.infer<typeof lancioSchema>;

export type EsitoLancio =
  | { ok: true; esiti: EsitoRete[] }
  | { ok: false; status: number; error: string };

function reteLibera(ultima: EdgeSubnetLastScan | null): boolean {
  return attivitaDaScansione(ultima) === null;
}

async function lanciaSuUnaRete(scanner: ScannerAttivo, l: Lancio, greenbone: "fast" | "balanced" | "deep", networkId: number, chi?: string): Promise<EsitoRete> {
  const rete = getNetworkById(networkId);
  if (!rete) return { id: networkId, nome: `#${networkId}`, esito: "errore", motivo: "Rete non trovata" };
  const nome = rete.name || rete.cidr;
  // 08/11/2026 (Riccardo, tavola 40-44): una rete con impianti si scansiona, e gli impianti li toglie la sonda (freno
  // `protetti` ed elenco degli ammessi). Il lancio immediato li include col consenso valido riletto da Edge; pianificata
  // e finestra li includono da sole sulla sonda quando il consenso copre il giro (08/11/2026).
  const conImpianti = impiantiDellaRete(getHostsByNetwork(rete.id)).host > 0;
  const comuneRete = { assessmentEnabled: true, assessmentProfileId: l.assessment_id, targetingMode: l.ambito };

  if (l.modo === "immediata") {
    // Edge non rifiuta una seconda scansione sulla stessa rete: la metterebbe in coda.
    const { sonda, ultima, consenso } = await leggiReteSullaSonda(scanner, rete.cidr);
    if (sonda === "errore") return { id: rete.id, nome, esito: "errore", motivo: "La sonda non ha risposto" };
    if (!reteLibera(ultima)) return { id: rete.id, nome, esito: "saltata", motivo: "Scansione già in corso o in coda" };
    const r = await triggerSubnetEdgeScan(rete.id, {
      ...comuneRete,
      profile: greenbone,
      syncHosts: l.sync_hosts,
      syncCredentials: l.sync_credentials,
      ancheImpianti: conImpianti && !!consenso,
      chi,
    });
    return r.ok ? { id: rete.id, nome, esito: "avviata" } : { id: rete.id, nome, esito: "errore", motivo: r.error };
  }

  if (l.modo === "pianificata") {
    const r = await saveEdgeSubnetSchedule(rete.id, {
      ...comuneRete,
      enabled: true,
      profile: greenbone,
      cronExpr: buildCron({
        frequency: l.frequency,
        at: l.at_time,
        daysOfWeek: l.days_of_week,
        dayOfMonth: l.day_of_month,
      }),
      jobName: slugifyJobName([nome, rete.cidr, l.voce, l.frequency]),
      frequency: l.frequency,
      atTime: l.at_time,
      daysOfWeek: l.days_of_week,
      dayOfMonth: l.day_of_month,
    });
    return r.ok
      ? { id: rete.id, nome, esito: "salvata", motivo: r.warning }
      : { id: rete.id, nome, esito: "errore", motivo: r.error };
  }

  const r = await salvaFinestraRotta(rete.id, {
    enabled: true,
    giorni: l.giorni,
    dalle: l.dalle,
    alle: l.alle,
    ripeti: l.ripeti,
    invio: l.invio,
    ip_per_gruppo: l.ip_per_gruppo,
    tentativi: l.tentativi,
    profile: greenbone,
    targeting_mode: l.ambito,
    assessment_enabled: true,
    assessment_profile_id: l.assessment_id,
  });
  const corpo = r.body as { error?: string; daAggiornare?: boolean; avviso?: string | null };
  if (r.status === 200) return { id: rete.id, nome, esito: "salvata", motivo: corpo.avviso ?? undefined };
  return { id: rete.id, nome, esito: "errore", motivo: corpo.daAggiornare ? SONDA_DA_AGGIORNARE : corpo.error };
}

export async function lanciaSuReti(l: Lancio, chi?: string): Promise<EsitoLancio> {
  const scanner = getActiveEdgeScanner();
  if (!scanner || scanner.enabled !== 1) {
    return { ok: false, status: 409, error: "Scanner-Edge non configurato o disabilitato" };
  }

  let catalogo: EdgeAssessmentProfile[];
  try {
    catalogo = (await listEdgeProfiles(scanner)).profiles;
  } catch (e) {
    return { ok: false, status: 502, error: `Impossibile leggere i profili dalla sonda: ${messaggio(e)}` };
  }
  const voce = risolviVoci(catalogo).find((v) => v.id === l.voce);
  if (!voce?.assessmentId) return { ok: false, status: 422, error: `«${voce?.nome ?? l.voce}» non c'è su questa sonda.` };
  if (voce.assessmentId !== l.assessment_id) {
    return { ok: false, status: 409, error: "I profili della sonda sono cambiati: ricarica la pagina." };
  }
  if (voce.autorizzazione && l.autorizzazione !== true) {
    return { ok: false, status: 400, error: "Serve la conferma dell'autorizzazione scritta del cliente." };
  }

  const esiti: EsitoRete[] = [];
  // Una rete alla volta: ognuna spinge host e credenziali alla sonda.
  for (const id of l.reti) {
    try {
      esiti.push(await lanciaSuUnaRete(scanner, l, voce.greenbone, id, chi));
    } catch (e) {
      esiti.push({ id, nome: getNetworkById(id)?.name ?? `#${id}`, esito: "errore", motivo: messaggio(e) });
    }
  }
  return { ok: true, esiti };
}
