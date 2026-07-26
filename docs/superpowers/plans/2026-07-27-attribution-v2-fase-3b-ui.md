# Attribution v2 — Fase 3b: UI subnet (acquisizione vs attribuzione) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Spec di riferimento: `docs/superpowers/specs/2026-07-26-attribution-v2-design.md` §6 (modello target verbatim).

**Goal:** Sostituire i pannelli "Scan — intera subnet" (7 pulsanti), "Classificazione" (4 pulsanti) e "Test credenziali" della pagina subnet con il modello §6.2: un solo ingresso `Scansione iniziale` (naabu automatico se disponibile), fasi successive con stato per rete, blocco Attribuzione con un solo `Ricalcola attribuzione` (anteprima/diretto), riga di completezza §6.3.

**Architecture:** Backend: nuova API `GET /api/networks/[id]/scan-phases` (stato fasi da `scan_history` + naabuAvailable + completezza attribuzione da `hosts.attr_*`) e modalità `preview` su `POST /api/attribution/recompute`. Frontend: riscrittura dei pannelli in `network-detail-client.tsx` (righe ~1038-1243) + nuovo `AttributionPreviewDialog` modellato su `classification-proposal-dialog.tsx`. La scelta naabu/fallback è client-side: `runScanJob` è awaitabile (le combo esistenti già concatenano), quindi `Scansione iniziale` = `scan_naabu` se disponibile, altrimenti `scan_icmp` → `scan_nmap_base` in sequenza, con percorso effettivo mostrato a posteriori.

**Tech Stack:** Next.js 16 / React 19 / TS strict, shadcn v4 (@base-ui, `render=` non `asChild`), Zod v4, better-sqlite3.

## Global Constraints

- TS strict, no `any`; testo UI in italiano; errori `{ error: "italiano" }`.
- API: `requireAuth` (GET) / `requireAdmin` (POST) + `isAuthError` + `withTenantFromSession` (pattern di `refresh/route.ts:33-34`).
- Funzioni DB nuove in `db-tenant.ts` E `db.ts` (facade, regola 12).
- Client: cleanup di ogni `setInterval` via ref (regola 8); dopo mutazioni `router.refresh()`.
- NON toccare: pannelli Detect e VA Scan; il motore attribution (`src/lib/attribution/*`) salvo `recompute.ts` per l'helper preview; il sistema legacy.
- Il pannello legacy "Anteprima proposte" (`ClassificationProposalDialog`) viene smontato dalla pagina ma il file resta (deprecato, si rimuove in Fase 4).
- Transizione visibilità: la tabella host mostra ancora la classificazione legacy; dopo "Applica" dell'attribuzione la UI chiama anche `POST /api/networks/[id]/refresh` (classify legacy) così la tabella riflette il cambiamento — comportamento transitorio documentato con commento, si rimuove in Fase 4.
- Verifica finale: `npm run lint && npx tsc --noEmit && npm test && npm run build`; poi release su `dev`.

---

### Task 1: Backend — scan-phases API + preview recompute

**Files:**
- Create: `src/app/api/networks/[id]/scan-phases/route.ts`
- Modify: `src/app/api/attribution/recompute/route.ts`
- Modify: `src/lib/attribution/recompute.ts` (nuovo helper `previewHostAttribution`)
- Modify: `src/lib/db-tenant.ts` + `src/lib/db.ts` (nuove `getScanPhaseStatusForNetwork`, `getAttributionCompletenessForNetwork`)
- Test: `src/lib/attribution/__tests__/preview.test.ts`

**Interfaces (contratti per il Task 2):**

```ts
// GET /api/networks/[id]/scan-phases → 200
interface ScanPhasesResponse {
  naabuAvailable: boolean;
  phases: Array<{
    key: "initial" | "nmap_deep" | "snmp" | "enrich" | "credentials";
    label: string;                 // "Scansione iniziale", "Porte approfondite (Nmap -sV)", "SNMP", "Enrich (ARP/DHCP/AD)", "Credenziali (SSH/WinRM)"
    adds: string;                  // cosa aggiunge all'attribuzione, es. "SNMP → sysObjectID, LLDP: distingue AP da switch"
    last_run: string | null;       // MAX(timestamp) ISO da scan_history, null = mai eseguita
    stale: boolean;                // last_run più vecchio di 7 giorni
  }>;
  attribution: {
    total: number;                 // host della rete
    level2: number;                // attr_category con "." 
    level1: number;                // attr_category valorizzata senza "."
    none: number;                  // attr_category NULL o 'unknown'
    suggestion: string | null;     // §6.3, es. "32 host fermi al livello 1: esegui SNMP per distinguere AP da switch"
  };
}
// Mappa fase→scan_type per last_run (OR sui tipi):
//   initial: scan_icmp, scan_naabu, network_discovery   (scan_full viene riscritto in network_discovery, discovery.ts:496-499)
//   nmap_deep: scan_nmap_base, nmap
//   snmp: scan_snmp_verify, snmp
//   enrich: arp_poll non scrive per-network? usare i tipi presenti: 'arp','dhcp','dns' se esistono in scan_history per la rete; se nessuno, last_run null (verificare cosa scrive scan_enrich e adeguare la lista, annotandolo)
//   credentials: credential_validate

// POST /api/attribution/recompute — body esteso:
//   { network_id?, host_ids?, preview?: boolean }
// preview:true → nessuna scrittura su hosts.attr_* né history (le evidenze SÌ, recordEvidence è additivo):
interface AttributionPreviewChange {
  host_id: number; ip: string; hostname: string | null;
  manual: boolean;               // ha evidenza manual → mostrato ma NON selezionabile
  dimensions: Array<{
    dimension: "vendor" | "category" | "os";
    before: string | null;       // attr_* corrente
    after: string | null;        // claim dalla fusione
    confidence: number;
    evidence: Array<{ source: string; claim: string; raw_value: string | null }>; // evidenze citate (max 5)
    min_phase: string | null;
  }>;
}
// Response preview: { success: true, preview: true, total: number, changes: AttributionPreviewChange[] }
// changes contiene SOLO host in cui almeno una dimensione cambia (before !== after).
// Response apply (invariata): { success, hosts, recomputed, message }
```

**Steps:**

- [ ] **Step 1**: `previewHostAttribution(dbh, signals): AttributionResult` in `recompute.ts` — identica a `recomputeHostAttribution` ma SENZA `applyAttribution` (recordEvidence + fuse e basta). Refactor: `recomputeHostAttribution` la riusa e aggiunge il persist.
- [ ] **Step 2**: test `preview.test.ts` (in-memory come `recompute.test.ts`): (a) preview non scrive `hosts.attr_*` né history; (b) preview seguita da apply produce lo stesso risultato; (c) host con evidenza manual → i claim restano quelli manual.
- [ ] **Step 3**: `getScanPhaseStatusForNetwork(networkId)` in db-tenant.ts: una query `SELECT scan_type, MAX(timestamp) t FROM scan_history WHERE network_id = ? GROUP BY scan_type`, poi mappa fase→max dei suoi tipi. `getAttributionCompletenessForNetwork(networkId)`: conteggi su hosts (total, level2 = `attr_category LIKE '%.%'`, level1 = valorizzata non-unknown senza punto, none = resto) + suggestion: se level1+none > 0 e la fase snmp non è mai stata eseguita → suggerisci SNMP; altrimenti se none > level2 → suggerisci scansione iniziale; altrimenti null. Facade in db.ts.
- [ ] **Step 4**: route `scan-phases` (requireAuth + isAuthError + withTenantFromSession): compone la response; `naabuAvailable` via `isNaabuAvailable(getSetting("naabu_bin_path") ?? undefined)` (import da `@/lib/scanner/naabu`, pattern di `api/scan-config/route.ts:36-42`).
- [ ] **Step 5**: estendi `recompute/route.ts` con `preview` (Zod `.optional()`); ramo preview costruisce `changes` confrontando fusione vs `attr_*` correnti (leggi le colonne correnti nella stessa query dei segnali o con SELECT dedicata); `manual` = esiste evidenza attiva `source='manual'` per l'host; evidence citate: risolvi `evidence_ids` → righe (source, claim, raw_value), max 5 per dimensione.
- [ ] **Step 6**: `npm run lint && npx tsc --noEmit && node --import tsx --test src/lib/attribution/__tests__/preview.test.ts` puliti. Commit: `feat(attribution): API scan-phases + preview recompute (fase 3b)`.

### Task 2: Frontend — pannelli Acquisizione/Attribuzione + AttributionPreviewDialog

**Files:**
- Modify: `src/app/(dashboard)/networks/[id]/network-detail-client.tsx` (pannelli righe ~1038-1243; stato ~121-187; handler ~313-337, 720-878)
- Create: `src/components/networks/attribution-preview-dialog.tsx`

**Interfaces:** consuma i contratti del Task 1 (`ScanPhasesResponse`, `AttributionPreviewChange`).

**Design vincolante (spec §6.2/6.3):**

- **Blocco A — Acquisizione** (sostituisce il pannello Scan, stile `ACTION_PANEL`):
  - Pulsante primario unico **`Scansione iniziale`** (variant default): se `naabuAvailable` → `runScanJob("scan_naabu")`; altrimenti `await runScanJob("scan_icmp")` poi `runScanJob("scan_nmap_base")`. A completamento, toast col percorso effettivo ("Percorso: ICMP + Naabu" / "ICMP + Nmap quick"). Mai chiedere all'utente quale percorso.
  - Fasi successive, un pulsante ciascuna con **riga di stato** sotto (da `scan-phases`): `Porte approfondite (Nmap -sV)` → `scan_nmap_base` · `SNMP` → `scan_snmp_verify` · `Enrich (ARP/DHCP/AD)` → `triggerEnrich(true)` · `Credenziali (SSH/WinRM)` → `scan_credential_validate` (= `triggerScan("credential_validate")`, disabled se `networkCredentialIds.length === 0` come oggi). Stato: "mai eseguita" (muted) / "il DD/MM HH:mm" / badge "obsoleta" se stale. Tooltip (title=) con `adds`.
  - **`Esegui tutte le fasi`** (variant outline, piccolo) → `triggerScan("scan_full")`.
  - Il pannello **Test credenziali sparisce** (assorbito dalla fase Credenziali). I pannelli Detect e VA Scan restano invariati.
- **Blocco B — Attribuzione** (sostituisce il pannello Classificazione):
  - **`Ricalcola attribuzione`** (variant default) → apre `AttributionPreviewDialog`. Attivo anche durante uno scan (legge solo evidenze salvate) — quindi NON disabled su `scanning`.
  - **`Applica diretto`** (variant outline) → `POST /api/attribution/recompute {network_id}` senza dialog + transitorio `POST /refresh` legacy + toast con `message`.
  - I 4 pulsanti combo attuali (righe 1188-1236) e lo stato `classifyingSubnet`/le funzioni `scanAndClassifySubnet`/`naabuAndClassifySubnet` vengono RIMOSSI; `classifySubnet()` resta (serve al transitorio post-apply); `ClassificationProposalDialog` smontato (import e righe 1988-1993 rimossi).
- **Riga di completezza §6.3** in testa alla toolbar (sopra i pannelli): testo compatto da `attribution`: "Attribuzione: X/N a livello 2 · Y a livello 1 · Z senza — [suggestion]" + fasi eseguite. Fetch di `scan-phases` al mount e dopo ogni scan completato (nel punto in cui oggi si fa `refreshHosts()`); cleanup corretto.
- **AttributionPreviewDialog** (modellato su `classification-proposal-dialog.tsx`: Set<number>, select-all, `DIALOG_PANEL_WIDE_CLASS`, `DialogScrollableArea`):
  - Al mount: `POST /api/attribution/recompute { network_id, preview: true }` → tabella: host (ip/hostname), per dimensione cambiata `before → after` (badge con confidence), evidenze in tooltip o riga espansa (source: claim), `min_phase` ("perché ora").
  - Host `manual`: riga visibile ma checkbox disabilitata, badge "manuale".
  - Footer: "Applica selezionati" → `POST /api/attribution/recompute { host_ids: [...] }` (apply), poi transitorio `POST /refresh`, `onApplied()` → refreshHosts + router.refresh. Vuoto ("nessun cambiamento") → stato esplicito con testo positivo.

**Steps:**

- [ ] **Step 1**: `AttributionPreviewDialog` completo (nuovo file, ~200 righe, pattern del dialog esistente).
- [ ] **Step 2**: riscrittura pannelli in `network-detail-client.tsx` come da design; nuovo stato `scanPhases: ScanPhasesResponse | null` + fetch con AbortController e cleanup; rimozione stato/handler morti (`classifyingSubnet`, combo). ATTENZIONE: il file è grande — modifiche chirurgiche, non riformattare sezioni non toccate.
- [ ] **Step 3**: `npm run lint && npx tsc --noEmit && npm run build` puliti (nessun test client nel repo). Verifica manuale con grep che non restino riferimenti a `scanAndClassifySubnet|naabuAndClassifySubnet|ClassificationProposalDialog` nella pagina.
- [ ] **Step 4**: Commit: `feat(ui): subnet — acquisizione progressiva e attribuzione con anteprima (fase 3b)`.

### Task 3: Verifica finale + release

- [ ] `npm run lint && npx tsc --noEmit && npm test && npm run build` tutti puliti.
- [ ] Merge su `dev`, `npm run version:release`, `git push origin dev` (MAI main).

## Fuori scope

- Colonna/i attribuzione v2 nella tabella host e pannello evidenze per host (Fase 4, migrazione UI completa).
- Rimozione file `classification-proposal-dialog.tsx` e delle route legacy (Fase 4).
- Probe nuovi HTTP/mDNS/SSDP/WSD (Fase 3).
