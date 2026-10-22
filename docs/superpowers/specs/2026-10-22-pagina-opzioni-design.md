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
