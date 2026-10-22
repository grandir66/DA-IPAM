# ADR 0023 — Verifica in due passaggi per utente, accesa dall'admin

**Stato:** Accepted
**Data:** 2026-10-20
**Autore:** Riccardo Grandi (decisioni), Claude (stesura)

## Contesto

DA-IPAM aveva due ingressi: l'account Domarc (DA-Auth, solo sull'hub) e nome e password locali, con
il blocco progressivo dei tentativi. Nessun secondo fattore per gli utenti locali. DA-Template, dal
15/10, ha la 2FA TOTP obbligatoria per l'ingresso locale. Riccardo (20/10) ha chiesto di valutarla
per gli «utenti interni» e di rifare la pagina d'accesso come quella di DA-Template.

Le appliance dei clienti aggiornano da sole da `dev` (cliente A) o da `main`: una 2FA accesa per
tutti avrebbe chiuso fuori i loro utenti al primo accesso dopo l'aggiornamento.

## Decisione

**La verifica in due passaggi vale per gli utenti a cui un admin la chiede, uno per uno; al primo
accesso dopo la richiesta l'utente inquadra un QR e la attiva con un codice.** Decisioni di Riccardo
del 20/10:

- chi: «quelli a cui viene abilitata la funzione» (non per ruolo, non per installazione);
- chi entra da entra.domarc.it (DA-Auth) non ha bisogno di niente: il secondo fattore lo fa il portale;
- l'utenza di servizio `domarc` (`DOMARC_PASSWORD` nell'env) resta senza codice; il confronto della
  sua password diventa a tempo costante;
- la attiva l'admin (Impostazioni → Utenti: Richiedi, Azzera, Togli); su se stessi si può chiedere e
  azzerare, togliere no (lo fa un altro admin o `scripts/seconda-verifica.ts` dal server).

Tecnica: TOTP RFC 6238 (SHA-1, 6 cifre, 30 s, finestra ±1, passo già usato rifiutato) scritto con
`node:crypto`; segreto di 20 byte cifrato con `encrypt()` in `users.totp_segreto`; QR proposto in una
colonna a parte, cifrato, valido 10 minuti, confermato dal primo codice giusto. Il login locale passa
da una funzione sola, `verificaAccessoLocale` (`src/lib/accesso/accesso-locale.ts`), usata dal passo
1 della pagina (`/api/auth/passo-uno`) e da `authorize`. Ogni tentativo si prenota prima di ogni attesa
(il blocco tiene anche in parallelo); i nomi inesistenti costano un bcrypt come gli altri. Le azioni
dell'admin vanno in `data/audit/accessi-AAAA-MM-GG.jsonl` (400 giorni, mai segreti).

## Alternative scartate

- **2FA per ruolo (admin e superadmin)** — scartata da Riccardo: decide l'admin, utente per utente.
- **2FA per installazione, obbligatoria per tutti (come DA-Template)** — avrebbe chiuso fuori gli utenti
  delle appliance al primo accesso dopo l'aggiornamento automatico; e non era la richiesta.
- **Codice condiviso per l'utenza di servizio `domarc`** — scartato da Riccardo: resta com'è.
- **Libreria TOTP esterna (otplib, speakeasy)** — l'algoritmo è di trenta righe, provate coi vettori
  dell'RFC: una dipendenza in meno dentro l'accesso. Per il QR invece `qrcode` 1.5.4 (disegnarlo a mano
  non vale il rischio).
- **Segreto proposto nel cookie firmato (come DA-Template)** — con NextAuth il passo 1 è una rotta a sé;
  la colonna con scadenza e la scrittura condizionata evitano due QR validi in parallelo.

## Conseguenze

### Positive

- Nessun accesso cambia finché un admin non chiede la verifica a qualcuno.
- Codice sbagliato o ripetuto conta nel blocco esistente, con lo stesso messaggio generico.
- Recupero senza toccare il database a mano: «Azzera» dalla pagina o lo script dal server.

### Negative

- **La sessione dura fino alla scadenza del JWT di NextAuth (30 giorni)**: «Azzera» e «Togli» valgono
  dal prossimo accesso, non fanno uscire chi è già dentro. Da accorciare in un passo a parte, se serve.
- Il blocco dei tentativi è in memoria: un riavvio del servizio lo azzera (com'era già).
- L'utenza di servizio `domarc` resta un accesso superadmin con la sola password.

### Cosa diventa difficile in futuro

- Rendere la 2FA obbligatoria per tutti vuol dire un interruttore per installazione con un periodo di
  attivazione: oggi la richiesta è per riga, una per utente.
- Cambiare `ENCRYPTION_KEY` rende illeggibili i segreti TOTP: quegli utenti restano fuori (rifiuto, mai
  ingresso) finché un admin non fa «Azzera».
- `/api/auth/passo-uno` risponde se la password è giusta: è protetta dallo stesso blocco del login e
  non va mai esclusa da lì.

## Riferimenti

- Piano `docs/superpowers/plans/2026-10-20-accesso-e-2fa.md`
- DA-Template ADR-0003 (tre ingressi, 2FA locale) e ADR-0005 (DA-Auth senza seconda verifica)
- RFC 6238 (TOTP), RFC 4226 (HOTP)
