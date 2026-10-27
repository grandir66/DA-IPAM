# ADR 0033 — «Esci» revoca la sessione, l'istanza si controlla e si ricorda

**Stato:** Accepted
**Data:** 2026-10-23
**Autore:** riccardo.grandi@gmail.com (con Claude)

## Contesto

Tre difetti dell'accesso, trovati il 23/10 sull'hub multi-istanza:

- «Esci» cancellava il cookie, ma le richieste della dashboard partite un attimo prima tornavano dopo e lo rimettevano: il JWT si rinnova a ogni risposta del proxy. Traccia: signout `Max-Age=0` a +495 ms, `/api/status/*` rimettono `authjs.session-token` a +525 ms, `/` riapre la sessione.
- Il cambio d'istanza (`useSession().update({ tenantCode })`) scriveva nel token qualsiasi codice arrivasse dal browser: un utente con la sola istanza A poteva chiedere B, o la vista «tutte».
- Il superadmin dell'hub doveva scegliere l'istanza a ogni accesso.

La sessione è JWT senza archivio lato server: non c'è una riga da cancellare.

## Decisione

Due colonne su `users` dell'hub e un modulo, `lib/accesso/sessione.ts`, usato dai callback di Auth.js.

- `sessioni_valide_da` (ms): `events.signOut` la scrive; il callback `jwt` rifiuta (ritorna `null`) un token il cui `accessoAt` (ora dell'accesso, messa all'ingresso e mai cambiata dai rinnovi, a differenza di `iat`) è uguale o precedente. Un token rinnovato in ritardo resta quindi morto.
- Il callback `jwt` accetta il cambio d'istanza solo se `istanzaAmmessa`: accessi letti dal DB, «tutte» solo superadmin, istanza attiva. Rifiutato = resta dov'era, con una riga `[Auth] … rifiutato` nel journal.
- `ultima_istanza`: scritta al cambio accettato; all'accesso `istanzaIniziale` riparte da lì se è ancora ammessa, altrimenti la regola di prima.

## Alternative scartate

- **Ritardare la navigazione dopo il signout / fermare il polling** — riduce la finestra, non la chiude: qualunque richiesta in volo la riapre.
- **Lista nera dei token** — servirebbe un identificativo per token e una tabella che cresce; l'ora d'uscita per utente basta.
- **Passare a sessioni su database** — cambio grosso di Auth.js per tre difetti.
- **Controllare l'istanza solo in `/api/auth/select-tenant`** — la rotta esiste ma l'interfaccia non la usa: il token si cambia da `update()`, quindi il controllo va nel callback.

## Conseguenze

### Positive

- «Esci» chiude davvero; un utente non passa a istanze non sue; il superadmin riparte dall'ultima istanza.

### Negative

- «Esci» chiude la sessione su **tutti** i browser dell'utente.
- Il callback `jwt` legge `users` a ogni richiesta che passa dal proxy (una lettura per chiave: trascurabile su SQLite, ma è un costo per richiesta).
- L'utente di servizio (`DOMARC_USERNAME`, id 0) non ha riga: per lui niente revoca né ultima istanza.

### Cosa diventa difficile in futuro

- Un passaggio a più processi o a un DB remoto per l'hub rende quella lettura per richiesta più cara: andrebbe messa in cache.
