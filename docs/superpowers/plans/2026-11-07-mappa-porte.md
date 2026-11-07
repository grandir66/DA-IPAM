# Mappa porte (switch port mapper) — piano

**Livello: completo** (migrazione additiva sui DB delle appliance; il rischio vero è una posizione falsa).
Approvato da Riccardo il 07/11/2026 («Sì, procedi»). Misure, trappole e fonti: `TASKS.md`, sezione del 07/11.
`attach.ts` e la mappa non si toccano. Il 72729 non si tocca. `main` solo col sì di Riccardo.

Decisioni: voce «Mappa porte» sotto Topologia, rotta `/port-map`; schede «Oggetti» e «Porte»; spostamenti 90 giorni;
correzione a mano e colonna in Discovery rimandate; correzione del PoE sovrascritto proposta, non applicata.

## La regola in breve

1. Le porte si uniscono per indice; i membri di un LAG si piegano sull'aggregato.
2. Passaggio: LLDP/CDP verso un apparato di rete, oppure vede il MAC di un altro apparato di rete, oppure uplink del controller.
   Mai `is_trunk`, tagged o spanning tree.
3. Il controller vince; poi l'unica porta di bordo. Fra porte di passaggio non si sceglie: «non so» col ramo.
4. Confidenza: certa (controller o MAC da solo), spiegata (hypervisor, telefono + PC), da capire (condivisa senza motivo, due porte), non so.

## Passi

| # | Passo | Stato | Verifica |
|---|---|---|---|
| 1 | ProMax «Port1» e PoE: causa | [x] | DA-IPAM e LibreNMS vedono i MAC del LAG 49-50 sulla porta FDB 1, il controller un client solo: difetto dell'agente. PoE: `upsertSwitchPorts` del giro SNMP riscrive null ogni 30 minuti |
| 2 | Modulo puro `src/lib/mappa-porte/` con prove | [x] | 31 prove; 7 mutazioni delle regole chiave, ognuna fa cadere almeno una prova |
| 3 | Tabelle additive, calcolo in transazione | [x] | `calcolo.test.ts`: migrazione idempotente, spostamento in due calcoli, tabelle vuote non cancellano la mappa |
| 4 | Job ogni 30 minuti da `server.ts` | [x] | Riga in Schedulazioni: la prova di completezza l'ha pretesa |
| 5 | API `GET /api/port-map` | [x] | Provata dalla pagina coi dati dell'hub |
| 6 | Pagina e voce di menu | [x] | Vista resa a 1280 e 1920 coi dati dell'hub, in locale |
| 7 | Cancello, resa a 1280 e 1920, release su `dev`, confronto col controller sull'hub | [~] | Cancello verde (esito 0, 7515 prove). Confronto sui dati dell'hub, in locale: 48 giuste, 1 stesso apparato su due porte, 7 «non so» |
| 8 | Consuntivo, `TASKS.md`, `CONTEXT.md`, `CHANGELOG.md`, `docs/scheda-mappa.md` | [ ] | |

## Consuntivo

(a fine lavoro)
