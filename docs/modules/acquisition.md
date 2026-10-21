# Collector modulari di acquisizione

Prima versione locale, approvata il 21/10/2026. Codice in `src/lib/acquisition/`.
Nessuna integrazione automatica con scheduler, database o interfaccia; nessun rilascio.

## Eseguire la CLI

Richiede Node 22 e le dipendenze già installate di DA-IPAM, non il server Next.js.
Il file di input JSON vive **fuori dal repository**, appartiene all'utente corrente e
ha permessi `0600`. Contiene `host`, `collector` (`"qnap-switch"` di default oppure `"hp-procurve"`), e almeno uno tra:

- `ssh`: `username`, `password` oppure `privateKey` PEM, eventuale `passphrase`, `port` (default 22).
- `snmp`: `community`, `version` (`"2c"` di default oppure `"1"`), `port` (default 161).

I segreti non sono accettati come argomenti della riga di comando. I limiti opzionali
stanno in `limits`: `timeout_ms` (4000, inattività console / singola lettura SNMP),
`total_timeout_ms` (90000), `max_rows` (4096 per tabella), `max_output_bytes` (1 MiB per
lettura SNMP o sessione console). Il termine totale limita anche una console che
continua a produrre dati. Non esiste sweep di indirizzi o ricerca di password.

Dalla radice del clone:

```bash
node --import tsx scripts/acquire-device.ts --list
node --import tsx scripts/acquire-device.ts --schema
node --import tsx scripts/acquire-device.ts --credentials-file /percorso/privato/device.json --output /percorso/privato/snapshot.json
```

`--output` crea un file nuovo 0600 esterno al repository: non sovrascrive file già
presenti. Senza `--output`, stdout contiene soltanto il JSON: proteggere il file
con `umask 077` se si usa una redirezione. Non committare snapshot reali: contengono
identificativi, MAC e topologia. Errori di input su stderr, senza valori sensibili.

Codici di uscita: **0** sezioni richieste completate; **2** raccolta parziale,
JSON utilizzabile sezione per sezione; **1** identificazione fallita o errore interno;
**64** input/percorso/permessi non validi. Non trattare exit 2 come elenco vuoto.
Uno snapshot con `poe.status=skipped` non dichiara che il dispositivo non supporta PoE.

## Contratto JSON 1.0

Schema Zod in `schema.ts`; `--schema` esporta il JSON Schema dello snapshot.
Metadati: collector e versione, target, istante iniziale ISO, durata e stato globale.
Ogni sezione ha `status`, `collected_at`, `sources`, `warnings` e `data`.
L'istante della sezione indica la sua composizione; le letture non sono atomiche:
contatori, MAC e vicini possono cambiare durante il giro.

Sezioni: `identity`, `interfaces`, `vlans`, `forwarding`, `neighbors`, `spanning_tree`,
`aggregation`, `sensors`, `network`, `poe`. Estensioni additive opzionali: `resources`
(CPU e memoria), `environment` (stato ventole e budget PoE), `identity.part_number`
e `identity.boot_rom`. Gli snapshot QNAP 1.0 precedenti restano validi.

- `null` = sconosciuto. Non convertire in 0, false o assenza autorevole.
- `ok` = formato riconosciuto e lettura conclusa per quella sezione, non garanzia
  che ogni campo opzionale del modello universale sia disponibile.
- `partial` = limite, dati non osservati o lettura incompleta; nessuna cancellazione.
- `unsupported` = rifiuto esplicito del comando/OID; un walk vuoto non lo dimostra.
- `error` = guasto della raccolta; `skipped` = capacità non implementata o trasporto
  non fornito. `warnings` contiene codici stabili e spiega le limitazioni.
- Byte/packet counters sono stringhe decimali, inclusi Counter64 oltre 2^53.
- Velocità in bit/s: `speed_bps` è null a link down; `reported_speed_bps` conserva
  quanto dichiarato dal dispositivo. ifSpeed saturo senza ifHighSpeed resta ignoto.
- `if_index`, bridge port e nome console sono identificatori diversi. L'associazione
  console/SNMP richiede MAC univoco; i bitmap VLAN usano bridgePort→ifIndex.
  I LAG con MAC ambiguo mantengono ifIndex null. FDB ID non equivale a VLAN ID.
- `pvid` richiede lettura esplicita: non deriva dalla sola membership untagged.
- STP conserva `enabled`, protocollo e tabella porte: con enabled=false non
  classificare un collegamento bloccato dalla sola parola Discarding.
- Temperature in Celsius, ventole rpm, ottiche mW (non dBm), bias in ampere.
  DDM tutto zero non dimostra la presenza di un transceiver e non genera sensori.

## Integrazione esplicita in DA-IPAM

```typescript
import { acquireForIpam } from "@/lib/acquisition/adapter";

// request ha già il target e le credenziali risolte dal chiamante.
const { snapshot, deviceInfo } = await acquireForIpam(request);
```

Il core non importa DB, NextAuth, cron o route. L'adapter mappa i soli campi identità
compatibili con `DeviceInfo` e consegna anche lo snapshot completo. **Non salva nulla**:
il futuro chiamante applicherà autorizzazioni, risoluzione credenziali, anti-lockout,
contesto tenant e persistenza correnti. Non usare automaticamente i dati per
riclassificare dispositivi o eliminare porte, MAC e vicini. Non viene modificato il
percorso NAS QNAP preesistente, né il traffico di scansione attuale.

## Collector qnap-switch

Collaudato in lettura su **QSW-M3216R-8S8T, QSS 4.5.0.847494 (20260908)**. Si identifica
tramite modello QSW letto in console oppure sysObjectID esatto osservato sul banco;
non si attribuisce ogni prodotto dell'enterprise SNMP a questa famiglia.

Trasporti riusati: `protocols/snmp-sessione.ts` e `devices/ssh-transport.ts`.
La console QSS rifiuta exec: il collector apre una shell, attende il prompt e
attraversa `--More--` con limiti. Nessun timeout o canale interrotto produce successo.
Comandi ammessi, fissi in `QSS_COMMANDS`: system-information, interfaces status,
interfaces, vlan, lldp neighbors, spanning-tree ports-summary, etherchannel summary,
system temperature, interfaces ddm, mac-address-table, tutti preceduti da `show`.
Nessun comando di configurazione, reset, export, lettura password o SNMP SET.

Sul banco: 16 porte fisiche e 16 gruppi LAG configurati, più un'interfaccia SNMP di
altro tipo; firmware/seriale, MTU/MAC/counter, tre VLAN, due vicini, FDB, STP e sensori
letti. Tabelle IP/ARP non acquisite (errori SNMP espliciti); PVID non osservati.
Lo stato complessivo con entrambi i trasporti è perciò parziale, non errore totale.
I totali dinamici della FDB non sono un criterio di regressione.

Limiti dichiarati: altri firmware/modelli non collaudati; LLDP solo riassunto (senza
nome/descrizione/IP remoto); PoE non implementato; SNMPv3 non esposto da questo input;
nessun endpoint API investigato o usato; nessuna scoperta automatica delle capability
non misurate. SSH eredita la policy di connessione del trasporto esistente, senza
aggiungere un archivio di pin host-key. Non vengono riutilizzati comandi NAS QTS.

## Collector hp-procurve

Collaudato con utente operator su **Aruba JL357A 2540-48G-PoE+-4SFP+**, firmware
**YC.16.11.0020**, ROM YC.16.01.0003. È ProCurve / ArubaOS-Switch: non ArubaOS-CX
né Comware. La famiglia si verifica sul sysDescr e sulla firma delle revisioni;
senza SNMP, una firma classica della revisione SSH consente una identità parziale,
con modello ignoto. Non si inventa il modello dal nome scelto per lo switch.

La CLI usa `collector: "hp-procurve"` nel file privato e gli stessi argomenti del QNAP.
Raccolta manuale read-only, senza nuove route, DB o job automatici. I trasporti e i
parser QNAP mantengono il loro comportamento; l'allowlist dei comandi è per profilo.

L'allowlist HP comprende: `show system`, `show version`, `show interfaces brief`,
`show vlans`, `show vlans ports all detail`, `show mac-address`, `show trunks`,
`show lldp info remote-device detail`, `show power-over-ethernet brief`,
`show spanning-tree`, `show system fans`. Nessuna promozione a manager, comando
`enable`, configurazione o esportazione di running-config.

Sul banco sono stati letti:

- 52 porte fisiche (48 rame PoE + 4 SFP+), più interfacce logiche SNMP. `49-Trk3`
  identifica la porta fisica 49, non un nuovo nome di porta. `ifName` univoco lega
  i record SSH e SNMP, senza dedurre ifIndex dal numero stampato. Contatori HC,
  MAC, MTU, alias e PVID arrivano dalle tabelle SNMP quando disponibili.
- VLAN con membership esplicita Tagged/Untagged, tramite dettaglio per porta o
  Q-BRIDGE-MIB; due trunk con membri e protocollo, senza indovinare lo stato
  operativo dai soli membri configurati.
- LLDP dettagliato: chassis ID anche non MAC, port ID testuale, nome, descrizione,
  capability e indirizzi di gestione. TTL non esposto resta null.
- Tabella MAC con VLAN esplicita e porta; STP globale e stati/ruolo root del CIST.
  **Le singole istanze MST non sono acquisite**: non estendere questi stati a ogni
  VLAN. L'avviso `CIST_ONLY_MST_INSTANCES_NOT_COLLECTED` resta nel JSON.
- 48 porte PoE: `power_watts` è **PD Pwr Draw**, non PSE Reserved. Budget globale
  disponibile/usato/rimanente separato in environment.
- CPU percentuale, memoria totale/libera in byte; tre ventole con stato e conteggio
  guasti, non RPM inventati. Sensori numerici di temperatura/RPM non implementati
  (`sensors.status=skipped`); il comando temperatura provato sul banco è rifiutato.
- Indirizzi IPv4 e tabella ARP, tramite SNMP standard.

Il banco è raggiunto con timeout di lettura 10 s e termine totale 180 s, impostati
nel file privato: le letture SNMP a 4 s erano parziali. Limiti di righe e byte restano
attivi; il collector conserva eventuali parziali anche con credenziali corrette.

Il pager HP scrive Enter oppure Return e può incollare il footer alla prima riga
successiva. Entrambi i casi sono normalizzati e coperti da regressioni; una perdita
avveniva anche nella prima riga PoE della pagina. I conteggi di porte, PoE, FDB, VLAN
e LLDP sono confrontati con le righe candidate: formato nuovo → risultato parziale,
non successo con righe perse. Il prompt operator `>` ridisegnato con ANSI e il
banner «Press any key» sono gestiti con gli stessi limiti temporali della console.
Altri modelli/revisioni e trunk dinamici non sono dichiarati collaudati.

## Estendere una famiglia

Aggiungere un collector che implementi lo stesso contratto, estendere l'unione di
input validati e il registry statico in `index.ts`, introdurre parser puri e fixture
anonimizzate da risposte reali. Riutilizzare i trasporti o introdurne uno con limiti
identici. Non accettare comandi liberi dall'input. Non inferire capacità dai soli nomi
vendor; dichiarare modelli, firmware e prove realmente eseguite. Prossime famiglie
previste: ArubaOS-CX e Comware, da sviluppare su campioni autorizzati.

## Prove

```bash
node --import tsx --test src/lib/acquisition/__tests__/*.test.ts src/lib/protocols/__tests__/snmp-sessione.test.ts
npx eslint src/lib/acquisition scripts/acquire-device.ts
npx tsc --noEmit
```

I test includono parser QSS, console con paginazione e timeout, troncamenti, STP
spento, contatori a 64 bit, bridge/PVID, mW/mA, redazione segreti, adapter senza DB,
CLI reale su agente UDP locale, permessi file e invariante sessioni SNMP centralizzate.
