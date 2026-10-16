# ADR 0017 — Archivio unico delle credenziali: tipi senza CHECK, validazione in `tipi.ts`

**Stato:** Accepted — tappa 2 chiusa il 2026-10-16: 2g rilasciata (v0.3.310) e pulizia dei dati vecchi applicata su hub, cliente A e pilota (16:12-16:19 ora italiana)
**Data:** 2026-10-16
**Autore:** riccardo.grandi@gmail.com (decisione), sessione Claude (stesura)

## Contesto

La spec del 15/10 (`docs/superpowers/specs/2026-10-15-credenziali-promozione-wizard-design.md`, §3
«Tappa 2») chiede un archivio unico con otto tipi per esteso: SSH (password o chiave), SNMP v1/v2c,
SNMP v3, Windows (WinRM e WMI), API (token o utente), Controller UniFi, Controller Omada, Active
Directory; `linux` confluisce in SSH. La tabella `credentials` aveva un CHECK su cinque tipi
(`ssh|snmp|api|windows|linux`): SQLite non modifica un CHECK, quindi ogni tipo nuovo voleva una
ricostruzione della tabella, con dieci colonne in nove tabelle che la referenziano (cinque in CASCADE).
Le misure del 15/10: hub 10 voci (1 `linux`), cliente A 5.

## Decisione

La tabella `credentials` si ricostruisce **una volta** senza CHECK sul tipo (sotto-tappa 2c,
`src/lib/credentials/migra-credenziali-tipi.ts`), partendo dalla definizione attuale in `sqlite_master`
come per `migra-apple-macos.ts`, con chiavi esterne spente fuori dalla transazione, conteggi dei figli
per colonna e `foreign_key_check` prima/dopo, `sqlite_sequence` conservato. I tipi validi stanno in un
posto solo, `src/lib/credentials/tipi.ts` (lista, etichette, regola tipo ↔ protocollo), che usano API,
pagina, wizard e motore. La normalizzazione (`normalizza-tipi.ts`) porta `linux` a `ssh` e le v3 vecchie
al tipo SNMP v3, con un segno in `tenant_settings` (`credenziali_t2_tipi`) che impedisce di rifarla.

## Alternative scartate

- **Un CHECK nuovo con gli otto tipi** — scartata: ogni tipo futuro richiederebbe un'altra ricostruzione
  della tabella più referenziata del tenant, con lo stesso rischio di cascata.
- **Tipo in una tabella di riferimento con FK** — scartata: una tabella in più da migrare e da tenere
  allineata fra hub, tenant ed export, per un elenco che cambia di rado e che il codice deve conoscere
  comunque (campi, prove, porte).
- **Lasciare `linux` come tipo a sé** — scartata dalla spec: per l'accesso è SSH.

## Conseguenze

### Positive

- Tipi nuovi senza toccare lo schema; una validazione sola.
- Il cliente A e l'hub passano una ricostruzione sola, provata a vuoto sulle copie.

### Negative

- Il database accetta qualunque stringa come tipo: la garanzia è solo nel codice (Zod e `tipi.ts`). Uno
  script che scrive direttamente nel DB può inserire un tipo sconosciuto; il motore lo ignora e la
  pagina lo mostra come sconosciuto.

## Cosa diventa difficile dopo

- Ogni scrittura in `credentials` deve passare dal CRUD (`insert-credentials-solo-crud.test.ts` lo
  presidia): un INSERT diretto salta la validazione.
- Un bundle esportato dopo la 2c, importato in un'installazione di prima, viene annullato per intero se
  contiene tipi nuovi (SNMP v3, UniFi, Omada, AD); le voci SSH a chiave vi arrivano senza la chiave.
- Tornare indietro dalla 2c non rimette il CHECK: il revert del codice lascia la tabella senza vincolo
  (innocuo) ma le voci convertite restano `ssh`/`snmp_v3`, che il codice di prima non conosce.

## Aggiornamento del 16/10 — 2g: l'archivio è l'unico posto (T26, T27)

Non cambia la decisione qui sopra; la completa. Dalla 2g le credenziali stanno **solo** nell'archivio:

- il motore non legge più binding inline, colonne di `network_devices`, catene vecchie, chiavi «di default»
  dell'hub e colonne di controller e AD (T26);
- i segreti rimasti lì li toglie uno script, `scripts/credenziali/pulizia-t2.ts`, mai `getTenantDb`: su
  un'appliance che riceve `main` la pulizia girerebbe all'apertura senza prova a vuoto, backup e conferma. Lo
  script controlla le condizioni (`condizioni-2g.ts`), fa il backup accanto al DB, chiede la conferma scritta e
  scrive il segno `credenziali_t2_pulizia`. Colonne svuotate, tabelle `network_host_credentials` e
  `host_detect_credential` tolte; le colonne restano nello schema (toglierle vorrebbe dire ricostruire
  `network_devices`, la tabella più collegata). Decisioni di Riccardo del 16/10: niente attesa di 14 giorni (D9
  rivista) e i due apparati lasciati dell'hub accettati, svuotati come gli altri, elencati nel segno;
- lo schema dei tenant nuovi non crea più le due tabelle vecchie; `togli-chiavi-hub.ts` toglie da hub.db le chiavi
  di D3 e le `integration_unifi_*` quando nessuna conversione le legge più.

### Cosa diventa difficile dopo la pulizia

- Tornare indietro non si fa col solo revert del codice: il codice di prima rileggerebbe colonne e catene che non ci
  sono più (e ricreerebbe le due tabelle vuote). Serve il `.bak` del tenant, e si perde quello che è stato scritto
  dopo l'ora del backup.
- Un bundle di prima della 2g porta ancora catene vecchie e pin: l'import li converte in memoria (tabelle temporanee),
  quindi `converti-catene.ts` e la conversione della 2e restano finché esistono bundle o appliance di prima.
- Un DB tenant mai aperto dopo la 2c (il DEFAULT dell'hub) farà tutte le conversioni alla prima apertura, ma la
  pulizia lì non parte da sola: va lanciata a mano, con le stesse condizioni.
