# Motore di classificazione multi-sorgente (evidence + scoring) — DA-IPAM

> Data: 2026-07-26 · Stato: design approvato (brainstorming) · Repo: DA-IPAM (`dev`)  
> Strategia: **Fase B** (facade sopra la cascata attuale) → **Fase A** (motore unificato).  
> Naabu: pre-pass TCP opzionale in affiancamento a Nmap (non sostituto).

## 1. Problema e obiettivo

Nmap da solo fa bene OS detection e service fingerprinting, ma l’accuratezza degrada con firewall, NAT, rate limiting, VM e stack custom. DA-IPAM ha già una pipeline multi-segnale (SNMP vendor, sysObjectID, fingerprint porte/banner/TTL, classificatore, `auto-classify` / `inferred_*`), ma:

- le decisioni non sono modellate come **evidence** esplicite con peso × confidenza;
- manca uno **storico** strutturato di classificazione / conflitti;
- `classification_reason` spiegabile non è il contratto ufficiale verso UI/ops;
- non c’è un pre-pass porte veloce (naabu) prima di Nmap mirato.

**Obiettivo:** assegnare a ogni host uno slug di classificazione IPAM esistente, con:

- `confidence_overall` (0–100)
- `classification_reason`
- `evidence[]` (fonti, pesi, observed vs inferred)
- policy di update che non degrada identità forti né override manuali
- opzionale: naabu come discovery TCP prima di Nmap

**Non obiettivo (Fase B):** nuova tassonomia slug, ML, Scanner-Edge, fingerprint passivi (span/LLDP/mDNS) come requisito, sostituzione di Nmap.

## 2. Contesto codice esistente (riuso obbligatorio)

| Pezzo attuale | Ruolo |
|---|---|
| Cascata Identificazione (README) | SNMP vendor → hostname → sysObjectID → fingerprint → classifier |
| `src/lib/scanner/device-fingerprint.ts` | Match porte/OID/sysDescr/MAC/banner/TTL → `detection_json` |
| `src/lib/device-classifier.ts` | Regole OID/text/port/hostname/vendor |
| `src/lib/device-fingerprint-classification.ts` | `final_device` → slug classificazione |
| `src/lib/devices/auto-classify.ts` | `inferred_*` + confidence + reasons (v3) |
| `src/lib/analytics/fingerprint-explain.ts` | Explain UI da snapshot |
| `hosts.classification` / `classification_manual` | Decisione + override utente |
| `hosts.detection_json` / `open_ports` | Artefatti scan |

Slug: restano `DEVICE_CLASSIFICATIONS` / custom slug UI. Nessuna rimappa tassonomia in B.

## 3. Approccio: Fase B → Fase A

### Fase B — Facade di normalizzazione (MVP)

Dopo la cascata attuale, un modulo `classification-engine`:

1. normalizza segnali già prodotti (+ porte naabu se presenti) in `evidence[]`;
2. calcola score per slug e `confidence_overall`;
3. produce `classification_reason`;
4. applica policy di update;
5. persiste summary + ultime N evidence; history su cambio/conflitto.

La cascata **non** viene riscritta; il motore spiega e governa l’update.

### Fase A — Motore unificato (dopo B validata)

- Migrare regole dentro il motore (pesi/precedenze unici).
- Assottigliare cascade / `device-classifier` / parti di fingerprint duplicate.
- Pesi editabili + libreria fingerprint enterprise locale.
- Validazione su dataset reale etichettato prima di heuristics evolute / ML leggero (ML non in scope vicino).

## 4. Architettura

**Runtime:** appliance DA-IPAM (come nmap/SNMP oggi). Nessun coinvolgimento Scanner-Edge in B.

```
1. Discovery host (ping/ARP)                 — invariato
2. Naabu pre-pass TCP (opzionale)            — porte aperte veloci
3. Nmap mirato (-sV / -O / UDP da profilo)   — porte naabu + porte “sempre utili”
4. Cascade identificazione attuale           — invariata in B
5. Facade classification-engine              — NEW
6. Persistenza ibrida                        — summary + history condizionale
```

### Componenti nuovi (B)

| Path | Responsabilità |
|---|---|
| `src/lib/classification/types.ts` | Evidence, Decision, Conflict, engine version |
| `src/lib/classification/normalize.ts` | Adapter da cascade / nmap / naabu / SNMP / banner → evidence |
| `src/lib/classification/engine.ts` | Scoring, reason, policy update |
| `src/lib/scanner/naabu.ts` | Wrapper CLI; fail-soft se binario assente |
| Schema tenant | Colonne summary su `hosts` + `host_classification_history` |

### Cosa non cambia in B

- Slug classificazione e filtri UI esistenti
- Regole fingerprint/SNMP/sysObjectID in hub
- Significato di `classification_manual=1`

## 5. Modello dati

### 5.1 Summary su `hosts`

| Campo | Contenuto |
|---|---|
| `classification` | slug IPAM (invariato) |
| `classification_manual` | override utente (invariato) |
| `inferred_confidence` | **riuso** come confidence overall 0–100 del motore (già esistente; niente colonna duplicata) |
| `classification_reason` | **nuovo** — one-liner spiegabile |
| `classification_json` | **nuovo** — snapshot: evidence (ultime N, default 20), conflicts, fingerprint_hash, engine_version, sources |
| altri `inferred_*` | allineati dalla facade quando applica una decisione (`inferred_device_type`, vendor, os_family, reasons, …) |

`detection_json` resta l’artefatto fingerprint grezzo; `classification_json` è il contratto decisionale.  
Policy di upgrade confronta sempre `inferred_confidence` (corrente vs nuova).

### 5.2 Evidence

```ts
type EvidenceSource =
  | "naabu" | "nmap" | "snmp" | "http" | "ssh" | "smb"
  | "mac_oui" | "dns" | "ttl" | "rule";

interface ClassificationEvidence {
  source: EvidenceSource;
  attribute: string;      // es. sysObjectID, os_guess, title, tcp_ports
  value: string;
  weight: number;         // 0–1
  confidence: number;     // 0–1
  observed: boolean;      // true = letto dal wire; false = inferred da regola
  timestamp: string;      // ISO-8601
  votes_for?: string;     // slug IPAM se l’evidence vota una categoria
}
```

### 5.3 History — `host_classification_history` (DB tenant)

Scrittura **solo se**:

- cambia `classification`, oppure
- `|Δ confidence| ≥ 5`, oppure
- nasce un conflitto.

| Colonna | Note |
|---|---|
| `id` | PK |
| `host_id` | FK host |
| `at` | ISO / unix |
| `classification` | slug al tempo T |
| `confidence` | 0–100 |
| `reason` | testo |
| `evidence_json` | snapshot evidence usate |
| `conflicts_json` | nullable |
| `trigger` | `scan` \| `apply` \| `manual` \| `backfill` |

### 5.4 Conflitto

Due slug con score entro finestra **Δ < 10** (punti normalizzati 0–100) → entry in `conflicts`; non appiattire. La policy (§6) decide se aggiornare `classification`.

### 5.5 Esempio payload decisionale (contratto logico)

```json
{
  "ip": "192.0.2.10",
  "hostname": "esx01.lab.local",
  "classification": "hypervisor",
  "vendor": "VMware",
  "os_family": "VMware ESXi",
  "confidence_overall": 93,
  "classification_reason": "Management UI and service pattern indicate ESXi host; overrides generic Linux OS fingerprint",
  "evidence": [
    {"source":"http","attribute":"title","value":"VMware ESXi","weight":0.9,"confidence":0.95,"observed":true,"votes_for":"hypervisor"},
    {"source":"nmap","attribute":"os_guess","value":"Linux 5.x or VMware VMkernel","weight":0.5,"confidence":0.62,"observed":true,"votes_for":"server_linux"},
    {"source":"naabu","attribute":"tcp_ports","value":"22,80,443,902","weight":0.2,"confidence":0.8,"observed":true}
  ],
  "last_seen": "2026-07-26T00:55:00Z"
}
```

Campi `vendor` / `os_family` in B: popolati via `inferred_*` esistenti quando disponibili; non richiedono nuova tassonomia.

## 6. Motore di scoring e policy

### 6.1 Formula

Per ogni slug candidato `c`:

\[
score(c)=\sum_i weight_i \times confidence_i
\]

solo sulle evidence con `votes_for = c` (o mappate dalla regola che le ha prodotte).

`confidence_overall` = normalizzazione 0–100 del max score (con floor/ceiling).  
Sotto **soglia minima** (default allineata a fingerprint attuale ~0.56 → ~56): non forzare; preferire `unknown` o slug generico a bassa confidence.

### 6.2 Precedenza fonti (pesi di default)

Ordine di affidabilità (alto → basso):

1. SNMP `sysObjectID` / `sysDescr` specifici  
2. Banner management dedicati (iLO, iDRAC, ESXi, Proxmox, Synology, …)  
3. SMB / WinRM  
4. SSH appliance-specific (banner generico OpenSSH = medio)  
5. MAC OUI  
6. Nmap OS guess generico  
7. Naabu porte da sole (peso basso; servono ad abilitare probe, non a classificare)

In B i pesi sono costanti nel modulo engine; in A diventano configurabili.

### 6.3 Policy di update (scelta A)

All’arrivo di una nuova decisione da scan/apply:

1. Se `classification_manual = 1` → aggiorna evidence/summary/confidence/reason **senza** cambiare `classification`.
2. Altrimenti se `score_new >= score_current` → applica nuova `classification` + reason + inferred allineati.
3. Se score vicini (Δ confidence < 10) ma slug diversi → registra `conflict`; non degradare un’identità già più forte senza evidenza dominante.
4. Solo segnali deboli → lascia `unknown` / generico a bassa confidence.

### 6.4 Pseudo-codice

```
function classifyHost(host, rawSignals, cascadeResult):
  evidence = normalize(rawSignals, cascadeResult)  // include naabu ports se presenti
  scores = {}
  for e in evidence where e.votes_for:
    scores[e.votes_for] += e.weight * e.confidence

  best = argmax(scores)
  overall = normalize0_100(scores[best])
  reason = buildReason(best, evidence, cascadeResult)
  conflicts = detectConflicts(scores, window=10)

  decision = { classification: best or "unknown", confidence: overall, reason, evidence, conflicts }

  if host.classification_manual:
    persistSummary(host, decision, touchClassification=false)
  else if shouldUpgrade(host, decision):  // score_new >= score_current, no weak overwrite
    persistSummary(host, decision, touchClassification=true)
    maybeAppendHistory(host, decision, trigger="scan")
  else:
    persistSummary(host, decision, touchClassification=false)
    if conflicts: maybeAppendHistory(host, decision, trigger="scan")

  return decision
```

### 6.5 Regole qualitative (da preservare in normalize/reason)

Esempi già noti in campo / codice (Synology vs Windows SMB, ESXi vs Linux generico, BMC, stampanti SNMP, camere ONVIF/RTSP): la facade deve far vincere il segnale forte nel **reason** anche quando la cascata ha già scelto lo slug corretto — così UI e history restano auditabili.

## 7. Naabu + probing progressivo

### 7.1 Ruolo naabu

- Solo discovery **TCP** veloce.
- Non OS detection, non version detection, non UDP.
- Output → `hosts.open_ports` + evidence `source=naabu`, `attribute=tcp_ports`.
- Nmap successivo mirato: `-sV` / `-O` / UDP da profilo sulle porte trovate **più** porte sempre utili (es. 22, 80, 443, 445, 161, 3389, 554, 623, 9100).

### 7.2 Fail-soft

- Binario assente o exit ≠ 0 → warning in log job, **fallback Nmap-only** (comportamento attuale).
- Job di scan non fallisce per mancanza naabu.

### 7.3 Configurazione

Su profilo/settings scan:

- `port_discovery`: `"nmap"` | `"naabu+nmap"` (default `"nmap"` finché naabu non validato in lab)
- path binario opzionale (default: `naabu` in `PATH`)

Install: dipendenza **opzionale** documentata in README / `scripts/install.sh` (binary ProjectDiscovery). Non bloccare install DA-IPAM.

### 7.4 Livelli di probing

| Livello | Contenuto | Fase |
|---|---|---|
| 1 | Host up (ping/ARP) | già c’è |
| 2 | Top TCP (naabu o nmap) | B3 |
| 3 | Nmap service/OS + banner leggeri | già c’è |
| 4 | SNMP / probe profondi se credenziali e host promettente | già c’è / raffinare in A |
| 5 | Passiva / LLDP / mDNS | fuori B |

Stessi vincoli operativi di nmap (privilegi dove servono; no scan Internet da questo modulo; rate configurabile).

## 8. UI (minimo B)

- Dettaglio host: badge confidence + `classification_reason` (riuso pattern `fingerprint-explanation-panel` dove possibile).
- Lista “Evidence” (ultime N) e “Conflicts” se presenti.
- Timeline history (collapse).
- Settings → Scansione: toggle `naabu+nmap`, path binario, stato disponibile/non trovato.

Nessun redesign delle liste classificazione / filtri slug.

## 9. Error handling

| Caso | Comportamento |
|---|---|
| Naabu missing/fail | Fallback Nmap; nessuna evidence naabu |
| Nmap/SNMP parziali | Evidence incomplete; score più basso; job continua |
| `classification_json` corrotto | Ignora snapshot; ricalcola al prossimo scan; history intatta |
| Override manuale | Mai sovrascrittura di `classification` dalla facade |

## 10. Test

**Unit**

- `normalize`: mapping signal → evidence (snmp, nmap os_guess, http title, naabu ports)
- `engine` score e `buildReason`
- Policy: manual lock / upgrade / conflict window / unknown sotto soglia

**Fixture (regressione nota)**

- ESXi: HTTP title vince su nmap “Linux”
- Synology: non classificare come `server_windows` solo per SMB/445
- Printer/UPS con SNMP entity
- Host senza segnali forti → unknown / bassa confidence

**Integration light**

- Naabu assente → fallback
- Naabu mock CLI → porte in `open_ports` + evidence

## 11. Roadmap implementativa

| Step | Scope |
|---|---|
| **B1** | `types` + `normalize` + `engine` + colonne `classification_reason` / `classification_json` + `host_classification_history` + wire post-cascade (riuso `inferred_confidence`) |
| **B2** | UI explain/history + policy in percorso `upsertHost` / apply-classifications |
| **B3** | `naabu.ts` + flag profilo + docs install opzionale |
| **B4** | Validazione su dataset reale etichettato (lab) |
| **A** | Unificazione regole nel motore; pesi editabili; thinning cascade; fingerprint enterprise locale |

### Fuori scope B

- ML puro
- Passive tap / JA3 obbligatorio
- Scanner-Edge come runtime di classificazione
- Nuova tassonomia slug (BMC come slug dedicato, ecc.) — eventuali alias solo in A se servono
- Sostituire Nmap con naabu

## 12. Riferimenti

- Pipeline attuale: [README.md](../../../README.md) § Pipeline di identificazione dispositivi
- Codice: `device-fingerprint.ts`, `device-classifier.ts`, `auto-classify.ts`, `fingerprint-explain.ts`
- Fonti esterne (contesto OS detection / limiti Nmap): Nmap OS Detection book; discussioni fingerprint incompleti / middlebox (vedi brief di prodotto 2026-07-26)

## 13. Decisioni chiuse (brainstorming)

| Tema | Scelta |
|---|---|
| Strategia | B (facade) poi A (unificato) |
| Implementazione B | Approccio 1 — normalize sopra cascata |
| Tassonomia | Slug IPAM invariati |
| Persistenza | Ibrida: summary + ultime N evidence; history su cambio/conflitto |
| Update policy | Manual lock; else upgrade solo se score_new ≥ score_current; conflict se vicini |
| Naabu | Pre-pass TCP only; default profilo `nmap` finché non validato |
| Runtime | Solo DA-IPAM appliance |
