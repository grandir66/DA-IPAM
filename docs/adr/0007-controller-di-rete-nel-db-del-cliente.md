# ADR 0007 — Controller di rete: più controller, nel DB del cliente

**Stato:** Accepted (modifica in parte l'ADR 0005)
**Data:** 2026-10-13
**Autore:** Riccardo Grandi, con Claude

## Contesto

La tappa 2 (ADR 0005) ha portato la lettura del controller UniFi con una sola
configurazione, nelle impostazioni globali dell'hub (`integration_unifi_*` in
`hub.db`), gestita da una card in Impostazioni → Moduli. Tre limiti emersi il
12-13/10:

- **un controller solo**: la rete Domarc ha una console UniFi OS (UDM Beast) e
  un Cloud Key; i clienti useranno anche Omada. Una configurazione unica non li
  contiene;
- **configurazione non legata a un tenant** (limite già scritto nell'ADR 0005):
  sull'hub con più clienti non si sa di chi sia il controller;
- **solo self-hosted**: la UDM Beast si legge con una chiave API (UniFi OS), non
  con utente e password; il client diceva «non ancora implementato».

Riccardo ha chiesto di gestire i controller dentro le acquisizioni, in una
sezione propria, con UniFi e (più avanti) Omada. Interfaccia proposta oggetto
per oggetto e approvata il 13/10.

## Decisione

**I controller diventano righe di una tabella del DB del cliente
(`network_controllers`), con il loro storico delle letture
(`network_controller_runs`) e una pagina «Controller di rete» (`/controllers`)
che sostituisce la card.**

- Ogni riga ha tipo (`udm`, `self_hosted`, `omada`), indirizzo, site,
  credenziali cifrate come nell'hub (AES-GCM), impronta del certificato propria
  (TOFU come prima), stato acceso/spento e riepilogo dell'ultima lettura.
- La lettura resta `syncUnifiForTenant` della tappa 2, invariata nella logica:
  riceve il client del controller come sorgente (`src/lib/controllers/service.ts`).
- La pianificazione di un controller è un job `unifi_sync` con
  `config.controller_id`: si riusa lo scheduler senza toccare il CHECK dei tipi
  di job (che la tappa 3c ricostruisce). «Ogni giorno» parte alle 03:00, perché
  lo scheduler sa fare solo quello: niente orario a scelta.
- Backend UniFi OS: `GET /proxy/network/api/s/<site>/stat/device` con
  l'intestazione `X-API-KEY`, stesso formato di risposta del self-hosted. La
  chiave parte solo dopo la verifica dell'impronta sullo stesso socket, come la
  password.
- «Stato moduli» **non contatta più i controller**: legge l'esito dell'ultima
  lettura. Prima era un login a ogni apertura della dashboard (tenuto cinque
  minuti); con più controller sarebbero stati più login nel registro accessi del
  cliente per sapere una cosa che lo storico sa già.
- La configurazione vecchia dell'hub si porta nella tabella **una volta per
  tenant** (segno `controllers_legacy_unifi` in `tenant_settings`), copiando i
  segreti cifrati come sono, solo se l'hub ha un tenant attivo. Le chiavi vecchie
  restano nell'hub, non lette: servono a tornare indietro.
- Omada esiste nel vocabolario e nel modulo (visibile, non selezionabile): si
  accende dopo la misura su un controller vero. Il controller Omada di Domarc
  (`da-omada`) serve i clienti: non si legge dall'hub di Domarc.

## Alternative scartate

- **Tenere la configurazione nell'hub, con un elenco JSON** — scartata: resta
  non legata a un tenant, e i segreti di più controller in una sola chiave.
- **Tabella dei controller nell'hub con una colonna tenant** — scartata: la
  regola del progetto mette nel DB del cliente ciò che è del cliente; un
  controller è dell'impianto di quel cliente.
- **Un tipo di job nuovo (`controller_sync`)** — scartata per ora: vuol dire
  ricostruire `scheduled_jobs` per il CHECK, lavoro della tappa 3c (v9). Con
  Omada acceso si rivede.
- **Sonda di salute dal vivo per ogni controller** — scartata: login ripetuti
  nel registro del cliente, tempi della dashboard che crescono col numero dei
  controller.
- **Integration API ufficiale (`/proxy/network/integration/v1`)** per UniFi OS —
  scartata come fonte principale: non dà la tabella delle porte né i vicini
  LLDP, che sono il motivo della lettura.

## Conseguenze

### Positive

- Più controller per cliente, ognuno col suo certificato, la sua pianificazione
  e il suo storico; si chiude il limite «configurazione non legata a un tenant».
- Le console UniFi OS si leggono (la UDM Beast di Domarc, appena la chiave API è
  valida).
- La dashboard non fa più login sui controller dei clienti.

### Negative

- Dopo il rilascio, finché nessuno lancia una lettura, «Stato moduli» dice «mai
  letto» per un controller che prima risultava «ok» dalla sonda dal vivo.
- Il backend UniFi OS è scritto e provato su un trasporto finto che riproduce
  la risposta vera di `stat/device`; non è ancora misurato su una console vera
  (la chiave del vault il 13/10 risultava rifiutata).
- I job `unifi_sync` nati prima, senza controller, falliscono col motivo invece
  di leggere: si ripianificano dalla pagina (il passaggio li lega al controller
  portato dall'hub, se c'era).

### Cosa diventa difficile in futuro

- Gli apparati letti non portano ancora il controller da cui vengono: due
  controller che vedono lo stesso switch lo aggiornano entrambi (abbinamento per
  seriale, quindi niente doppioni, ma «chi l'ha visto» non si sa). Servirà una
  colonna di provenienza prima dei client della tappa 4.
- Il nome `unifi_sync` del tipo di job resterà anche per Omada finché la 3c non
  ricostruisce `scheduled_jobs`.

## Riferimenti

- ADR 0005 (integrazione UniFi, tappa 2), ADR 0002 (import statico di db-tenant)
- Piano di miglioramento `docs/superpowers/specs/2026-10-12-piano-miglioramento-design.md`, tappa 4
- Codice: `src/lib/controllers/`, `src/app/api/controllers/`, `src/components/controllers/`
