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
