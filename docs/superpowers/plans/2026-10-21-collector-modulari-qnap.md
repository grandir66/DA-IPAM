# Collector QNAP — piano di esecuzione

Esecuzione in linea, approvata da Riccardo il 21/10/2026.

**Obiettivo:** collector read-only QSS riusabile da CLI e DA-IPAM.
**Architettura:** core indipendente in src/lib/acquisition, trasporti iniettati e parser puri. Adapter senza persistenza.
**Spec:** ../specs/2026-10-21-collector-modulari-qnap-design.md
**Livello di controllo:** completo.

## Vincoli globali
Niente push/deploy, nessuna scrittura apparati/DB; credenziali solo fuori repo. Node22, sessioni SNMP centralizzate. Nessun fallback errore→lista vuota autorevole.

## Task
- [x] 1. Identificazione e contratto: schema.ts, parsers.ts e __tests__; snapshot versionato validato con Zod e parseIfTable(rows). Fixture delle risposte, Counter64, bitmap e identity; test deve fallire prima dell’implementazione.
- [x] 2. Trasporti e collector: transports.ts, qnap-switch.ts, index.ts; collectDevice(input, transports?) restituisce Promise<AcquisitionSnapshot>. Timeout, limiti, shell SSH e sezioni indipendenti; test errori e paginazione con trasporti finti.
- [x] 3. CLI e adapter: scripts/acquire-device.ts e adapter.ts; acquireForIpam(input) restituisce snapshot+DeviceInfo senza DB. Input locale protetto, exit code documentati; fixture CLI e raccolta reale confrontata.
- [ ] 4. Verifica e consegna: test mirati, lint, typecheck, build richiesta dal repo; manuale, CHANGELOG, CONTEXT e TASKS con risultati e limiti reali. Commit locali selettivi, nessun rilascio o push.

## Casi da non dimenticare
Porta SSH rifiuta exec (T2); SNMP tabella vuota vs timeout (T2); contatori oltre 2^53 e ifSpeed saturo (T1); VLAN usa bridgePort non ifIndex (T1); errori contenenti credenziali (T2/T3).
