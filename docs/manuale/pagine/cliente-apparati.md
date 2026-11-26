---
percorso: /cliente/apparati
titolo: Apparati — vista cliente
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Elenca gli **apparati del cliente divisi per tipo**: computer, server, macchine virtuali, apparati di rete, stampanti,
telefoni, cellulari e tablet, telecamere. Per ogni apparato si vede la scheda; per gli switch, le porte. È una pagina
della [vista cliente](pagine/cliente.md), in sola lettura; la vedono gli utenti con il ruolo Cliente e gli
amministratori. Si apre dal riquadro **Apparati** della pagina iniziale o dai collegamenti **Apparati →** dei grafici.

![La pagina Apparati della vista cliente, tipo Rete](/manuale/cliente-apparati/pagina.png)

## Le voci della pagina

In alto, **← La tua rete** torna alla [pagina iniziale](pagine/cliente.md).

**Per tipo** (a sinistra), con il totale degli apparati: Computer, Server, Macchine virtuali, Rete, Stampanti, Telefoni,
Cellulari e tablet, Telecamere e altro, Non riconosciuti. Accanto a ogni tipo, quanti sono; compaiono solo i tipi che
hanno almeno un apparato. Un clic sceglie il tipo; quello scelto ha il fondo azzurro.

**Al centro**, l'elenco degli apparati del tipo scelto («Rete · 40 apparati»): nome, tipo e produttore, indirizzo. Il
segno a sinistra dice se è acceso. Un clic su una riga apre il dettaglio.

**A destra**, il dettaglio dell'apparato scelto:

- per uno **switch** o un altro apparato con le porte lette: il pannello delle **porte**, con quali sono usate e da
  cosa; un clic su una porta mostra cosa c'è collegato;
- per gli altri: la **scheda** dell'apparato (nome, indirizzo, produttore, sistema operativo, quando è stato visto).

Finché non si sceglie niente, il riquadro dice «Scegli un apparato per vedere i dettagli».

## Come si usa

1. Scegli il tipo a sinistra (per esempio **Stampanti**).
2. Clicca l'apparato nell'elenco al centro.
3. Leggi la scheda o le porte a destra.

## Da dove arrivano i dati

Dalle scansioni delle reti e dalle letture degli apparati di DA-IPAM (SNMP per le porte degli switch). Il tipo viene
dalla classificazione di DA-IPAM: quelli che non è riuscita a classificare stanno in **Non riconosciuti**.

## Se la pagina è vuota

Se l'elenco dei tipi è vuoto, per questo cliente non è ancora stato trovato nessun apparato: serve almeno una rete
scansionata.
