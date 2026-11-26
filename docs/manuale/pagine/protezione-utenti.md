---
percorso: /protezione/utenti
titolo: Utenti — chi può entrare in DA-IPAM
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Mostra **chi può entrare in DA-IPAM**, con quale ruolo, se usa la seconda verifica, quando è entrato l'ultima volta e
da dove. Serve a trovare utenze che non servono più e amministratori senza seconda verifica, e a limitare gli
indirizzi da cui un utente può entrare.

Si arriva dalla scheda **Utenti** di **Sicurezza › Protezione** (le schede sono descritte in
[Stato della protezione](pagine/protezione.md)). Solo amministratori. Nessuna schermata nel manuale.

## Le voci della pagina

In cima la riga **Filtro degli accessi** (vedi [Stato della protezione](pagine/protezione.md)) e quattro numeri:
**Utenti**, **Amministratori**, **Admin senza seconda verifica**, **Con «Solo da»** (utenti che possono entrare solo da
un elenco di indirizzi).

Il pannello **Chi può entrare**; in alto a destra **Gestisci utenti (Impostazioni › Utenti)** porta dove si crea un
utente e si cambiano ruolo e password: si fa in un posto solo, non qui.

| Colonna | Che cosa dice |
|---|---|
| **Utente** | Il nome dell'utenza. |
| **Ruolo** | Solo lettura, amministratore e gli altri ruoli (vedi [i ruoli](../INTERFACCIA.md#utente)). |
| **Seconda verifica** | ○ **accesa**; ▲ **spenta** su un amministratore; – **spenta** su un utente senza diritti di amministratore. |
| **Ultimo accesso** | Quando, o «non registrato». |
| **Da dove** | L'indirizzo dell'ultimo accesso. |
| **Solo da** | Gli indirizzi da cui l'utente può entrare; vuoto vuol dire ovunque. |

**Cambia**, nella colonna **Solo da**, apre la casella degli indirizzi (vuoto = ovunque; indirizzi singoli o reti,
separati da virgola); **Salva** la registra, **Annulla** lascia com'era. Il collegamento di gestione (NetBird /
DA-Link) passa sempre; la limitazione vale davvero solo con le porte interne chiuse (vedi
[Chi può collegarsi](pagine/protezione-accessi.md)).

## Come si fa

- **Trovare gli amministratori senza seconda verifica**: guarda il numero **Admin senza seconda verifica** e le righe
  con ▲ nella colonna **Seconda verifica**; chiedi a quelle persone di accenderla.
- **Togliere un'utenza che non serve più**: cerca chi ha un **Ultimo accesso** molto vecchio o «non registrato», poi
  **Gestisci utenti (Impostazioni › Utenti)**.
- **Far entrare un utente solo dall'ufficio**: **Cambia** nella sua riga, scrivi la rete dell'ufficio, **Salva**.
- **Togliere la limitazione**: **Cambia**, svuota la casella, **Salva**.

## Cosa vogliono dire i segni

- ▲ amministratore senza seconda verifica.
- ○ seconda verifica accesa.
- – spenta, su un utente senza diritti di amministratore.

## Da dove arrivano i dati

Gli utenti di questa installazione e i dati del loro ultimo accesso.

## Se la pagina è vuota

Non succede: c'è sempre almeno l'utente con cui stai guardando.
