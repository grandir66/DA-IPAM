/**
 * Testi delle conferme di disinstallazione e rimozione dei moduli.
 *
 * MOD-19 (piano di miglioramento, tappa 1, 12/10): la conferma diceva il
 * contrario del codice. Sotto «Elimina anche i dati storici» c'era scritto che
 * la richiesta «viene accettata ma non droppa», mentre
 * /api/features/[key]/uninstall cancellava davvero le tabelle; «Rimuovi» dello
 * Scanner-Edge prometteva che i findings restavano in archivio, mentre la
 * rimozione li cancella a cascata.
 *
 * I testi stanno qui, accanto all'elenco delle tabelle che la disinstallazione
 * tocca, così le prove (src/lib/modules/__tests__/uninstall-copy.test.ts e
 * src/lib/vuln/__tests__/edge-removal.test.ts) eseguono la cancellazione vera
 * e la confrontano con ciò che la conferma promette. Se il comportamento cambia
 * (tappa 7, MOD-5) si aggiornano insieme.
 *
 * Modulo condiviso fra client (conferma in Impostazioni → Moduli) e server:
 * importa dagli schemi solo le costanti con i nomi delle tabelle.
 */
import { PATCH_MODULE_TABLES } from "@/lib/patch/schema";
import { INVENTORY_AGENT_TABLES } from "@/lib/inventory-agent/schema";
import { MC_TABLES } from "@/lib/integrations/meshcentral/schema";
import type { IntegrationComponent } from "@/lib/integrations/types";

/** Moduli che /api/features/[key]/uninstall sa disinstallare. */
export const UNINSTALLABLE_FEATURES = [
  "patch_management",
  "inventory_agent",
  "meshcentral",
] as const;

export type UninstallableFeature = (typeof UNINSTALLABLE_FEATURES)[number];

export function isUninstallableFeature(key: string): key is UninstallableFeature {
  return (UNINSTALLABLE_FEATURES as readonly string[]).includes(key);
}

export interface UninstallCopy {
  /** Cosa succede sempre, con o senza la casella. */
  effetto: string;
  /** Cosa resta se la casella «Elimina anche i dati storici» NON è spuntata. */
  senzaCasella: string;
  /** Cosa si perde se la casella è spuntata. */
  conCasella: string;
  /** Tabelle del database del cliente cancellate con la casella spuntata. */
  tabelle: readonly string[];
}

export const UNINSTALL_COPY: Record<UninstallableFeature, UninstallCopy> = {
  patch_management: {
    effetto:
      "La voce «Patch Management» sparisce dal menu e le funzioni del modulo non rispondono più finché non lo reinstalli.",
    senzaCasella:
      "Senza la casella, le operazioni di patch con i loro log, le CVE da correggere e i metadati del software restano nel database e ricompaiono se reinstalli il modulo.",
    conCasella:
      "Si cancellano per sempre le operazioni di patch con i loro log, le CVE da correggere e i metadati del software. Reinstallando il modulo si riparte da zero.",
    tabelle: PATCH_MODULE_TABLES,
  },
  inventory_agent: {
    effetto:
      "Il token di invio viene revocato: gli agenti GLPI restano installati sugli endpoint, ma i loro inventari vengono rifiutati. Per riprendere servirà un token nuovo sugli agenti.",
    senzaCasella:
      "Senza la casella, endpoint, software, licenze e report già ricevuti restano nel database e ricompaiono se reinstalli il modulo.",
    conCasella:
      "Si cancellano per sempre endpoint, software, licenze e report ricevuti dagli agenti. Restano le informazioni già riportate sugli host, come il sistema operativo.",
    tabelle: INVENTORY_AGENT_TABLES,
  },
  meshcentral: {
    effetto:
      "La voce «Controllo remoto» sparisce dal menu. Il server MeshCentral sull'appliance, gli agenti sugli endpoint e i parametri di collegamento non vengono toccati.",
    senzaCasella:
      "Senza la casella, l'elenco dei nodi con i collegamenti agli host, lo storico delle sessioni remote e il registro dei comandi eseguiti restano nel database e ricompaiono se reinstalli il modulo.",
    conCasella:
      "Si cancellano per sempre l'elenco dei nodi con i collegamenti agli host, lo storico delle sessioni remote e il registro dei comandi eseguiti (chi ha eseguito cosa, e dove).",
    tabelle: MC_TABLES,
  },
};

/** 1234 → "1.234": raggruppamento sempre, anche sotto 10.000 (it-IT non lo fa). */
function migliaia(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Conferma di «Rimuovi» nella card Scanner-Edge.
 *
 * DELETE /api/integrations/scanner-edge cancella la riga di vuln_scanners;
 * vuln_scan_runs e vuln_findings hanno ON DELETE CASCADE e il DB del cliente
 * apre con foreign_keys=ON, quindi se ne vanno anche loro. Si ferma anche la
 * sincronizzazione pianificata (job vuln_sync).
 */
export function edgeRemovalConfirmText(findingCount: number): string {
  const n = Number.isFinite(findingCount) && findingCount > 0 ? Math.trunc(findingCount) : 0;
  const cosa =
    n === 0
      ? "Si cancella anche lo storico delle scansioni importate"
      : n === 1
        ? "Si cancellano anche il finding importato e lo storico delle scansioni"
        : `Si cancellano anche i ${migliaia(n)} findings importati e lo storico delle scansioni`;
  return (
    "Rimuovere lo Scanner-Edge da DA-IPAM?\n\n" +
    `${cosa}, e la sincronizzazione pianificata si ferma. L'operazione non si annulla.`
  );
}

/** Container che «Elimina tutto e ricrea» toglie oltre a quello principale. */
const DIPENDENZE_DOCKER: Record<IntegrationComponent, string> = {
  librenms: "MariaDB, Redis e il dispatcher dei grafici",
  graylog: "MongoDB e OpenSearch",
  loki: "",
};

/**
 * Conferme di «Rimuovi container» ed «Elimina tutto e ricrea» nelle card
 * LibreNMS, Graylog e Loki (POST /api/integrations/[component]/action).
 *
 * Cosa fa il codice: `docker rm -f` del container (per LibreNMS anche del
 * dispatcher) o di tutti i container del modulo più la rete Docker; la
 * configurazione del collegamento non si tocca. Dopo la rimozione la card
 * offre solo «Installa / Reinstalla», che toglie e ricrea tutti i container:
 * i dati raccolti fino a quel momento non tornano.
 */
export function containerRemovalConfirmText(
  component: IntegrationComponent,
  title: string,
  action: "remove" | "remove-all",
): string {
  const nonTornano =
    "Una nuova installazione riparte da zero: i dati raccolti finora non tornano. La configurazione del collegamento resta salvata.";
  if (action === "remove") {
    const quale =
      component === "librenms"
        ? `il container Docker di ${title} e il suo dispatcher dei grafici`
        : `il container Docker di ${title}`;
    return (
      `Rimuovere ${quale}? ${title} smette di funzionare e per riaverlo c'è solo «Installa / Reinstalla», ` +
      `che ricrea tutti i container. ${nonTornano}`
    );
  }
  const dip = DIPENDENZE_DOCKER[component];
  const tutti = dip ? `tutti i container Docker di ${title} (${dip} compresi)` : `il container Docker di ${title}`;
  return `Eliminare ${tutti}? ${nonTornano}`;
}

const NET_SERVICES_ENV_VARS = "NET_SERVICES_API_URL e NET_SERVICES_API_TOKEN";
const NET_SERVICES_BRIDGE_INTATTO = "Il bridge e i suoi servizi DNS/DHCP non vengono toccati.";

/**
 * Conferma di «Disinstalla» di Network Services (Impostazioni → Moduli e
 * pagina /network-services).
 *
 * DELETE /api/network-services/setup (uninstallNetServices) mette enabled=0 e
 * config_json=NULL in tenant_features e non contatta il bridge. Ma se
 * NET_SERVICES_API_URL e NET_SERVICES_API_TOKEN sono nell'ambiente del
 * container (scripts/appliance-integrate-fix.sh le scrive nel compose),
 * getNetServicesState ripiega su di loro e il modulo resta attivo: in quel
 * caso la conferma non può promettere che la voce sparisce. Presidiata da
 * src/lib/network-services/__tests__/uninstall-env.test.ts.
 *
 * @param envFallback le due variabili sono impostate (stato `envFallback` di
 *   GET /api/network-services/setup)
 */
export function netServicesUninstallConfirmText(envFallback: boolean): string {
  if (!envFallback) {
    return (
      "Disinstallare Network Services? La voce sparisce dal menu e si cancellano URL e token del bridge: " +
      `per riattivarlo vanno reinseriti. ${NET_SERVICES_BRIDGE_INTATTO}`
    );
  }
  return (
    "Disinstallare Network Services? Si cancellano URL e token del bridge salvati qui, ma il modulo resta attivo: " +
    `${NET_SERVICES_ENV_VARS} sono impostate nell'ambiente del container e lo tengono acceso con il bridge indicato lì. ` +
    `Per spegnerlo vanno tolte dall'ambiente. ${NET_SERVICES_BRIDGE_INTATTO}`
  );
}

/**
 * Nota al posto di «Disinstalla» quando il bridge viene solo dalle variabili
 * d'ambiente (stato `source: "env"`): la disinstallazione da DA-IPAM non
 * cambierebbe niente.
 */
export const NET_SERVICES_ENV_NOTE =
  `Configurato dalle variabili d'ambiente ${NET_SERVICES_ENV_VARS} del container: da qui non si disinstalla. ` +
  "Per spegnerlo vanno tolte dall'ambiente.";
