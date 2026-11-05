# Profili di scansione: Approfondito e IoT/OT — piano e consuntivo

**Obiettivo:** far vedere a DA-IPAM i sistemi che oggi restano muti — le macchine Windows
senza WinRM, le appliance dietro un certificato, gli apparati di campo (PLC, HMI, inverter,
gateway IoT) — usando nmap per quello che sa fare invece della fetta minima di prima.

**Richiesta di Riccardo (04/11/2026):** «dovrei arricchire la scansione dei device con un
profilo dedicato ad IoT OT […] per identificare meglio quello che è poco visibile», con
l'elenco delle porte OT/IoT dato in chat; poi «non si potrebbero utilizzare altri profili nmap
per fare un discover più approfondito dei sistemi in rete»; poi «vediamo di abilitare tutto il
possibile»; poi «si applicherebbe l'approfondito con la selezione dei device dalla lista […]
abilitabile solo su determinati device selezionati dentro a subnet».

**Livello di controllo:** **leggero**, scelto da Riccardo («vai e procedi con un controllo
leggero, vorrei avere la funzione disponibile al più presto»). Prove a fine tappa, cancello
una volta sola alla fine. La checklist viva sta in `TASKS.md`, non qui.

**Stato:** completato (tappa 1 e tappa 2) · **Ultimo aggiornamento:** 2026-11-05

## Cosa c'era prima (misurato, non supposto)

| Fatto | Esito |
| --- | --- |
| `-O` (OS detection) | **mai passato** in nessun punto; `parseNmapXml` legge già `host.os.osmatch` e nessuno lo riempiva |
| `--version-intensity` | **0**, il minimo; nessun override nel `.env.local` dell'hub |
| Script NSE usati in tutto il codice | **due**: `smb-os-discovery`, `snmp-info` |
| Output degli altri script | **buttato** dal parser |
| Secondo profilo nmap | **vietato**: `POST /api/nmap-profiles` risponde «È supportato un solo profilo Nmap» |
| Porte OT negli elenchi | **assenti** (102, 502, 1883, 8883, 4840, 44818; UDP 47808, 5683, 2222) |
| Conseguenza | le regole OT del 04/11 mattina (`PORT_RULES` 502→plc, 44818→plc, firme builtin) **non potevano scattare**: aspettavano porte mai provate |
| `bacnet-discover` | **non esiste**: è `bacnet-info`, UDP 47808. Un nome inesistente fa abortire tutta la scansione |

## Decisioni

1. **Probe OT**: solo script di lettura. **Niente `modbus-discover`** né `iec-identify`:
   categoria `intrusive`, e su apparati di campo vecchi possono fare danno. Verificate le
   categorie dei 36 script candidati sulla macchina: tutti gli altri sono `safe`.
2. **`mqtt-subscribe` incluso com'è**, payload compresi (scelta di Riccardo). A verbale: nel
   database dell'appliance finiscono messaggi dei broker del cliente, cioè dati di processo.
   Freno messo: tetto di 2 KB per rilievo.
3. **PLC e HMI foglie distinte** da IoT → radice nuova di livello 1 **`ot`** (`plc`, `hmi`,
   `drive`, `rtu`, `io_remoto`, `gateway`). `legacy-projection` **non** collassa `ot.*` come
   fa con `iot.*`.
4. **Nessun interruttore**: il profilo si lancia sugli **host selezionati nella lista**. Il
   meccanismo c'era già (`hostScope`), e un profilo senza selezione non parte.
5. **Modulo a parte**, non un `DiscoveryScanType` nuovo: `discovery.ts` è 3381 righe con
   `scanType` sparso in una trentina di condizioni, e infilarci un tipo nuovo era il modo più
   sicuro di rompere la scansione di tutti i clienti.
6. **`--version-intensity 7` solo dentro il profilo Approfondito**: il valore globale resta 0,
   perché là costa su ogni host di ogni cliente.

## Consuntivo della tappa 1

**Fatto**: `src/lib/scanner/profili/` (`tipi`, `profili`, `comando`, `lettura`, `motore`,
`salva`), `src/lib/attribution/profilo-evidence.ts`, radice `ot` in `taxonomy.ts` e
proiezione in `legacy-projection.ts`, sorgenti `ot_probe` e `rdp_ntlm` con fase
`scan_profilo`, tabella `host_profilo_rilievi`, rotta `POST /api/scans/profilo`, pulsante
«Profilo» col menu nella pagina della rete, 31 prove nuove.

**Due difetti veri trovati dalle prove, prima del rilascio**:
1. il testo libero degli script NSE non veniva **mai** letto — sta nell'attributo `output`,
   cioè `@_output` col prefisso configurato — e con lui restavano vuoti i lettori di `nbstat`
   e `upnp-info`;
2. `parseTagValue` di serie convertiva i valori numerici: il numero di serie `0x60c12345` che
   `enip-info` riporta sui PLC Allen-Bradley diventava `1623270213`.

**Difetto trovato rileggendo**: `getHostByIp` fa `WHERE ip = ? LIMIT 1` senza guardare la
rete. Con lo stesso indirizzo in due reti del cliente il profilo avrebbe scritto sull'host
sbagliato. La mappa IP → id ora si costruisce nella rotta dagli `host_ids` già verificati.

**Prove esistenti cambiate d'esito perché è cambiato l'intento** (non per farle passare):
`oui-ot.test.ts` (Weintek → `hmi`, CREVIS → `plc`, azionamenti → `rete_ot`, invece di `iot`
per tutti) e le eccezioni del round-trip in `legacy-projection.test.ts` (`plc` e `hmi` non
sono più eccezioni: il giro torna, ed è il punto).

**Mancante / non verificato** (anche in `TASKS.md`):
- nessun apparato OT raggiungibile da qui: la forma esatta dell'output di `s7-info`,
  `enip-info`, `bacnet-info` e `omron-info` va confermata sul campo. Le chiavi si leggono
  **normalizzate**, quindi una variante non fa sparire il dato, ma non è una prova sul vero;
- privilegi per `-O` e `-sU` sulle appliance dei clienti: sull'hub gira root, altrove no si sa;
- costo per host del profilo Approfondito non misurato su una rete vera;
- i rilievi non si vedono ancora nella scheda dell'apparato: riempiono i campi vuoti e stanno
  in `host_profilo_rilievi`, ma non c'è una tab che li mostri.

**Consigli per la tappa 2**: tab dei rilievi nella scheda; misura del costo su una rete vera;
collaudo sulla rete di impianto del 72729 quando torna raggiungibile (oggi 192.168.2.0/24
tace, aperto in TASKS); valutare `http-favicon` come impronta per riconoscere i modelli.

## Consuntivo della tappa 2 — 05/11/2026

**Stato:** completato. Due rilasci: **0.9.967** (i rilievi si vedono) e **0.9.970** (si leggono
tre script in più e riempiono anche l'apparato), entrambi su `dev` e promossi su `main` col sì
di Riccardo; le appliance 70151 e 72729 verificate dal riavvio (`/api/health`, versione e uptime).

**Fatto**

- Tab **«Rilievi»** nella scheda (`components/scheda/tab-rilievi.tsx`, rotta
  `GET /api/hosts/[id]/profilo-rilievi`, `profili/campi-scheda.ts`): tabella dei campi
  significativi — campo, valore, script e porta, quando — che riusa `fattiDaScript`, la stessa
  lettura della scrittura, quindi non può divergere. Compare solo con almeno un rilievo.
  Commit `1d9d2855`, rilascio `4b7ed120`.
- **Tre script che prima si buttavano** (`lettura.ts`): `snmp-info` (produttore e, solo con
  `engineIDFormat: text`, il seriale), `vmware-version` (versione e build di ESXi),
  `ldap-rootdse` (dominio e nome del DC). Fixture dai dati **veri** del 72729.
- **Difetto trovato leggendo i dati veri**: l'output degli script arriva con le entità XML non
  decodificate (`&#xa;` invece di una riga nuova), perché sta in un attributo. `snmp-sysdescr`
  restituiva tutto l'output come una riga sola e `upnp-info` non trovava niente dopo la prima
  riga: era un difetto vivo della tappa 1, non una regressione. Ora c'è `testo()` e vale anche
  per i rilievi già in archivio.
- **Propagazione all'apparato** (`profili/propaga-apparato.ts`): `model`, `serial_number`,
  `firmware` sull'apparato dell'host, **solo dove è vuoto**, seriale validato con
  `eSerialeFinto` perché è la chiave degli apparati fisici; `soloProva` per la prova a vuoto.
- **Colonna «Da rivedere»** in Discovery con chip e conferma in blocco
  (`POST /api/hosts/conferma-rivisti`), colonne `campi_da_rivedere` su `hosts` e
  `network_devices` (`assicuraColonneDaRivedere`, additiva). Commit `d0c82308`, rilascio
  `aed13e3a`.
- **23 prove nuove** (13 sui tre script, 10 sulla propagazione), viste fallire prima di passare.
  Cancello: lint 0, tsc 0, build 0, 7148/7153 prove.

**Misure sul campo (72729, sola lettura, entrando dal Proxmox del cliente)**

- 105 rilievi su 13 host; 12 nomi, 12 sistemi operativi, 13 produttori riempiti.
- Il profilo IoT/OT **ha determinato una categoria**: host 46 e 49 (`192.168.0.106` e `.105`)
  da «nessuna categoria, confidenza 0» a **`ot` con confidenza 66** alle 16:51 del 04/11, per
  l'evidenza `ot_probe` (porta 502 aperta). L'OUI Microchip da solo non classificava.
- Prova a vuoto della propagazione: su 22 apparati con host, 3 modelli e 1 seriale.
- Migrazione verificata sull'appliance dopo il rilascio: le due colonne ci sono, 0 righe segnate.

**Mancante / non verificato**

- **Resa a schermo mai vista**, né la tab né la colonna: in locale non c'è un accesso all'app e
  sul 72729 vale la sola lettura. Verificate da tsc, build e prove.
- Il profilo non è ancora girato dove serve: sui 45 `unknown`, 18 `iot`, 11 `hmi` e 8 `rete_ot`
  del 72729 i rilievi sono **zero** (valutazione in `docs/revisione/2026-11-05-popolare-ip-e-apparati-dai-profili.md`).
  Riccardo ha deciso: prima un **campione di 5 host**, che lancia lui.
- Costo per host con `--version-intensity 7` ancora non misurato; forma dell'output degli script
  di campo (`s7-info`, `enip-info`, `bacnet-info`, `omron-info`) ancora solo su fixture.
- I rilievi **grezzi** (`elems_json`, `output`) non hanno nessuna pagina: rimandato.

**Scostamenti dal piano**

- La revisione dei dati scritti dai profili doveva essere una **proposta per campo** nella
  scheda, come per l'assegnatario. Riccardo (05/11) ha deciso diversamente: si riempie quanto è
  vuoto e si guarda **dalla tabella** di Discovery con un segno «da rivedere». Meno clic e
  niente 64 schede da aprire.
- Degli script da aggiungere si parte da tutti e tre, non dal solo `snmp-info`: sono funzioni
  pure, il costo stava nelle prove e non nel rischio.

**Consigli di sviluppo**

- Leggere anche i banner web (`http-server-header`, `http-headers`, `banner`): 15 host su 13
  del giro del 72729 li hanno dati e oggi finiscono fra gli script senza campi. Stringhe da
  normalizzare, quindi una tappa a sé.
- Sistemare le due prove che pretendono `data/ipam.db` assente senza prepararselo: oggi il
  cancello pieno ha due rosse che non dipendono dal codice (lezione #8).
- Valutare un bersaglio «almeno questa versione» per l'aggiornatore delle sonde: con
  `SOLO_SU_COMANDO=1` e un numero esatto, due rilasci ravvicinati fanno mancare il treno (è
  successo due volte il 04/11 col 72729).
