# ADR 0024 — Collector versionati utilizzabili senza database

Data: 2026-10-21. Stato: accettato da Riccardo per sviluppo e collaudo locali;
integrazione automatica e rilascio esclusi dalla tappa.

## Contesto

Servono collector specifici per famiglia, verificabili su un apparato da terminale
e riutilizzabili da DA-IPAM. QNAP switch non deve passare dai comandi per NAS QTS.

## Decisione

Core TypeScript in `src/lib/acquisition`, schema Zod versionato, registry statico,
parser puri e trasporti iniettati. Primo profilo qnap-switch. CLI con credenziali da
file privato esterno; adapter esplicito che restituisce DeviceInfo e snapshot,
nessuna scrittura DB. Riusare le sessioni SNMP e il trasporto SSH esistenti.
Risultato per sezione, fonti, limiti e fallimenti espliciti; nessun comando libero,
nessuna nuova pianificazione. Non installare un servizio o un agent separato.

## Alternative

Servizio HTTP indipendente: richiede gestione auth, distribuzione e disponibilità
senza necessità attuale. Estendere solo device-info.ts: impedisce il collaudo CLI
isolato e mantiene la confusione switch/NAS. Entrambe rinviate.

## Cosa diventa difficile in futuro

Il contratto JSON è un'interfaccia pubblica: cambi semantici richiedono versione e
adapter, non rinomina silenziosa. Un trasporto standalone completamente separato
richiederà packaging delle dipendenze del clone; oggi la CLI richiede Node22 e le
dipendenze DA-IPAM. L'integrazione persistente dovrà rispettare credenziali, lucchetti,
anti-lockout e logica di classificazione esistenti: il collector non li sostituisce.

## Verifica

Spec e piano `docs/superpowers/{specs,plans}/2026-10-21-collector-modulari-qnap*`;
manuale `docs/modules/acquisition.md`, test in `src/lib/acquisition/__tests__/`.
