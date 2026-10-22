# ADR 0027 — Bridge, porte e bond della scheda MikroTik in tabelle proprie

**Stato:** Accepted
**Data:** 2026-10-21
**Autore:** Riccardo Grandi, con Claude

## Contesto

La scheda di un router MikroTik deve mostrare, come la pagina del Manager, gli attributi di bridge, porte dei bridge e
bond (VLAN filtering, PVID, priorità, offload in hardware, slave, politica di hash…). Piano
`plans/2026-10-21-scheda-mikrotik-dal-manager.md`, Task 8 (P3). La lettura della topologia (`topologia.lettura.mikrotik`,
ADR 0018) riceve già le uscite di `/interface bridge print`, `/interface bridge port print` e `/interface bonding print`
(MK3, MK4, MK8), ma ne tiene solo quello che serve alla mappa, in `topology_bridge_facts` e `topology_port_facts`.

## Decisione

1. **Tre tabelle della scheda**, `mikrotik_bridge`, `mikrotik_bridge_port`, `mikrotik_bond`, chiave `(device_id, nome)`,
   separate dalle `topology_*`: la mappa legge solo `topology_*`, la scheda solo `mikrotik_*`. Nessun comando nuovo sul
   router: `leggiMikrotikTopologia` passa le uscite lette davvero (`RisultatoMk.uscite`) e `letturaMikrotik` le rilegge coi
   lettori della scheda (`mikrotik-scheda.ts`).
2. **Fotografia per apparato, non storia**: per ogni parte letta si cancellano le righe dell'apparato e si scrivono quelle
   nuove con lo stesso `seen_at`, in una transazione per le tre tabelle. Una parte non letta (errore, «non so», uscita che
   il lettore non capisce) non tocca la sua tabella: restano le righe dell'ultima lettura buona, con la loro età. Così i
   contatori della scheda contano solo l'ultima lettura.
3. **Solo i router** (ramo dei router del giro ARP); il ramo degli switch MikroTik non scrive queste tabelle.
4. **Schema livello 2** della migrazione `scheda_mikrotik_v21` (segno `done:<data>:v2`): le CREATE stanno solo nella
   migrazione, non in `TENANT_SCHEMA_SQL`, perché lo schema gira prima e le creerebbe fuori dalla transazione e senza
   riga nel journal. Chi scrive chiede `livelloSchemaSchedaMk() >= 2`; sotto, non scrive niente. Esportazione e
   importazione le trattano come storico (`table-registry.ts`).

## Alternativa scartata

**Colonne in più su `topology_bridge_facts` / `topology_port_facts`**: una tabella sola, ma quelle tengono la storia per
lettore (potata a 90 giorni) e una riga per porta con la chiave della mappa; la scheda vuole l'ultima fotografia con i
valori com'è scritti da RouterOS, e ogni colonna nuova lì peserebbe sulle letture della mappa.

## Cosa diventa difficile in futuro

- **Due copie di parte degli stessi fatti** (nome del bridge, PVID, membri del bond, porta inattiva): se una delle due
  scritture fallisce, le due copie hanno età diverse e possono dire cose diverse finché il giro dopo non riesce.
- Le tabelle si riempiono solo con la lettura della topologia accesa: su un cliente che la tiene spenta la scheda non ha
  bridge (e le tab VLAN e Bridge non compaiono).
- Un campo nuovo di RouterOS che la scheda vuole mostrare chiede una colonna nuova (un livello nuovo della migrazione),
  non solo un lettore.

## Aggiunta del 2026-10-22: lettura «VLAN, DNS e utenti dei MikroTik» (Task 10, P4)

La matrice VLAN completa, le VLAN con la loro interfaccia madre, il DNS e gli utenti del router chiedono **comandi nuovi**
(zona rossa: sui router dei clienti), che la lettura della topologia non manda.

1. **Una lettura in più propria**, `mikrotik_scheda` (interruttore `topologia.lettura.mikrotik_scheda`, schema di ADR 0018):
   **nasce spenta** su ogni cliente, si accende dalla card «Letture in più» di «Dati della mappa» (solo admin), al più una
   volta l'ora per apparato (`conCadenza`), esito per apparato con numeri e codici. Spenta, il giro manda esattamente i
   comandi di prima (prova con la spia sull'esecutore).
2. **Quattro comandi in sola lettura** su una connessione sua (`COMANDI_MK_SCHEDA`): `/interface bridge vlan print terse`,
   `/interface vlan print terse`, `/ip dns print`, `/user print terse` (la forma `terse` al posto della tabella: commenti e
   ore con lo spazio rompono le colonne). Solo nel ramo dei router. Tre esiti per comando come la topologia: un'uscita non
   capita o un tempo scaduto danno null, mai una lista vuota.
3. **Livello 3 dello schema** (`done:<data>:v3`): `mikrotik_bridge_vlan` (chiave `(device_id, pos)`, `pos` = ordine di
   lettura: le righe non hanno un nome), `mikrotik_vlan`, `mikrotik_dns` (una riga per apparato), `mikrotik_user`; stessa
   fotografia per tabella del punto 2. Schema sotto il 3 → la lettura dà errore `SCHEMA_SCHEDA` senza aprire la connessione.
4. **Gli utenti del router sono un dato riservato**: nessuna password (RouterOS non la mostra e il lettore legge solo nome,
   gruppo, indirizzi, ultimo accesso, commento); la scheda per tutti (`GET …/mikrotik-scheda`) non li porta, li dà solo
   `GET /api/devices/[id]/mikrotik-utenti` con `requireAdmin()`; nei log e nei resoconti solo numeri e codici.

Cosa diventa difficile: una seconda connessione SSH per router quando topologia e scheda sono accese insieme (6 + 4
comandi, due esiti separati); una tabella senza righe non distingue «mai letta» da «letta e vuota»: la rotta lo decide
dall'esito dell'ultima lettura (completa → vuoto vero).
