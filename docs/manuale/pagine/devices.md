---
percorso: /devices
titolo: Dispositivi — gli apparati gestiti, tutti insieme
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

È l'elenco dei **dispositivi gestiti**: gli apparati che sono stati «resi apparato» e che DA-IPAM interroga con le
credenziali (switch, router, server, NAS, hypervisor, access point, PC). Rispetto all'elenco degli
[Apparati](pagine/discovery.md), che contiene tutto ciò che è stato visto in rete, qui ci sono solo quelli gestiti,
con il protocollo usato, le credenziali attive e l'eventuale collegamento a LibreNMS.

La pagina non ha una voce nel menu: ci si arriva dalla freccia «indietro» degli elenchi per tipo
([Switch, Router e gli altri](pagine/devices-id.md)) o scrivendo l'indirizzo `/devices`.

![La pagina Dispositivi](/manuale/devices/pagina.png)

## Le voci della pagina

1. **I tipi**: **Tutti** e un pulsante per ogni tipo presente (Server, PC, Switch, NAS / Storage, Hypervisor, Access
   Point, Router, Windows…), col numero. Un clic mostra solo quel tipo.
2. **Filtri e ricerca**: la casella **Cerca per nome, IP, vendor, profilo prodotto, classificazione…** filtra mentre
   scrivi; accanto tre menu: **Tutti gli stati** (Online, Offline, Sconosciuto), **Tutti i vendor**, **Tutti i
   profili**.
3. **Acquisizione**: la data dell'ultima lettura completa dell'apparato (inventario, porte, sistema). Vuota vuol dire
   che non è ancora stata fatta.
4. **Cred.**: le credenziali che funzionano, una etichetta per protocollo (**SNMP**, **WinRM**, **SSH**…).
5. **LibreNMS**: se l'apparato è già monitorato in LibreNMS c'è il collegamento; altrimenti il pulsante **Aggiungi**
   lo aggiunge (con SNMP se l'apparato ha una community, altrimenti solo col ping).
6. **Azioni**: la freccia apre la scheda dell'apparato ([scheda dell'oggetto](pagine/objects-id.md)), il cestino lo
   elimina dopo una conferma.

Le altre colonne: **Tipo**, **Nome**, **IP**, **Vendor**, **Profilo** (il profilo di prodotto riconosciuto, per esempio
«Client» o «Storage»), **MAC**, **Stato** (Online, Unreachable, Transient, Sconosciuto, con da quanto tempo). Un clic
sull'intestazione di una colonna con le frecce ordina l'elenco. In alto a destra **Aggiorna** rilegge l'elenco, e le
frecce accanto al numero di dispositivi sfogliano le pagine.

Aggiungere a LibreNMS ed eliminare spetta a chi ha il ruolo di amministratore.

## Come si usa

1. Per vedere solo gli switch, o solo i server, clicca il tipo in alto.
2. Per trovare un apparato scrivi nella ricerca una parte del nome o dell'indirizzo.
3. Per aprire la scheda clicca la freccia nella colonna **Azioni**.
4. Per mettere un apparato sotto monitoraggio premi **Aggiungi** nella colonna LibreNMS.

## Cosa vogliono dire i segni

- **Online** col pallino pieno, **Unreachable** (non raggiungibile), **Transient** (risponde a intermittenza),
  **Sconosciuto**: lo stato è sempre scritto.
- Etichette in **Cred.**: i protocolli con cui DA-IPAM entra davvero nell'apparato.

## Da dove arrivano i dati

Dagli apparati resi gestiti dalla loro scheda o dalla pagina della subnet, e dalle letture periodiche fatte con le
loro credenziali (SNMP, SSH, WinRM, API).

## Se la pagina è vuota

Nessun apparato è ancora stato reso gestito: apri un host dalla [scheda dell'oggetto](pagine/objects-id.md) e premi
**Rendi apparato**. Se ci sono filtri attivi, rimettili su «Tutti».
