/**
 * Il quadro della pagina «Cosa esce da questa istanza» (tappa C1, spec §5.3).
 *
 * Dice tutto ciò che esce verso Domarc:
 * - verso DA-Link: configurazione (mai il token), livello e suo registro, ultimo
 *   tentativo e ultimo invio riuscito, stato della conferma, e l'**anteprima** del
 *   prossimo segnale, costruita con lo stesso `costruisciSegnale` del giro;
 * - gli altri flussi: risultati delle scansioni verso da-vulcan se l'edge è acceso,
 *   monitoraggio verso Zabbix se c'è il proxy. Sono il servizio chiesto dal cliente e
 *   si fermano spegnendo il modulo.
 *
 * Senza configurazione si mostra lo stesso cosa conterrebbe il segnale, col cliente
 * dell'istanza se è uno solo: chi decide il livello prima di collegarsi vede cosa
 * uscirebbe.
 */
import fs from "node:fs";
import { getActiveTenants } from "@/lib/db-hub";
import { leggiConfigDalink, type ConfigDalink } from "./config";
import { fattiIstanza, inventarioCliente } from "./fatti";
import { costruisciSegnale, type CorpoSegnale, type FattiIstanza, type Inventario } from "./segnale";
import { OGNI_MS } from "./segnale-job";
import {
  livelloAttuale,
  registroLivello,
  statoConferma,
  statoSegnale,
  type RigaRegistro,
  type StatoConferma,
  type StatoSegnale,
} from "./stato";

export const FILE_PROXY_ZABBIX = "/etc/zabbix/zabbix_proxy.conf";

export interface DipendenzeQuadro {
  config: () => ConfigDalink;
  /** Il codice dell'unico cliente attivo dell'istanza, se è uno solo e numerico. */
  clienteUnico: () => string | null;
  fatti: (codcli: string) => Promise<{ fatti: FattiIstanza; clienteTrovato: boolean }>;
  inventario: (codcli: string) => Inventario | null;
  proxyZabbix: () => boolean;
}

export type ConfigurazioneVista =
  | { stato: "assente" }
  | { stato: "non_valida"; motivo: string }
  | { stato: "pronta"; destinazione: string; codcli: string; nodo: string; token_presente: true };

export interface QuadroCosaEsce {
  configurazione: ConfigurazioneVista;
  livello: RigaRegistro | null;
  registro: RigaRegistro[];
  segnale: StatoSegnale | null;
  conferma: StatoConferma;
  anteprima: CorpoSegnale | null;
  anteprima_errore: string | null;
  ogni_minuti: number;
  altri_flussi: { edge: "acceso" | "spento" | "non_so"; zabbix_proxy: "presente" | "non_rilevato" };
}

const dipendenzeReali: DipendenzeQuadro = {
  config: () => leggiConfigDalink(),
  clienteUnico: () => {
    const attivi = getActiveTenants().map((t) => t.codice_cliente).filter((c) => /^[0-9]{3,8}$/.test(c));
    return attivi.length === 1 ? attivi[0] : null;
  },
  fatti: (codcli) => fattiIstanza(codcli, statoSegnale()?.esito && statoSegnale()?.esito !== "ok" ? `segnale precedente: ${statoSegnale()?.dettaglio ?? ""}` : null),
  inventario: (codcli) => inventarioCliente(codcli),
  proxyZabbix: () => fs.existsSync(FILE_PROXY_ZABBIX),
};

function vista(cfg: ConfigDalink): ConfigurazioneVista {
  if (cfg.stato === "pronta") {
    return { stato: "pronta", destinazione: cfg.url.host, codcli: cfg.codcli, nodo: cfg.nodo, token_presente: true };
  }
  return cfg;
}

export async function quadroCosaEsce(dip: Partial<DipendenzeQuadro> = {}): Promise<QuadroCosaEsce> {
  const d: DipendenzeQuadro = { ...dipendenzeReali, ...dip };
  const cfg = d.config();
  const livello = livelloAttuale();

  const codcli = cfg.stato === "pronta" ? cfg.codcli : d.clienteUnico();
  let anteprima: CorpoSegnale | null = null;
  let anteprimaErrore: string | null = null;
  if (codcli) {
    try {
      const { fatti, clienteTrovato } = await d.fatti(codcli);
      anteprima = costruisciSegnale(
        { codcli, nodo: cfg.stato === "pronta" ? cfg.nodo : `${codcli}-ipam` },
        livello?.livello ?? null,
        fatti,
        () => (clienteTrovato ? d.inventario(codcli) : null),
      );
    } catch {
      anteprimaErrore = "errore nella raccolta dei dati dell'istanza";
    }
  }

  let edge: QuadroCosaEsce["altri_flussi"]["edge"] = "non_so";
  if (anteprima && "edge" in anteprima.moduli) edge = anteprima.moduli.edge ? "acceso" : "spento";

  let proxy = false;
  try {
    proxy = d.proxyZabbix();
  } catch {
    proxy = false;
  }

  return {
    configurazione: vista(cfg),
    livello,
    registro: registroLivello(20),
    segnale: statoSegnale(),
    conferma: statoConferma(),
    anteprima,
    anteprima_errore: anteprimaErrore,
    ogni_minuti: Math.round(OGNI_MS / 60_000),
    altri_flussi: { edge, zabbix_proxy: proxy ? "presente" : "non_rilevato" },
  };
}
