/**
 * La fonte di raccolta di un apparato (decisione 4 della tavola C1, «fonte automatica»): collector dal prodotto
 * riconosciuto (`acquisition/riconosci.ts`), credenziali fra quelle già assegnate all'apparato (i suoi binding
 * d'archivio, riusciti poi non provati; mai host, rete, hub o «public»). Si chiede a una persona solo nel caso dubbio:
 * due collector possibili, o nessuna credenziale compatibile. La sua scelta (`acquisition_source_choices`) vale finché
 * resta fra le possibili.
 *
 * Con l'interruttore spento la valutazione si ferma alla prima domanda e non legge altro: il chiamante prosegue col
 * percorso di sempre (prova `aggancio.test.ts`).
 */
import { CATALOGO, COLLECTOR_IDS, descrittore, type CollectorId } from "@/lib/acquisition";
import type { ProtocolloCollector } from "@/lib/acquisition/catalogo";
import { collectorPossibili, type ApparatoDaRiconoscere } from "@/lib/acquisition/riconosci";
import { credenzialiApparatoDb, FONTI_APPARATO } from "@/lib/credentials/resolve";
import { acquisizioneModulareAccesa, getCurrentTenantCode, getTenantDb, sceltaFonteAcquisizione, type SceltaFonteAcquisizione } from "@/lib/db-tenant";

/** Valore di `acquisition_source_choices.scelta` per «usa l'acquisizione di sempre». */
export const SCELTA_CLASSICA = "classica";

export interface CandidatoCredenziale {
  protocollo: ProtocolloCollector;
  credential_id: number;
  nome: string;
  port: number;
}

export type CredenzialiProposte = Partial<Record<ProtocolloCollector, CandidatoCredenziale>>;

export type ValutazioneFonte =
  | { esito: "spenta" }
  | { esito: "nessun_collector" }
  | { esito: "classica_scelta"; scelta: SceltaFonteAcquisizione }
  | { esito: "dubbio"; motivo: "due_collector"; possibili: CollectorId[] }
  | { esito: "dubbio"; motivo: "credenziali"; collector: CollectorId; possibili: CollectorId[]; richieste: readonly ProtocolloCollector[] }
  | { esito: "pronta"; collector: CollectorId; possibili: CollectorId[]; credenziali: CredenzialiProposte; scelta: SceltaFonteAcquisizione | null };

export interface DipendenzeFonte {
  accesa(): boolean;
  scelta(deviceId: number): SceltaFonteAcquisizione | null;
  /** Le credenziali assegnate all'apparato per un protocollo, nell'ordine del motore. Non legge segreti. */
  candidati(deviceId: number, protocollo: ProtocolloCollector): CandidatoCredenziale[];
}

/** «Classica» o un collector cambiano il percorso: tutto il resto (spenta, nessun collector) è il percorso di sempre. */
export function usaPercorsoDiSempre(v: ValutazioneFonte): boolean {
  return v.esito === "spenta" || v.esito === "nessun_collector" || v.esito === "classica_scelta";
}

export function valutaFonte(device: ApparatoDaRiconoscere & { id: number }, deps: DipendenzeFonte): ValutazioneFonte {
  if (!deps.accesa()) return { esito: "spenta" };
  const possibili = collectorPossibili(device);
  const scelta = deps.scelta(device.id);
  if (scelta?.scelta === SCELTA_CLASSICA) return { esito: "classica_scelta", scelta };
  const sceltaValida = scelta && (possibili as string[]).includes(scelta.scelta) ? (scelta.scelta as CollectorId) : null;
  if (!sceltaValida && possibili.length === 0) return { esito: "nessun_collector" };
  if (!sceltaValida && possibili.length > 1) return { esito: "dubbio", motivo: "due_collector", possibili };
  const collector = sceltaValida ?? possibili[0];
  const d = descrittore(collector);
  const credenziali: CredenzialiProposte = {};
  for (const p of d.credenziali.ammesse) {
    const primo = deps.candidati(device.id, p)[0];
    if (primo) credenziali[p] = primo;
  }
  if (!d.credenziali.una_di.some((p) => credenziali[p])) {
    return { esito: "dubbio", motivo: "credenziali", collector, possibili, richieste: d.credenziali.una_di };
  }
  return { esito: "pronta", collector, possibili, credenziali, scelta: sceltaValida ? scelta : null };
}

/** Le dipendenze vere, sul DB del tenant corrente. */
export function dipendenzeDb(): DipendenzeFonte {
  return {
    accesa: acquisizioneModulareAccesa,
    scelta: sceltaFonteAcquisizione,
    candidati: (deviceId, protocollo) => {
      const code = getCurrentTenantCode();
      if (!code) throw new Error("Contesto tenant assente");
      const dbh = getTenantDb(code);
      const righe = credenzialiApparatoDb(dbh, deviceId, protocollo, { fonti: FONTI_APPARATO });
      const ids = righe.map((r) => r.credential_id).filter((x): x is number => x != null);
      if (ids.length === 0) return [];
      const nomi = new Map((dbh.prepare(`SELECT id, name FROM credentials WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) as Array<{ id: number; name: string }>)
        .map((r) => [r.id, r.name]));
      return righe.filter((r) => r.credential_id != null)
        .map((r) => ({ protocollo, credential_id: r.credential_id as number, nome: nomi.get(r.credential_id as number) ?? `#${r.credential_id}`, port: r.port }));
    },
  };
}

/** Frase per un 409 del pulsante d'acquisizione nel caso dubbio. */
export function testoDubbio(v: Extract<ValutazioneFonte, { esito: "dubbio" }>): string {
  if (v.motivo === "due_collector") {
    return `Acquisizione modulare: questo apparato può essere letto da ${v.possibili.join(" o ")}. Scegli la fonte in Gestione → «Acquisizione modulare».`;
  }
  return `Acquisizione modulare: ${v.collector} vuole una credenziale ${v.richieste.map((p) => p.toUpperCase()).join(" o ")} assegnata all'apparato, e non ce n'è. Assegnala in «Credenziali» o scegli l'acquisizione di sempre in «Acquisizione modulare».`;
}

/** Id del catalogo validi per una scelta, più «classica». */
export const SCELTE_AMMESSE: readonly string[] = [...COLLECTOR_IDS, SCELTA_CLASSICA];

/** Nomi dei collector in parole, per gli stati vuoti della scheda (oggetto 12). */
export function collectorInParole(): string[] {
  return CATALOGO.map((c) => c.prodotti[0]);
}
