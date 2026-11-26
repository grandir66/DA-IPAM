---
percorso: /devices
titolo: Dispositivi — gli apparati gestiti, tutti insieme
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

È l'elenco dei **dispositivi gestiti**: gli apparati che sono stati «resi apparato» e che DA-IPAM interroga con le
credenziali (switch, router, server, NAS, hypervisor, access point, PC). Rispetto all'elenco degli
[Apparati](pagine/discovery.md), che contiene tutto ciò che è stato visto in rete, qui ci sono solo quelli gestiti,
con il protocollo usato, le credenziali attive e l'eventuale collegamento a LibreNMS.

La pagina non ha una voce nel menu: ci si arriva dalla freccia «indietro» degli elenchi per tipo
([Switch, Router e gli altri](pagine/devices-id.md)) o scrivendo l'indirizzo `/devices`. Le tabelle funzionano come
in tutte le pagine: vedi le [parti comuni dell'interfaccia](../INTERFACCIA.md).

## Il titolo e i tipi

![Il titolo e i tipi](/manuale/devices/testata.png)

Sotto il titolo, quanti dispositivi ci sono e `icona:chevrons-left` `icona:chevron-left` `icona:chevron-right`
`icona:chevrons-right` per sfogliare le pagine. A destra `tasto:refresh` **Aggiorna** rilegge l'elenco.

1. **I tipi**: **Tutti** e un pulsante per ogni tipo presente (Server, PC, Switch, NAS / Storage, Hypervisor, Access
   Point, Router, Windows…), con la sua icona e il numero. Un clic mostra solo quel tipo.

## I filtri

![I filtri](/manuale/devices/filtri.png)

1. `icona:search` **Cerca per nome, IP, vendor, profilo prodotto, classificazione…**: filtra mentre scrivi.
2. **Tutti gli stati**: Online, Offline, Sconosciuto.
3. **Tutti i vendor**: un produttore solo.
4. **Tutti i profili**: un profilo di prodotto solo (compare se ce ne sono).

Con un filtro acceso compare `icona:x`, che li toglie tutti.

## La tabella

![La tabella dei dispositivi](/manuale/devices/tabella.png)

Nella schermata la colonna Nome è sfocata.

1. **Acquisizione**: la data dell'ultima lettura completa dell'apparato (inventario, porte, sistema). Vuota vuol dire
   che non è ancora stata fatta.
2. **Cred.**: le credenziali che funzionano, una etichetta per protocollo (**SNMP**, **WinRM**, **SSH**…).
3. **LibreNMS**: se l'apparato è già monitorato c'è `icona:activity` con il suo numero in LibreNMS; altrimenti
   `tasto:plus-circle` **Aggiungi** lo aggiunge (con SNMP se l'apparato ha una community, altrimenti solo col ping).
4. **Azioni**: `icona:external-link` **Dettagli** apre la scheda dell'apparato
   ([Switch, Router e gli altri](pagine/devices-id.md)), `icona:trash` **Elimina** lo toglie dopo una conferma.

| Colonna | Che cosa dice |
|---|---|
| **Tipo** | L'etichetta del tipo, con l'icona. |
| **Nome** | Il nome dell'apparato. |
| **IP** | L'indirizzo con cui viene letto. |
| **Vendor** | Il produttore. |
| **Profilo** | Il profilo di prodotto riconosciuto (per esempio «Client» o «Storage»); passa il mouse per il dettaglio. |
| **Acquisizione** | L'ultima lettura completa. |
| **MAC** | L'indirizzo della scheda di rete. |
| **Stato** | Online, Unreachable, Transient, Sconosciuto, con da quanto tempo. |
| **Cred.**, **LibreNMS**, **Azioni** | Vedi sopra. |

Ogni intestazione con `icona:arrow-up-down` ordina con un clic. **Aggiungi** ed **Elimina** si vedono anche in sola
lettura, ma li esegue solo un **amministratore**.

## Come si fa

- **Vedere solo gli switch**: pulsante **Switch** in alto (oppure apri **Network › Switch** se il menu lo mostra).
- **Trovare un apparato**: scrivi nella ricerca una parte del nome o dell'indirizzo.
- **Aprire la scheda**: `icona:external-link` nella colonna **Azioni**.
- **Mettere un apparato sotto monitoraggio**: `tasto:plus-circle` **Aggiungi** nella colonna LibreNMS.
- **Trovare gli apparati senza credenziali che funzionano**: scegli il tipo e scorri la colonna **Cred.**: le righe
  senza etichette vanno sistemate assegnando una credenziale dalla loro scheda.

## Cosa vogliono dire i segni

- **Online** col pallino pieno, **Unreachable** (non raggiungibile), **Transient** (risponde a intermittenza),
  **Sconosciuto**: lo stato è sempre scritto.
- Etichette in **Cred.**: i protocolli con cui DA-IPAM entra davvero nell'apparato.

## Da dove arrivano i dati

Dagli apparati resi gestiti dalla loro scheda o dalla pagina della subnet, e dalle letture periodiche fatte con le
loro credenziali (SNMP, SSH, WinRM, API).

## Se la pagina è vuota

Nessun apparato è ancora stato reso gestito: apri un host dalla [scheda dell'oggetto](pagine/objects-id.md) e premi
**Rendi apparato**. Se ci sono filtri attivi, toglili con `icona:x`.
