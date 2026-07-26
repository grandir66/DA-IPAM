# Verifica Fase 0 — protocollo di collaudo

> Chi implementa: **Cursor**. Chi verifica: **Claude Code**. Questo file è il contratto di collaudo:
> definisce cosa viene controllato PRIMA che l'implementazione sia considerata valida, così il
> risultato non dipende da chi guarda. Piano: [2026-07-26-attribution-v2-fase-0.md](2026-07-26-attribution-v2-fase-0.md).

## Stato di partenza (baseline misurata 2026-07-26, tenant 70791)

| Metrica | Valore |
|---|---|
| Host totali | 375 |
| `classification = 'unknown'` | 38 |
| `inferred_confidence = 0` | 145 |
| `inferred_confidence = 40` (floor cascade) | 47 |
| `classification_reason = 'Insufficient evidence'` | 131 |
| Righe `sysobj_lookup` con categoria non valida | 53 su 94 (`networking` 39, `wireless` 14) |

## 1. Verifica statica (bloccante)

```bash
cd /Users/riccardo/Progetti/Domarc/DA-IPAM
npm run lint          # 0 errori
npx tsc --noEmit      # 0 errori
npm test              # tutti verdi, inclusi engine/normalize/persist preesistenti
npm run build         # build production completata
```

Nessuno dei quattro può essere saltato o "aggiustato" disattivando regole.

## 2. Revisione del diff (bloccante)

Cosa viene controllato sul diff `dev` prima/dopo:

- **Aderenza al piano**: i file toccati sono quelli previsti dai 3 task. Modifiche fuori perimetro
  vanno motivate, non presunte.
- **Nessuna regola anti-regressione violata** (vedi `AGENTS.md`): no `any`, no `console.log`, no
  `decrypt()` nudo, auth invariata sulle route, testo UI in italiano.
- **Nessun test preesistente indebolito**: soglie e asserzioni storiche non abbassate per far
  passare la build. Se un valore atteso cambia, il commit deve spiegare perché.
- **`mapSysObjCategory` è puro**: nessun accesso a DB o rete, nessun side effect.
- **La migrazione è idempotente**: rieseguire `ensureTenantDb` due volte non deve ricostruire la
  tabella la seconda volta né duplicare righe.

## 3. Verifica comportamentale (bloccante)

### 3.1 Mapper categorie

```bash
npx tsx --test src/lib/attribution/__tests__/sysobj-category.test.ts
```

Casi che devono passare, in particolare: `UniFi AP → access_point`, `UniFi Switch → switch`,
`RouterOS — CRS (Cloud Router Switch) → switch` (lo switch vince sul router), `Catalyst → switch`,
`ISR → router`, `TP-Link / Omada generico → undefined`.

### 3.2 Evidenze votanti

```bash
npx tsx --test src/lib/classification/__tests__/normalize.test.ts
```

Deve risultare che hostname, OUI, banner SSH e porte producono `votes_for`, e che una stampante
(hostname `printer-hp1` + vendor Brother + porta 9100) supera la soglia 56 **senza SNMP**.
Contro-prova: vendor `Ubiquiti Inc` da solo **non** deve votare (è ambiguo per costruzione).

### 3.3 Migrazione su copia del DB reale

```bash
cp data/tenants/70791.db /tmp/migr-check.db
sqlite3 /tmp/migr-check.db "SELECT COUNT(*) FROM network_devices;"        # prima
# avviare l'app una volta puntando alla copia, poi:
sqlite3 /tmp/migr-check.db "SELECT sql FROM sqlite_master WHERE name='network_devices';" | grep device_type
sqlite3 /tmp/migr-check.db "SELECT COUNT(*) FROM network_devices;"        # dopo: identico
sqlite3 /tmp/migr-check.db "PRAGMA foreign_key_check;"                    # vuoto
sqlite3 /tmp/migr-check.db "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='network_devices';"
```

Criteri: il CHECK include `access_point`, `nas`, `server`; **conteggio righe invariato**;
`foreign_key_check` vuoto; i 7 indici ricreati; nessuna tabella `network_devices__ap_new` residua.

## 4. Verifica in produzione (dopo il deploy)

```bash
ssh root@192.168.4.8 'cd /opt/da-invent && sqlite3 data/tenants/70791.db "
SELECT COUNT(*) FROM hosts WHERE classification IN (\"networking\",\"wireless\");
SELECT COUNT(*) FROM hosts WHERE classification = \"unknown\";
SELECT COUNT(*) FROM hosts WHERE COALESCE(inferred_confidence,0) = 0;
SELECT COUNT(*) FROM hosts WHERE inferred_confidence = 40;
"'
```

| Criterio | Soglia di accettazione |
|---|---|
| Slug `networking`/`wireless` in `hosts.classification` | **0** (obbligatorio) |
| Host `unknown` | in calo rispetto a 38 |
| Host a confidence 0 | in calo rispetto a 145 |
| Host a confidence esattamente 40 | in calo rispetto a 47 |
| Host Ubiquiti con sysObjectID noto | `access_point` o `switch`, mai `unknown` |

### Non-regressione (obbligatoria)

```bash
ssh root@192.168.4.8 'cd /opt/da-invent && sqlite3 data/tenants/70791.db "
SELECT COUNT(*) FROM host_classification_history h
JOIN hosts ON hosts.id = h.host_id
WHERE hosts.classification_manual = 1 AND h.at > datetime(\"now\", \"-1 hour\");
"'
```

Deve essere **0**: nessun host classificato a mano può essere stato riscritto. Se è > 0 la fase è
respinta a prescindere dagli altri numeri.

Inoltre: nessun host deve passare da uno slug valido a `unknown` (la policy `shouldTouchClassification`
lo vieta già; se accade è un bug introdotto).

## 5. Esito

La Fase 0 è **valida** solo se: sezioni 1, 2 e 3 tutte verdi, sezione 4 con `networking`/`wireless`
azzerati e non-regressione a 0. Le altre metriche di §4 possono migliorare in misura variabile — è
l'assenza di peggioramenti a essere vincolante, non l'entità del miglioramento.

L'esito misurato va riportato nella tabella §9 della
[spec](../specs/2026-07-26-attribution-v2-design.md), riga Fase 0.
