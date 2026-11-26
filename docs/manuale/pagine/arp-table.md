---
percorso: /arp-table
titolo: Tabella ARP — quale MAC ha quale indirizzo
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

È la **tabella cumulativa MAC ↔ indirizzo IP** di tutte le reti: per ogni scheda di rete (MAC) dice quale indirizzo
ha, in quale rete, con che nome e da quale fonte lo si sa. Si aggiorna da sola quando un MAC cambia indirizzo e si
ricorda l'indirizzo di prima. Serve per trovare un apparato partendo dal MAC (scritto sull'etichetta o letto dallo
switch) o per capire chi aveva un indirizzo ieri.

Si arriva da **Network › Topologia**, scheda **Tabella ARP** in cima (le altre schede: [Mappa](pagine/topology.md),
[Tavola di cablaggio](pagine/topology-tavola.md), [Porte](pagine/port-map.md),
[Dati della mappa](pagine/topology-dati.md)). Menu, schede e tabelle funzionano come in tutte le pagine: vedi le
[parti comuni dell'interfaccia](../INTERFACCIA.md).

## La barra in cima

![La barra della tabella ARP](/manuale/arp-table/barra.png)

1. `icona:search` **Cerca MAC, IP o hostname…**: filtra mentre scrivi (bastano le ultime cifre del MAC).
2. **Tutte le reti**: mostra una rete sola.
3. **Sorgente**: mostra solo le righe che vengono da una fonte: **ARP** (la tabella del router), **DHCP** (i lease
   del server DHCP), **Host** (le scansioni), **Switch** (le tabelle degli switch). **Tutte** le rimette insieme.
4. `tasto:radio-tower` **Forza poll router**: chiede subito ai router, via SSH o SNMP, la loro tabella ARP e i lease
   DHCP, rete per rete (solo la rete scelta in 2, se ce n'è una). È più lento del semplice aggiornamento; alla fine un
   messaggio dice su quante reti è riuscito. Il pulsante si vede anche in sola lettura, ma la lettura la avvia solo un
   **amministratore**.
5. **VLAN dal trunk**: apre le VLAN e i MAC visti dalla sonda sulla porta trunk
   ([VLAN e indirizzi](pagine/arp-table-trunk.md), sotto **Sicurezza › Rete**).
6. `tasto:refresh` **Ricarica**: rilegge l'elenco da quello che DA-IPAM ha già in memoria, senza interrogare i router.

## La tabella

![La tabella ARP](/manuale/arp-table/tabella.png)

Nella schermata la colonna Hostname è sfocata.

1. **Sorgente**: l'etichetta della fonte di quella riga.
2. **Ultimo visto**: da quanto tempo. All'apertura la tabella è ordinata da qui, i più recenti in cima.
3. **IP precedente**: l'indirizzo che aveva prima, se è cambiato.

| Colonna | Che cosa dice |
|---|---|
| **MAC** | L'indirizzo della scheda di rete. |
| **IP** | L'indirizzo attuale. Passa il mouse per il pulsante che lo copia. |
| **Sorgente** | ARP, DHCP, Host o Switch. |
| **Rete** | La subnet. |
| **Hostname** | Il nome, se lo si conosce. |
| **Vendor** | Il produttore ricavato dal MAC. |
| **Ultimo visto** | Da quanto tempo. |
| **IP precedente** | L'indirizzo di prima, se è cambiato. |

Ogni intestazione con `icona:arrow-up-down` ordina con un clic. La pagina mostra al massimo **500 righe**: se sono di
più compare l'avviso «Sono mostrati i primi 500 risultati» e si restringe con la ricerca o i filtri.

## Come si fa

- **Hai un MAC e cerchi l'apparato**: scrivilo in **Cerca** (bastano le ultime cifre), leggi IP e rete, poi cerca
  l'indirizzo fra gli [Apparati](pagine/discovery.md).
- **Chi usava un indirizzo ieri?**: scrivi l'indirizzo e guarda anche la colonna **IP precedente**.
- **Vedere solo quello che dà il DHCP di una rete**: **Tutte le reti** › la rete, **Sorgente** › DHCP.
- **La tabella sembra vecchia**: un amministratore preme `tasto:radio-tower` **Forza poll router**, poi
  `tasto:refresh`.
- **Trovare su quale porta dello switch sta quel MAC**: cercalo nella [Mappa porte](pagine/port-map.md).

## Da dove arrivano i dati

Dalle tabelle ARP dei router (il router della rete si indica nella [pagina della subnet](pagine/networks-id.md)), dai
lease dei server DHCP, dalle scansioni degli host e dalle tabelle degli switch.

## Se la pagina è vuota

«Nessun mapping trovato»: le reti non hanno ancora un router ARP o non c'è stata una scansione. Indica il router in
**Modifica** nella pagina della subnet e premi **Forza poll router**.
