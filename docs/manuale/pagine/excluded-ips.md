---
percorso: /excluded-ips
titolo: IP esclusi — gli indirizzi eliminati che non devono tornare
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Quando si elimina un host, DA-IPAM si ricorda la coppia **rete + indirizzo** in questa lista. Serve a evitare che
l'host ricompaia da solo il giorno dopo perché una fonte «passiva» ne parla ancora: la tabella ARP del router, un
lease del DHCP, la sincronizzazione di Active Directory. Finché l'indirizzo è qui, quelle fonti non lo ricreano.

L'esclusione cade da sola se un controllo **attivo** (il ping) trova davvero un apparato acceso su quell'indirizzo:
vuol dire che c'è qualcosa di vero, e DA-IPAM torna a mostrarlo. Si arriva da **Network › Apparati**, scheda **IP
esclusi** in cima (le altre schede sono spiegate in [Apparati](pagine/discovery.md)).

Menu, schede e tabelle funzionano come in tutte le pagine: vedi le [parti comuni dell'interfaccia](../INTERFACCIA.md).
Questa pagina è un elenco semplice: niente ricerca, niente filtri, niente tasto destro.

## La tabella

![La tabella degli IP esclusi](/manuale/excluded-ips/tabella.png)

Nella schermata la colonna «Eliminato da» è sfocata: contiene il nome dell'utente.

1. **Rete**: il nome della subnet e, sotto, il suo indirizzo.
2. **Motivo**: perché l'indirizzo è finito qui.
3. `icona:rotate-ccw` **Rimuovi**: toglie l'indirizzo dalla lista.

| Colonna | Che cosa dice |
|---|---|
| **Rete** | La subnet in cui stava l'host, con il suo indirizzo sotto. |
| **IP** | L'indirizzo escluso. |
| **Motivo** | **Eliminato manualmente** (tolto dalla sua scheda), **Eliminato in massa** (tolto con la selezione di più righe in Apparati), **Aggiunto manualmente**. |
| **Eliminato da** | L'utente che l'ha tolto. |
| **Data** | Giorno e ora dell'esclusione. |
| **Azione** | Il pulsante `icona:rotate-ccw` **Rimuovi**. |

**Rimuovi** chiede conferma («Rimuovere … dalla blacklist? Le prossime scansioni potranno ricreare l'host.») perché
da quel momento le scansioni e le fonti passive possono ricreare l'host. Il pulsante si vede anche in sola lettura, ma
la rimozione la esegue solo un **amministratore**: per gli altri finisce con un messaggio d'errore.

## Come si fa

- **Far tornare un host eliminato per errore**: trova la riga con il suo indirizzo, `icona:rotate-ccw` **Rimuovi**,
  conferma. Al prossimo giro della scansione, o alla prossima lettura di ARP, DHCP o Active Directory, l'host torna fra
  gli [Apparati](pagine/discovery.md).
- **Far sparire per sempre un apparato dismesso**: eliminalo da [Apparati](pagine/discovery.md) (menu della riga ›
  Elimina host): l'indirizzo finisce qui da solo e le fonti passive non lo ricreano più.
- **Capire chi ha tolto un host**: guarda **Eliminato da** e **Data** sulla sua riga.
- **Un indirizzo riassegnato a un apparato nuovo e acceso**: non serve fare niente, il ping toglie l'esclusione da
  solo.

## Da dove arrivano i dati

Ogni eliminazione di host dalla sua scheda o dall'elenco degli apparati scrive qui una riga.

## Se la pagina è vuota

«Nessun IP escluso» vuol dire che finora non è stato eliminato nessun host, o che le esclusioni sono già cadute.
