# Attribution v2 — Fase 2: KB vendorizzata + mac_product_map Implementation Plan

> Spec: `docs/superpowers/specs/2026-07-26-attribution-v2-design.md` §4.4. Esegue con superpowers:subagent-driven-development.

**Goal:** Dare al motore una base dati vendor/prodotto offline: 57.791 prefissi MAC **inclusi MA-M (/28) e MA-S (/36)** — che oggi mancano e producono i vendor placeholder "IEEE Registration Authority" — e 9.874 sysObjectID (contro i 94 della tabella built-in), più la tabella curata `mac_product_map` che risolve la linea di prodotto (Ubiquiti AP vs switch) senza SNMP né convenzioni di naming.

**Architecture:** Uno script di build scarica i dataset (solo sulla macchina di sviluppo), li normalizza e produce l'artefatto SQLite **committato** `data/attribution-kb.sqlite`; l'appliance non tocca mai internet. Un modulo di lookup read-only con cache sostituisce/estende `oui-data` e la `LOOKUP_TABLE` hardcoded. `mac_product_map` vive nell'**hub** (condivisa fra tenant, editabile da UI, seedata dalla KB) e alimenta un emettitore di evidenze nuovo.

**Tech Stack:** better-sqlite3, TS strict, node:test.

## Global Constraints

- **L'appliance non scarica mai nulla**: lo script di build gira solo in sviluppo; l'artefatto è committato. Mai puntare a `standards-oui.ieee.org` (risponde 418 ai client automatici).
- **Licenze**: i dataset sono GPL-2 e vanno vendorizzati **come dati** con attribuzione, non linkati come codice → file `data/NOTICE-attribution-kb.md` con fonte, licenza, URL e data di generazione di ciascun dataset; la versione della KB è mostrata in UI (§10 rischio "drift").
- Artefatto **minimale**: solo le colonne che servono; niente indici superflui; VACUUM finale. Obiettivo < 6 MB.
- La KB è **read-only** a runtime: aperta con `readonly: true`, mai scritta dall'app.
- `mac_product_map` è **hub** (dato uguale per tutti i tenant, regola 11 CLAUDE.md); le correzioni per-tenant restano evidenze `manual`.
- TS strict, no `any`; funzioni DB hub in `db-hub.ts`; API con `requireAuth`/`requireAdmin` + Zod v4; testi UI in italiano.
- Gate per task: `npm run lint && npx tsc --noEmit && npm test`; gate completi in **worktree isolato** (altre sessioni lavorano sullo stesso checkout).

---

### Task 1: Script di build e artefatto KB

**Files:** create `scripts/build-attribution-kb.ts`, `data/NOTICE-attribution-kb.md`; genera `data/attribution-kb.sqlite` (committato).

**Fonti e formati verificati il 2026-07-28:**
- `https://www.wireshark.org/download/automated/data/manuf` — GPL-2, 57.791 righe. Formato TSV: `prefisso<TAB>nome_breve<TAB>nome_completo`. Prefissi: `00:00:01` (24 bit), `00:55:DA:00/28`, `00:1B:C5:00:00/36`. Le righe che iniziano con `#` sono commenti.
- `https://raw.githubusercontent.com/glpi-project/sysobject.ids/master/sysobject.ids` — GPL-2, 9.874 righe. Formato TSV: `id<TAB>vendor<TAB>TYPE<TAB>modello<TAB>modulo` (modello presente su 9.238). `id` è di norma il sysObjectID **relativo** all'arco enterprise (`14988` = MikroTik → `1.3.6.1.4.1.14988`), ma alcune righe sono OID assoluti (`1.2.826.0.1.4616240.1.1.4500`): il lookup deve tentare entrambe le forme.
- TYPE presenti (conteggi reali): `NETWORKING` 8916, `PRINTER` 454, `POWER` 77, `STORAGE` 43, `COMPUTER` 39, `PHONE` 12, `KVM` 5, `VIDEO` 1.

**Schema dell'artefatto:**
```sql
CREATE TABLE kb_meta (key TEXT PRIMARY KEY, value TEXT);   -- version, generated_at, source_*_url, source_*_license
CREATE TABLE oui (
  prefix TEXT PRIMARY KEY,   -- esadecimale maiuscolo SENZA separatori, es. "0015 6D" → "00156D"
  bits INTEGER NOT NULL,     -- 24 | 28 | 36
  vendor_short TEXT,
  vendor_name TEXT NOT NULL
);
CREATE INDEX idx_oui_bits ON oui(bits);
CREATE TABLE sysobj (
  oid TEXT PRIMARY KEY,      -- normalizzato in forma ASSOLUTA (1.3.6.1.4.1.x…) quando la riga è relativa
  vendor TEXT NOT NULL,
  glpi_type TEXT,
  model TEXT
);
```
**Mappa TYPE → categoria v2** (tassonomia di `taxonomy.ts`, usata dal lookup, non memorizzata nella KB per non congelarla):
`NETWORKING`→`network` (livello 1: il tipo GLPI non distingue router/switch/AP) · `PRINTER`→`peripheral.printer` · `POWER`→`power.ups` · `STORAGE`→`storage` · `COMPUTER`→`compute` · `PHONE`→`voip.phone` · `KVM`→`compute` · `VIDEO`→`av.display`.

**Steps:**
- [ ] Script con `--offline` (usa file già scaricati in una cartella di lavoro) e download via `fetch` altrimenti; scrive l'artefatto e stampa un riepilogo (righe per tabella, dimensione finale).
- [ ] Normalizzazione MAC: rimuovi `:`/`-`, uppercase; per `/28` e `/36` conserva le cifre esadecimali significative (7 e 9 cifre). Scarta righe malformate contandole.
- [ ] `kb_meta`: `version` = data ISO di generazione, più URL e licenza di ciascuna fonte.
- [ ] `PRAGMA journal_mode=DELETE` e `VACUUM` prima di chiudere (artefatto compatto, niente -wal committati).
- [ ] `NOTICE-attribution-kb.md` con attribuzione completa e istruzioni di rigenerazione.
- [ ] Test: `scripts/__tests__/build-attribution-kb.test.ts` sulle funzioni pure di parsing (una riga MA-L, una /28, una /36, un commento, una malformata; una riga sysobj relativa, una assoluta, una senza modello).

### Task 2: Lookup runtime e integrazione negli emettitori

**Files:** create `src/lib/attribution/kb.ts` + test; modify `src/lib/attribution/emitters.ts`, `src/lib/scanner/mac-vendor.ts`.

```ts
export interface KbOuiMatch { vendor_name: string; vendor_short: string | null; bits: 24 | 28 | 36 }
export interface KbSysObjMatch { vendor: string; model: string | null; category: CategorySlug | null }
export function kbLookupMac(mac: string): KbOuiMatch | null;       // longest-prefix: prova 36 → 28 → 24 bit
export function kbLookupSysObjectId(oid: string): KbSysObjMatch | null; // longest-prefix su OID, forma assoluta e relativa
export function kbVersion(): string | null;                        // da kb_meta, per la UI
export function kbAvailable(): boolean;                            // false se l'artefatto manca: nessun crash
```
- Apertura lazy, `readonly: true`, cache in modulo; se il file manca → `kbAvailable() === false` e tutti i lookup ritornano `null` (l'app continua a funzionare con `oui-data`).
- **Ordine in `mac-vendor.ts` `lookupVendorSync`**: `custom_oui.txt` (override locale, invariato) → **KB** (che copre MA-M/MA-S) → `oui-data` (fallback) . Questo elimina i placeholder "IEEE Registration Authority" quando esiste un prefisso più lungo.
- **In `emitters.ts`**: il ramo `snmp_sysobj` usa prima `kbLookupSysObjectId`, poi la `LOOKUP_TABLE` esistente come fallback; resta valido il filtro dei vendor placeholder e la soppressione della categoria per l'OID generico net-snmp (`1.3.6.1.4.1.8072.`). Se la KB dà `model`, finisce in `raw_value` (utile in UI).
- Test: match /36 vince su /28 che vince su /24; MAC sconosciuto → null; OID relativo e assoluto; KB assente → nessuna eccezione; il vendor placeholder resta filtrato.

### Task 3: `mac_product_map` (hub) + emettitore

**Files:** modify `src/lib/db-hub-schema.ts`, `src/lib/db-hub.ts`; create `src/lib/attribution/mac-product.ts` + test; modify `src/lib/attribution/emitters.ts`.

```sql
CREATE TABLE IF NOT EXISTS mac_product_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mac_prefix TEXT NOT NULL,              -- esadecimale maiuscolo senza separatori, 6/7/9 cifre
  hostname_pattern TEXT,                 -- regex opzionale, applicata solo se presente
  vendor TEXT NOT NULL,                  -- slug (vendorSlug)
  product_family TEXT,                   -- es. "UniFi AP"
  category TEXT,                         -- slug tassonomia v2, validato in scrittura
  confidence REAL NOT NULL DEFAULT 0.7,
  source TEXT NOT NULL DEFAULT 'domarc' CHECK(source IN ('seed','domarc','feedback')),
  enabled INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(mac_prefix, hostname_pattern)
);
CREATE INDEX IF NOT EXISTS idx_mac_product_prefix ON mac_product_map(mac_prefix, enabled);
```
- CRUD in `db-hub.ts`: `getMacProductMap()`, `createMacProductEntry`, `updateMacProductEntry`, `deleteMacProductEntry`, `seedBuiltinMacProductMap()` (pattern di `seedBuiltinSysObjLookup`, `db-hub.ts:320`).
- **Seed iniziale** (`source='seed'`), i casi che conosciamo dal campo — prefissi Ubiquiti con famiglia prodotto quando distinguibile, e le famiglie note per vendor con hostname_pattern: `^ap-`→`network.access_point`, `^sw-`→`network.switch`, `^gw-`/`^fw-`→`network.router`. Il seed non deve mai contraddire evidenze più forti: confidence ≤ 0.7.
- `src/lib/attribution/mac-product.ts`: `matchMacProduct(mac, hostname): { vendor, product_family, category, confidence } | null` — longest-prefix sul MAC; se la riga ha `hostname_pattern`, matcha solo se l'hostname combacia (regex compilata con try/catch: pattern non valido → riga ignorata, mai eccezione).
- In `emitters.ts`: nuova sorgente `mac_product` (già nel vocabolario `AttributionSource`), fase `scan_icmp`, emette vendor + categoria + `product_family` in `raw_value`. Va aggiunta a `RECOMPUTED_SOURCES` (è ricalcolabile dai dati host).
- Test: longest-prefix; hostname_pattern che matcha e che non matcha; pattern regex invalido ignorato; entry disabilitata ignorata; nessun match → null.

### Task 4: UI nel tab Identificazione + loop di feedback

**Files:** create `src/app/api/mac-product-map/route.ts` e `[id]/route.ts`; create `src/components/settings/mac-product-map-tab.tsx`; modify `src/components/settings/device-identification-tab.tsx`.

- API: `GET` (requireAuth) elenco con filtro testuale; `POST`/`PUT`/`DELETE` (requireAdmin) con Zod v4; validazione: `mac_prefix` esadecimale 6/7/9 cifre dopo normalizzazione, `category` dentro `isValidCategory`, `confidence` 0–1, regex `hostname_pattern` compilabile.
- UI: tabella con ricerca, form di creazione/modifica, badge della sorgente (`seed`/`domarc`/`feedback`), e in testa la **versione della KB** (`kbVersion()`) con conteggio prefissi — così si vede il drift.
- **Loop di feedback (§4.7)**: `classification_feedback` oggi è scritta e mai letta. Aggiungere un'azione esplicita in UI "Promuovi a regola" che, da una correzione registrata, crea una entry `mac_product_map` con `source='feedback'` (nessuna promozione automatica: la decisione resta dell'operatore).
- Test: le route con `requireAdmin` sono coperte dalla suite `api-auth-guards.test.ts` esistente — verificare che le nuove rientrino nel pattern.

### Task 5: Verifica, release e misura

- Gate completi in worktree isolato; merge su `dev`, `version:release`, push; deploy VM 533; poi:
  - ricalcolo attribuzione sul tenant 70791 e confronto: **quanti host perdono il vendor placeholder** e quanti guadagnano vendor/categoria rispetto alla misura precedente (categoria 178/362, vendor 312/362, livello 2 154);
  - verificare che i 5 host con `attr_vendor` prima nullo per placeholder ora abbiano un vendor reale.

## Fuori scope
- Fingerbank e AI (Fase 5). Dataset Home Assistant/Satori/OUI-Master (seconda iterazione della KB, se il ritorno lo giustifica).
