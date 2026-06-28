# Edge Scan UX — scope, schedulazione, naming (DA-IPAM → scanner-edge)

> Data: 2026-06-28 · Stato: design approvato (brainstorming) · Scope: migliorare chiarezza di
> **scope scansione**, **schedulazione** e **naming** nel transfer DA-IPAM → scanner-edge.

## 1. Problema e obiettivo

Oggi il pannello edge-scan (`subnet-edge-scan-panel.tsx`) espone scelte poco chiare:

- **Scope**: 3 modi esistono (`full_subnet`/`found_ips`/`populated_24`) ma con label tecniche.
- **Schedulazione**: solo **5 intervalli preset** (6h/12h/giorno/3gg/settimana). Manca il caso reale
  "mensile in orario lavorativo": molte network vanno scansionate **una volta al mese**, a un
  **orario lavorativo** preciso, non giornaliero/settimanale.
- **Naming**: il job/report non ha un nome chiaro legato a cliente+subnet; il report di ritorno usa
  l'ID dell'edge.

**Obiettivo**: rendere espliciti e leggibili scope + schedulazione + naming, riducendo errori di
configurazione, senza riscrivere il flusso esistente (riuso payload e client edge attuali).

## 2. Vincoli edge accertati (codice scanner-edge)

- L'edge **esegue** schedule **cron a 5 campi** (`schedule_runner.py` + `cron_eval.py`): cron onorato.
- Ma l'API `PUT /api/v1/networks/{id}/schedule` (`VulnScheduleBody`) **accetta solo `interval_minutes`**
  (60–10080), che mappa a 5 cron fissi. **Non accetta cron arbitrario** → va estesa.
- `POST .../scan` (`ScanNetworkBody`) **non** accetta un nome scansione custom (task gvmd
  auto-generato `edge-scan-{cidr}-{profile}-{ts}`).
- `POST /api/v1/networks/ensure` (`EnsureNetworkBody`) **accetta `label`** (rete) → memorizzato in
  `networks.label`, ritornato nelle lookup. Riutilizzabile come nome leggibile lato edge.
- Il report mostrato **in DA-IPAM** è reso da DA-IPAM (`vuln_scan_runs`) → DA-IPAM può nominarlo
  localmente come vuole, senza dipendere dall'edge.

## 3. Decomposizione (2 sotto-progetti, repo separati)

- **A — scanner-edge (DA-Vul-can)**: estendere `VulnScheduleBody` per accettare un **`cron_expr`**
  opzionale (validato con `cron_eval.validate`) in alternativa a `interval_minutes`. Persistenza in
  `network_schedules.cron_expr` (colonna già esistente). Prerequisito per schedulazione ricca.
- **B — DA-IPAM**: UX completa (scope relabel, builder frequenza→cron, naming auto+editabile,
  naming locale dei report). Questa spec è focalizzata su B; A è una spec separata nel repo edge.

## 4. Scope scansione (solo DA-IPAM)

Nessuna modifica edge: i 3 `targeting_mode` esistenti restano, ri-etichettati con label + descrizione
+ conteggio IP live (logica di conteggio già presente nel pannello):

| Valore (invariato) | Label UI | Descrizione |
|---|---|---|
| `full_subnet` | **Tutto il CIDR** | Ogni indirizzo del range nominale della subnet. |
| `populated_24` | **Solo /24 popolati** | Solo i blocchi /24 con almeno un host noto. |
| `found_ips` | **Solo IP che rispondono** | Solo host online dalla discovery IPAM. |

Le label vivono in una costante `TARGETING_MODE_LABELS` (già esiste, da arricchire con descrizione).

## 5. Schedulazione — builder per frequenza (DA-IPAM, dipende da A)

UI a builder che genera un `cron_expr` a 5 campi (min hour dom month dow):

- **Frequenza**: `daily` | `weekly` | `monthly`.
- **Orario**: `HH:MM` (input time). Mostrare il **fuso dell'appliance edge** accanto (il cron gira in
  ora locale dell'edge), per evitare equivoci su "orario lavorativo".
- **Giorno settimana** (solo `weekly`): multiselezione lun–dom → campo `dow` (es. `1,3,5`).
- **Giorno del mese** (solo `monthly`): 1–28 (consigliato; >28 evitato per mesi corti) → campo `dom`.
- **Anteprima leggibile**: es. "Ogni 15 del mese alle 10:00", "Ogni lun/mer/ven alle 09:30".

Mapping builder → cron:

```
daily   HH:MM            → "MM HH * * *"
weekly  HH:MM, dow=1,3,5 → "MM HH * * 1,3,5"
monthly HH:MM, dom=15    → "MM HH 15 * *"
```

Il `cron_expr` + `profile` + `targeting_mode` + `enabled` vengono inviati a
`PUT /api/networks/{id}/edge-scan` (DA-IPAM) → inoltrati all'edge esteso (sotto-progetto A).
Retro-compatibilità: se l'edge non ha ancora il supporto cron, DA-IPAM ricade sul preset intervallo
più vicino e mostra un avviso (degradazione esplicita, non silenziosa).

### Persistenza DA-IPAM
La configurazione schedule (frequenza, orario, giorni, nome) va salvata lato DA-IPAM per ricostruire
il builder in modifica. Tabella `edge_scan_schedules` (DB tenant):

```sql
CREATE TABLE IF NOT EXISTS edge_scan_schedules (
  network_id INTEGER PRIMARY KEY REFERENCES networks(id) ON DELETE CASCADE,
  job_name TEXT,                 -- nome leggibile (slug, vedi §6)
  frequency TEXT,                -- 'daily'|'weekly'|'monthly'
  at_time TEXT,                  -- 'HH:MM'
  days_of_week TEXT,             -- CSV '1,3,5' (weekly)
  day_of_month INTEGER,          -- 1-28 (monthly)
  cron_expr TEXT,                -- derivato, inviato all'edge
  profile TEXT,                  -- fast|balanced|deep
  targeting_mode TEXT,
  enabled INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);
```

## 6. Naming — auto + editabile (DA-IPAM)

**Default generato automaticamente, editabile dall'utente.** Senza spazi (per evitare errori su
edge/gvmd/filename): token separati da `_`, parole interne unite da `-`, `/` del CIDR → `-`,
sanitizzazione caratteri non `[A-Za-z0-9._-]` (accenti/simboli rimossi o traslitterati).

Template default:
```
<cliente>_<rete>_<cidr>_<scope>_<frequenza>
```
Esempio: `ACME_Sede-MI_10.0.0.0-24_ip-attivi_mensile`

- `<cliente>` = ragione sociale tenant (slug), `<rete>` = `networks.name` (slug), `<cidr>` con `/`→`-`,
  `<scope>` = slug del targeting_mode (`tutto-cidr`|`24-popolati`|`ip-attivi`), `<frequenza>` =
  `giornaliera`|`settimanale`|`mensile`.
- Helper `slugifyJobName(parts: string[])`: lowercase opzionale? No — mantenere il case del cliente;
  sostituire spazi interni con `-`, unire i token con `_`, strip caratteri non sicuri.

Uso del nome:
1. Inviato come `label` rete all'edge (`EnsureNetworkBody.label`) → chiarezza lato edge.
2. Salvato in `edge_scan_schedules.job_name`.
3. Usato per nominare i **report di ritorno** in DA-IPAM: in fase di sync (`sync-job.ts`), quando si
   crea/visualizza un `vuln_scan_runs`, derivare un display name dal `job_name` della rete +
   `started_at` (es. `ACME_Sede-MI_10.0.0.0-24_ip-attivi_mensile_2026-06-15`). Non richiede modifica
   schema edge: il naming del report è interamente lato DA-IPAM.

> Nota: `vuln_scan_runs` non ha oggi un campo nome. Aggiungere colonna `display_name TEXT` (migrazione
> tenant) popolata al momento del pull, oppure derivarla a runtime da `network_id`→`edge_scan_schedules.job_name`
> + `started_at`. Preferenza: **derivata a runtime** (no denormalizzazione, sempre coerente col nome corrente).

## 7. Componenti e file (sotto-progetto B)

- Modifica `src/components/networks/subnet-edge-scan-panel.tsx`: scope con descrizioni+conteggi;
  sostituire il dropdown intervalli con il **ScheduleBuilder**; campo nome auto+editabile con anteprima.
- Nuovo `src/components/networks/schedule-builder.tsx`: builder frequenza→cron + anteprima leggibile (unit-testabile a parte).
- Nuovo `src/lib/vuln/cron-builder.ts`: `buildCron({frequency, at, daysOfWeek, dayOfMonth}): string` +
  `describeCron(...)` (anteprima IT) + `slugifyJobName(parts)`. Puro, **TDD**.
- `src/lib/vuln/edge-subnet-bridge.ts`: `saveEdgeSubnetSchedule()` invia `cron_expr` + `label`;
  persiste in `edge_scan_schedules`.
- `src/app/api/networks/[id]/edge-scan/route.ts`: PUT accetta i nuovi campi (Zod), salva tabella.
- `src/lib/db-tenant-schema.ts`: tabella `edge_scan_schedules` + (opz.) nessuna colonna su vuln_scan_runs
  (naming derivato a runtime).
- `src/lib/vuln/sync-job.ts` / vista report: display name derivato da `job_name`+`started_at`.

## 8. Error handling

- Validazione builder (Zod): orario `HH:MM` valido, `dom` 1–28, almeno un `dow` se weekly.
- `cron_expr` generato validato prima dell'invio; se l'edge risponde 400 (no supporto cron) →
  fallback al preset intervallo più vicino + avviso UI (no fallimento silenzioso).
- `slugifyJobName` garantisce output non vuoto (fallback su CIDR) e solo `[A-Za-z0-9._-]`.
- `JSON.parse`/`req.json()` in try-catch; Zod `.issues`.

## 9. Testing

- `cron-builder.test.ts` (node:test): daily/weekly/monthly → cron atteso; `describeCron` testo IT;
  `slugifyJobName` (spazi→`-`, `/`→`-`, accenti rimossi, token join `_`, non vuoto).
- Smoke manuale: salvare uno schedule mensile alle 10:00 il giorno 15 su una subnet, verificare il
  cron inviato e (con edge esteso) `next_run_at` coerente.

## 10. Dipendenza dal sotto-progetto A

Il builder mensile/orario richiede l'edge esteso (accetta `cron_expr`). Fino ad allora DA-IPAM degrada
ai 5 preset con avviso. Implementare A (piccola modifica `VulnScheduleBody` + route) prima o in
parallelo; B è testabile in isolamento (cron-builder puro) e con fallback.
