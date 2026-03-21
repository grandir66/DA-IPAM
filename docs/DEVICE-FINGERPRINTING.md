# Device fingerprinting (DA-INVENT)

Documento operativo: come funziona il modulo di **identificazione automatica** tipo dispositivo / OS nel progetto (implementazione **TypeScript/Node**, stesso stack dell’app).

## Panoramica

Durante la discovery con scan **nmap** o **snmp**, per ogni host online viene costruito uno snapshot JSON (`detection_json` su tabella `hosts`) combinando:

1. **TTL (ICMP)** — da `ping` batch prima dello sweep, quando abilitato.
2. **Firme porte TCP** — pesi 0,75 (porte chiave) / 0,25 (opzionali), soglia minima 0,40, top 3 match.
3. **Probe attivi** (opzionali) — HTTP/HTTPS (titolo, header `Server`, keyword nel body), banner SSH su porta 22, SMB OS discovery via `nmap` se la 445 è aperta; SNMP sysDescr/sysObjectID già raccolti dallo scan.

Cache in-memory **1 ora** per IP per evitare riscansioni inutili.

## Nmap: TCP e UDP

`nmapPortScan` esegue **due processi** distinti: (1) solo TCP dal profilo, (2) solo UDP con `buildUdpScanArgs()`. Il profilo utente **non** deve includere `-sU` (viene rimosso dalla fase TCP). Combinare TCP+UDP in un unico comando spesso provoca errori in container/ambienti senza capability.

## SNMP: net-snmp e snmpwalk

Le query SNMP usano la libreria **net-snmp** in Node. Se i GET su `sysDescr`/`sysName`/`sysObjectID` sono vuoti, si può usare il fallback **`snmpwalk`** CLI sul subtree `1.3.6.1.2.1.1` (stesso comportamento di `snmpwalk` da terminale). Disabilitare con `DA_INVENT_SNMPWALK_CLI=false`.

## Variabili d’ambiente

| Variabile | Default | Effetto |
|-----------|---------|---------|
| `DA_INVENT_FINGERPRINT` | `true` | `false` disattiva tutto il fingerprinting. |
| `DA_INVENT_FINGERPRINT_PROBES` | `true` | `false` mantiene solo TTL + firme porte + dati SNMP già presenti (niente HTTP/SSH/SMB). |
| `DA_INVENT_FINGERPRINT_TTL` | `true` | `false` non esegue ping ICMP per TTL prima dello sweep nmap. |
| `DA_INVENT_SNMPWALK_CLI` | `true` | `false` non invoca mai `snmpwalk` come fallback. |
| `DA_INVENT_FINGERPRINT_PROBES_MAX_HOSTS` | `8` | Oltre questo numero di host online nella scan Nmap/SNMP, niente probe HTTP/SSH/SMB (solo firme/SNMP; evita blocchi di molti minuti). |
| `DA_INVENT_NMAP_HOST_TIMEOUT_S` | `75` | `--host-timeout` nmap per scan TCP/UDP completo (TLS/servizi lenti). |
| `DA_INVENT_NMAP_PORT_SCAN_CONCURRENCY` | `2` | Host processati in parallelo nello scan porte; valori alti possono far perdere risposte. |

## File principali

- `src/lib/scanner/device-fingerprint.ts` — firme, merge risultati, cache, `final_device` / `final_confidence`.
- `src/lib/scanner/device-fingerprint-probes.ts` — HTTP, SSH, SMB.
- `src/lib/scanner/ping.ts` — parsing `ttl` dalla risposta ICMP.
- `src/lib/scanner/discovery.ts` — integrazione ping TTL + chiamata fingerprint e salvataggio `detection_json`.
- `src/lib/scanner/ports.ts` — lista TCP predefinita (allineata alle porte utili alla detection).

## Porte TCP

Le porte sono in `NMAP_DEFAULT_TCP_PORTS` (inclusi es. 5985 WinRM, 8728 MikroTik, 1300 Stormshield, 623 IPMI TCP). I profili nmap possono aggiungere porte extra tramite `buildTcpScanArgs(customPorts)`.

### Proxmox VE

Il nodo espone quasi sempre **8006** (API/UI) e **22** (SSH); la **3128** (Squid) spesso manca: la firma porte usa quindi `8006+22` come chiave. In più, con **sysObjectID** `…8072` (net-snmp) si forza `final_device` Proxmox se c’è 8006 aperta o indizi in `sysDescr`. La classificazione host (`device-classifier`) applica la stessa logica prima di mappare l’OID Linux come `server_linux`, per evitare etichette tipo “switch” da testi ambigui.

## Output (campo `detection_json`)

Struttura tipica (vedi tipo `DeviceFingerprintSnapshot` in `src/types/index.ts`):

- `ip`, `hostname`, `mac`, `ttl`, `os_hint`
- `open_ports`, `matches[]` (nome, confidence, `matched_ports`)
- `banner_http`, `banner_ssh`, SMB/snmp dove disponibili
- `final_device`, `final_confidence`, `detection_sources[]`

## Note operative

- **Niente Python** nel runtime: nmap/snmp/ping sono processi esterni; probe HTTP usano `fetch`/`https` con timeout e (per HTTPS) verifica certificato disabilitata dove serve.
- Su container, funzioni che richiedono raw socket (es. UDP scan) restano soggette ai permessi del processo.
- Per commit: incrementare la patch version (`npm run version:bump`) come da regole del repo.
