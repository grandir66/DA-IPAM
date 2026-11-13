/**
 * I riquadri della pagina DATIA MONITORING (Riccardo, 13/11/2026: «la dashboard dovrebbe essere organizzabile
 * con possibilità di nascondere/visualizzare oggetti; servirebbero anche KPI con grafici statistici»).
 *
 * Stesso meccanismo della casa (`casa.ts`): una libreria, una disposizione per cliente in `tenant_settings`,
 * composta dall'amministratore; il cliente la vede in sola lettura. Un riquadro nuovo si aggiunge qui e compare
 * da solo fra quelli disponibili. Le tabelle per famiglia stanno sotto la griglia, sempre: sono l'elenco.
 */
import type { RiquadroCasa } from "./casa";

export const CHIAVE_MONITORING = "cliente.monitoring";

export const RIQUADRI_MONITORING: readonly RiquadroCasa[] = [
  { id: "fascia", titolo: "Stato in una frase", cosa: "Quanti apparati sono fermi o da tenere d'occhio, e l'ora dell'ultima lettura", l: 12, a: 1, inTesta: true },
  { id: "kpi-disponibilita", titolo: "Disponibilità 30 giorni", cosa: "Percentuale di tempo senza fermi, col mese prima", l: 3, a: 1 },
  { id: "kpi-incidenti", titolo: "Incidenti 30 giorni", cosa: "Problemi da «Media» in su aperti nel mese, col mese prima", l: 3, a: 1 },
  { id: "kpi-soluzione", titolo: "Tempo di soluzione", cosa: "Entro quanto si chiude metà dei problemi del mese, col mese prima", l: 3, a: 1 },
  { id: "kpi-scadenza", titolo: "Prima scadenza", cosa: "Il certificato che scade per primo", l: 3, a: 1 },
  { id: "famiglie", titolo: "Famiglie", cosa: "Un riquadro per famiglia di apparati, con le sue misure", l: 12, a: 2 },
  { id: "grafico-disponibilita", titolo: "Disponibilità per giorno", cosa: "Gli ultimi 30 giorni, in percentuale", l: 6, a: 3 },
  { id: "grafico-incidenti", titolo: "Incidenti per settimana", cosa: "Le ultime 4 settimane, gravi e medi", l: 6, a: 3 },
  { id: "stati", titolo: "Apparati per stato", cosa: "Quanti funzionano, quanti da tenere d'occhio, quanti fermi", l: 4, a: 2 },
  { id: "spazio", titolo: "Spazio più pieno", cosa: "I dischi e i volumi più pieni", l: 4, a: 3 },
  { id: "problemi", titolo: "Problemi aperti", cosa: "Quelli che contano, con chi ci sta lavorando", l: 8, a: 4 },
  { id: "storico", titolo: "Ultimi 30 giorni per famiglia", cosa: "Un segmento per giorno: chiaro senza fermi, scuro con un fermo", l: 12, a: 3 },
];
