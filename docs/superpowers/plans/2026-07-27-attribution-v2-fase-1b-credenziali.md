# Attribution v2 — Fase 1b: catena credenziali unica + anti-lockout Implementation Plan

> Spec: `docs/superpowers/specs/2026-07-26-attribution-v2-design.md` §7.1-7.5. Esegue con superpowers:subagent-driven-development.

**Goal:** Riparare la catena credenziali (oggi le credenziali aggiunte dall'UI v2 non raggiungono i collettori: 41 host rispondono a SNMP senza credenziale validata, 46% dei software scan fallisce), con un unico resolver `resolveCredentialFor()`, tracciamento dei fallimenti e protezioni anti-lockout, e gli esiti di autenticazione trasformati in evidenze di attribuzione.

**Architecture:** Un solo punto di risoluzione (`src/lib/credentials/resolve.ts`) che unifica le tre sorgenti odierne — `host_credentials` (validate per prime), `device_credential_bindings`, catena di rete `network_credentials` — con ponte host↔device basato su IP e su `host_id`. I collettori smettono di leggere le tabelle legacy (`network_host_credentials`, `host_detect_credential`) passando dal resolver; le legacy restano leggibili come fallback in coda finché non sono migrate (Fase 4). I fallimenti diventano stato persistito su `host_credentials` con backoff, e ogni esito di autenticazione emette evidenza di attribuzione.

**Tech Stack:** TS strict, better-sqlite3, node:test, Zod v4.

## Global Constraints — sicurezza operativa (VINCOLANTI, prevalgono sulla spec)

- **La validazione credenziali resta su host esplicitamente selezionati.** Nessuno sweep di rete, né manuale né schedulato: ogni tentativo è un logon fallito reale → allarmi MDR/XDR e rischio lockout AD. La memoria di progetto `project-credential-validate-selection-only` è vincolante; il §7.5 della spec ("rivalidazione schedulata settimanale per subnet") **non va implementato come job di rete**: in questo piano la rivalidazione schedulata è FUORI SCOPO.
- **Budget e backoff obbligatori** su ogni percorso che tenta autenticazioni (§7.5): stop dopo N fallimenti consecutivi della stessa credenziale sulla stessa subnet, backoff esponenziale per (host, credenziale), invalidazione al fallimento.
- **Mai credenziali di dominio su host palesemente non-Windows**; saltare i multihomed secondary come già fa `/api/devices/[id]/test`.
- Nessuna credenziale in chiaro nei log, mai. `safeDecrypt()` nei percorsi non critici (regola 3 CLAUDE.md).
- TS strict no `any`; funzioni DB in `db-tenant.ts` **e** `db.ts` allineate; schema in `db-tenant-schema.ts` + ALTER idempotenti in `getTenantDb()`; testi in italiano.
- **NON toccare `src/lib/ad/health/**`**: contiene lavoro non committato di un'altra sessione (incluso `winrm-probe.ts`, che pure usa `decrypt()` nudo — si sistemerà quando quel lavoro sarà chiuso).
- Verifica per task: `npm run lint && npx tsc --noEmit && npm test`; i gate completi girano in un **worktree isolato** (l'albero principale ha modifiche altrui).

---

### Task 1: Stato dei fallimenti su `host_credentials` + resolver unico

**Files:** create `src/lib/credentials/resolve.ts`, `src/lib/credentials/__tests__/resolve.test.ts`; modify `src/lib/db-tenant-schema.ts`, `src/lib/db-tenant.ts`, `src/lib/db.ts`.

**Schema** (ALTER idempotenti col pattern `attrCols` di `getTenantDb()`, + CREATE aggiornato):
`host_credentials.fail_count INTEGER NOT NULL DEFAULT 0`, `last_error TEXT`, `last_attempt_at TEXT`, `backoff_until TEXT`.

**Interfacce prodotte:**
```ts
export type CredProtocol = "ssh" | "snmp" | "winrm" | "api";
export interface ResolvedCredential {
  credential_id: number;
  protocol: CredProtocol;
  port: number;
  source: "host_validated" | "host_unvalidated" | "device_binding" | "network_chain" | "legacy_chain";
  validated: boolean;
  fail_count: number;
  backoff_until: string | null;
}
/** Ordine: host validate → binding device con test_status success → host non validate →
 *  binding device non testati → catena di rete (network_credentials) → catena legacy.
 *  Esclude le credenziali in backoff attivo salvo includeBackoff:true. */
export function resolveCredentialsFor(
  target: { hostId?: number; deviceId?: number; ip?: string; networkId: number },
  protocol: CredProtocol,
  opts?: { includeBackoff?: boolean; limit?: number }
): ResolvedCredential[];
/** Prima credenziale utilizzabile, o null. */
export function resolveCredentialFor(target: Parameters<typeof resolveCredentialsFor>[0], protocol: CredProtocol): ResolvedCredential | null;
// stato fallimenti (db-tenant.ts + db.ts):
export function recordCredentialFailure(hostId: number, credentialId: number, protocol: CredProtocol, port: number, error: string): void; // fail_count+1, last_error, last_attempt_at, backoff_until = now + min(2^fail_count * 5min, 24h), validated=0 se era 1
export function recordCredentialSuccess(hostId: number, credentialId: number, protocol: CredProtocol, port: number): void; // fail_count=0, last_error=null, backoff_until=null, validated=1, validated_at=now
```
Il ponte host↔device: se arriva `hostId` e non `deviceId`, risolvere il device con `getNetworkDeviceByHostId` (più affidabile del match su stringa IP) e viceversa.

**Test** (DB in-memory, pattern di `src/lib/attribution/__tests__/recompute.test.ts`): ordine di precedenza completo; esclusione per backoff attivo e inclusione con `includeBackoff`; `recordCredentialFailure` incrementa e calcola il backoff, invalida `validated`; `recordCredentialSuccess` azzera; ponte host→device e device→host; nessun risultato → array vuoto (mai eccezione).

### Task 2: I collettori passano dal resolver

**Files:** modify `src/lib/scanner/discovery.ts` (SNMP: righe ~784, 1118, 1181, 1558, 1602, 1799, 2029; windows ~1273; ssh ~1372, 1678), `src/lib/probes/software-runner.ts` (~183-199), `src/lib/db-tenant.ts`+`db.ts` (`buildSnmpCommunitiesForHost`, `getOrderedDetectCredentialIds`, `getOrderedSshLinuxCredentialIds`).

- Le tre funzioni legacy diventano **wrapper** del resolver: prima le sorgenti v2, poi in coda le legacy attuali (che restano finché non migrate). Firme invariate per non toccare i call-site.
- `buildSnmpCommunitiesForHost` deve includere le community di `network_credentials` (oggi ignorate: è la causa dei 41 host SNMP senza credenziale) e mantenere `public`/`private` **in fondo**.
- `software-runner.ts` path host: accetta la risoluzione automatica via `resolveCredentialFor({hostId, networkId}, "winrm"|"ssh")` quando `opts.credentialId` è assente, invece di fallire con "non ha credenziali linkate".
- `autoBindCredentialToDevice` (`discovery.ts:123`): usare `getNetworkDeviceByHostId` con fallback su IP, e **non uscire** se il device non esiste — in quel caso registrare comunque su `host_credentials` (il binding non deve richiedere la promozione a device, §7.2).
- Test: unit sulle tre funzioni wrapper (una community aggiunta via `network_credentials` compare nella catena; l'ordine mette le validate per prime; `public`/`private` restano ultime).

### Task 3: Anti-lockout in `credential_validate`

**Files:** modify `src/lib/scanner/discovery.ts` (blocco righe 2085-2241).

- Prima di ogni tentativo: saltare le credenziali in `backoff_until` futuro; saltare i **multihomed secondary** (riusare la logica di `/api/devices/[id]/test`); saltare le credenziali di tipo `windows` su host senza alcun indicatore Windows (già presente `hasWindowsIndicator`: renderlo bloccante, non solo condizione di ramo).
- **Budget per credenziale e subnet**: contatore in memoria per run + stato persistito; dopo `N=3` fallimenti consecutivi della stessa credenziale sulla subnet, smettere di provarla per il resto del run e registrare il motivo nel log della scansione.
- Ogni fallimento → `recordCredentialFailure`; ogni successo → `recordCredentialSuccess` (che sostituisce l'attuale `addHostCredential(..., validated:true)`).
- Il binding `api` non viene più creato senza test: se non c'è un test disponibile, registrare con `validated: false` **e** `last_error: "nessun test disponibile per il protocollo api"`.
- Timeout SSH portato da 6 s a **15 s** (allineato al default del transport, §7.5: evita falsi negativi su link lenti).
- Test: DB in-memory che verifica che una credenziale in backoff non venga tentata, che dopo 3 fallimenti la credenziale sia esclusa dal resto del run, che un successo azzeri il contatore.

### Task 4: Esiti di autenticazione → evidenze di attribuzione (§7.3)

**Files:** create `src/lib/attribution/credential-evidence.ts` + test; modify `src/lib/scanner/discovery.ts` (blocco credential_validate).

```ts
export interface AuthOutcome {
  protocol: CredProtocol; ok: boolean;
  banner?: string | null;      // banner SSH, output hostname WinRM, sysDescr SNMP
  sysObjectId?: string | null;
}
export function evidenceFromAuthOutcome(o: AuthOutcome): EvidenceInput[]; // pura
```
Regole (phase `credential_validate`): WinRM OK → `os=windows` 0.95 (autoritativa, `winrm` è già in `AUTHORITATIVE_SOURCES.os`); SSH OK con banner OpenSSH/Debian/Ubuntu → `os=linux` 0.9 + `compute` 0.6; banner RouterOS/IOS/VyOS/EdgeOS → `os=network-os` 0.9 + `network` 0.7 + vendor; SNMP OK → nessuna evidenza nuova qui (già coperta dagli emettitori sysobj/sysdescr); auth rifiutata ma servizio presente → categoria debole 0.3 (`compute` per winrm, nessuna per ssh: troppo generico).
Nel blocco `credential_validate`, dopo ogni esito: `recordEvidence` + `recomputeAttributionSafe(hostId, "scan")`.

### Task 5: `safeDecrypt` nei percorsi non critici + verifica finale

**Files:** modify `src/lib/ad/ad-client.ts` (righe ~74-75 e ~441-442), `src/lib/inventory-agent/feature.ts` (~71). **NON toccare `src/lib/ad/health/winrm-probe.ts`** (lavoro altrui non committato).
- Sostituire `decrypt()` con `safeDecrypt()` + gestione esplicita del `null` (errore parlante in italiano, nessun segreto nel messaggio). In `ad-client.ts` il try/catch esiste già: mantenerlo, ma non far dipendere il flusso da un throw.
- Gate finali in worktree isolato: `npm run lint && npx tsc --noEmit && npm test && npm run build`; merge su `dev`, `version:release`, push; deploy VM 533 e misura: quanti host hanno una credenziale validata per il protocollo pertinente (§7.6), quanti software scan falliscono.

## Fuori scope
- Rivalidazione schedulata (§7.5 ultimo punto) — vietata dai vincoli operativi finché non c'è un design con budget/opt-in esplicito.
- Nuovi protocolli §7.4 (SNMP v3 completo, SMB/WMI, Redfish/IPMI, ONVIF, NETCONF) → Fase 4b.
- Migrazione e rimozione delle tabelle legacy → Fase 4.
- Vocabolario unico `protocol` (§7.2 ultimo punto): rinominare `credential_type` tocca troppa UI; rimandato.
