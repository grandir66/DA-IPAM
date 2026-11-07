/**
 * Consenso a scansionare gli impianti e copia del registro di Edge (Riccardo, 06-07/11/2026): «dove ci sono
 * gli impianti deve essere registrato il consenso e le attività svolte con timestamp delle scansioni».
 *
 * Il consenso lo applica Edge: qui non si tiene uno stato che possa dire altro. Gli IP si rileggono
 * dall'inventario, mai dal client; il nome viene dalla sessione. Il registro ha una copia qui perché
 * resti anche se la sonda viene rifatta.
 */
import { getDb, getNetworkById, getNetworks } from "@/lib/db";
import { getActiveEdgeScanner } from "@/lib/vuln/edge-scanner-db";
import { EdgeClientError, edgeApiGet, edgeApiPost } from "@/lib/vuln/scanner-edge-client";
import { allineaReteEdge, ipImpiantiDellaRete } from "@/lib/vuln/edge-subnet-bridge";
import { SONDA_DA_AGGIORNARE } from "@/lib/vuln/finestra";
import { dataRegistro, dettaglioRegistro, nomeEvento, profiloRegistro, type ConsensoRete } from "@/lib/vuln/scansioni-va-regole";

export const ORE_CONSENSO = [4, 12, 24] as const;
export type OreConsenso = (typeof ORE_CONSENSO)[number];

const PAGINA = 500;
const RIGHE_A_SCHERMO = 300;

export interface RigaRegistro {
  id: number;
  at: string;
  cidr: string;
  rete: string;
  evento: string;
  chi: string;
  scan_id: number | null;
  impianti: number;
  ips: string;
  profilo: string | null;
  dettaglio: string | null;
}

type RigaEdge = Omit<RigaRegistro, "rete"> & { consenso_id: number | null };

export type Esito<T> = { ok: true; dati: T } | { ok: false; status: number; error: string; daAggiornare?: boolean };

function sonda() {
  const s = getActiveEdgeScanner();
  return s && s.enabled === 1 ? s : null;
}

function rifiuto(e: unknown): { ok: false; status: number; error: string; daAggiornare?: boolean } {
  if (e instanceof EdgeClientError) {
    if (e.status === 404 || e.status === 405) return { ok: false, status: 409, error: SONDA_DA_AGGIORNARE, daAggiornare: true };
    if (e.status === 409 || e.status === 422) return { ok: false, status: 409, error: e.detail ?? e.message };
  }
  return { ok: false, status: 502, error: e instanceof Error ? e.message : "La sonda non risponde" };
}

async function idSullaSonda(cidr: string): Promise<number | null> {
  const s = sonda();
  if (!s) return null;
  const l = await edgeApiGet<{ found: boolean; network_id?: number }>(s, `/api/v1/networks/lookup?cidr=${encodeURIComponent(cidr)}`);
  return l.found ? (l.network_id ?? null) : null;
}

export async function daiConsenso(networkId: number, d: { chi: string; riferimento: string; ore: OreConsenso }): Promise<Esito<ConsensoRete>> {
  const s = sonda();
  const rete = getNetworkById(networkId);
  if (!s || !rete) return { ok: false, status: 409, error: "Sonda non configurata o rete non trovata" };
  const ips = ipImpiantiDellaRete(networkId);
  if (ips.length === 0) return { ok: false, status: 409, error: "Su questa rete non risultano impianti" };
  try {
    // L'elenco degli impianti deve essere arrivato alla sonda: lei rifiuta un IP che non conosce come impianto.
    await allineaReteEdge(networkId);
    const id = await idSullaSonda(rete.cidr);
    if (id === null) return { ok: false, status: 409, error: "La sonda non conosce questa rete" };
    const r = await edgeApiPost<{ consenso: ConsensoRete }>(s, `/api/v1/networks/${id}/consenso`, { chi: d.chi, riferimento: d.riferimento, ore: d.ore, ips });
    await sincronizzaRegistro().catch(() => undefined);
    return { ok: true, dati: r.consenso };
  } catch (e) {
    return rifiuto(e);
  }
}

export async function revocaConsenso(networkId: number, chi: string): Promise<Esito<{ revocato: boolean }>> {
  const s = sonda();
  const rete = getNetworkById(networkId);
  if (!s || !rete) return { ok: false, status: 409, error: "Sonda non configurata o rete non trovata" };
  try {
    const id = await idSullaSonda(rete.cidr);
    if (id === null) return { ok: false, status: 409, error: "La sonda non conosce questa rete" };
    const r = await edgeApiPost<{ ok: boolean }>(s, `/api/v1/networks/${id}/consenso/revoca`, { chi });
    await sincronizzaRegistro().catch(() => undefined);
    return { ok: true, dati: { revocato: r.ok } };
  } catch (e) {
    return rifiuto(e);
  }
}

/**
 * Porta qui le righe nuove. Una sonda rifatta riparte da 1 e può già aver superato il nostro ultimo id:
 * si rilegge l'ultima riga ricordata e, se la sonda non ha quella riga, si riparte da capo. I doppioni
 * non contano, li ferma la chiave.
 */
export async function sincronizzaRegistro(): Promise<number> {
  const s = sonda();
  if (!s) return 0;
  const db = getDb();
  const chiave = String(s.id);
  const inserisci = db.prepare(
    `INSERT OR IGNORE INTO va_registro_impianti (sonda, edge_id, cidr, evento, chi, consenso_id, scan_id, impianti, ips, profilo, dettaglio, at)
     VALUES (@sonda, @id, @cidr, @evento, @chi, @consenso_id, @scan_id, @impianti, @ips, @profilo, @dettaglio, @at)`,
  );
  const ricordata = db
    .prepare(`SELECT edge_id, at, evento FROM va_registro_impianti WHERE sonda = ? ORDER BY edge_id DESC, at DESC LIMIT 1`)
    .get(chiave) as { edge_id: number; at: string; evento: string } | undefined;
  let dopo = ricordata ? ricordata.edge_id - 1 : 0;
  let controllo = !!ricordata;
  let nuove = 0;
  for (;;) {
    const { righe } = await edgeApiGet<{ righe: RigaEdge[] }>(s, `/api/v1/registro-impianti?dopo=${dopo}&limite=${PAGINA}`);
    if (controllo) {
      controllo = false;
      const r = righe[0];
      const stessa = r?.id === ricordata?.edge_id && r?.at === ricordata?.at && r?.evento === ricordata?.evento;
      if (!stessa && dopo > 0) {
        dopo = 0;
        continue;
      }
    }
    for (const r of righe) nuove += inserisci.run({ ...r, sonda: chiave }).changes;
    if (righe.length < PAGINA) return nuove;
    dopo = righe[righe.length - 1].id;
  }
}

export function leggiRegistro(limite = RIGHE_A_SCHERMO): RigaRegistro[] {
  const nomi = new Map(getNetworks().map((n) => [n.cidr, n.name || n.cidr]));
  const righe = getDb()
    .prepare(`SELECT id, at, cidr, evento, chi, scan_id, impianti, ips, profilo, dettaglio FROM va_registro_impianti ORDER BY at DESC, id DESC LIMIT ?`)
    .all(limite) as Omit<RigaRegistro, "rete">[];
  return righe.map((r) => ({ ...r, rete: nomi.get(r.cidr) ?? r.cidr }));
}

const CAMPI: Array<[string, (r: RigaRegistro) => string | number | null]> = [
  ["Quando", (r) => dataRegistro(r.at)], ["Rete", (r) => r.rete], ["CIDR", (r) => r.cidr], ["Evento", (r) => nomeEvento(r.evento)], ["Chi", (r) => r.chi],
  ["Scansione", (r) => r.scan_id], ["Impianti", (r) => r.impianti], ["IP", (r) => r.ips], ["Profilo", (r) => profiloRegistro(r.profilo)], ["Dettaglio", (r) => dettaglioRegistro(r.dettaglio)],
];

/** Una cella che comincia con = + - @ in Excel è una formula: il riferimento lo scrive una persona. */
function cella(v: string | number | null): string {
  const t = v == null ? "" : String(v);
  const sicuro = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
  return /[";\n\r]/.test(sicuro) ? `"${sicuro.replace(/"/g, '""')}"` : sicuro;
}

export function registroCsv(righe: readonly RigaRegistro[]): string {
  return [CAMPI.map(([t]) => t).join(";"), ...righe.map((r) => CAMPI.map(([, f]) => cella(f(r))).join(";"))].join("\r\n") + "\r\n";
}
