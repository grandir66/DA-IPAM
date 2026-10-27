# ADR 0034 — Vault: chiave degli slot dentro `encrypt()`, accesso sulla chiave d'installazione, interruttori nel file

**Stato:** Superseded (27/10/2026): Riccardo toglie OpenBao e gli slot; al loro posto un archivio KDBX aperto con un key file. Specifica e piano in DA-Link: `docs/superpowers/specs/2026-10-27-vault-semplice-kdbx-design.md`, `docs/superpowers/plans/2026-10-27-vault-semplice-kdbx.md`. Un ADR nuovo al passo 8 del piano.
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

## Correzioni dopo la revisione (23/10)

Decisioni prese correggendo la PR #18 (rilievi della revisione, numerati come là):

- **Spegnere `DA_VAULT_LOCALE` dopo una ricifra (rilievo 8).** C'è la **ricifra inversa**: `scripts/da-vault.ts ricifra --inversa
  [--applica]`, dalla chiave degli slot a `ENCRYPTION_KEY`, con le stesse garanzie della ricifra (a vuoto di serie, tutto o
  niente per database, verifica col lettore unico, `VACUUM`). Si lancia a **servizio fermo** con `DA_VAULT_LOCALE=1`, poi si toglie
  l'interruttore dal file e si riavvia. Se qualcuno spegne l'interruttore senza farla, il controllo della chiave (avvio e
  `/api/health`) lo dice a schermo: «valori ricifrati dal vault e DA_VAULT_LOCALE spento … ricifra --inversa». I segreti TOTP non
  si toccano (non si sono mai mossi).
- **Backup e `.bak-` con la chiave vecchia (rilievo 9).** Dopo `ricifra --applica` il CLI elenca i backup che hanno ancora valori
  della chiave vecchia (`<dati>/hub.db.bak-*`, `<dati>/tenants/*.db.bak-*`, backup notturni `<radice>/AAAA-MM-GG/*.db.gz`; i
  segreti TOTP non contano: restano sulla chiave d'installazione per scelta) e propone `--purga-backup`. **A vuoto di serie**:
  cancella solo `--purga-backup --applica`. Non tocca le copie fuori da qui (snapshot di Proxmox, backup fuori sede): restano con la
  chiave vecchia, e il CLI lo ricorda. Cancellare i backup toglie anche il punto di ritorno alla situazione di prima: si fa dopo
  aver verificato l'appliance ricifrata, non subito.
- **Segreto in OpenBao dopo la cancellazione o la modifica di una credenziale (rilievo 7).** Alla cancellazione di una voce con
  `credential_ref` (e `DA_VAULT_OPENBAO=1`) si cancellano i **metadata** del percorso (`DELETE kv-domarc/metadata/<percorso>`:
  tutte le versioni, non solo l'ultima). È asincrona (la cancellazione dal database è sincrona): se OpenBao non risponde o la
  policy dell'AppRole non permette `delete` sui metadata, la voce si cancella lo stesso e l'avviso nel log nomina cliente e voce
  (mai un ripiego muto). `da-vault-migra-openbao --verifica` elenca i **percorsi orfani** (sotto `clienti/<cliente>/da-ipam/` ma
  senza voce che li usi) e copre quello che la cancellazione non vede: un cancellamento fallito, una cancellazione in massa, un
  segreto cambiato dalla pagina (toglie il riferimento: la migrazione riscrive lo stesso percorso, ma le **versioni vecchie**
  restano nella cronologia del KV; per tenerle corte servono `max_versions` e `delete_version_after` sul mount, da impostare in
  OpenBao). La policy dell'AppRole `da-ipam` deve quindi includere `delete` su `kv-domarc/metadata/clienti/*/da-ipam/*`.
- **Passphrase del cliente (rilievi 5 e 10).** Un solo contatore di tentativi sbagliati **per utente** (5 in 15 minuti) per
  sblocco e KeePass, prenotato prima della derivazione; tetto di 2 derivazioni scrypt in corso (le altre 429). Normalizzazione
  unica: una passphrase con spazi, tab o a capo ai bordi è **rifiutata** in creazione, cambio e recupero (mai tagliata in
  silenzio: prima `crea` la teneva e il recupero la tagliava).
- **Esclusione di Domarc (rilievo 12).** Senza slot Domarc il riferimento della richiesta scritta del cliente è obbligatorio, sta
  in `archivio.json` (`domarcEscluso`) e in `recuperi.jsonl`; nel registro dei recuperi si scrive prima l'intento e poi l'esito.
- **`/api/health` (rilievo 1).** Col vault locale acceso e bloccato: 200 «degraded» con «vault bloccato»; 503 solo con `?strict=1`
  (monitoraggio). Il guasto vero (chiave sbagliata a vault spento) resta 503.
- **Moduli ESM (rilievo 6).** `age-encryption` si carica con `await import()` dentro le funzioni che lo usano; `kdbxweb` e
  `hash-wasm` non sono raggiunti dall'avvio (solo dalla rotta KeePass).
- **Registro e stato (rilievo 14).** «Chi ha visto cosa» solo admin (tecnici Domarc e admin del cliente, D2); lo stato del vault
  resta a tutti gli autenticati ma senza nomi di credenziali (solo conteggi).

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

- Il segreto di una credenziale cambiata resta nelle versioni vecchie del KV finché non si limitano `max_versions` /
  `delete_version_after` in OpenBao; la cancellazione dei metadata riguarda le voci eliminate.
- `ricifra --inversa` e `--purga-backup` sono operazioni da fare a servizio fermo e con un backup recente a portata di mano.

### Cosa diventa difficile in futuro

- Togliere `ENCRYPTION_KEY` richiede di spostare anche i segreti TOTP (es. su un secondo slot, o una 2FA che non
  cifra con chiavi dell'appliance).

## Riferimenti

- Piano `docs/superpowers/plans/2026-10-23-da-vault.md` (D1-D5); ADR 0023 (2FA per utente), ADR 0002 (import statico
  di db-tenant), ADR 0032 (Opzioni).
- Codice: `src/lib/vault/`, `src/lib/crypto.ts`, `src/lib/credentials/segreti.ts`, `scripts/da-vault*.ts`.
