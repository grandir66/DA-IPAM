# ADR 0034 — Vault: chiave degli slot dentro `encrypt()`, accesso sulla chiave d'installazione, interruttori nel file

**Stato:** Accepted (decisioni di dettaglio dentro il piano approvato da Riccardo il 23/10; da confermare in revisione)
**Data:** 2026-10-23
**Autore:** Claude (sessione cloud `claude/da-vault-codice`), su piano e decisioni D1-D5 di Riccardo

## Contesto

Il piano `docs/superpowers/plans/2026-10-23-da-vault.md` (approvato, livello completo) chiede, dai clienti, un archivio
locale cifrato con slot age (cliente, Domarc, TPM) e una `ricifra` dalla chiave di `ENCRYPTION_KEY` a quella degli
slot, dietro un interruttore spento di serie; sull'hub, le credenziali dei device in OpenBao con `credentialRef` e una
doppia lettura per una versione. Restavano da decidere, scrivendo il codice:

- come far passare dalla stessa chiave tutti gli `encrypt()` (non solo le credenziali: integrazioni, profili edge,
  inventory-agent, network-services, credenziali di sistema) senza toccarli uno per uno;
- che fare dei segreti della verifica in due passaggi (ADR 0023), cifrati anche loro con `encrypt()`: se passano
  dalla chiave degli slot, col vault bloccato (niente TPM) un admin con la 2FA non entra più a sbloccarlo;
- dove stanno gli interruttori, visto che ogni push su `dev` arriva a tutte le appliance;
- come si riconosce, durante e dopo la ricifra, con quale chiave è cifrato un valore.

## Decisione

**La chiave degli slot entra dentro `encrypt()`/`decrypt()` di `src/lib/crypto.ts`; i segreti dell'accesso restano
sulla chiave d'installazione; gli interruttori stanno nel file dell'appliance.**

- `crypto.ts`: con `DA_VAULT_LOCALE=1` `encrypt()` scrive con la chiave dei dati aperta dagli slot (vault bloccato =
  errore, mai un ripiego sulla chiave d'installazione); `decrypt()` prova la chiave dei dati e poi quella
  d'installazione. **Stesso formato** `iv:tag:testo`: la chiave giusta la dice il tag di GCM. Così ogni
  `encrypt()` dell'app passa dalla stessa chiave senza un elenco da tenere allineato, i controlli di formato
  (`FORMATO_CIFRATO`, `isCiphertext`) non cambiano, e a metà ricifra ogni valore resta leggibile.
- Spento: il codice di sempre, provato contro una copia del `crypto.ts` di prima (stessi valori, stessi errori).
- Lo stato (chiave aperta, store OpenBao, conferme della «mostra password») sta su `globalThis`
  (`Symbol.for("da-ipam.vault.stato")`), come lo stato dello scheduler: `server.ts` e le rotte di Next sono bundle
  diversi dello stesso processo.
- **Accesso**: `accesso-locale.ts` usa `cifraAccesso`/`safeDecifraAccesso` (sempre chiave d'installazione) e la
  ricifra salta `users.totp_segreto` e `users.totp_proposto`. `ENCRYPTION_KEY` resta quindi necessaria sull'appliance,
  ma protegge solo i segreti TOTP.
- **Ricifra**: prende ogni valore nel formato di `encrypt()` che si apre con la chiave d'installazione, intero o dentro
  un testo (JSON di network-services e inventory-agent), in ogni tabella di `hub.db` e dei database dei clienti.
  Prova a vuoto di serie; con `--applica` prima la prova a vuoto su tutti, poi una transazione per database verificata
  col lettore unico (`campiVoceDb`), poi `VACUUM`.
- **Interruttori nel file** (`DA_VAULT_LOCALE`, `DA_VAULT_OPENBAO` in `.env.local`), non nel database: si cambiano solo
  sul server, con un riavvio, un'appliance alla volta; in Opzioni › Da file si leggono e basta. `server.ts` importa il
  modulo del vault solo con un interruttore acceso.
- **Hub e OpenBao**: `credentials.credential_ref` accanto alle colonne; il lettore unico (sincrono) legge dalla cache
  di OpenBao (`leggiSync`); senza riferimento legge la colonna con un avviso; un segreto cambiato dalla pagina toglie
  il riferimento (la voce torna alla colonna col valore nuovo e la migrazione la riporta in OpenBao).

## Alternative scartate

- **Prefisso di versione nel valore (`v2:…`)** — scartata: tutti i controlli di formato dell'app (`FORMATO_CIFRATO`,
  `isCiphertext`) avrebbero visto un valore già cifrato come testo in chiaro e lo avrebbero cifrato due volte.
- **Elenco esplicito delle colonne cifrate per la ricifra** — scartato: le colonne sono decine e alcune sono dentro un
  JSON; un elenco si disallinea al primo `encrypt()` nuovo. La scansione generica con la prova «si apre con la chiave
  vecchia» non ha falsi positivi (GCM).
- **TOTP sulla chiave degli slot e sblocco prima del login** — scartato: una pagina senza sessione che accetta la
  passphrase è un'eccezione alle guardie delle rotte, e col vault bloccato nessun admin con la 2FA entrerebbe.
- **Interruttori in Opzioni (database)** — scartato: un admin del cliente potrebbe accendere il vault senza archivio né
  ricifra, e la chiave non si apre senza un riavvio.

## Conseguenze

### Positive

- Un solo punto (`crypto.ts`) decide la chiave; nessun chiamante cambia; spento è il codice di prima.
- Ricifra ripetibile, tutto o niente per database, interrompibile: dopo un crash ogni valore resta leggibile.
- Col vault bloccato si entra (2FA) e si sblocca da Impostazioni › Vault.

### Negative

- `ENCRYPTION_KEY` non sparisce dall'appliance: protegge i segreti TOTP.
- `decrypt()` col vault acceso, per un valore non ancora ricifrato, fa due tentativi (uno scrypt in più): solo durante
  la transizione.
- Le letture dirette delle colonne fuori da `segreti.ts` (`credentials/trova.ts`, `apparato-archivio.ts`,
  `integrations/self-identity.ts`, `controllers/credenziale.ts`, la `for_edit` della rotta delle credenziali) non
  sanno di `credential_ref`: funzionano finché le colonne restano piene (doppia lettura). Prima di svuotarle vanno
  portate sul lettore unico.

### Cosa diventa difficile in futuro

- Togliere `ENCRYPTION_KEY` richiede di spostare anche i segreti TOTP (es. su un secondo slot, o una 2FA che non
  cifra con chiavi dell'appliance).

## Riferimenti

- Piano `docs/superpowers/plans/2026-10-23-da-vault.md` (D1-D5); ADR 0023 (2FA per utente), ADR 0002 (import statico
  di db-tenant), ADR 0032 (Opzioni).
- Codice: `src/lib/vault/`, `src/lib/crypto.ts`, `src/lib/credentials/segreti.ts`, `scripts/da-vault*.ts`.
