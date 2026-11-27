# ADR 0043 — Archivio degli utenti: KDBX locale, una serratura per persona, copia verso una chiave pubblica

- Stato: accettato (Riccardo, 26/11/2026: «Sì, confermo»)
- Piano: [`docs/superpowers/plans/2026-11-25-sicurezza-accessi-honeypot.md`](../superpowers/plans/2026-11-25-sicurezza-accessi-honeypot.md) §12

## Contesto

Riccardo, 26/11: «un kdbx a disposizione degli utenti finali, slegato da quello di uso di ipam»; «una password
principale e un 2fa per accedere personale e una registrazione degli accessi»; «solo utenti con una autorizzazione
specifica non necessariamente admin»; «il recupero con il superadmin che può resettare l'utenza»; «vorrei trovare un
sistema per avere una copia cifrata sicura dell'archivio». Nel codice il formato KDBX locale c'era già
(`src/lib/vault/kdbx.ts`, aperto da un key file) ma nessuno lo usava.

## Decisione

1. **Un archivio KDBX locale all'installazione** (`<dati>/archivio-utenti/utenti.kdbx`), per le persone. Non contiene e
   non tocca le credenziali che DA-IPAM usa per lavorare (`credentials`, `host_credentials`, vault di DA-Link): i
   lavori automatici non lo leggono mai.
2. **La chiave dell'archivio non sta mai in chiaro sul disco.** È il key file del formato esistente, tenuto solo in
   memoria; sul disco c'è **una serratura per persona**: la chiave cifrata (AES-256-GCM) con una chiave derivata dalla
   **password principale personale** (Argon2id). Nessun segreto condiviso.
3. **Autorizzazione = avere una serratura.** Non dipende dal ruolo. Toglierla è cancellare la serratura.
4. **Apertura**: password principale personale **e** codice a sei cifre dell'utente, separata dal login. Vale per
   quell'utente, in memoria del processo; si richiude dopo 10 minuti senza gesti e comunque dopo 60; un riavvio richiude.
5. **Chi comanda è chi possiede il codice dell'amministratore dell'archivio** (Riccardo, 26/11, dopo la prima
   stesura: «l'admin di quell'archivio è un codice nuovo e solo chi lo possiede può resettare le credenziali; neppure
   il superadmin dell'installazione può accedere senza il suo codice che può essere revocabile; quell'archivio è una
   nuova feature riservata per il cliente e non necessariamente condivisa»). Il codice nasce alla creazione, si mostra
   **una volta sola**, non sta sul disco (c'è una serratura che lui apre). Con quel codice, e solo con quello, si dà,
   si ridà e si toglie l'accesso a una persona; il ruolo nell'installazione non dà nessun potere. Si **sostituisce**
   presentando quello attuale: il vecchio smette di valere subito. Il recupero di chi ha perso la password è una
   serratura nuova con una password provvisoria, da cambiare alla prima apertura.
6. **Copia**: automatica verso una chiave pubblica di recupero (la privata si mostra una volta sola e la tiene il
   cliente, non Domarc), più «Scarica una copia» a mano in formato KDBX standard.
7. **Registro**: aperture, chiusure, tentativi falliti, letture delle voci, cambi alle serrature; i tentativi falliti
   entrano anche fra i tentativi della Protezione, con avviso.

## Conseguenze

- Cosa diventa difficile: **se il codice dell'amministratore si perde nessuno può più dare o ridare un accesso**; chi ha
  già la sua serratura continua ad aprire, ma chi dimentica la password resta fuori per sempre, e Domarc non può
  aiutare (è voluto: l'archivio è del cliente). Cambiare l'algoritmo delle serrature vuol dire riscriverle tutte.
- Chi crea l'archivio (un amministratore dell'installazione) vede il codice una volta: va consegnato al cliente
  subito, e se chi l'ha visto non deve tenerlo il cliente lo sostituisce.
- La memoria del processo contiene la chiave finché l'archivio è aperto: chi ha root sulla macchina accesa la legge.
- Due archivi con nomi simili nel codice: `vault/archivio.ts` (slot dell'appliance, del 23/10) e `archivio-utenti/`.
- La chiave privata di recupero la tiene solo il cliente: se la perde, le copie automatiche non si aprono.
