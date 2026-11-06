# Riconoscere gli apparati da ciò che già sappiamo

Livello **completo** (migrazioni additive su due lati, scrive nell'inventario dei clienti). Autorizzato da Riccardo il 06/11:
«sì, procedi». Rilievi di partenza: `TASKS.md`, 06/11. Stessa voce in `DA-Vul-can/TASKS.md`.

Caso guida: 192.168.0.52 e .53 del 72729, due Cisco SG200-26 firmware 1.3.2.02 con SNMP spento, `unknown` in DA-IPAM.

| # | Passo | Dove | Stato | Verifica |
|---|---|---|---|---|
| 1 | Il sensore conserva piattaforma, versione, capacità e MAC del telaio di CDP e LLDP | DA-Vul-can `sensore/` | [x] | prova vista fallire + frame vero del 72729 |
| 2 | `trunk_vicini` riceve i campi e il legame con l'host | DA-IPAM `trunk/` | [x] | prova su DB |
| 3 | Modello e firmware riempiti (mai sovrascritti), categoria dall'attribuzione | DA-IPAM `trunk/`, `attribution/` | [x] | prova + golden |
| 4 | Descrizione LLDP letta via SNMP, vicini SNMP nell'attribuzione dietro un interruttore spento | DA-IPAM | [x] | freno T2 ancora verde + prova a interruttore acceso |
| 5 | `-O`: niente ipotesi sotto il 95%, categoria dal testo di nmap | DA-IPAM `scanner/` | [x] | prova |
| 6 | Profilo `riconoscimento` automatico sugli `unknown`, spento di serie | DA-IPAM `scanner/profili/` | [x] | prova sulla scelta degli host |
| 7 | Cancelli e prova sul dato vero | tutti | [x] | copia del DB del 72729: 0 differenze sui 138 host, cambiano solo .52 e .53 |

## Scelte

- **ADR 0018 resta valido**: una lettura in più non cambia le classificazioni da sola. I vicini `snmp` entrano solo con
  `riconoscimento.vicini_snmp` acceso per cliente. CDP e LLDP sentiti dal sensore non passano da `device_neighbors`, quindi
  non toccano quel freno.
- **Si riempie, non si sovrascrive**, come `scanner/profili/salva.ts`.
- **Host dal vicino**: per IP di gestione, poi per MAC del telaio; due host possibili vuol dire nessun legame. Non si usa il
  VID del frame: il CDP passa nella nativa, l'IP di gestione può stare in un'altra VLAN.
- **Capacità non autoritativa**: un Linux con `lldpd` annuncia bridge e router (nodi Proxmox, T2-b). Se la descrizione dice
  un sistema operativo, le capacità non danno categoria.
- **Il profilo automatico nasce spento** (standard: automatismi nuovi spenti; 05/11 Riccardo ha fermato i job di scansione del
  72729). Salta 9100 e stampanti (incidente del 05/11) e gli apparati OT: `-O` manda pacchetti malformati, su un PLC vecchio è
  la parte che può fare danno, come dice già il profilo IoT/OT.

## Consuntivo

**Fatto**: i sette passi, più i sette rilievi della revisione indipendente. DA-IPAM 0.9.985, Vulcan 0.8.257 live (snapshot `pre-rilascio-08257-20261106` della VM 664 su DA-PX-03). Sul 72729 vero .52 e .53 sono `switch` con modello e firmware, `unknown` da 50 a 48.

**Mancante**: 71343-ipam e 79993-ipam-9 restano a 0.8.256 (accesso negato, scansioni non verificabili). Le due levette spente: decisione di Riccardo. Gli altri 48 `unknown` del 72729: il CDP non li copre e `-O` salta i 19 Microchip.

**Scostamenti**: il punto 3 dietro una levetta per non scavalcare ADR 0018; la soglia del 95% è diventata un segno nel testo dopo la revisione; `verifica-permessi.sh` non eseguita, nessuna rotta toccata.

**Consigli**: la build va fatta prima di dire «cancello verde»: qui è arrivata solo al momento di `main`. La firma web degli Sx200/300 copre gli switch senza CDP.
