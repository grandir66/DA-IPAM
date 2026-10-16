# Attribution v2 — Fase 4: ritiro del sistema legacy Implementation Plan

> Spec: `docs/superpowers/specs/2026-07-26-attribution-v2-design.md` §4.7 e riga Fase 4 di §9. Esegue con superpowers:subagent-driven-development.

**Goal:** Un solo sistema. Oggi convivono il motore v2 (`hosts.attr_*`) e il legacy (`hosts.classification` + `inferred_*`) scritto da `auto-classify` e da quattro bypass. Dopo questa fase la fusione v2 è **l'unica sorgente di verità**, e le colonne legacy diventano **proiezioni** calcolate dal risultato della fusione — così tutta la UI esistente mostra il risultato v2 senza doverla riscrivere.

**Architecture:** Si inverte la direzione. `attribution/legacy-projection.ts` traduce l'esito della fusione nei valori legacy (slug `DeviceClassification` + campi `inferred_*`); `applyAttribution` scrive anche quelle colonne, **rispettando il lock manuale** (`classification_manual=1` non viene mai toccato). `auto-classify` smette di scrivere e i bypass smettono di scavalcare. Nessuna colonna viene rimossa in questa fase: la rimozione fisica è un passo separato, dopo un ciclo di produzione senza sorprese.

**Tech Stack:** TS strict, better-sqlite3, node:test.

## Global Constraints

- **Il lock manuale è sacro**: gli host con `classification_manual = 1` non devono cambiare né in `classification` né nelle proiezioni. È l'invariante che ha retto in Fase 0 e deve reggere qui.
- **Nessuna perdita di informazione visibile**: se la fusione non produce una categoria, la proiezione NON deve azzerare un `classification` esistente — si lascia il valore precedente (meglio un dato vecchio che nessun dato).
- **Niente rimozione di colonne o tabelle** in questa fase (`classification`, `inferred_*`, `classification_json` restano). Si rimuovono solo **scritture** e **codice morto**.
- Rollback semplice: la proiezione è un singolo modulo; disattivarla riporta al comportamento precedente senza migrazioni inverse.
- TS strict, no `any`; DB in `db-tenant.ts` **e** `db.ts`; testi in italiano.
- Gate per task: `npm run lint && npx tsc --noEmit && npm test`; gate completi in **worktree isolato** (altre sessioni lavorano sullo stesso checkout).

---

### Task 1: Proiezione legacy dalla fusione

**Files:** create `src/lib/attribution/legacy-projection.ts` + test; modify `src/lib/attribution/persist.ts`.

```ts
export interface LegacyProjection {
  classification: string | null;      // slug DeviceClassification, null = non proiettabile
  inferred_device_type: string | null;
  inferred_vendor: string | null;
  inferred_os_family: string | null;
  inferred_confidence: number;        // 0-100, dalla dimensione categoria
}
export function projectLegacy(result: AttributionResult): LegacyProjection;
```
- **Mappa inversa** di `mapLegacyClassification` (taxonomy.ts), con le regole di ricomposizione: `compute.server` + `os=windows` → `server_windows`; `compute.server` + `os=linux` → `server_linux`; `compute.server` senza OS → `server`; `network.access_point` → `access_point`; `storage.nas` → `nas`; `peripheral.printer` → `stampante`; `peripheral.mfp` → `multifunzione`; `av.camera` → `telecamera`; `voip.phone` → `voip`; `power.ups` → `ups`; `compute.laptop` → `notebook`; `compute.vm` → `vm`; `compute.hypervisor` → `hypervisor`; `compute.workstation` → `workstation`; `network.router|switch|firewall|modem|controller` → omonimi; `iot.*` → `iot`; `mobile.phone` → `smartphone`; `mobile.tablet` → `tablet`; `storage` (livello 1) → `storage`; `network` (livello 1) → **null** (non c'è uno slug legacy per "rete generica": meglio non proiettare che proiettare male).
- `inferred_device_type` usa il vocabolario ristretto di `auto-classify` (`router|switch|firewall|hypervisor|server|workstation|printer|iot|nas|ups`): mappa la categoria v2 su quello, `null` se non rappresentabile.
- Test tabellari: ogni riga della mappa; livello 1 non proiettabile → null; risultato vuoto → tutti null e confidence 0; **proprietà**: per ogni slug legacy `s`, `projectLegacy` di una fusione costruita da `mapLegacyClassification(s)` ritorna `s` (round-trip) tranne i casi dichiarati non proiettabili — elencali esplicitamente nel test.

**In `persist.ts` (`applyAttribution`)**: dopo la scrittura delle `attr_*`, scrivere anche le colonne legacy **solo se**: `classification_manual` è 0, la proiezione produce un valore non nullo, e il valore è diverso da quello attuale. Mantenere il guard "risultato invariato → non scrivere" già presente. Aggiungere un test che verifica che un host con `classification_manual=1` non venga toccato.

### Task 2: Ritiro dei writer legacy

**Files:** modify `src/lib/devices/auto-classify.ts` (o i suoi call-site in `db-tenant.ts`/`db.ts`), `src/lib/cron/jobs.ts` (3 punti), `src/lib/inventory-agent/enrich-host.ts`, `src/lib/ad/ad-client.ts`, `src/lib/db-tenant.ts` (`relinkAdComputersForNetwork`), `src/lib/analytics/batch-refingerprint.ts`.

- **`auto-classify`**: `applyAutoClassification` non scrive più su `hosts`. Due opzioni, scegli la meno invasiva verificando i chiamanti: (a) la funzione diventa no-op documentata e i call-site in `upsertHost` vengono rimossi; (b) resta il calcolo ma senza UPDATE. In entrambi i casi il backfill al boot (`initializeTenantDb`) va rimosso: è lavoro inutile a ogni avvio.
- **Bypass in `cron/jobs.ts`** (ARP ~276, DHCP ~309, `runDhcpPollForNetwork` ~614): rimuovere il calcolo `classifyDevice(...)` e il campo `classification` da `updateHostIfExists`. Gli hook `recomputeAttributionSafe` già presenti restano: sono loro a produrre il risultato ora.
- **`enrich-host.ts`**: rimuovere la scrittura di `inferred_os_family`/`inferred_at` (l'evidenza `inv_agent` già emessa copre il caso). Il campo `vendor` da OUI resta (è anagrafica, non attribuzione).
- **`ad-client.ts` + `relinkAdComputersForNetwork`**: rimuovere l'euristica `server_windows`/`workstation` che scrive `classification`; l'evidenza `ad` già emessa la sostituisce. `os_info`/`hostname` restano.
- **`batch-refingerprint.ts`**: smette di scrivere `classification`; continua a scrivere `detection_json` (è un dato di rilevazione, non un'attribuzione).
- Dopo ogni rimozione, verificare che il percorso emetta comunque evidenza e chiami `recomputeAttributionSafe` (se manca, aggiungerlo).
- Test: un test di regressione per ciascun writer rimosso non è praticabile senza infrastruttura; scrivere invece **un test di guardia** che fallisce se qualcuno reintroduce una scrittura diretta: cerca nel sorgente le `UPDATE hosts SET ... classification` fuori da `persist.ts` (test che legge i file e asserisce l'assenza del pattern, con una allowlist esplicita dei punti legittimi).

### Task 3: UI — un solo sistema visibile

**Files:** modify `src/app/(dashboard)/networks/[id]/network-detail-client.tsx`, `src/components/networks/attribution-preview-dialog.tsx`; delete `src/components/networks/classification-proposal-dialog.tsx`, `src/components/shared/network-credential-chains.tsx`.

- Rimuovere la chiamata **transitoria** a `classifySubnet()` dopo l'applicazione dell'attribuzione (il commento la dichiara "fino a Fase 4"): ora la proiezione allinea le colonne legacy dentro `applyAttribution`.
- La colonna "Attribuzione" diventa la colonna principale della classificazione; la vecchia colonna legacy resta solo se mostra qualcosa che l'attribuzione non copre — verifica e, se ridondante, rimuovila.
- Eliminare i due componenti morti (`classification-proposal-dialog.tsx` non ha più consumatori dalla Fase 3b; `network-credential-chains.tsx` è marcato `@deprecated` senza consumatori — verificare con grep prima di cancellare).
- Verificare che nessun import resti orfano e che il build passi.

### Task 4: Verifica, release e misura

- Gate completi in worktree isolato; merge su `dev`, `version:release`, push; deploy VM 533.
- **Misura di accettazione** sul tenant 70791, prima/dopo: quanti host hanno `classification` **coerente** con `attr_category` proiettata (deve tendere al 100% degli host non-manuali); zero host con `classification_manual=1` modificati; conteggi `attr_*` invariati o migliorati rispetto a categoria 181 / livello2 157 / vendor 330 / os 88 su 362.
- Verificare in UI che la tabella host mostri un solo dato di classificazione coerente.

## Fuori scope
- Rimozione fisica delle colonne `classification`/`inferred_*`/`classification_json` e delle tabelle credenziali legacy: passo separato, dopo un ciclo di produzione stabile.
- Riscrittura della UI di dettaglio host sul modello a tre dimensioni (vendor/categoria/OS separati): merita un suo piano.
