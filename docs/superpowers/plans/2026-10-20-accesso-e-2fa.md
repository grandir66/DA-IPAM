# Pagina d'accesso e verifica in due passaggi — piano di esecuzione

> Si esegue in linea, task per task, con una revisione per task (livello completo). Le caselle
> `- [ ]` tengono il conto.

**Obiettivo:** pagina d'accesso nuova (due metà, come DA-Template) e verifica in due passaggi (TOTP)
per gli utenti locali a cui un admin la accende.
**Architettura:** codice TOTP RFC 6238 scritto con `node:crypto` (nessuna libreria), segreto cifrato
con `encrypt()` nel DB dell'hub; il login locale passa da una funzione sola
(`verificaAccessoLocale`) usata sia dal passo 1 (`/api/auth/passo-uno`: password giusta → serve il
codice? serve l'attivazione?) sia da `authorize` di NextAuth. QR generato sul server con `qrcode`.
**Spec:** decisioni di Riccardo del 20/10 in sessione (sotto).
**Livello di controllo:** completo (autenticazione, zona rossa).

## Decisioni di Riccardo (20/10, non riaprire)

1. La 2FA vale **per gli utenti a cui un admin la accende** (utente per utente), non per ruolo né per tutti.
2. L'utenza di servizio `domarc` (`DOMARC_PASSWORD` nell'env) **resta com'è**: solo il confronto della
   password diventa a tempo costante.
3. **La attiva l'admin**: «Richiedi la verifica in due passaggi» su un utente; al suo accesso dopo,
   l'utente vede il QR e non entra finché non conferma un codice.
4. **Chi entra da entra.domarc.it (DA-Auth) non ha bisogno di niente**: nessun codice, nessun QR.
5. Pagina d'accesso **in due metà come DA-Template**.

## Vincoli globali

- Spenta per tutti alla consegna: nessun utente ha la richiesta accesa, quindi il push su `dev` (che
  arriva anche al cliente A) non cambia l'accesso di nessuno.
- Codice a 6 cifre, passo 30 s, SHA-1 (quello di tutte le app Authenticator), finestra ±1 passo, un
  codice usato non vale una seconda volta (si salva l'ultimo passo usato).
- Segreto: 20 byte casuali (`crypto.randomBytes`), base32, cifrato con `encrypt()`; letto con
  `safeDecrypt()` (un segreto che non si apre è un rifiuto, mai un «entra»).
- QR proposto valido 10 minuti; il segreto proposto sta in colonna a parte, cifrato, finché il primo
  codice giusto non lo conferma.
- Codice sbagliato = tentativo fallito per il freno esistente (`login:<nome>`), stesso messaggio
  generico («nome, password o codice non validi»); il blocco col conto alla rovescia resta.
- Testo ≥13 px, token Domarc, stati con simbolo; testi in italiano.

## Casi da non dimenticare

1. Utente con 2FA attiva che entra senza codice o con codice vecchio/ripetuto → rifiuto, conta (T2).
2. QR scaduto (oltre 10 min) → nuovo QR al passo 1, il vecchio non attiva (T2).
3. `ENCRYPTION_KEY` diversa o segreto rovinato → rifiuto, non ingresso (T2).
4. L'admin non perde l'accesso a se stesso: «Azzera» sul proprio utente chiede conferma; se l'unico
   admin perde il telefono c'è lo script da server (T4).
5. DA-Auth e utenza `domarc` non toccati dalla 2FA (prove in T2).

## Task 1 — TOTP e schema

**File:** crea `src/lib/auth/totp.ts`, prova `src/lib/auth/__tests__/totp.test.ts`; modifica
`src/lib/db-hub-schema.ts` (ALTER idempotenti su `users`).
**Produce:** `base32Codifica/Decodifica`, `nuovoSegreto(): string`, `codiceTotp(segreto, passo): string`,
`verificaTotp(segreto, codice, oraMs, ultimoPasso): number | null` (passo accettato o null),
`uriOtpauth(segreto, utente, emittente = "DA-IPAM"): string`.
Colonne: `totp_richiesta INTEGER NOT NULL DEFAULT 0`, `totp_segreto TEXT`, `totp_attivato_at TEXT`,
`totp_ultimo_passo INTEGER`, `totp_proposto TEXT`, `totp_proposto_scade TEXT`.
**Verifica:** vettori RFC 6238 (SHA-1, T=59 → `287082`, T=1111111109 → `081804`), finestra ±1,
ripetizione rifiutata, codice non numerico rifiutato; prova vista fallire prima del codice.

## Task 2 — Accesso locale in una funzione sola

**File:** crea `src/lib/auth/accesso-locale.ts` (+ prova con hub DB temporaneo), `src/app/api/auth/passo-uno/route.ts`;
modifica `src/lib/auth.ts` (l'`authorize` del ramo `credentials` chiama la funzione nuova; confronto di
`DOMARC_PASSWORD` con `timingSafeEqual` sulle impronte SHA-256).
**Produce:** `verificaAccessoLocale({ username, password, codice? }): Esito` con esiti `entra`,
`serve_codice`, `serve_attivazione` (QR SVG + segreto per l'inserimento a mano, proposto 10 min),
`rifiuta`, `bloccato` (secondi). Il passo 1 risponde solo l'esito (mai se il nome esiste); `authorize`
entra solo con `entra`. Al primo codice giusto su un proposto: si salva il segreto, `totp_attivato_at`,
si pulisce il proposto.
**Verifica:** le prove dei «casi da non dimenticare» 1-3 e 5, più: utente senza 2FA entra come oggi;
freno invariato (5 fallimenti → blocco).

## Task 3 — Pagina d'accesso

**File:** riscrive `src/app/login/page.tsx`.
- Due metà: sinistra navy pieno con `logo-white.png`, «OLTRE L'UFFICIO IT», «DA-IPAM · inventario e
  rete»; destra bianca: «Accedi a DA-IPAM», pulsante «Accedi con l'account Domarc» (solo dove c'è
  DA-Auth, come oggi), «oppure», modulo nome + password.
- Passo 2 nella stessa scheda: con `serve_codice` compare «Codice» (6 cifre, `inputmode=numeric`,
  `autocomplete=one-time-code`, fuoco automatico) e «Indietro»; con `serve_attivazione` il QR, il
  segreto in gruppi di 4 da copiare, tre righe d'istruzioni e il campo codice.
- Errori e blocco in un avviso con simbolo (✕ / ▲), blocco con l'ora di sblocco.
- Sotto i 900 px la fascia navy diventa una testata.
**Verifica:** resa a 1280, 1920 e 390 px: passo 1, codice, attivazione, errore, blocco.

## Task 4 — Gestione da Impostazioni → Utenti e recupero da server

**File:** crea `src/app/api/users/[id]/seconda-verifica/route.ts` (POST `{ azione: "richiedi" | "azzera" | "togli" }`,
`requireAdmin`, permessi di `users/permissions.ts` come per «reimposta password»), `scripts/seconda-verifica.ts`
(`stato|azzera|togli <utente>`, solo da server); modifica la tabella utenti in `settings/page.tsx` e
`GET /api/users` (stato senza segreti).
- Colonna «Due passaggi»: «–» non richiesta, «▲ da attivare», «✓ attiva»; azioni nel menu della riga.
  «Azzera» e «Togli» con conferma.
- Registro JSONL `data/audit/accessi-AAAA-MM-GG.jsonl` (chi, cosa, su chi, quando; mai segreti),
  conservazione 400 giorni come quello della pulizia host.
**Verifica:** prove dei permessi (viewer 403, admin non gestisce superadmin), registro scritto, resa
della tabella a 1920.

## Task 5 — Documenti, cancello, rilascio

- ADR 0023 «Verifica in due passaggi per utente» (alternative scartate: per ruolo, per installazione,
  libreria esterna; cosa diventa difficile: la sessione JWT dura fino alla scadenza anche dopo
  «Azzera»). CHANGELOG, CONTEXT, manuale utente §accesso, scheda-mappa.
- Cancello completo (`lint`, `tsc`, `npm test`, `build`), log nello scratchpad.
- Prima del push: copia del `hub.db` dell'hub (`.bak-AAAAMMGG-HHMMSS`) perché le colonne nuove
  si aggiungono all'avvio; push su `dev`, aggiornamento dell'hub, prova sull'hub: accesso senza 2FA
  invariato; su un utente di prova creato apposta, richiesta → QR → codice → ingresso; poi l'utente di
  prova si cancella.
