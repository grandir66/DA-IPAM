# Installazione snella e collegamento al centrale — piano di esecuzione

> Si esegue con la skill `subagent-driven-development` oppure in linea
> (una sessione che esegue i task in ordine). Le caselle `- [ ]` tengono il conto.

**Obiettivo:** dai clienti un'installazione DA-IPAM leggera, che manda inventario e config a un DA-IPAM centrale per `codcli` e ne riceve ordini da un elenco chiuso.
**Architettura:** l'installazione fa tutto il lavoro e apre ogni connessione. Il centrale riceve copie, le mostra e firma ordini; non scansiona e non tiene credenziali degli apparati. Stesso codice di DA-IPAM, con un profilo «centrale» che tiene attive solo le rotte elencate.
**Spec:** [ADR 0035](../../adr/0035-installazione-snella-e-collegamento.md); sezione del 2026-11-07 in `TASKS.md`.
**Livello di controllo:** completo (deciso da Riccardo il 2026-11-07).
**Stato:** approvato · **Ultimo aggiornamento:** 2026-11-08

## Vincoli globali

- **Stesso codice (Riccardo, 07/11): «il codice non deve essere diverso da ipam completo, solo avere il modulo per centralizzare i dati e le funzioni aggiuntive spente».** Niente ramo, niente versione a parte di DA-IPAM: la versione ridotta è il DA-IPAM di sempre con il collegamento al centrale e il resto spento. Ciò che cambia sta nell'installazione (Deploy-Appliance), mai nel codice di DA-IPAM.
- Risposte di Riccardo del 07/11: solo tecnici Domarc nel centrale; config solo lette e archiviate; segreti delle config cifrati per `codcli`, `/etc/pve/priv` escluso; appliance attuali aggiornate senza reinstallare; chi ha la VA tiene Edge; prima prova su PX-NAS; il dato completo esce solo per scelta del cliente.
- Un'installazione resta un cliente (12/10). Niente DA-Auth sulle installazioni.
- ADR 0011: ogni connessione la apre l'installazione; nessuna policy unisce due remoti; niente rotte verso la LAN del cliente; niente gruppo `All`.
- Il livello di uscita lo decide l'installazione, mai il centro. Senza una scelta dichiarata esce solo lo stato.
- Automatismi nuovi spenti di serie. Sull'installazione spento vuol dire identico a oggi, bit per bit.
- `main` di DA-IPAM: si tocca solo col sì di Riccardo. Nessuna immagine nuova senza il suo via.
- Sistemi dei clienti: nessun intervento senza conferma. Laboratorio e VM Domarc: snapshot prima, nome e nodo nel resoconto. Mai la VM 423.
- DA-IPAM: Node 22, `db-tenant` importato solo staticamente, ogni rotta con guardia e `withTenantFromSession`, schema con `ALTER TABLE` idempotente, niente `any`.
- Cancello DA-IPAM, letto dal codice di uscita: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`. Poi `npm run version:release -- --staged-only` e `git push origin dev`.
- Deploy-Appliance e DA-Link: lavoro in worktree da `origin/main`, PR su `main`. Prima di commit si rilegge `origin`, mai `git add -A`.
- Credenziali solo via `vault-a-stdin`, mai a schermo.

## Passi

| ID | Stato | Passo | Agente | Dipende da | Fatto quando | Verifica |
|---|---|---|---|---|---|---|
| S1 | [x] | Misura con l'immagine attuale e moduli spenti | in linea | — | peso vero scritto nel piano, soglie decise | misure 24 h sulla VM di prova |
| S2 | [x] | Immagine snella | implementer | S1 | installazione senza Docker sul PX-NAS | `da-appliance verifica` verde |
| S3 | [~] | Moduli e pesi in DA-Link | implementer | S2 | la procedura propone la variante | prove DA-Link + una bozza vera |
| S4 | [ ] | Coda comune senza vicolo cieco | implementer, tester | — | 7 giorni di caduta si recuperano da soli | prove della coda |
| S5 | [ ] | Terzo livello di uscita | implementer | — | `completo` accettato da DA-Link e scelto solo in locale | prove dei due repo |
| S6 | [ ] | Fotografia completa | implementer, tester | S5 | lista bianca provata, peso misurato | prova sui campi, misura su 533 |
| S7 | [ ] | Profilo centrale | implementer, reviewer | — | senza profilo nulla cambia | prova di equivalenza |
| S8 | [ ] | Muri del tenant | implementer, reviewer | S7 | nessun ripiego, rotte in elenco | prove viste fallire |
| S9 | [ ] | Ricezione per `codcli` | implementer, tester, reviewer | S6, S8 | il `codcli` viene solo dal gettone | prove d'attacco |
| S10 | [ ] | VM del centrale e rete | in linea | S9 | una VM di laboratorio trasmette | `da-link-verifica` verde, riga nel DB |
| S11 | [ ] | Viste del centrale | implementer | S10 | pagine approvate da Riccardo | resa a 1280 e 1920 |
| S12 | [ ] | Ordini firmati | implementer, tester, reviewer | S10 | un ordine storto non parte | prove viste fallire |
| S13 | [ ] | Azioni dell'elenco | implementer, tester | S12 | quattro azioni provate in laboratorio | esiti e giornale |
| S14 | [ ] | Archivio config MikroTik e Proxmox | implementer, tester, reviewer | S9, S13 | versioni e differenze, segreti cifrati | prove + router e nodo di laboratorio |
| S15 | [ ] | Config degli switch | implementer | S14 | un produttore alla volta, da campioni veri | prove su campione |
| S16 | [ ] | Passaggio delle appliance attuali | in linea | S13 | 79993-ipam-2 trasmette dopo l'aggiornamento | stato a schermo |
| S17 | [ ] | Lettura dei centralini 3CX | implementer, tester | S9 | interni, trunk e versione nel centrale, nulla installato sul centralino | prove + centralino di laboratorio |

Fermate col sì di Riccardo: dopo S1 (soglie), prima di S2 (immagine), prima di S11 (interfaccia), prima di S13 per `aggiorna`, prima di S16 (`main`). In parallelo si possono proporre S4 e S5, e S7 dopo S1: niente file in comune.

## Casi da non dimenticare

- NetBird giù per giorni: oggi dopo 12 tentativi la riga si ferma. Coperto da S4.
- DA-Link vecchio riceve `completo` e rifiuta tutto il segnale con 422. Coperto da S5: prima DA-Link.
- VM clonata: due nodi con lo stesso gettone. Coperto da S9.
- Il cliente abbassa il livello: il centrale deve cancellare ciò che ha. Coperto da S9.
- Un'installazione ripristinata da snapshot perde il progressivo degli ordini: resta la scadenza. Coperto da S12.

---

## Tappa 1 — Installazione snella

### [x] Task 1 — Misura con l'immagine attuale e moduli spenti

Nessun codice: serve a sapere il peso vero prima di costruire un'immagine.

- **Dove:** una VM nuova del cliente di laboratorio 79993 sul PX-NAS, immagine `ULTIMO`, creata da DA-Link con `ipam`, `zabbix` e `trunk` accesi; `edge`, `meshcentral`, `librenms`, `wazuh`, `proxreporter` spenti. La riga è in `dalink/appliance_immagine.py`, `PREDEFINITI`.
- **Si misura** subito e dopo 24 ore, in un solo comando: `free -m`, RSS di ogni processo sopra 50 MB, `df -h`, `docker ps`, `du -sh` di `/opt/da-ipam`, `/opt/da-invent/data`, `/var/lib/docker`, `/opt/sensore-trunk`.
- **Riferimenti:** DA-Link stima base 1,5 GB, DA-IPAM 0,5, Zabbix 0,5. La 533 fa 827 MB con 3,6 GB di tenant. Proxy Zabbix e sensore non vogliono Docker: il primo è un pacchetto Debian, il secondo sta in `/opt/sensore-trunk/venv`.
- **Soglie proposte, da confermare dopo la misura:** a riposo sotto 3 GB, RAM assegnata 4 GB, disco 40 GB. In questa sede si decide se togliere anche Docker.

Verifica: tabella delle misure qui sotto, con data e fonte.

### [x] Task 2 — Immagine snella

- **File (Deploy-Appliance):** `costruttore/costruisci.sh` (nuova opzione `--variante piena|snella`, di base `piena`), `costruttore/elenco-sigillo.txt`, `costruttore/pacchetto-aggiornamento.sh`, `lib/immagine.sh`, `primo-avvio/fasi/moduli.sh`, `primo-avvio/verifica.sh`, prove in `tests/`.
- **Cosa fare:** con `snella` niente Greenbone, immagini di Edge, LibreNMS e MeshCentral, e niente Docker se il Task 1 lo consente. Elenco di Riccardo, 07/11: «l'immagine deve avere solo ipam, proxy zabbix, gli script per proxmox, mikrotik, 3cx....». Più NetBird, che serve al collegamento. `sensore-trunk` entra e resta acceso (Riccardo, 07/11: «no acceso»). La riga di rilascio è separata da `ULTIMO`: `ULTIMO-SNELLA`, firmata come l'altra.
- **Interfacce:** il file d'avvio `moduli.*` non cambia. Un modulo chiesto e assente nell'immagine fa fallire `avvio.py` con un messaggio chiaro, prima di toccare la macchina.
- **Prova prima del codice:** chiedere `moduli.edge` a un'immagine snella viene rifiutato.

Verifica: installazione dalla variante snella sul PX-NAS, `da-appliance verifica` verde, trunk e proxy vivi. Commit in PR; il rilascio dell'immagine aspetta il via.

### [~] Task 3 — Moduli e pesi in DA-Link

- **File (DA-Link):** `dalink/appliance_immagine.py` (`RAM`, scelta della variante in base ai moduli), `dalink/cli_immagine.py`, relative prove.
- **Cosa fare:** se nella bozza non ci sono Edge, LibreNMS e MeshCentral, la procedura propone la variante snella e i pesi veri del Task 1. Chi aggiunge Edge dopo deve passare alla piena: lo si dice a schermo prima di salvare.

Da aggiungere, emerso dal Task 2:

- `host/installa-appliance.sh` (Deploy-Appliance) impone 12 GB e `MINIMO_GB=120`: per la snella 4 GB e 40 GB.
- `dalink immagine rilascia` non deve spostare `ULTIMO` su una versione snella. Riga `ULTIMO-SNELLA`, manifest con la variante.
- Proxreporter acceso e `aggiorna.sh` si provano qui, con l'installatore vero.

Verifica: prove DA-Link verdi, una bozza vera preparata per il cliente 79993.

**Stato 08/11/2026 (Riccardo: «procedi»).** Codice fatto in due PR aperte:
[Deploy-Appliance #76](https://github.com/grandir66/Deploy-Appliance/pull/76), da unire per prima, e
[DA-Link #86](https://github.com/grandir66/DA-Link/pull/86).
- Deploy-Appliance: `"variante"` nell'elenco firmato; `installa-appliance.sh --variante`, con la snella a 4 GB e 40 GB e i moduli della piena rifiutati prima di toccare l'host. Un elenco di un'altra variante non viene ripristinato. `aggiorna.sh` rifiuta il cambio di variante. Cancello verde, 54 gruppi.
- DA-Link: rilascio su `ULTIMO-SNELLA`; «Prova» delle due righe, con `ULTIMO` su una snella segnato rosso. La bozza sceglie la ridotta dai moduli solo se ce n'è una provata, quindi senza una ridotta pubblicata nulla cambia. La variante installata resta nella bozza per Riconfigura, Aggiorna, trunk e «Riusa». Pagina guardata coi dati finti. Cancello verde, 3138 prove.
- Scelta fatta: niente casella «piena anche senza Edge». La variante segue i moduli, e chi aggiunge Edge dopo reinstalla con la piena, come deciso.
- 08/11, fatto con i sì di Riccardo:
  - PR unite: Deploy-Appliance #76 e DA-Link #86.
  - DA-Link in produzione al `5ebe6f1`, con snapshot `pre-snella-20261108` della VM 109 su DA-PX-02.
  - Ridotta **2026.11.92** costruita dal `main` di Deploy-Appliance e pubblicata. Firmata da DA-Link: `ULTIMO-SNELLA` punta alla 2026.11.92, `ULTIMO` resta 2026.10.25. La «Prova» delle due origini è ok su tutte e due le righe.
  - Difetto trovato pubblicando: la pulizia dello specchio proteggeva solo `ULTIMO` e ha tolto la 2026.10.24. Corretto in Deploy-Appliance #77, unita.
- **Installazione vera, 08/11 (Riccardo: «Sì, installa»).** Bozza 32 di DA-Link, `79993-ipam-5`, preparata con le funzioni della pagina: variante ridotta, 2026.11.92, installatore della sua immagine, 4 GB. Comando incollato sul PX-NAS così come lo dà DA-Link. Esito della VM 108:
  - Download, impronta, ripristino, primo avvio, NetBird e credenziali a DA-Link tutti ok.
  - **Proxreporter acceso**: «raccoglie da 1 host».
  - `da-appliance verifica` dice «Tutto ciò che è acceso funziona».
  - Senza Docker; 4 GB di RAM con 4 di swap, 1,2 GB usati; 8,9 GB su 40 di disco.
  - Nei primi minuti DA-IPAM ha risposto 502 perché l'aggiornamento automatico di DA-IPAM ricompilava (5 minuti, 700 MB di swap al picco), poi verde. **Da sapere**: chi apre l'appliance subito dopo l'installazione può trovare un 502 per qualche minuto.
  - L'installatore ha proposto lo storage `ZFS-LARGE-replica-replica`, il primo dell'elenco con più spazio: è una scelta della ricognizione, non della ridotta. Da guardare se è il disco giusto per il PX-NAS.
- **`aggiorna.sh` sulla ridotta non è ancora provato**: serve una ridotta più nuova della 2026.11.92 da pubblicare. Il rifiuto di un cambio di variante è coperto dalle prove, non sul vero.
- **Ridotta su una Debian già installata, 08/11 (piano A, Riccardo: «Sì, due sessioni»).** Deploy-Appliance PR #78 e DA-Link PR #87, unite.
  - L'installatore (`host/installa-debian.sh`) prende l'elenco firmato della ridotta e tutti i componenti del pacchetto d'aggiornamento, poi lancia sulla Debian la preparazione della VM modello col codice della versione. Così va già con la 2026.11.92.
  - Prova vera sul PX-NAS: VM 110 `79993-debian-prova`, Debian 13 netinst (ifupdown, senza `curl` né netplan), file d'avvio vero di DA-Link. Bozza 34 `79993-ipam-6`: DA-IPAM, Zabbix, sonda condivisa, IP cambiato da `.61` a `.7`. `da-appliance verifica` verde, anche dopo un riavvio. 9,1 GB su 38 di disco, niente Docker.
  - Rilascio col sì di Riccardo (08/11): PR unite, `debian/installa-debian.sh` nella 2026.11.92 firmata, DA-Link `f0d721e` in produzione. Prova dal comando per Debian di DA-Link (bozza 35 `79993-ipam-7`, VM 110 dallo snapshot): verde.
  - Non ci sono ancora Riconfigura e Aggiorna per una Debian. Il mini PC fisico è coperto solo dalle prove automatiche.
- Prove sul PX-NAS da togliere quando lo dice Riccardo: VM 106 (`79993-ipam-3`) e 107 (`79993-ipam-4`), con le loro registrazioni in DA-Link. **La VM 963 (`79993-ipam-2`) è vera e resta** (Riccardo, 08/11).

---

## Tappa 2 — Trasferimento

### [ ] Task 4 — Coda comune senza vicolo cieco

- **File:** crea `src/lib/trasferimento/coda.ts` e `src/lib/trasferimento/__tests__/coda.test.ts`; modifica `src/lib/vulcan/coda.ts` perché deleghi; schema in `src/lib/db-tenant-schema.ts` (tabella `centrale_coda`, stessa forma di `vulcan_coda`).
- **Interfacce:** `creaCoda({ tabella, maxTentativi, backoffS }) → { accoda, prendiProssimi, segnaInviato, segnaRitento, segnaScartato, rilascia, rimettiFalliti, conteggiCoda, puliziaCoda }`. Con `maxTentativi: null` una riga non va mai in `fallito`.
- **Cosa fare:** il comportamento verso Vulcan resta identico: `MAX_TENTATIVI = 12`, stesse prove, nessuna modificata. La coda verso il centrale usa `maxTentativi: null` e un tetto di attesa di 1 ora. Un inventario nuovo supera quello in attesa, quindi non cresce.
- **Prova vista fallire:** 7 giorni di errori simulati, al ritorno della rete parte l'ultimo inventario senza un clic.

Verifica: `node --import tsx --test src/lib/trasferimento/__tests__/coda.test.ts` e prove esistenti di `lib/vulcan` senza modifiche.

### [ ] Task 5 — Terzo livello di uscita

Ordine obbligato: **prima DA-Link**, altrimenti il segnale prende 422.

- **DA-Link:** `dalink/segnale.py:87`, `dalink/kit/configurazione.py:80,374`: si aggiunge `completo`. Abbassando il livello si cancellano i dati come già avviene per i numeri.
- **DA-IPAM:** `src/lib/dalink/stato.ts:16`, `src/app/api/dalink/livello/route.ts`, la pagina che sceglie il livello. In `segnale.ts` `completo` manda gli stessi numeri di `stato_inventario`: il dato vero passa dal Task 6.
- **Cosa fare:** il livello si sceglie solo in locale, con la frase che dice cosa esce.

Verifica: prove dei due repo; una prova che fallisce se il valore viene da DA-Link o da un ordine.

### [ ] Task 6 — Fotografia completa

- **File:** crea `src/lib/trasferimento/corpo-completo.ts`, `dati-completo.ts`, `job.ts`, con prove; aggancio in `server.ts` accanto al job di Vulcan.
- **Interfacce:** `costruisciFotografia(dati) → { schema_versione: 1, codcli, nodo, generato_il, reti, host, apparati, porte, vlan, trunk_vlan, trunk_vicini, acquisizioni }`. Funzione pura, oggetti costruiti campo per campo come `corpo-inventario.ts`.
- **Cosa fare:** alle 03:00 ora italiana, solo con livello `completo` e `CENTRALE_URL` e `CENTRALE_TOKEN` in `oggetto.env`. Mai `mac_ip_history`, credenziali, chiavi, testi d'errore.
- **Prova:** un dato finto con un campo credenziale in ogni tabella non esce; ogni nome di campo in uscita sta nell'elenco.
- **Misura:** peso compresso calcolato sui dati dell'hub, in sola lettura. Se supera 50 MB si riapre il formato prima di proseguire.

Verifica: prove verdi, misura scritta qui sotto.

---

## Tappa 3 — Centrale

### [ ] Task 7 — Profilo centrale

- **File:** crea `src/lib/profilo.ts` e prove; modifica `server.ts`, `src/lib/modules/registry.ts`, `src/proxy.ts`.
- **Interfacce:** `profilo(): "installazione" | "centrale"`, da `DA_PROFILO`. Assente = `installazione`; valore sconosciuto = l'app non parte.
- **Cosa fare:** con `centrale` non partono scheduler, salvataggi periodici dei job, ricerca dei DC e motori. `src/proxy.ts` risponde 404 a ogni rotta fuori da `ROTTE_CENTRALE`, elenco nel codice.
- **Prova di equivalenza:** senza variabile, l'elenco dei job avviati e dei moduli è uguale a oggi.

Verifica: prove e cancello.

### [ ] Task 8 — Muri del tenant

- **File:** `src/lib/db.ts` (`getDb`, righe 172-185), `src/lib/api-tenant.ts` (riga 26 e seguenti), `src/lib/permessi/rotte.ts`, `src/lib/crypto.ts`.
- **Cosa fare:** col profilo centrale, niente contesto = errore, nessun `DEFAULT`, nessun `ipam.db`. Sessione senza `codcli` = 403. In `rotte.ts` ogni rotta di `ROTTE_CENTRALE` si dichiara `tenant` o `hub`, col motivo. Le 8 rotte `system-credentials` restano fuori dall'elenco. `__ALL__` ammesso solo nelle viste aggregate, in sola lettura.
- **Chiave:** `chiaveDelCliente(codcli)` con HKDF-SHA256 dalla chiave d'installazione, informazione `codcli`.
- **Prove viste fallire:** rotta senza dichiarazione, accesso senza contesto, una richiesta sul tenant A che chiede una riga di B, un segreto cifrato per A che B non apre.

Verifica: prove e cancello; revisione del passo con `reviewer`.

### [ ] Task 9 — Ricezione per `codcli`

- **File:** crea `src/app/api/centrale/ricevi/route.ts`, `src/lib/centrale/gettoni.ts`, `src/lib/centrale/fotografie.ts`, con prove. Schema: hub `centrale_gettoni` (`sha256`, `codcli`, `nodo`, `revocato_il`); tenant `centrale_fotografie`, `centrale_installazioni`.
- **Interfacce:** `POST /api/centrale/ricevi` con `Authorization: Bearer`, corpo gzip, massimo 200 MB. `DELETE /api/centrale/ricevi` con lo stesso gettone quando il livello scende.
- **Cosa fare:** il gettone stabilisce `codcli` e nodo, poi `withTenant`. `codcli` o `nodo` diversi nel corpo = 403 e riga d'audit, come fa già il segnale di DA-Link. Schema Zod chiuso. Doppione per sha256 = 200 senza riscrittura.
- **Prove d'attacco:** gettone di A con corpo di B; gettone revocato; stesso gettone da due nodi; corpo oltre il tetto; campo in più; cancellazione al calo del livello.

Verifica: prove e cancello; revisione del passo con `reviewer`.

### [ ] Task 10 — VM del centrale e rete

- **Dove:** VM nuova sui Proxmox Domarc, non la 533, con un'unità systemd come `da-invent` e `DA_PROFILO=centrale`. La sede e la RAM le dà Riccardo in questo task.
- **DA-Link:** gruppo `centro-ipam` in `dalink/rete.py`; `dalink-P13` in `dalink/politiche.py` (`remoto-ipam` → `centro-ipam`, 443); controlli R1–R5 aggiornati; comando `dalink kit centrale <n> [--applica | --stato | --revoca]`, modello `dalink kit vulcan`.
- **Deploy-Appliance:** blocco `centrale` nel file d'avvio, modello del blocco `vulcan`.
- **Accesso:** solo tecnici Domarc con l'accesso dell'hub. Regola del 12/10 invariata per le installazioni.

Verifica: `dalink politiche` a vuoto poi `--applica`, `da-link-verifica` verde; la VM del Task 2 trasmette e la fotografia sta nel DB del suo `codcli`. Snapshot prima, nome e nodo qui sotto.

### [ ] Task 11 — Viste del centrale

- **Prima di scrivere:** si propone a Riccardo ogni pagina, oggetto per oggetto (regola di `docs/STILE-UI.md`). Fermata.
- **File:** pagine sotto `src/app/(dashboard)/centrale/`, con i mattoni di `src/components/shared/console.tsx`.
- **Contenuto:** elenco dei clienti con età dell'ultima fotografia, livello, versione; scheda del cliente con link alla pagina dell'installazione. Una fotografia vecchia si dice «dati fermi dal…», mai «host spento».

Verifica: `verifica_pagine` e resa a 1280 e 1920 con dati finti.

---

## Tappa 4 — Comandi

### [ ] Task 12 — Ordini firmati

- **File:** crea `src/lib/centrale/ordini.ts` (lato centrale), `src/lib/ordini/verifica.ts`, `src/lib/ordini/giornale.ts`, `src/lib/ordini/job.ts` (lato installazione), `src/app/api/centrale/ordini/route.ts`, con prove.
- **Interfacce:** ordine `{ id, codcli, nodo, azione, parametri, emesso_da, emesso_il, scade_il, progressivo, firma }`, firma Ed25519. `verificaOrdine(ordine, { codcli, nodo, chiavePubblica, ultimoProgressivo, adesso }) → { ok: true } | { ok: false; motivo }`, funzione pura.
- **Cosa fare:** l'installazione chiede ogni minuto con `CENTRALE_ORDINI=1` in `oggetto.env`, spento di serie, e rifiuta `codcli` o nodo altrui, firma errata, scaduti, progressivo non crescente, azione sconosciuta, parametri fuori schema. Non c'è testo libero: niente `customArgs`, solo identificativi. Ogni ordine, accettato o no, va in `data/audit/ordini-AAAA-MM-GG.jsonl` con esito e utente, conservazione 365 giorni. La chiave pubblica sta nel blocco del Task 10.
- **Prove viste fallire:** ogni motivo di rifiuto, più un ordine con un'azione non nell'elenco firmato correttamente.

Verifica: prove e cancello; revisione del passo con `reviewer`.

### [ ] Task 13 — Azioni dell'elenco

- **File:** crea `src/lib/ordini/azioni.ts` con prove.
- **Azioni:** `lancia_giro { rete_id, tipo }`, `rileggi_apparato { apparato_id }`, `raccogli_config { apparato_id }` (dal Task 14), `aggiorna { versione }`.
- **Cosa fare:** ogni azione chiama la funzione che usa già il pulsante locale, dentro `withTenant`, rispettando lucchetti, ammessi e protetti. `aggiorna` riusa `src/lib/aggiornamento-servizio.ts` con il numero esatto, e parte solo col sì di Riccardo sul disegno: un aggiornamento fallito senza rete non si recupera dal centro.

Verifica: le azioni su una VM di laboratorio, esiti nel centrale e nel giornale.

---

## Tappa 5 — Config

### [ ] Task 14 — Archivio config MikroTik e Proxmox

- **File:** crea `src/lib/config-apparati/` (`raccogli.ts`, `archivio.ts`, `confronta.ts`, `maschera.ts`), con prove; tabella tenant `config_apparati` (`apparato_id`, `sha256`, `raccolta_il`, `testo_cifrato`).
- **MikroTik:** `getConfig()` di `src/lib/devices/router-client.ts`, poi `ripulisciExport`. Lettura dell'export riservata all'amministratore, come in `mikrotik-guardia.ts`.
- **Proxmox:** elenco fisso via SSH: `/etc/pve/storage.cfg`, `/etc/pve/datacenter.cfg`, `/etc/pve/nodes/*/lxc`, `/etc/pve/nodes/*/qemu-server`, `/etc/network/interfaces`. **Mai** `/etc/pve/priv`. Il `backup.py` di ProxReporter non si tocca.
- **Cosa fare:** si salva una versione solo se lo sha256 cambia. Il testo va al centrale cifrato con `chiaveDelCliente`.
- **Prove:** config identica = nessuna riga nuova; un percorso `priv` non è raggiungibile; un dato cifrato per A non si apre per B.

Verifica: router e nodo Proxmox di laboratorio; differenza fra due versioni a schermo.

### [ ] Task 15 — Config degli switch

Un produttore per commit, da un campione vero nel vault `collectors/`, mai nel repo.

- **File:** `src/lib/acquisition/comandi.ts`, `src/lib/config-apparati/maschera.ts`.
- **Ordine:** Comware `display current-configuration`; ProCurve `show running-config`; AOS-CX `show running-config`, che oggi è escluso di proposito (`comandi.ts:22`): si cambia quel commento dicendo perché. Poi gli altri su richiesta.
- **Cosa fare:** maschera di community SNMP, hash e chiavi, che fallisce chiusa: una riga non riconosciuta sospetta si nasconde.

Verifica: prova su campione per produttore.

### [ ] Task 17 — Lettura dei centralini 3CX

Riccardo, 07/11: «è l'installazione che potrà analizzare gli apparati e trasferire i dati». Sugli apparati non si installa niente: vale per MikroTik, Proxmox, switch e 3CX.

- **File:** crea `src/lib/acquisition/3cx.ts` con prove; il dato esce con la fotografia del Task 6.
- **Cosa leggere:** quello che oggi legge `agente-3cx` di DA-Zabbix (`zbximport/kpi_3cx.py`): interni, trunk, versione, FQDN. Via SSH con una credenziale dell'apparato, `psql` su `database_single` con l'utente `phonesystem`, solo query fisse in sola lettura. I trunk si provano in TCP sulla porta SIP.
- **Da verificare prima:** serve sudo verso `phonesystem` sul centralino, che oggi mette l'agente. I 3CX su Windows non sono coperti. Registrazione SIP e chiamate attive stanno in memoria nella console v20: non si leggono neanche oggi.
- **Prova:** una query fuori elenco non parte; un output inatteso dà «non so», mai zero interni.

Verifica: centralino di laboratorio, valori uguali a quelli di DA-Zabbix.

### [ ] Task 16 — Passaggio delle appliance attuali

- **Cosa fare:** con il sì di Riccardo al promote, 79993-ipam-2 prende il codice; `dalink kit centrale` gli dà il gettone; il livello si alza a mano sull'installazione. Il cliente vero viene dopo, uno alla volta, con conferma.
- **Documenti:** `CONTEXT.md`, `docs/scheda-mappa.md`, `CHANGELOG.md`, e nota nell'ADR 0011 per P13 e il terzo livello.

Verifica: stato a schermo nel centrale, ultima fotografia di oggi, `da-link-verifica` verde.

---

## Registro

- 2026-11-07 — Task 1 sospeso su richiesta di Riccardo (verifica di un'installazione su Debian senza immagine, esito in `TASKS.md`). Stato sul campo: bozza DA-Link 30, nodo `79993-ipam-3`, sede 3, `192.168.99.3/24`, moduli `ipam` e `zabbix`, trunk `condivisa`, comando valido fino all'08/11 17:41. Giro fermato durante lo scarico, nessuna VM creata; sul PX-NAS restano lo scarico parziale in `/ZFS-LARGE/replica/da-appliance-scarico` (5,8 GB, riprende da solo) e il registro `/root/install-79993-ipam-3.log`. Nessuna misura fatta. La RAM della VM sarà 12 GB, minimo di `RAM_MINIMA_VM`, non i 4 GB delle soglie proposte.
- 2026-11-07 — Riccardo: «Riprendi la misura». VM 106 `79993-ipam-3` creata sul PX-NAS, esito 0, prima misura qui sotto. Nessuno snapshot: VM nuova. Decisione sul pacchetto Debian ancora aperta in `TASKS.md`.

## Misure

### Task 1 — VM 106 `79993-ipam-3`, PX-NAS, 07/11 18:18-18:20 (fonte: `qm guest exec` sulla VM)

Immagine 2026.10.25 (`ULTIMO`), DA-IPAM `8920423`, moduli `ipam`, `zabbix`, trunk `condivisa`. VM da 12 GB (`RAM_MINIMA_VM`), 4 core, disco 160 GB su `ZFS-LARGE`. Installazione: 10 minuti dalla ripresa dello scarico, esito 0. **VM vuota e accesa da 2-3 minuti**: wizard non fatto, nessuna rete, nessuna scansione. Vale come pavimento, non come consumo in esercizio.

| Misura | Subito (2 min) | Dopo 1 min | 24 ore |
|---|---|---|---|
| RAM usata (`free -m`, su 11.967 MB) | 1.812 MB | 1.615 MB | da leggere |
| RAM disponibile | 10.154 MB | 10.352 MB | da leggere |
| RSS `node` | 710 MB | 723 MB | da leggere |
| RSS `npm` (avvio) | 430 MB | 58 MB | da leggere |
| `dockerd` + `containerd` RSS | 169 MB | 180 MB | da leggere |
| `netbird` RSS | 71 MB | 72 MB | da leggere |
| `sensore-trunk` RSS | 64 MB | 64 MB | da leggere |
| cgroup `da-ipam` | 1.092 MB | 1.138 MB | da leggere |
| cgroup `docker` + `containerd` | 252 MB | 437 MB | da leggere |
| cgroup `zabbix-proxy` + `zabbix-agent2` | 99 MB | 104 MB | da leggere |

| Disco | Valore |
|---|---|
| Usato su `/` | 66 GB su 158 |
| `/var/lib/docker/volumes` | 39 GB |
| `/var/lib/containerd` (immagini) | 24 GB |
| `/opt/da-ipam` | 1,7 GB (`node_modules` 909 MB, `.next` 686 MB, `data` 41 MB) |
| `/opt/sensore-trunk` | 113 MB |
| `/usr` | 1,8 GB |

`docker ps`: acceso solo `appliance-nginx`. 28 immagini, 8 volumi, tutti fermi. `/opt/da-invent/data` non esiste su questa VM: i dati stanno in `/opt/da-ipam/data`. Nessuna unità fallita.

**Lettura, da confermare con le 24 ore.** Riposo sotto 3 GB: rispettato a VM vuota. Disco 40 GB: l'immagine piena fa 66 GB, ma 63 sono Docker; senza restano circa 4 GB più i dati. RAM 4 GB: oggi non si può assegnare, `RAM_MINIMA_VM` e l'installatore impongono 12 GB. Docker costa 250-440 MB e serve solo a nginx.

Seconda lettura: timer una tantum sul PX-NAS, `misura-79993-ipam-3-24h`, 08/11 18:19 CET, scrive `/root/misura-79993-ipam-3-24h.txt`. Nessuna sessione parte: il file si legge a mano. Le soglie si decidono dopo, con Riccardo.

### Task 2 — Variante snella, VM 107 `79993-ipam-4`, PX-NAS, 07/11 (fonte: `qm guest exec`)

Immagine `2026.11.90`, 4 GB, 2 core, disco 40 GB, `ipam`, `zabbix`, trunk `condivisa`. Dopo 13 minuti, con DA-IPAM aggiornato a `715c4237`. VM vuota.

| Misura | Piena (VM 106) | Snella (VM 107) |
|---|---|---|
| Immagine | 20 GB | 1,5 GB |
| Costruzione | ore, con Greenbone | 7 minuti |
| Disco usato | 66 GB | 8,3 GB, di cui 4 di swap |
| RAM usata | 1,6-1,8 GB | 1,06 GB su 3,9 |
| RAM disponibile | 10,2 GB su 12 | 2,86 GB |
| cgroup `da-ipam` | 1.138 MB | 690 MB |
| nginx | contenitore, con Docker 250-440 MB | 3 MB |
| Primo avvio | circa 2 minuti | circa 1 minuto |

Aggiornamento di DA-IPAM (`next build`) su 4 GB: **senza swap OOM**, picco 2,8 GB, `tentativi: 4`, nessun avviso. **Con 4 GB di swap riuscito**, 100 s, picco 3,4 GB, 274 MB di swap.

Provati: rifiuto di `moduli.edge` (esito 2, macchina intatta), `da-appliance verifica` verde, HTTPS 200 da LAN e da NetBird, HTTP 301, cinque riavvii. Il primo riavvio si è bloccato: causa nel `TASKS.md` di Deploy-Appliance, proxy Zabbix fermato mentre creava il database. Corretto l'08/11 in Deploy-Appliance `98cc197`, sulla PR #75, valido anche per la piena: un database a metà si sposta da parte, lo spegnimento ha un tetto di 120 s, e il primo avvio aspetta la riga di fine nel log del proxy. Provato sulla 107. `2026.11.91` porta lo swap: accesa una volta, swap attivo da solo. Non provati: `aggiorna.sh`, Riconfigura, Proxreporter acceso, l'installatore vero: la VM è stata ripristinata e il file d'avvio passato con `da-appliance applica`, perché l'installatore vuole un'immagine firmata.

**Soglie decise da Riccardo, 07/11, senza attendere le 24 ore («Sì, parti»):** 4 GB di RAM, 40 GB di disco, niente Docker. Punto di partenza, da rivedere con le misure sulla versione ridotta e una rete vera. La lettura delle 24 ore resta un controllo in più.

## Consuntivo

### Fatto

### Mancante

### Scostamenti dal piano

### Consigli di sviluppo
