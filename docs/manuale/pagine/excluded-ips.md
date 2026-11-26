---
percorso: /excluded-ips
titolo: IP esclusi — gli indirizzi eliminati che non devono tornare
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Quando si elimina un host, DA-IPAM si ricorda la coppia **rete + indirizzo** in questa lista. Serve a evitare che
l'host ricompaia da solo il giorno dopo perché una fonte «passiva» ne parla ancora: la tabella ARP del router, un
lease del DHCP, la sincronizzazione di Active Directory. Finché l'indirizzo è qui, quelle fonti non lo ricreano.

L'esclusione cade da sola se un controllo **attivo** (il ping) trova davvero un apparato acceso su quell'indirizzo:
vuol dire che c'è qualcosa di vero, e DA-IPAM torna a mostrarlo. Si arriva da **Network › Apparati**, scheda **IP
esclusi** in cima.

![La pagina IP esclusi](/manuale/excluded-ips/pagina.png)

Nella schermata la colonna «Eliminato da» è sfocata: contiene il nome dell'utente.

## Le voci della pagina

- **Rete**: il nome della subnet e, sotto, il suo indirizzo.
- **IP**: l'indirizzo escluso.
- **Motivo**: perché è finito qui. **Eliminato manualmente** (un host tolto dalla sua scheda), **Eliminato in massa**
  (tolto con la selezione multipla dall'elenco), **Aggiunto manualmente**.
- **Eliminato da**: l'utente che l'ha tolto.
- **Data**: quando.
- **Rimuovi**: toglie l'indirizzo dalla lista. Prima chiede conferma, perché da quel momento le scansioni possono
  ricreare l'host. Lo usa chi ha il ruolo di amministratore.

## Come si usa

1. Se un host eliminato per errore non ricompare più, cerca il suo indirizzo qui.
2. Premi **Rimuovi** e conferma.
3. Al prossimo giro della scansione, o alla prossima lettura di ARP, DHCP o Active Directory, l'host torna nell'elenco
   degli [Apparati](pagine/discovery.md).

Non serve togliere a mano un indirizzo che è stato riassegnato a un apparato nuovo e acceso: il ping lo toglie da solo.

## Da dove arrivano i dati

Ogni eliminazione di host dalla sua scheda o dall'elenco degli apparati scrive qui una riga.

## Se la pagina è vuota

«Nessun IP escluso» vuol dire che finora non è stato eliminato nessun host, o che le esclusioni sono già cadute.
