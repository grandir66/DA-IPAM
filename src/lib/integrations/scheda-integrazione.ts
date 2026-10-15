/**
 * Cosa mostra la scheda di un'integrazione a container (LibreNMS, Graylog,
 * Loki) secondo modalità e stato. Pura, senza import lato server: la usa il
 * componente client e la provano i test.
 */
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
    ? " (c'è già LibreNMS dell'appliance)"
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
