/**
 * Cosa mostra la scheda di un'integrazione a container (LibreNMS, Graylog,
 * Loki) secondo modalità e stato. Pura, senza import lato server: la usa il
 * componente client e la provano i test.
 */
import type { ContainerIntegrationComponent, IntegrationMode } from "./types";

export interface StatoScheda {
  /** Sulla macchina c'è il LibreNMS messo in Docker dall'installatore dell'appliance. */
  dallAppliance: boolean;
  dockerAvailable: boolean;
  managed: boolean;
  installing: boolean;
  containerRunning: boolean;
}

export interface VistaScheda {
  /** Nome della modalità «external» nella tendina. */
  etichettaEsterna: string;
  /** Etichetta in testa alla scheda quando la modalità è «external». */
  badgeEsterno: string;
  dockerLocaleSelezionabile: boolean;
  /** Perché «Docker locale» non si può scegliere ("" se si può). */
  notaDockerLocale: string;
  mostraInstalla: boolean;
}

export function vistaScheda(s: StatoScheda): VistaScheda {
  const notaDockerLocale = s.dallAppliance
    ? " (c'è già)"
    : !s.dockerAvailable
      ? " (Docker non disponibile)"
      : "";
  return {
    etichettaEsterna: s.dallAppliance ? "Installato dall'appliance" : "Istanza esterna",
    badgeEsterno: s.dallAppliance ? "Installato dall'appliance" : "Esterno",
    dockerLocaleSelezionabile: notaDockerLocale === "",
    notaDockerLocale,
    mostraInstalla:
      s.managed && s.dockerAvailable && !s.installing && !s.containerRunning && !s.dallAppliance,
  };
}

/** Nome del modo `appliance` in tendina e in testa alla scheda. */
export const ETICHETTA_APPLIANCE = "Installato dall'appliance";

/** Una voce della tendina «Modalità». */
export interface VoceModalita {
  value: IntegrationMode;
  label: string;
  disabled: boolean;
}

/**
 * Le voci della tendina «Modalità» (passo 5 del piano di solidità, 16/10).
 * LibreNMS è solo locale: al posto di «Istanza esterna» c'è «Installato
 * dall'appliance». La voce esterna ricompare solo se la configurazione salvata è
 * già `external`, per leggerla com'è: niente migrazione automatica, la si
 * converte col pulsante apposito. Graylog e Loki restano come prima.
 */
export function vociModalita(
  component: ContainerIntegrationComponent,
  modoSalvato: IntegrationMode | null | undefined,
  vista: VistaScheda,
): VoceModalita[] {
  const voci: VoceModalita[] = [
    { value: "disabled", label: "Disabilitato", disabled: false },
    {
      value: "managed",
      label: `Docker locale${vista.notaDockerLocale}`,
      disabled: !vista.dockerLocaleSelezionabile,
    },
  ];
  if (component !== "librenms") {
    voci.push({ value: "external", label: vista.etichettaEsterna, disabled: false });
    return voci;
  }
  voci.push({ value: "appliance", label: ETICHETTA_APPLIANCE, disabled: false });
  if (modoSalvato === "external") {
    voci.push({ value: "external", label: "Istanza esterna (da convertire)", disabled: false });
  }
  return voci;
}

/** La scheda propone «Converti»: solo LibreNMS salvato come `external`. */
export function mostraConversione(
  component: ContainerIntegrationComponent,
  modoSalvato: IntegrationMode | null | undefined,
): boolean {
  return component === "librenms" && modoSalvato === "external";
}
