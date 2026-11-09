# Prompt per il Claude Code del tecnico — estrazione di un apparato (BOZZA, 09/11/2026)

> **Bozza.** Presuppone l'alternativa **A + D** del §6 di
> [`2026-11-09-estrazione-device-tecnico.md`](2026-11-09-estrazione-device-tecnico.md), che **Riccardo non ha ancora
> deciso**. Presuppone anche gli script `raccogli-grezzo`, `anonimizza-grezzo`, `estrai-apparato` e `controlla-campione`,
> che **non esistono ancora**.
>
> Il prompt non è un freno: i divieti valgono davvero solo con le regole `deny` e l'hook sulla cartella privata, imposte
> dall'installer (domanda D3). Il testo fra le righe `---` è quello da incollare. Le parti fra `<…>` le compila il tecnico.

---

## Compito

Devi aggiungere a DA-IPAM la lettura di un tipo di apparato che oggi non sa leggere:
- vendor: `<vendor>`;
- famiglia: `<switch | router | firewall>`;
- modello: `<modello>`;
- firmware: `<firmware>`.

L'apparato è già registrato nel profilo cliente attivo di DA-IPAM, con id `<device_id>`, e ha una credenziale
`<ssh | snmp | api>` che tu **non vedi e non chiedi**.

Il risultato è un **collector** di DA-IPAM, cioè parser e voce di catalogo. Produce lo snapshot JSON 1.0
(`src/lib/acquisition/schema.ts`), dentro la busta `da-ipam-estrazione`. Lavori nel clone locale di DA-IPAM, su un ramo
`tecnico/<vendor>-<famiglia>`, mai su `main` o su `dev`.

Prima di cominciare leggi solo queste parti:
- `docs/modules/acquisition.md`, sezioni «Contratto JSON 1.0» e «Aggiungere una famiglia»;
- la voce di catalogo e il parser della famiglia più simile in `src/lib/acquisition/`. Per esempio `aruba-cx.ts` e
  `aruba-cx-parsers.ts` per una CLI `show`, o `comware-parsers.ts` per `display`.

Non leggere altro «per orientarti».

## Cosa NON deve mai arrivare a te (al modello)

Il repository è pubblico, e le regole di Domarc vietano che dati dei clienti arrivino a un modello esterno.

- **Mai** l'output vero dei comandi, mai i file della cartella privata del profilo (`<percorso cartella privata>`), mai il
  JSON d'estrazione vero. Lavori solo sul **campione anonimo** che ti indica il tecnico.
- **Mai** credenziali: password, chiavi, community SNMP, token. Non cercarle nel DB, in `.env.local`, nel vault o nei file
  di configurazione.
- **Mai** `ssh`, `snmpwalk`, `snmpget` o `curl` lanciati da te verso l'apparato, e nemmeno `cat` o `less` di un output grezzo.
  All'apparato si arriva **solo** dagli script del §«Come si prova», che stampano riepiloghi senza valori.
- Se in un campione noti qualcosa che sembra un dato vero, fermati e dillo al tecnico. Per esempio un IP fuori da
  `192.0.2.0/24`, `198.51.100.0/24` o `203.0.113.0/24`, un MAC che non comincia con `02:`, un nome di azienda, un seriale
  plausibile o un'email. Non ricopiarlo in nessun file.

## Comandi ammessi sull'apparato

Il trasporto rifiuta comunque tutto ciò che non è nell'allowlist del catalogo, o che contiene un verbo vietato.

**Puoi proporre nell'allowlist del catalogo** solo comandi di lettura.

- **SSH, CLI:**
  - `show …` e `display …`;
  - `get system …` e `get router info …` (FortiOS);
  - `/… print terse without-paging` (RouterOS);
  - `show … | display json` (Junos).
- **Paginazione, solo per la sessione:** `terminal length 0`, `screen-length disable` (vista utente), `no page`,
  `terminal pager 0`.
- **SNMP:** solo GET e walk, v2c o v3. Elenca gli OID, preferendo le MIB standard.
- **HTTP/API:** solo `GET` su endpoint nominati, più il solo endpoint di login.

**Vietati sempre**, anche come parte di un altro comando:
- `configure`, `conf t`, `system-view`, `edit`, `set`, `unset`, `delete`, `commit`;
- `write`, `save`, `copy`, `erase`, `format`, `reload`, `reboot`, `shutdown`;
- `clear`, `debug`, `execute`, `diagnose`, `request`, `test`, `ping`, `traceroute`, `terminal monitor`;
- `enable`, `su`, `sudo`;
- `/system reset`, `/export`, `show running-config`, `show startup-config`;
- SNMP SET;
- HTTP `PUT`, `PATCH`, `DELETE`, ogni `POST` che non sia il login, gli endpoint di backup o export.

Se un dato che serve si legge solo con un comando che non è in questi elenchi, **non aggiungerlo**: scrivilo al tecnico come
domanda.

## Cosa produrre

1. **Voce in `src/lib/acquisition/catalogo.ts`**:
   - `id` `<vendor>-<famiglia>`, in minuscolo e col trattino;
   - `versione: "0.1.0"`, `famiglia`, `prodotti`;
   - `credenziali` e `sezioni` che popoli davvero;
   - `comandi`, cioè l'allowlist, oppure la lista di OID o endpoint;
   - `collaudo: "non_collaudato"`, `collaudati: []`.
2. **Allowlist** in `src/lib/acquisition/comandi.ts`, se è una CLI.
3. **Parser puri** in `src/lib/acquisition/<id>-parsers.ts`: testo in ingresso, dati tipizzati in uscita, nessuna rete.
   - Colonne lette per nome, mai per posizione.
   - `null` = ignoto: mai 0, `false` o una lista vuota al suo posto.
   - Contatori come stringhe decimali; velocità in bit/s.
   - `if_index`, bridge port e nome di console non si confondono.
4. **Collector** `src/lib/acquisition/<id>.ts`:
   - una `section` per ogni parte dello snapshot, cioè identity, interfaces, vlans, forwarding, neighbors, network.arp,
     routes, spanning_tree, aggregation, poe e sensors;
   - ogni sezione con `status`, `collected_at`, `sources` (il comando che l'ha prodotta) e `warnings` (codici stabili);
   - una sezione che l'apparato non ha è `unsupported` o `skipped`, mai assente o `ok` vuota;
   - passa da `redactSnapshot` e `snapshotSchema.parse`.
5. **Registrazione** in `src/lib/acquisition/index.ts`, in `IMPLEMENTAZIONI`.
6. **Fixture** in `src/lib/acquisition/__tests__/contratto-fixture.ts`, presa **solo dal campione anonimo**. Metti un
   segreto di prova finto in un campo di testo libero, come il nome host, così la prova vede la redazione.
7. **Test del parser** in `src/lib/acquisition/__tests__/<id>-parsers.test.ts`, sul campione anonimo. Per ogni sezione
   controlla un valore preciso, non solo che «non è vuoto».
8. **Sezione nel manuale** `docs/modules/acquisition.md`: modello e firmware, comandi, cosa non si legge e perché.

Forma della busta e un esempio completo: §2 di `docs/revisione/2026-11-09-estrazione-device-tecnico.md`.

## Come si prova

Tutti i comandi partono dalla radice del clone. Tetto di **2 minuti** per prova: una verifica più lunga non si lancia, si
scrive «non verificato: X».

1. **Parser, sul campione**:
   `node --import tsx --test src/lib/acquisition/__tests__/<id>-parsers.test.ts src/lib/acquisition/__tests__/contratto.test.ts`
2. **Tipi**: `npx tsc --noEmit`. Si lancia una volta, a fine lavoro.
3. **Sull'apparato vero**: lo lancia il tecnico, oppure tu, se te lo dice. Il comando stampa solo stato per sezione, righe e
   codici d'avviso:
   `node --import tsx scripts/estrai-apparato.ts --device <device_id> --collector <id>`
   - una sezione `error` o `partial`: leggi il codice d'avviso, poi chiedi al tecnico un campione anonimo di **quel solo
     comando** (`scripts/raccogli-grezzo.ts`, poi `scripts/anonimizza-grezzo.ts`);
   - due fallimenti di fila senza una causa chiara: fermati e chiedi. Niente terzo tentativo.
4. **Import**: il tecnico apre la scheda dell'apparato in DA-IPAM, tab Gestione, «Importa estrazione», e guarda porte, VLAN e
   Mappa porte.
5. **Prima del push**: `node --import tsx scripts/controlla-campione.ts`. Se trova un valore vero nella fixture, il push non
   si fa.

## Consegna

- Aggiorna la voce di catalogo:
  - `collaudo: "collaudato"`;
  - `collaudati: [{ modello, firmware }]`, come li riporta il riepilogo di `estrai-apparato`;
  - `versione: "1.0.0"`.
- Commit sul ramo `tecnico/<vendor>-<famiglia>` in italiano. Una riga nel `CHANGELOG.md` sotto «[Non rilasciato]», col
  perché.
- Push del ramo e PR verso **`dev`**, mai `main`. Nella descrizione metti:
  - modello e firmware;
  - le sezioni lette e quelle no, col motivo;
  - le prove lanciate e il loro esito.

  **Nessun IP, nome o seriale veri.**
- Al tecnico, in chiaro: cosa funziona, cosa non è stato provato, cosa resta aperto.

---

## Note per chi mantiene questo prompt

- Va riallineato quando gli script esistono, perché i nomi sono provvisori, e quando Riccardo decide D1, D2, D3, D5 e D9.
- Con l'alternativa C (modello interno) il §«Cosa NON deve mai arrivare a te» cambia. Con l'alternativa E cade quasi tutto,
  ma restano credenziali e config.
