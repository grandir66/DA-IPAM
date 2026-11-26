---
percorso: /arp-table
titolo: Tabella ARP — quale MAC ha quale indirizzo
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

È la **tabella cumulativa MAC ↔ indirizzo IP** di tutte le reti: per ogni scheda di rete (MAC) dice quale indirizzo
ha, in quale rete, con che nome e da quale fonte lo si sa. Si aggiorna da sola quando un MAC cambia indirizzo e si
ricorda l'indirizzo di prima. Serve per trovare un apparato partendo dal MAC (scritto sull'etichetta o letto dallo
switch) o per capire chi aveva un indirizzo ieri. Si arriva da **Network › Topologia**, scheda **Tabella ARP** in cima.

![La tabella ARP](/manuale/arp-table/pagina.png)

## Le voci della pagina

1. **Cerca MAC, IP o hostname…**: filtra mentre scrivi.
2. **Tutte le reti**: mostra una rete sola.
3. **Sorgente**: mostra solo le righe che vengono da una fonte: **ARP** (la tabella del router), **DHCP** (i lease
   del server DHCP), **Host** (le scansioni), **Switch** (le tabelle degli switch). **Tutte** le rimette insieme.
4. **Forza poll router**: chiede subito ai router, via SSH o SNMP, la loro tabella ARP e i lease DHCP. È più lento del
   semplice aggiornamento; lo fa chi ha il ruolo di amministratore.
5. **VLAN dal trunk**: apre le VLAN e i MAC visti dalla sonda sulla porta trunk, nella sezione **Rete** del menu
   Sicurezza.
6. **Sorgente**, nella tabella: l'etichetta della fonte di quella riga.

Le due frecce in cerchio a destra **ricaricano** l'elenco dalla memoria, senza interrogare i router.

Le colonne: **MAC**, **IP**, **Sorgente**, **Rete**, **Hostname**, **Vendor** (il produttore ricavato dal MAC),
**Ultimo visto** (da quanto tempo), e in fondo l'**IP precedente**, se l'indirizzo è cambiato. Passando il mouse su
un indirizzo compare il pulsante per copiarlo. Un clic sull'intestazione di una colonna con le frecce la ordina.

La pagina mostra al massimo **500 righe**: se sono di più compare l'avviso «Sono mostrati i primi 500 risultati» e si
restringe con la ricerca o i filtri.

## Come si usa

1. Hai un MAC e cerchi l'apparato: scrivilo in **Cerca** (bastano le ultime cifre).
2. Cerchi chi usava un indirizzo: scrivi l'indirizzo e guarda anche la colonna dell'IP precedente.
3. Se la tabella non è aggiornata, chiedi all'amministratore di premere **Forza poll router**.

## Da dove arrivano i dati

Dalle tabelle ARP dei router (il router della rete si indica nella [pagina della subnet](pagine/networks-id.md)), dai
lease dei server DHCP, dalle scansioni degli host e dalle tabelle degli switch.

## Se la pagina è vuota

«Nessun mapping trovato»: le reti non hanno ancora un router ARP o non c'è stata una scansione. Indica il router in
**Modifica** nella pagina della subnet e premi **Forza poll router**.
