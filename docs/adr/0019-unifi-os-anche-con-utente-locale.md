# ADR 0019 — Console UniFi OS anche con utente locale e password

**Stato:** Accepted (modifica in parte gli ADR 0005 e 0007: UniFi OS non più «solo chiave API»)
**Data:** 2026-10-16
**Autore:** Riccardo Grandi, con Claude

## Contesto

Gli ADR 0005 e 0007 leggono le console UniFi OS (UDM, UDM Pro/Beast, Cloud Key
Gen2+) **solo con la chiave API**, creata nell'app Network (Control Plane →
Integrazioni). Con utente e password si leggeva solo la Network Application
classica (`self_hosted`: `POST /api/login`, percorsi `/api/s/...`).

Il 16/10, sull'appliance pilota, il controller è un UDM con un account **locale**
(`rgadmin`) che non ha i permessi di gestione del sito: la chiave API non si può
creare. Salvato come `self_hosted`, il controller fallisce sempre (su UniFi OS il
login classico e i percorsi `/api/s/...` non esistono), anche con le credenziali
giuste, e la pagina non diceva perché.

## Decisione

Riccardo il 16/10 ha deciso di aggiungere l'accesso con **utente locale e
password** al tipo `udm`, accanto alla chiave API, perché non sempre la chiave si
può creare.

- **Metodo dedotto dai campi, niente colonne nuove**: chiave presente → chiave;
  altrimenti utente (e password) → utente; nessuno dei due → errore di
  validazione. Una riga tiene i segreti di UN metodo solo (`api_key_enc` oppure
  `username` + `password_enc`); quelli dell'altro si tolgono al salvataggio.
- **Protocollo**: `POST /api/auth/login` con `{username, password, rememberMe:false}`
  → cookie `TOKEN` e intestazione `x-csrf-token`; le stesse GET di oggi sotto
  `/proxy/network/api/...` con `Cookie: TOKEN=…` e `X-CSRF-Token` (aggiornato da
  `x-updated-csrf-token`); `POST /api/auth/logout` alla fine, anche dopo un errore.
- **Sola lettura**: `isUnifiRequestAllowed` ammette in più solo
  `POST /api/auth/login` e `POST /api/auth/logout`.
- **Fail-closed, nessun nuovo tentativo**: 401 «utente o password non accettati
  dalla console»; 403 (e 499, secondo fattore richiesto) «account senza permessi
  sull'app Network o con la verifica in due passaggi: serve un account locale
  senza 2FA»; 429 «la console ha bloccato i tentativi: riprova fra qualche
  minuto». Il login non si ripete mai nel giro.
- **Certificato**: lo stesso `cert_pin` fissato al primo uso (TOFU); la password
  parte solo su un socket verificato.
- **Avviso «scegli UDM»**: se un controller `self_hosted` fallisce il login senza
  la risposta tipica della Network Application, o lo si salva, una `GET /`
  anonima (nessuna credenziale, nessun cookie, fuori da `isUnifiRequestAllowed`)
  guarda se la pagina è «UniFi OS» e lo dice.

## Alternative scartate

- **Solo chiave API (come prima)** — scartata: sul pilota la chiave non si può
  creare, e il controller resterebbe illeggibile.
- **Colonna `auth_method`** — scartata: i campi che ci sono già bastano a dire il
  metodo, e una colonna in più può contraddirli.
- **Ritentare il login dopo un errore** — scartato: dopo pochi tentativi la
  console blocca l'account (429), anche per chi lo usa a mano.

## Conseguenze

### Positive

- Un UDM si legge anche quando l'account non può creare chiavi.
- Il controller del pilota, salvato `self_hosted` con utente e password, passa a
  «UDM» dalla pagina senza riscrivere la password.
- Un `self_hosted` puntato a una console UniFi OS dice cosa cambiare invece di
  «credenziali rifiutate».

### Negative

- Una password di un account locale vive cifrata nel DB del cliente, come per
  `self_hosted`; la chiave API resta la via consigliata.
- Ogni giro fa login e logout (due richieste in più della chiave).

### Cosa diventa difficile in futuro

- **Serve un account locale senza 2FA**: un account Ubiquiti (cloud) o con la
  verifica in due passaggi non entra, e lo si dice col 403/499.
- **Blocco dopo troppi tentativi**: una password sbagliata in una pianificazione
  oraria consuma tentativi a ogni giro; il 429 ferma il giro ma non spegne la
  pianificazione.
- **Tappa 2f (credenziali dei controller nell'archivio)**: la conversione non può
  più assumere `udm` → «chiave». Deve prevedere il tipo «Controller UniFi: chiave
  o utente» anche per UniFi OS: `udm` con `api_key_enc` → chiave, `udm` con
  `username` + `password_enc` → utente.

## Riferimenti

- ADR 0005 (client UniFi, certificato fissato), ADR 0007 (controller nel DB del cliente)
- `src/lib/integrations/unifi-api.ts`, `src/lib/controllers/service.ts`,
  `src/components/controllers/controller-dialog.tsx`
- Prove: `src/lib/integrations/__tests__/unifi-os-utente.test.ts`,
  `src/lib/controllers/__tests__/service.test.ts`
- Piano della tappa 2: `docs/superpowers/plans/2026-10-15-tappa2-archivio-credenziali.md` (sotto-tappa 2f)
