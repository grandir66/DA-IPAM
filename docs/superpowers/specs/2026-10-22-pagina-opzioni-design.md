# Pagina Opzioni — design

**Data:** 2026-10-22 · **Approvato da Riccardo:** 2026-10-22 (decisioni e tavola grafica)
**Livello di controllo:** leggero · **Piano:** `docs/superpowers/plans/2026-10-22-pagina-opzioni.md`
**Tavola grafica:** https://claude.ai/artifact/MFg8HqVhyS4dEzwiDoo1LX (oggetti 1-13)

## 1. Il problema

Il 22/10, sull'appliance appena installata di 70151, il router MikroTik era leggibile ma la sua scheda non aveva le
VLAN: la lettura nasceva spenta (corretto con l'ADR 0031) e **nessun job leggeva gli apparati**, perché il giro ARP,
le scansioni e la lettura degli hypervisor si creano a mano. Riccardo: «deve essere automatica la lettura, non dovrei
dover aprire finestre da tutte le parti e sempre diverse per avere dei dati coerenti» e «deve esserci una pagina sola
in cui si attivano le opzioni per ogni singola funzionalità che non parte in automatico ed eventualmente da
disabilitare».

Censimento del 22/10 su `origin/dev` (commit `672fe9d2`): **34 interruttori in 13 pagine**, 11 voci che si cambiano
solo da file, 4 automatismi sempre accesi; valori di serie opposti (chiave assente = accesa per letture, NIS2,
Chocolatey; spenta per quasi tutto il resto); quattro forme di valore (JSON `{acceso,da,il}`, "1"/"0", "0"/"false",
modo testuale); interruttori dell'hub (per tutti i clienti) mescolati a quelli per cliente; tre senza pagina
(`offline_guard_mode`, `networks.probes_enabled`, `attribution_probes_enabled`). Dei job nasce da solo solo
`known_host_check`.

### Il censimento (22/10, `origin/dev` 672fe9d2)

Aggiunto il 22/10 sera durante l'esecuzione: la spec lo citava ma non lo conteneva; è il resoconto del subagent della
sessione di progettazione. Le righe di file sono di quel commit. Il catalogo e la sua prova (`catalogo.test.ts`,
`CENSIMENTO`) lo seguono voce per voce.

#### Interruttori

| nome in parole | chiave/meccanismo | dove vive | di serie | dove si cambia oggi | file:riga |
|---|---|---|---|---|---|
| Lettura topologia: router MikroTik | `topologia.lettura.mikrotik` (JSON `{acceso,da,il}`) | tenant | acceso (chiave assente = acceso, ADR 0031) | `/topology/dati`, scheda Letture | src/lib/topology/letture/interruttori.ts:62 |
| Lettura topologia: controller | `topologia.lettura.controller` | tenant | acceso | `/topology/dati` | interruttori.ts:11 |
| Lettura topologia: SNMP | `topologia.lettura.snmp` | tenant | acceso | `/topology/dati` | interruttori.ts:11 |
| Lettura topologia: host | `topologia.lettura.host` | tenant | acceso | `/topology/dati` | interruttori.ts:11 |
| Lettura topologia: scheda MikroTik (VLAN/DNS/utenti) | `topologia.lettura.mikrotik_scheda` | tenant | acceso | `/topology/dati` | interruttori.ts:11 |
| Lettura topologia: VLAN degli switch | `topologia.lettura.switch_vlan` | tenant | acceso | `/topology/dati` | interruttori.ts:11 |
| Mappa nuova con i cavi | `topologia.mappa.cavi` | tenant | spento | `/topology/dati`, scheda Mappa | src/lib/topology/letture/mappa.ts:9 |
| Chocolatey automatico (alle credenziali WinRM e ogni notte alle 02:00) | `patch.choco_automatico` (solo "0" = spento) | tenant | acceso (agisce solo se il modulo Patch è installato) | `/settings/moduli/patch_management` o `/settings?tab=moduli` | src/lib/patch/choco-automatico.ts:41 |
| Freno sul passaggio a offline (registra/applica) | `offline_guard_mode` | tenant | "registra", cioè freno non attivo | solo DB: nessuna rotta né pagina | src/lib/scanner/offline-guard.ts:52 |
| MeshCentral senza agente | `meshcentral.senza_agente` più l'ambiente `MESHCENTRAL_SENZA_AGENTE=1`, che vince | tenant + env | spento | `/settings?tab=moduli`, scheda MeshCentral | src/lib/integrations/meshcentral/senza-agente.ts:42, :56 |
| Modulo Inventario NIS2 (`/services`) | `nis2_inventory_enabled` | tenant | acceso (assente = acceso) | `/settings?tab=moduli`, scheda NIS2 | src/lib/modules/registry.ts:447 |
| Wazuh SIEM | `integration_wazuh_enabled` | hub (vale per tutti i clienti) | spento | `/settings?tab=moduli`, scheda Wazuh: diventa 1 al salvataggio, si azzera con DELETE (nessuna levetta propria) | src/lib/integrations/wazuh-config.ts:60 |
| Sonde di attribuzione (tutte le reti) | `attribution_probes_enabled` (solo "0"/"false" = spento) | hub | acceso | solo `PUT /api/settings` generica, nessuna pagina | src/lib/scanner/probes/run-probes.ts:108 |
| Sonde di attribuzione per singola rete | colonna `networks.probes_enabled` | tenant (per rete) | acceso | solo DB | src/lib/db-tenant-schema.ts:436 |
| Naabu prima di Nmap | `port_discovery` ("nmap" o "naabu+nmap") | hub | spento (solo nmap) | `/settings?tab=scansione` | src/lib/scanner/discovery.ts:594 |
| Notifiche attive | `notify_enabled` | hub | spento | `/settings?tab=notifiche` | src/lib/notifications/config.ts:36 |
| Canale email | `notify_smtp_enabled` | hub | spento | `/settings?tab=notifiche` | src/lib/notifications/config.ts:37 |
| Canale webhook | `notify_webhook_enabled` | hub | spento | `/settings?tab=notifiche` | src/lib/notifications/config.ts:45 |
| LibreNMS / Graylog | `integration_<c>_mode` (disabled/external/appliance) | hub | disabled | scheda modulo in `/settings?tab=moduli`, oppure import del JSON | src/lib/integrations/config.ts:190 |
| Modulo Patch Management | riga `tenant_features` `patch_management` | hub per cliente | spento (non installato) | `/settings?tab=moduli`, Installa/Disinstalla | src/lib/patch/feature.ts:180 |
| Modulo Inventory Agent | `tenant_features` `inventory_agent` | hub per cliente | spento | `/settings?tab=moduli` | src/lib/inventory-agent/feature.ts:112 |
| Modulo MeshCentral | `tenant_features` `meshcentral` | hub per cliente | spento | `/settings?tab=moduli` | src/lib/integrations/meshcentral/feature.ts:44 |
| Modulo Network Services | `tenant_features` `network_services` | hub per cliente | spento | `/settings?tab=moduli`, setup/DELETE | src/lib/network-services/feature.ts:163 |
| Scanner-Edge | `vuln_scanners.enabled` più `auto_disabled_at` | tenant | assente finché non configurato | `/settings?tab=moduli` o import | src/lib/modules/registry.ts:282 |
| MDM Headwind (e il suo job) | `mdm_config.enabled` più spegnimento automatico | tenant | spento | `/settings/mdm` (casella) | src/lib/integrations/mdm-config.ts:95 |
| Pannello Zabbix in sola lettura | `zabbix_lettura.enabled` | tenant | spento | `/settings?tab=moduli`, scheda Zabbix | src/lib/zabbix-lettura/config.ts:169 |
| Controller UniFi attivo | `controllers.enabled` | tenant (per controller) | a scelta alla creazione | `/controllers`, finestra del controller | src/components/controllers/controller-dialog.tsx:453 |
| Lettura dei client UniFi ogni ora (7–20) | crea o cancella un job `unifi_sync` con `cosa=client` | tenant / job | spento | `/controllers`, dettaglio (casella) | src/lib/db-tenant.ts:472 |
| Lettura degli apparati UniFi | crea o cancella un job `unifi_sync` (minuti oppure nulla) | tenant / job | spento | `/controllers` | src/lib/db-tenant.ts:504 |
| Lettura giornaliera degli hypervisor | crea o cancella il job `hypervisor_sync` (03:00) | tenant / job | spento, nessuno lo crea da solo | `/topology/dati`, scheda Hypervisor (casella) | src/lib/db-tenant.ts:576 |
| Pulizia notturna degli host assenti | crea o cancella il job `pulizia_host` (04:00); job riservato | tenant / job | spento | `/settings?tab=sistema`, scheda Pulizia (solo admin) | src/lib/db-tenant.ts:619; src/lib/cron/job-riservati.ts |
| Livello di ciò che esce verso DA-Link | `solo_stato` / `stato_inventario` (tabella hub propria) | hub | solo_stato | `/settings/cosa-esce` | src/app/api/dalink/livello/route.ts:14 |
| Cliente attivo | `tenants.active` | hub | acceso | `/tenants` | src/app/(dashboard)/tenants/page.tsx:386 |
| Ogni job pianificato | `scheduled_jobs.enabled` | tenant / job | vedi elenco (b) | `/settings?tab=jobs` (una levetta per riga; pulizia_host in sola lettura) | src/app/(dashboard)/settings/page.tsx:1166 |

#### Interruttori da ambiente (solo file o env, nessuna pagina)

| nome in parole | chiave/meccanismo | dove vive | di serie | dove si cambia oggi | file:riga |
|---|---|---|---|---|---|
| Invio a DA-Vul-can (coda ogni minuto, battito ogni 15 minuti, inventario alle 03:00) | presenza di `VULCAN_TOKEN` in `/etc/dalink/oggetto.env` | file env | spento | solo file (si vede in `/settings/cosa-esce`) | src/lib/vulcan/config.ts:47; server.ts:166 |
| Segnale di vita verso DA-Link (ogni 5 minuti) | esistenza e validità di `oggetto.env` (percorso cambiabile con `DALINK_OGGETTO_ENV`) | file env | spento | solo file | src/lib/dalink/config.ts:22; segnale-job.ts:15 |
| Riconoscimento degli apparati | `DA_INVENT_FINGERPRINT` ("false" = spento) | env | acceso | solo env | src/lib/scanner/discovery.ts:2770 |
| Sonde attive del riconoscimento | `DA_INVENT_FINGERPRINT_PROBES` | env | acceso | solo env | discovery.ts:2826; device-fingerprint.ts:297 |
| snmpwalk da riga di comando | `DA_INVENT_SNMPWALK_CLI` | env | acceso | solo env | src/lib/scanner/snmp-query.ts:99 |
| DNS: rilettura forzata | `DA_INVENT_DNS_ALWAYS_REFRESH` | env | spento | solo env | discovery.ts:2795 |
| DNS: aggiorna i nomi salvati nel job | `DA_INVENT_DNS_CRON_REFRESH_STORED` | env | spento | solo env | src/lib/cron/jobs.ts:1578 |
| DNS: log dettagliato | `DA_INVENT_DNS_VERBOSE` | env | spento | solo env | src/lib/scanner/dns.ts:67 |
| MeshCentral: TLS senza verifica | `MESHCENTRAL_TLS_INSECURE=1` | env | spento | solo env | src/lib/integrations/meshcentral/tls-fetch.ts:28 |
| Redirect da HTTP a HTTPS | `TLS_REDIRECT=true` | env | spento | solo env | server.ts:49 |
| Fidarsi dell'host (auth) | `AUTH_TRUST_HOST` ("false" = spento) | env | acceso | solo env | src/lib/auth.ts:11 |

#### Automatismi sempre accesi (nessun interruttore, partono da `server.ts`)

| nome in parole | meccanismo | dove vive | di serie | dove si cambia oggi | file:riga |
|---|---|---|---|---|---|
| Backup notturno di hub e clienti | node-cron alle 03:00 (orario cambiabile con `DA_INVENT_BACKUP_CRON`) | processo | acceso | solo env (orario) | src/lib/backup/scheduler.ts:25 |
| Allarme salute dell'appliance (disco, Docker) | ogni 30 minuti | processo | acceso | — | src/lib/modules/appliance-health-notify.ts:182 |
| Allarme sui job fermi | ogni 30 minuti | processo | acceso | — | src/lib/health/scheduler-health-notify.ts:209 |
| Correzioni dei job all'avvio | spegne `fast_scan`/`ping_sweep` sotto le 12 ore su reti /22 o più grandi; crea `known_host_check` | processo | acceso | — | src/lib/db-tenant.ts:7028 |

## 2. Decisioni prese (22/10, non riaprire)

| Decisione | Scelta di Riccardo |
| --- | --- |
| Le levette nelle 13 pagine | **si spostano tutte nella pagina Opzioni**; nelle pagine vecchie resta lo stato in una riga con «cambia da Opzioni ›» |
| Job che nascono da soli | **giro ARP ogni 30 minuti**, **lettura degli hypervisor ogni notte (03:00)**, **nomi DNS ogni giorno**, **scansione veloce di ogni rete ogni 12 ore** |
| Appliance già installate | ricevono i job di serie **se mancano**; uno spento da un admin resta spento e non si ricrea |
| Livello di controllo | leggero |
| Tavola grafica | approvata così com'è |

Alternativa scartata: una pagina che chiama le rotte di oggi una per una, senza catalogo (più veloce, ma la prossima
opzione aggiunta altrove non comparirebbe).

## 3. Architettura

### 3.1 Il catalogo delle opzioni (`src/lib/opzioni/`)

Un modulo server che **dichiara ogni opzione una volta**: è l'unica fonte per la pagina e per la prova di completezza.

```ts
export type Gruppo = "letture" | "job" | "moduli" | "automatismi" | "notifiche_uscite" | "da_file";
export type Forma = "levetta" | "modulo" | "scelta" | "file";
export type TipoEsito = "ok" | "attenzione" | "errore" | "neutro";

export interface Opzione {
  id: string;                 // stabile, es. "lettura.mikrotik_scheda", "job.arp_poll", "modulo.patch_management"
  gruppo: Gruppo;
  nome: string;               // in parole, come nella tavola
  cosa: string;               // una riga
  valePer: "cliente" | "hub"; // hub = tutti i clienti
  forma: Forma;
  diSerie: string;            // «accesa», «spenta», «solo lo stato»…
  scelte?: ReadonlyArray<{ valore: string; etichetta: string }>; // forma "scelta" (ritmo, livello DA-Link, freno offline)
  configura?: string;         // href della scheda dove si inseriscono i dati («Configura ›», «Installa ›»)
  leggi(): StatoOpzione;      // dal sistema vivo
  cambia?(richiesta: { acceso?: boolean; valore?: string }, chi: string): void; // assente per forma "file"
}

export interface StatoOpzione {
  acceso: boolean | null;     // null = da configurare
  valore?: string;            // forma "scelta"
  da: string | null; il: string | null;   // chi l'ha cambiata e quando (UTC); null = di serie
  esito: { tipo: TipoEsito; testo: string }; // «letta alle 15:00 · 19 VLAN», «mai girata: nessun hypervisor con credenziale»
}
```

`leggi` e `cambia` **riusano le funzioni che esistono già** (`leggiInterruttore`/`scriviInterruttore`,
`getHypervisorSyncSchedule`/`setHypervisorSyncSchedule`, `getPuliziaHostSchedule`/`setPuliziaHostSchedule`, le
funzioni dei moduli `feature.ts`, le config di notifiche, MDM, Zabbix, Wazuh, DA-Link livello…): il catalogo non
riscrive la logica, la indicizza. L'esito si legge da dove il sistema lo scrive già (esiti delle letture in
`tenant_settings`, `scheduled_jobs.last_run`, stato dei moduli del registry).

Le opzioni dei job sono **dinamiche**: una riga per ogni `scheduled_jobs` del cliente (il ritmo è una «scelta»), più
le righe dei job di serie anche quando mancano (si accendono da lì).

### 3.2 Job di serie

`src/lib/opzioni/job-di-serie.ts`: quattro voci `{ tipo, intervallo_minuti, perRete }`:
`arp_poll` 30 (rete NULL = tutti gli apparati del giro ARP), `hypervisor_sync` (via `setHypervisorSyncSchedule(true)`,
03:00), `dns_resolve` 1440, `fast_scan` 720 per ogni rete (spalmati come `known_host_check`). 720 minuti è la soglia
che `applyTenantSchedulerDefaults` già tollera sulle reti /22 e più grandi: nessun conflitto con quel freno.

Il seme sta in `applyTenantSchedulerDefaults` (`src/lib/db-tenant.ts:7028`, gira a ogni avvio per ogni cliente):
crea il job che manca **salvo** che esista la lapide `opzioni.job_di_serie.<tipo>` = `{"acceso":false,"da","il"}` in
`tenant_settings`. La lapide la scrive lo spegnimento da Opzioni e anche la cancellazione del job dalla pagina dei job.
Riaccendere da Opzioni toglie la lapide e riaccende o ricrea il job.

### 3.3 Rotte

- `GET /api/opzioni` — `requireAuth`, `withTenantFromSession`: tutte le opzioni del catalogo con stato ed esito, più
  `puoCambiare` (ruolo admin).
- `PUT /api/opzioni/[id]` — `requireAdmin`, `withTenantFromSession`, corpo Zod `{ acceso?: boolean, valore?: string }`:
  chiama `cambia`, scrive l'audit (chi, quando, opzione, prima → dopo), ricarica lo scheduler del cliente se l'opzione
  è un job (`reloadTenantScheduler`). Un'opzione `file` → 405 con il motivo. Le opzioni dell'hub le cambia solo un
  admin dell'hub (stessa regola di oggi su `/api/settings`).

Le rotte di oggi restano (le usano le schede di configurazione e le prove); la pagina passa solo da queste due.

### 3.4 La pagina `/settings/opzioni` (tavola, oggetti 1-13)

Voce di menu «Opzioni» in `src/components/shared/sidebar.tsx` accanto a «Impostazioni». Titolo e cliente (2), filtri
Tutte · Accese · Spente · ▲ Da guardare · Da file + ricerca (3), sei gruppi nell'ordine della tavola, una riga per
opzione con colonne separate: levetta (4) · funzione e cosa fa · vale per (5) · di serie (6) · cosa è successo (7) ·
ritmo o azione (8). Levetta: «ACCESA» navy pieno con testo bianco, «SPENTA» bianca col bordo grigio, «○ DA
CONFIGURARE» bordo tratteggiato, «DA FILE» col lucchetto: si distinguono per luminanza e per scritta (Riccardo è
daltonico). Esiti a tinta piena col segno ✓ ▲ ✕ ●. Una riga cambiata da qualcuno dice «spenta da … il …» (9).
Spegnere chiede conferma con cosa si ferma, cosa resta, «resta spenta dopo gli aggiornamenti» (10). Chi non è admin
vede tutto con le levette ferme e la scritta «solo un amministratore può cambiarle» (13). Da scrivania: verifica a
1920 e 1280, niente telefono.

### 3.5 Le pagine vecchie (11)

Le levette si tolgono e al loro posto va `RigaRimando` (`src/components/opzioni/riga-rimando.tsx`): nome, stato
(ACCESA/SPENTA), «di serie» o «spenta da … il …», link «cambia da Opzioni ›» a `/settings/opzioni#<id>`. Pagine:
`/topology/dati` (6 letture, mappa, hypervisor), `/settings?tab=moduli` e `/settings/moduli/[key]` (Chocolatey,
senza agente, NIS2, Zabbix, Installa/Disinstalla dei quattro moduli), `/settings?tab=notifiche` (3 levette di
funzione), `/settings?tab=jobs` (levetta di ogni riga), `/settings?tab=sistema` (pulizia), `/settings?tab=scansione`
(Naabu), `/settings/mdm` (casella), `/settings/cosa-esce` (livello), `/controllers` (lettura apparati e client),
`/networks/[id]` (job della rete). I moduli dei dati (URL, credenziali, porte) restano nelle loro schede.

### 3.6 Fuori dal catalogo, col motivo

`tenants.active` (è l'anagrafica dei clienti dell'hub, non un'opzione del cliente), `controllers.enabled` (dato del
singolo controller), le levette di `/settings?tab=identificazione` (dati di regole), `networks.probes_enabled`
(dato per rete), gli automatismi sempre accesi (backup, allarmi salute e job fermi, correzioni all'avvio): la pagina
li elenca in fondo al gruppo «Da file dell'appliance» come «sempre acceso», senza levetta.

## 4. Errori e casi limite

- Un `leggi` che fallisce non fa fallire la pagina: la riga mostra «✕ stato illeggibile» con il codice (mai un
  silenzio, mai «spenta» per ripiego).
- Un `cambia` che fallisce: 500 col messaggio, la levetta torna com'era, niente audit di un cambio non avvenuto.
- Job di serie su un cliente senza reti: `fast_scan` non crea niente (zero reti), gli altri tre sì.
- Due admin che spengono e accendono insieme: vince l'ultima scrittura; la riga mostra chi.
- Il seme non tocca i job che esistono già (intervallo scelto da un admin, job spento senza lapide): solo quelli che
  mancano.

## 5. Come si verifica

- Prove: catalogo (ogni chiave censita al §1 è nel catalogo o nell'elenco «fuori» con motivo; ogni tipo di
  `SCHEDULED_JOB_TYPES` è coperto), seme dei job (crea i mancanti, rispetta la lapide, non tocca gli esistenti, regge
  il freno /22), rotte (non admin → 403 sul PUT, opzione file → 405, tenant giusto).
- Cancello: `npm run lint && npx tsc --noEmit && npm test && npm run build`.
- Pagina resa con Playwright e dati finti a 1920 e 1280; rimandi resi in `/topology/dati` e `/settings?tab=moduli`.
- Sull'appliance di 70151 (canale `dev`): dopo l'aggiornamento esistono i quattro job di serie (il giro ARP c'è già:
  non si duplica), la pagina mostra le VLAN lette e i job col loro ultimo giro.

## 6. Cosa diventa difficile in futuro

Ogni interruttore nuovo deve entrare nel catalogo, o la prova di completezza fallisce: è voluto, ma costa una riga
in più a chi aggiunge una funzione. Le appliance dei clienti, al primo avvio con questa versione, cominciano a
scansionare le reti ogni 12 ore e a leggere gli hypervisor ogni notte: più traffico verso gli apparati dei clienti,
deciso da Riccardo il 22/10.
