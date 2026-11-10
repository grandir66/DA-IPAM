# Scansioni: opzioni per modalità (comandi per Cursor) — 10/11/2026

Da Nety: ogni modalità di giro ha le sue opzioni. In DA-IPAM la UI di `/scans` ha tipo, profilo,
fasi, scelta rete, levetta «Prove invasive» (`prove_fabbrica`) e avanzamento. Mancano i **knob
per-modalità**, che sono quasi tutti **lato motore/API** (non UI). Qui l'elenco per modalità: il
motore (Cursor) li accetta nel lanciatore, poi io aggiungo i controlli UI che li mandano.

Dove: `src/lib/scanner/lancia-giro.ts` (`LancioGiro` + `lanciaGiro`), il motore del giro, e i
default per profilo in `src/lib/scanner/profili-giro-ui.ts` / `scanner/profili/`. Rotta
`/api/scans/lancia` passa già il corpo a `lanciaGiro`. Regole: validare i range, errore chiaro
fuori range, i giri automatici e lo schedulatore restano sui default del profilo, freno porte di
campo/stampa sempre attivo, niente PII nei log.

## Discovery
Campi per-giro (oggi vengono dal profilo):
- `targets` (CIDR/indirizzi separati da spazio/virgola) e `exclusions`; `auto_targets` (bool):
  se true aggiunge i prefissi della rete scelta (comportamento attuale con `network_ids`).
- `tcp_ports` ("top100" | "top1000" | "all" | "22,80,8000-8100"), `udp_ports` (idem, vuoto = niente UDP).
- `scan_mode` ("auto" | "syn" | "connect").
- `rate_pps` (intero), `timeout_ms`, `concorrenza`, `retries` (già nel handoff timeout/concorrenza).

## Segmentazione
- `source_network_id` (la VLAN da cui si manda) — oggi implicito; esplicitarlo.
- `reti_bersaglio` (lista di network_id da raggiungere) con, per la UI, il conteggio di servizi e
  host noti per rete (serve un endpoint che li dia: «N servizi · M host noti» per rete).
- **Tecniche** (tutte opzionali, di base solo la diretta; le altre sono «da auditor», spente di
  serie, da concordare col cliente — sono prove attive sulla rete del cliente):
  - protocollo/baseline: `direct` (default), `icmp_echo`, `ipv6`, `fragmented_syn`.
  - porta sorgente: `src_port` ∈ {53, 88, 123, 20, 67, 500} (una o più).
  - routing: `via_local_gateway`, `via_other_next_hop`.
  - layer-2 attivo: `l2_active` (⚠ può disturbare lo switch): spento di serie, conferma esplicita.
  Nota: queste tecniche sono codice di probing di rete; implementale tu (Cursor). Io rendo solo
  gli interruttori quando l'API li accetta, con i «da auditor» spenti e con l'avviso L2.

## Sonda L2 (passiva)
- `durata_s` (secondi di ascolto). È già passiva; esporre solo la durata.

## Solo controlli
- fasi (service detection / identity / checks) e `prove_fabbrica`: **già fatti**. Nessun nuovo knob.

## Cosa faccio io (UI) quando il motore accetta ciascun campo
Per Discovery: sezione «Targets e parametri» (targets/exclusions/auto-targets/porte/scan mode/rate)
nel profilo «Su misura». Per Segmentazione: «Reti da raggiungere» (checkbox coi conteggi) e le
Tecniche come interruttori raggruppati (baseline / porta sorgente / routing / L2), coi «da auditor»
spenti e l'avviso su L2. Per Sonda L2: campo durata. Riferimento UI: `scans-client.tsx` (v0.9.1076).
