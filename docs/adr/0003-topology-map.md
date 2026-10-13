# ADR 0003 — Mappa topologia interattiva con stato

**Stato:** Accepted
**Data:** 2026-10-12
**Autore:** riccardo.grandi@domarc.it

> La pagina e la disposizione sono superate dalla fase 2 (ADR 0009).

> La disposizione con dagre è superata dalla spec v2 del 13/10; il modello dei dati dall'ADR 0008.

## Contesto

Serve una mappa di rete **fisica + logica** per tenant, con icone per tipo di
apparato, **nodi trascinabili con posizione salvata** e **stato a semaforo**
(OK/Warning/Fail/sconosciuto) dal monitoraggio. Nasce da un'esigenza cliente (DTS)
ma deve essere **generale e multi-tenant**. I dati esistono già in DA-IPAM
(`network_devices`, `hosts`, `device_neighbors`, `switch_ports`, LibreNMS); mancava
solo la vista. Vincoli: additivo/non distruttivo (principio ROADMAP), stack fisso
(Next 16 / React 19 / better-sqlite3), nessuna libreria di diagrammi già presente.

## Decisione

Una **vista `/topology`** con **React Flow (`@xyflow/react`) + dagre** per
l'auto-layout, logica pura testata in `src/lib/topology/` (match, stato, grafo,
layout), una **tabella tenant `topology_position`** per le posizioni e due route
(`GET /api/topology`, `PUT /api/topology/positions`). Lo **stato a 4 livelli** è
derivato da dati già presenti (`hosts.status`/`last_response_time_ms`, LibreNMS
`last_status`, `anomaly_events.severity`, porte uplink down). React Flow è stato
scelto perché nativo React, con drag, posizioni persistibili e nodi custom
(icona + colore stato), adatto alle dimensioni di topologia per-vista.

## Alternative scartate

- **Generatore drawio statico (companion esterno)** — scartato: non può tenere in
  memoria le posizioni né mostrare lo stato live; resta come **export** (Fase 2).
- **Cytoscape.js** — scartato per l'MVP: motore potente ma meno "React-native",
  nodi custom più laboriosi; valutabile se le topologie crescono molto.
- **CMDB esterno tipo NetBox** — scartato: sistema in più da installare/mantenere,
  mentre la fonte di verità è già DA-IPAM.

## Conseguenze

### Positive

- Mappa viva e mantenibile dentro il prodotto, per tutti i tenant.
- Riuso totale dell'inventario e del monitoraggio esistenti; nessuna scrittura sugli apparati.
- Logica pura testabile (TDD) separata dalla UI e dal DB.

### Negative

- Due dipendenze nuove (`@xyflow/react`, `dagre`) nel bundle client.
- Lo stato dipende dalla copertura del monitoraggio: dove manca (no LibreNMS,
  host mai sondato) i nodi restano "sconosciuti".

### Cosa diventa difficile in futuro

- Cambiare libreria di rendering comporterebbe riscrivere la pagina client e il nodo custom.
- La tabella `topology_position` lega le posizioni all'`id` logico del nodo
  (`dev:<id>`/`host:<id>`): rinumerazioni massive di device/host invaliderebbero i layout salvati.

## Riferimenti

- Spec: `docs/superpowers/specs/2026-10-12-topology-map-design.md`
- Piano: `docs/superpowers/plans/2026-10-12-topology-map.md`
- Collector API controller UniFi multi-backend + export drawio: Fase 2 (piano separato)
