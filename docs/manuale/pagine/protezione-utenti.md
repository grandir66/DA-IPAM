---
percorso: /protezione/utenti
titolo: Utenti — chi può entrare in DA-IPAM
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Mostra **chi può entrare in DA-IPAM**, con quale ruolo, se usa la seconda verifica, quando è entrato l'ultima volta e
da dove. Serve a trovare utenze che non servono più e amministratori senza seconda verifica, e a limitare gli
indirizzi da cui un utente può entrare.

Si arriva dalla scheda **Utenti** di **Sicurezza › Protezione**. Solo amministratori. Nessuna schermata nel manuale.

## Le voci della pagina

In cima quattro numeri: gli utenti, **Amministratori**, **Admin senza seconda verifica**, **Con «Solo da»** (utenti
che possono entrare solo da un elenco di indirizzi).

Il pannello **Chi può entrare** ha le colonne:

- **Utente** e **Ruolo**.
- **Seconda verifica**: **accesa** o **spenta**.
- **Ultimo accesso**: quando, o «non registrato».
- **Da dove**: l'indirizzo dell'ultimo accesso.
- **Solo da**: gli indirizzi da cui l'utente può entrare; vuoto vuol dire ovunque. **Cambia** li modifica. Il
  collegamento di gestione (NetBird / DA-Link) passa sempre; la limitazione vale davvero solo con le porte interne
  chiuse (vedi [Chi può collegarsi](pagine/protezione-accessi.md)).

**Gestisci utenti (Impostazioni › Utenti)** porta dove si crea un utente e si cambiano ruolo e password: si fa in un
posto solo, non qui.

## Come si usa

1. Controlla gli amministratori con la seconda verifica spenta e chiedi di accenderla.
2. Guarda chi non entra da molto: un'utenza che non serve si toglie in Impostazioni › Utenti.
3. Per un utente che deve entrare solo dall'ufficio, **Cambia** nella colonna **Solo da**.

## Cosa vogliono dire i segni

- ▲ amministratore senza seconda verifica.
- ○ seconda verifica accesa.
- – spenta, su un utente senza diritti di amministratore.

## Da dove arrivano i dati

Gli utenti di questa installazione e i dati del loro ultimo accesso.

## Se la pagina è vuota

Non succede: c'è sempre almeno l'utente con cui stai guardando.
