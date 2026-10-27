/**
 * L'assegnatario proposto per un PC (piano 2026-10-23-assegnatari-da-ad, passo 4; tavola ⑫-⑱). Funzione pura: riceve gli
 * accessi già sommati per account e fonte nella finestra, le persone di AD e la scheda dell'asset, e dice l'esito.
 *
 * Regole (decise da Riccardo il 23/10, soglie in Opzioni):
 * - contano solo le **persone abilitate in AD con nome e cognome**, non amministrative e non di servizio;
 * - si usano gli accessi **alla tastiera** (Wazuh tipi 2/10/11, WinRM, GLPI) se le persone ne hanno almeno `minimo`,
 *   altrimenti quelli **di rete** (tipo 3 visti dai server per nome della postazione);
 * - sotto `minimo` accessi di persone → «pochi dati»; il primo sopra `percentuale` → proposta; altrimenti condiviso;
 * - server, apparati di rete e PC segnati «condiviso» non ricevono proposte (si calcola lo stesso, per la tabella).
 * Nessuna scrittura: la proposta diventa assegnazione solo col clic su «Accetta».
 */
import { eAccountDiServizio, eNomeAmministrativo } from "./account";

export type FonteAccesso = "wazuh_tastiera" | "wazuh_rete" | "winrm" | "glpi";
export const FONTI_ACCESSO: readonly FonteAccesso[] = ["wazuh_tastiera", "wazuh_rete", "winrm", "glpi"];
const FONTI_TASTIERA = new Set<FonteAccesso>(["wazuh_tastiera", "winrm", "glpi"]);

export interface AccessoAggregato {
  account: string;
  fonte: FonteAccesso;
  conteggio: number;
  /** UTC del DB («2026-10-22 17:52:00») o ISO; il più recente fra le righe sommate. */
  ultimo: string | null;
}

export interface PersonaAd {
  account: string;
  integrationId: number;
  guid: string;
  nome: string | null;
  cognome: string | null;
  nomeVisualizzato: string | null;
  reparto: string | null;
  ruolo: string | null;
  abilitato: boolean;
  /** In un gruppo privilegiato di AD. */
  amministrativo: boolean;
}

export interface Soglie {
  /** Il primo deve superare questa percentuale degli accessi di persone. */
  percentuale: number;
  /** Accessi di persone sotto cui non si propone. */
  minimo: number;
  /** Finestra in giorni (la applica chi legge gli accessi). */
  giorni: number;
}
export const SOGLIE_DI_SERIE: Soglie = { percentuale: 50, minimo: 5, giorni: 30 };

/** Categorie dell'asset che non ricevono proposte: non sono la postazione di una persona. */
export const CATEGORIE_SENZA_PROPOSTA: ReadonlySet<string> = new Set([
  "Server", "Switch", "Firewall", "Router", "Access Point", "NAS", "Stampante", "Licenza",
]);

export type MotivoFuori = "amministrativo" | "servizio" | "non_in_ad" | "disattivato" | "senza_nome";

export interface RigaAccount {
  account: string;
  persona: PersonaAd | null;
  tastiera: number;
  rete: number;
  perFonte: Record<FonteAccesso, number>;
  ultimo: string | null;
  nelCalcolo: boolean;
  motivo: MotivoFuori | null;
}

export type EsitoProposta = "proposta" | "condiviso" | "pochi_dati" | "nessuna_fonte" | "esclusa";

export interface Proposta {
  esito: EsitoProposta;
  /** Perché `esclusa`. */
  perche: "categoria" | "segnato_condiviso" | null;
  /** Quale famiglia di accessi ha deciso (null senza accessi di persone). */
  base: "tastiera" | "rete" | null;
  /** La persona prevalente: valorizzata anche quando l'esito è `esclusa` ma il calcolo l'avrebbe proposta. */
  persona: PersonaAd | null;
  accessiPersona: number;
  totale: number;
  ultimoPersona: string | null;
  righe: RigaAccount[];
}

function haNomeECognome(p: PersonaAd): boolean {
  if (p.nome?.trim() && p.cognome?.trim()) return true;
  return (p.nomeVisualizzato ?? "").trim().split(/\s+/).length >= 2;
}

function motivoFuori(account: string, p: PersonaAd | null): MotivoFuori | null {
  if (eAccountDiServizio(account)) return "servizio";
  if (eNomeAmministrativo(account) || p?.amministrativo) return "amministrativo";
  if (!p) return "non_in_ad";
  if (!p.abilitato) return "disattivato";
  if (!haNomeECognome(p)) return "senza_nome";
  return null;
}

const piuRecente = (a: string | null, b: string | null): string | null => (!a ? b : !b ? a : a > b ? a : b);

export function calcolaProposta(input: {
  accessi: readonly AccessoAggregato[];
  persone: ReadonlyMap<string, PersonaAd>;
  categoria: string | null;
  propostaOff: boolean;
  soglie: Soglie;
}): Proposta {
  const perAccount = new Map<string, RigaAccount>();
  for (const a of input.accessi) {
    if (a.conteggio <= 0) continue;
    let r = perAccount.get(a.account);
    if (!r) {
      const persona = input.persone.get(a.account) ?? null;
      const motivo = motivoFuori(a.account, persona);
      r = {
        account: a.account, persona, tastiera: 0, rete: 0,
        perFonte: { wazuh_tastiera: 0, wazuh_rete: 0, winrm: 0, glpi: 0 },
        ultimo: null, nelCalcolo: motivo === null, motivo,
      };
      perAccount.set(a.account, r);
    }
    r.perFonte[a.fonte] += a.conteggio;
    if (FONTI_TASTIERA.has(a.fonte)) r.tastiera += a.conteggio;
    else r.rete += a.conteggio;
    r.ultimo = piuRecente(r.ultimo, a.ultimo);
  }
  const righe = [...perAccount.values()].sort((x, y) =>
    Number(y.nelCalcolo) - Number(x.nelCalcolo) || (y.tastiera + y.rete) - (x.tastiera + x.rete) || x.account.localeCompare(y.account));

  const esclusa = input.categoria !== null && CATEGORIE_SENZA_PROPOSTA.has(input.categoria)
    ? "categoria" as const
    : input.propostaOff ? "segnato_condiviso" as const : null;
  const vuota = (esito: EsitoProposta, base: Proposta["base"] = null, totale = 0): Proposta => ({
    esito: esclusa ? "esclusa" : esito, perche: esclusa, base, persona: null, accessiPersona: 0, totale, ultimoPersona: null, righe,
  });

  if (righe.length === 0) return vuota("nessuna_fonte");
  const persone = righe.filter((r) => r.nelCalcolo);
  const minimo = Math.max(1, input.soglie.minimo);
  const sommaTastiera = persone.reduce((s, r) => s + r.tastiera, 0);
  const base: "tastiera" | "rete" = sommaTastiera >= minimo ? "tastiera" : "rete";
  const valore = (r: RigaAccount) => (base === "tastiera" ? r.tastiera : r.rete);
  const totale = persone.reduce((s, r) => s + valore(r), 0);
  if (totale < minimo) return vuota("pochi_dati", totale > 0 ? base : null, totale);

  const primo = [...persone].sort((x, y) => valore(y) - valore(x) || x.account.localeCompare(y.account))[0];
  const quota = valore(primo);
  if (quota * 100 <= input.soglie.percentuale * totale) return vuota("condiviso", base, totale);
  return {
    esito: esclusa ? "esclusa" : "proposta",
    perche: esclusa,
    base,
    persona: primo.persona,
    accessiPersona: quota,
    totale,
    ultimoPersona: primo.ultimo,
    righe,
  };
}
