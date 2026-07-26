# Attribution v2 — Fase 0 (quick-fix) Implementation Plan

> **Per l'agente che implementa (Cursor, Codex, Claude Code):** esegui il piano **un task per volta**,
> nell'ordine dato. Ogni task ha il suo ciclo test → implementazione → verifica → commit: non
> accorpare i commit e non saltare gli step di verifica. Spunta le checkbox (`- [ ]`) man mano.
> Vincoli di progetto non negoziabili: [AGENTS.md](../../../AGENTS.md). Design di riferimento:
> [spec Attribution v2](../specs/2026-07-26-attribution-v2-design.md).
>
> **Regola sui test preesistenti:** se un test storico cambia esito, NON abbassare soglie o
> asserzioni per farlo passare — aggiorna il valore atteso e spiega il motivo nel commit.

**Goal:** Sbloccare l'attribuzione già oggi — senza nuova architettura — correggendo le tre cause che rendono `classification` inutilizzabile: le categorie legacy di `sysobj_lookup`, le evidenze che non votano, e l'assenza di `access_point` tra i tipi di device.

**Architecture:** Nessun nuovo motore. Si interviene su tre punti esistenti: (1) un mapper puro traduce la `category` libera di `SysObjMatch` in un `DeviceClassification` valido, disambiguando switch/router/AP dal nome prodotto; (2) `normalize.ts` assegna `votes_for` alle evidenze oggi mute, riusando le regole già presenti in `device-classifier.ts` invece di duplicarle; (3) una migrazione di tabella (idiom già usato nel repo) estende il CHECK `network_devices.device_type`.

**Tech Stack:** TypeScript strict · Next.js 16 · better-sqlite3 (WAL) · test runner `node:test` + `node:assert/strict` via tsx.

## Global Constraints

- **Node 22 LTS obbligatorio** (≥25 rompe better-sqlite3).
- Branch di lavoro: **`dev`**. Mai push su `main` (promote via UI).
- Ogni modifica al codice termina con `npm run version:release` + `git push origin dev`.
- Verifica completa prima della release: `npm run lint && npx tsc --noEmit && npm run build`.
- TypeScript strict, **no `any`**. Testo UI/errori in italiano; nomi simbolo e log tecnici in inglese.
- Nessun framework di migrazioni: modifiche schema **idempotenti e inline**, nel file `*-schema.ts` o in `ensureTenantDb`, mai DDL ad-hoc.
- Test: file in `src/lib/**/__tests__/*.test.ts`, eseguiti da `npm test` (`node --import tsx --test "src/**/*.test.ts"`).

---

### Task 1: Mapper categorie sysObjectID → classificazione valida

Oggi `discovery.ts:2566-2568` fa `nmapData.sysObjMatch.category as DC`: un cast falso. Su 94 righe della lookup table, **53 hanno categorie non valide** (`networking` 39, `wireless` 14); `firewall`, `server`, `storage` sono invece già slug legittimi. Conseguenza: l'UniFi AP (`1.3.6.1.4.1.41112.1.6`) finisce `wireless` e l'UniFi Switch (`.41112.1.4`) finisce `networking` — entrambi non renderizzabili.

**Files:**
- Create: `src/lib/attribution/sysobj-category.ts`
- Create: `src/lib/attribution/__tests__/sysobj-category.test.ts`
- Modify: `src/lib/scanner/discovery.ts:2565-2568`

**Interfaces:**
- Consumes: `SysObjMatch` da `src/lib/scanner/snmp-sysobj-lookup.ts` (`{ vendor, product, category, enterpriseId }`); `DeviceClassification` da `src/lib/device-classifier.ts`.
- Produces: `mapSysObjCategory(match: SysObjMatch): DeviceClassification | undefined` — usata in Task 4 per la verifica sui dati reali.

- [ ] **Step 1: Write the failing test**

Create `src/lib/attribution/__tests__/sysobj-category.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapSysObjCategory } from "../sysobj-category";
import type { SysObjMatch } from "@/lib/scanner/snmp-sysobj-lookup";

function m(product: string, category: string, vendor = "Ubiquiti"): SysObjMatch {
  return { vendor, product, category, enterpriseId: 41112 };
}

test("wireless → access_point (UniFi AP)", () => {
  assert.equal(mapSysObjCategory(m("UniFi AP (UAP serie)", "wireless")), "access_point");
});

test("networking + prodotto switch → switch (UniFi Switch)", () => {
  assert.equal(mapSysObjCategory(m("UniFi Switch (USW serie)", "networking")), "switch");
});

test("networking + prodotto router → router (MikroTik CCR)", () => {
  assert.equal(
    mapSysObjCategory(m("RouterOS — CCR serie (Cloud Core Router)", "networking", "MikroTik")),
    "router",
  );
});

test("switch vince su router quando il prodotto contiene entrambi (CRS)", () => {
  assert.equal(
    mapSysObjCategory(m("RouterOS — CRS (Cloud Router Switch)", "networking", "MikroTik")),
    "switch",
  );
});

test("Catalyst → switch, ISR → router", () => {
  assert.equal(mapSysObjCategory(m("Catalyst 2960 serie", "networking", "Cisco")), "switch");
  assert.equal(mapSysObjCategory(m("ISR 4000 serie", "networking", "Cisco")), "router");
});

test("categorie già valide passano invariate", () => {
  assert.equal(mapSysObjCategory(m("UniFi Security Gateway (USG)", "firewall")), "firewall");
  assert.equal(mapSysObjCategory(m("Synology DSM", "storage", "Synology")), "storage");
  assert.equal(mapSysObjCategory(m("iLO 5", "server", "HPE")), "server");
});

test("networking ambiguo → undefined (lascia decidere alla cascade)", () => {
  assert.equal(mapSysObjCategory(m("TP-Link / Omada generico", "networking", "TP-Link")), undefined);
});

test("categoria vuota o sconosciuta → undefined", () => {
  assert.equal(mapSysObjCategory(m("Qualcosa", "")), undefined);
  assert.equal(mapSysObjCategory(m("Qualcosa", "banana")), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/attribution/__tests__/sysobj-category.test.ts`
Expected: FAIL — `Cannot find module '../sysobj-category'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/attribution/sysobj-category.ts`:

```ts
/**
 * Traduce la `category` libera di `SysObjMatch` in un `DeviceClassification` valido.
 *
 * La lookup table `snmp-sysobj-lookup.ts` usa categorie storiche ("networking",
 * "wireless") che NON sono slug di classificazione: usarle direttamente produce
 * valori non renderizzabili in UI. Qui vengono normalizzate, disambiguando
 * switch/router dal nome prodotto quando la categoria da sola non basta.
 *
 * Ritorna `undefined` quando il prodotto è genuinamente ambiguo: la cascade di
 * discovery.ts prosegue con i livelli successivi invece di fissare uno slug sbagliato.
 */
import { DEVICE_CLASSIFICATIONS } from "@/lib/device-classifications";
import type { DeviceClassification } from "@/lib/device-classifier";
import type { SysObjMatch } from "@/lib/scanner/snmp-sysobj-lookup";

const VALID = new Set<string>(DEVICE_CLASSIFICATIONS);

/** Linee prodotto inequivocabilmente switch. Valutate PRIMA dei router: "Cloud Router Switch" è uno switch. */
const SWITCH_PRODUCT = /switch|catalyst|procurve|comware|aos-cx|\bcrs\b|\busw\b|tl-sg|m4[13]00|hp\s*19[12]0/i;
/** Linee prodotto inequivocabilmente router/gateway. */
const ROUTER_PRODUCT = /router|\bisr\b|\basr\b|\bccr\b|\brb\d|hex|hap|dream\s*machine|\budm\b|gateway/i;

export function mapSysObjCategory(match: SysObjMatch): DeviceClassification | undefined {
  const category = match.category?.trim().toLowerCase() ?? "";
  const product = match.product ?? "";

  if (category === "wireless") return "access_point";

  if (category === "networking") {
    if (SWITCH_PRODUCT.test(product)) return "switch";
    if (ROUTER_PRODUCT.test(product)) return "router";
    return undefined;
  }

  return VALID.has(category) ? (category as DeviceClassification) : undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/attribution/__tests__/sysobj-category.test.ts`
Expected: PASS — 8 test.

- [ ] **Step 5: Wire it into discovery**

In `src/lib/scanner/discovery.ts`, aggiungi l'import in cima al file, accanto agli altri import da `@/lib`:

```ts
import { mapSysObjCategory } from "@/lib/attribution/sysobj-category";
```

Sostituisci il blocco alle righe 2565-2568:

```ts
    // sysObjectID lookup (dalla tabella snmp-sysobj-lookup.ts): alta affidabilità, match esatto su OID standard
    const classFromSysObj: DC | undefined = nmapData?.sysObjMatch
      ? (nmapData.sysObjMatch.category as DC)
      : undefined;
```

con:

```ts
    // sysObjectID lookup (dalla tabella snmp-sysobj-lookup.ts): alta affidabilità, match esatto su OID standard.
    // La category della lookup è storicamente libera ("networking"/"wireless"): mapSysObjCategory la
    // normalizza a uno slug valido e ritorna undefined se il prodotto è ambiguo, così la cascade prosegue.
    const classFromSysObj: DC | undefined = nmapData?.sysObjMatch
      ? mapSysObjCategory(nmapData.sysObjMatch)
      : undefined;
```

- [ ] **Step 6: Verify type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/lib/attribution src/lib/scanner/discovery.ts`
Expected: nessun errore.

- [ ] **Step 7: Commit**

```bash
git add src/lib/attribution/sysobj-category.ts src/lib/attribution/__tests__/sysobj-category.test.ts src/lib/scanner/discovery.ts
git commit -m "fix(classification): mappa categorie sysObjectID legacy a slug validi

Le 53 righe con category networking/wireless producevano slug non
renderizzabili (UniFi AP -> wireless, UniFi Switch -> networking).
mapSysObjCategory normalizza e disambigua switch/router dal prodotto."
```

---

### Task 2: Far votare le evidenze oggi mute

`scoreByClassification` (`classification/engine.ts:29`) salta ogni evidenza senza `votes_for`. In `normalize.ts` le evidenze `dns` (hostname), `mac_oui` (vendor), `ssh` (banner) e `naabu` (porte) sono create **senza voto**: contribuiscono zero al punteggio e restano solo decorative nel pannello. È la causa della confidence bloccata a 40 (il floor di `cascadeConfidence`) su gran parte degli host.

Il voto si ricava riusando le regole già esistenti in `device-classifier.ts` — `classifyDeviceDetailed()` accetta un `ClassifierInput` e applica OID/text/hostname/vendor/port rules — invocandolo con **un solo segnale per volta**. Nessuna tabella di regole duplicata.

**Files:**
- Modify: `src/lib/classification/normalize.ts` (aggiunta helper + 4 punti di `votes_for`)
- Modify: `src/lib/classification/__tests__/normalize.test.ts` (append)

**Interfaces:**
- Consumes: `classifyDeviceDetailed(input: ClassifierInput): DeviceDetectionResult` da `src/lib/device-classifier.ts`; `SOURCE_WEIGHTS` da `./weights` (dns 0.35, mac_oui 0.4, ssh 0.55, naabu 0.2).
- Produces: nessuna nuova export pubblica — cambia solo il contenuto di `normalizeToEvidence()`.

- [ ] **Step 1: Write the failing test**

Append a `src/lib/classification/__tests__/normalize.test.ts`:

```ts
import { decideClassification } from "../engine";

test("hostname, vendor e porte votano: stampante supera la soglia senza SNMP", () => {
  const evidence = normalizeToEvidence({
    hostname: "printer-hp1",
    vendor: "Brother Industries, Ltd.",
    naabu_ports: [9100],
  });

  const dns = evidence.find((e) => e.source === "dns");
  const oui = evidence.find((e) => e.source === "mac_oui");
  const ports = evidence.find((e) => e.source === "naabu");
  assert.equal(dns?.votes_for, "stampante");
  assert.equal(oui?.votes_for, "stampante");
  assert.equal(ports?.votes_for, "stampante");

  // 0.35*0.6 + 0.4*0.7 + 0.2*0.8 = 0.65 → 65 ≥ MIN_APPLY_CONFIDENCE (56)
  const decision = decideClassification(evidence);
  assert.equal(decision.classification, "stampante");
  assert.ok(decision.confidence >= 56, `confidence attesa ≥56, ottenuta ${decision.confidence}`);
});

test("banner SSH RouterOS vota router", () => {
  const evidence = normalizeToEvidence({
    detection: { banner_ssh: "SSH-2.0-ROSSSH MikroTik RouterOS 7.14" },
  });
  assert.equal(evidence.find((e) => e.source === "ssh")?.votes_for, "router");
});

test("vendor ambiguo non vota (Ubiquiti fa AP, switch e gateway)", () => {
  const evidence = normalizeToEvidence({ vendor: "Ubiquiti Inc" });
  assert.equal(evidence.find((e) => e.source === "mac_oui")?.votes_for, undefined);
});

test("hostname senza pattern noto non vota", () => {
  const evidence = normalizeToEvidence({ hostname: "pc-di-mario" });
  assert.equal(evidence.find((e) => e.source === "dns")?.votes_for, undefined);
});
```

> Nota: `normalizeToEvidence` e gli helper `test`/`assert` sono già importati in testa al file esistente. Se `decideClassification` risulta già importato, non duplicare l'import.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/classification/__tests__/normalize.test.ts`
Expected: FAIL — `Expected values to be strictly equal: undefined !== 'stampante'`.

- [ ] **Step 3: Write the implementation**

In `src/lib/classification/normalize.ts`, aggiungi l'import in testa al file:

```ts
import { classifyDeviceDetailed } from "@/lib/device-classifier";
```

Aggiungi questo helper subito dopo la funzione `cascadeVotes` (riga 86):

```ts
/**
 * Voto derivato da UN SINGOLO segnale.
 *
 * Riusa le regole di `device-classifier.ts` (hostname/vendor/port/text) passando
 * un solo campo per volta: così l'evidenza vota esattamente ciò che quel segnale
 * implica, senza duplicare le tabelle di regole e senza che un segnale forte
 * "trascini" gli altri. Ritorna undefined quando il segnale non è discriminante
 * (es. vendor Ubiquiti, che produce AP, switch e gateway).
 */
function singleSignalVote(
  signal:
    | { hostname: string }
    | { vendor: string }
    | { osInfo: string }
    | { openPorts: number[] },
): string | undefined {
  if ("openPorts" in signal) {
    return (
      classifyDeviceDetailed({ openPorts: signal.openPorts.map((port) => ({ port })) })
        .classification ?? undefined
    );
  }
  return classifyDeviceDetailed(signal).classification ?? undefined;
}
```

Modifica i quattro blocchi di evidenza. Hostname (righe 122-130) diventa:

```ts
  if (input.hostname?.trim()) {
    const hostname = input.hostname.trim();
    out.push(
      evidence("dns", "hostname", hostname, {
        timestamp: ts,
        confidence: 0.6,
        observed: true,
        votes_for: singleSignalVote({ hostname }),
      })
    );
  }
```

Vendor OUI (righe 132-140) diventa:

```ts
  if (input.vendor?.trim()) {
    const vendor = input.vendor.trim();
    out.push(
      evidence("mac_oui", "vendor", vendor, {
        timestamp: ts,
        confidence: 0.7,
        observed: true,
        votes_for: singleSignalVote({ vendor }),
      })
    );
  }
```

Porte naabu (righe 142-150) diventa:

```ts
  if (input.naabu_ports && input.naabu_ports.length > 0) {
    out.push(
      evidence("naabu", "tcp_ports", input.naabu_ports.join(","), {
        timestamp: ts,
        confidence: 0.8,
        observed: true,
        votes_for: singleSignalVote({ openPorts: input.naabu_ports }),
      })
    );
  }
```

Banner SSH (righe 166-174) diventa:

```ts
  if (snap?.banner_ssh?.trim()) {
    const bannerSsh = snap.banner_ssh.trim();
    out.push(
      evidence("ssh", "banner", bannerSsh, {
        timestamp: ts,
        confidence: 0.55,
        observed: true,
        votes_for: singleSignalVote({ osInfo: bannerSsh }),
      })
    );
  }
```

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS — inclusi i test preesistenti di `engine.test.ts`, `normalize.test.ts`, `persist.test.ts`. Se un test preesistente fallisce perché ora una decisione ha confidence più alta, **non abbassare le soglie**: aggiorna l'asserzione del test vecchio al nuovo valore e annota il motivo nel messaggio di commit.

- [ ] **Step 5: Verify type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/lib/classification`
Expected: nessun errore.

- [ ] **Step 6: Commit**

```bash
git add src/lib/classification/normalize.ts src/lib/classification/__tests__/normalize.test.ts
git commit -m "fix(classification): hostname, OUI, banner SSH e porte ora votano

scoreByClassification salta le evidenze senza votes_for: quattro sorgenti
su nove erano decorative e la confidence restava al floor 40. Il voto
riusa le regole di device-classifier applicate a un segnale per volta."
```

---

### Task 3: `access_point` tra i tipi di device promuovibili

`network_devices.device_type` ammette solo `router|switch|firewall|hypervisor`. Un access point promosso a device diventa `hypervisor` (fallback finale di `inferDeviceTypeFromClassification`) oppure `switch` (default di `suggestDeviceTypeFromProductProfile`). Il CHECK di SQLite non è alterabile: serve una ricostruzione tabella — idiom già usato nel repo (`network_devices_hypervisor_new` in `db.ts:827-864` aggiunse `hypervisor` allo stesso CHECK).

**Files:**
- Modify: `src/lib/db-tenant-schema.ts:135` (CHECK nel DDL di riferimento)
- Modify: `src/lib/db-tenant.ts` (migrazione idempotente in `ensureTenantDb`)
- Modify: `src/components/devices/promote-host-dialog.tsx:51-56`
- Modify: `src/lib/device-product-profiles.ts:196`

**Interfaces:**
- Consumes: nulla dai task precedenti.
- Produces: `device_type` accetta anche `access_point`, `nas`, `server`; `inferDeviceTypeFromClassification(c: string): "router" | "switch" | "firewall" | "hypervisor" | "access_point" | "nas" | "server"`.

- [ ] **Step 1: Aggiorna il DDL di riferimento**

In `src/lib/db-tenant-schema.ts`, riga 135, sostituisci:

```sql
  device_type TEXT NOT NULL CHECK(device_type IN ('router', 'switch', 'firewall', 'hypervisor')),
```

con:

```sql
  device_type TEXT NOT NULL CHECK(device_type IN ('router', 'switch', 'firewall', 'hypervisor', 'access_point', 'nas', 'server')),
```

- [ ] **Step 2: Aggiungi la migrazione idempotente**

In `src/lib/db-tenant.ts`, dentro `ensureTenantDb`, subito **dopo** il blocco che crea `host_classification_history` (riga ~846), inserisci:

```ts
    // Migrazione: estendi il CHECK device_type con access_point/nas/server.
    // SQLite non consente ALTER di un CHECK → ricostruzione tabella (stesso idiom
    // di network_devices_hypervisor_new). Idempotente: il probe INSERT/DELETE
    // fallisce solo finché il CHECK vecchio è in vigore.
    try {
      newDb.prepare(
        "INSERT INTO network_devices (name, host, device_type, vendor, protocol) VALUES ('__probe__', '0.0.0.0', 'access_point', 'other', 'ssh')"
      ).run();
      newDb.prepare("DELETE FROM network_devices WHERE name = '__probe__'").run();
    } catch {
      newDb.pragma("foreign_keys = OFF");
      newDb.transaction(() => {
        newDb.exec(`CREATE TABLE network_devices__ap_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          host TEXT NOT NULL,
          device_type TEXT NOT NULL CHECK(device_type IN ('router', 'switch', 'firewall', 'hypervisor', 'access_point', 'nas', 'server')),
          vendor TEXT NOT NULL CHECK(vendor IN ('mikrotik', 'ubiquiti', 'hp', 'cisco', 'omada', 'stormshield', 'proxmox', 'vmware', 'linux', 'windows', 'synology', 'qnap', 'other')),
          vendor_subtype TEXT CHECK(vendor_subtype IN ('procurve', 'comware')),
          protocol TEXT NOT NULL CHECK(protocol IN ('ssh', 'snmp_v2', 'snmp_v3', 'api', 'winrm')),
          credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
          snmp_credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
          username TEXT, encrypted_password TEXT, community_string TEXT, api_token TEXT, api_url TEXT,
          port INTEGER DEFAULT 22, enabled INTEGER DEFAULT 1, classification TEXT,
          sysname TEXT, sysdescr TEXT, model TEXT, firmware TEXT, serial_number TEXT, part_number TEXT,
          last_info_update TEXT, last_device_info_json TEXT, stp_info TEXT,
          last_proxmox_scan_at TEXT, last_proxmox_scan_result TEXT,
          scan_target TEXT CHECK(scan_target IN ('proxmox', 'vmware', 'windows', 'linux')),
          product_profile TEXT,
          use_for_arp_poll INTEGER NOT NULL DEFAULT 0,
          host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
          physical_device_id INTEGER REFERENCES physical_devices(id) ON DELETE SET NULL,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )`);
        const srcCols = (newDb.prepare("PRAGMA table_info(network_devices)").all() as Array<{ name: string }>)
          .map((r) => r.name);
        const dstCols = new Set(
          (newDb.prepare("PRAGMA table_info(network_devices__ap_new)").all() as Array<{ name: string }>)
            .map((r) => r.name)
        );
        const common = srcCols.filter((c) => dstCols.has(c)).join(", ");
        newDb.exec(`INSERT INTO network_devices__ap_new (${common}) SELECT ${common} FROM network_devices`);
        newDb.exec("DROP TABLE network_devices");
        newDb.exec("ALTER TABLE network_devices__ap_new RENAME TO network_devices");
        newDb.exec(`
          CREATE INDEX IF NOT EXISTS idx_network_devices_credential ON network_devices(credential_id);
          CREATE INDEX IF NOT EXISTS idx_network_devices_host ON network_devices(host);
          CREATE INDEX IF NOT EXISTS idx_network_devices_device_type ON network_devices(device_type);
          CREATE INDEX IF NOT EXISTS idx_network_devices_product_profile ON network_devices(product_profile);
          CREATE INDEX IF NOT EXISTS idx_network_devices_classification ON network_devices(classification);
          CREATE INDEX IF NOT EXISTS idx_network_devices_physical_device_id ON network_devices(physical_device_id);
          CREATE INDEX IF NOT EXISTS idx_network_devices_host_id ON network_devices(host_id);
        `);
      })();
      newDb.pragma("foreign_keys = ON");
      console.info(`[db-tenant] ${tenantCode}: network_devices.device_type esteso (access_point/nas/server)`);
    }
```

- [ ] **Step 3: Verifica la migrazione su una copia del DB reale**

```bash
cp data/tenants/DEFAULT.db /private/tmp/claude-501/-Users-riccardo-Progetti-Domarc/2d8e667d-74ec-437b-a91b-568f35bf2986/scratchpad/migr-test.db
sqlite3 /private/tmp/claude-501/-Users-riccardo-Progetti-Domarc/2d8e667d-74ec-437b-a91b-568f35bf2986/scratchpad/migr-test.db "SELECT sql FROM sqlite_master WHERE name='network_devices';" | grep device_type
```

Expected prima della migrazione: il CHECK mostra solo `'router', 'switch', 'firewall', 'hypervisor'`.
Dopo aver avviato l'app una volta (`npm run dev:server`, poi Ctrl-C), rieseguire il comando sul DB del tenant: il CHECK deve includere `'access_point', 'nas', 'server'` e il conteggio righe deve essere invariato:

```bash
sqlite3 data/tenants/DEFAULT.db "SELECT COUNT(*) FROM network_devices;"
```

- [ ] **Step 4: Correggi i fallback della UI**

In `src/components/devices/promote-host-dialog.tsx`, sostituisci le righe 51-56:

```ts
function inferDeviceTypeFromClassification(c: string): "router" | "switch" | "hypervisor" {
  if (c === "router" || c === "firewall") return "router";
  if (c === "switch") return "switch";
  return "hypervisor";
}
```

con:

```ts
type PromotableDeviceType =
  | "router" | "switch" | "firewall" | "hypervisor" | "access_point" | "nas" | "server";

function inferDeviceTypeFromClassification(c: string): PromotableDeviceType {
  if (c === "firewall") return "firewall";
  if (c === "router") return "router";
  if (c === "switch") return "switch";
  if (c === "access_point") return "access_point";
  if (c === "nas" || c === "storage") return "nas";
  if (c === "hypervisor" || c === "vm") return "hypervisor";
  if (c === "server" || c === "server_linux" || c === "server_windows") return "server";
  return "server";
}
```

Nello stesso file il tipo è annotato in due punti e la logica di scelta ne ammette solo tre. Alla riga 62, dentro `interface DeviceFormState`, sostituisci:

```ts
  device_type: "router" | "switch" | "hypervisor";
```

con:

```ts
  device_type: PromotableDeviceType;
```

Alle righe 112-121, dentro `buildInitialForm`, sostituisci l'intero blocco:

```ts
  let device_type: "router" | "switch" | "hypervisor";
  if (inferredDeviceType === "router" || inferredDeviceType === "switch" || inferredDeviceType === "hypervisor") {
    device_type = inferredDeviceType;
  } else if (inferredDeviceType === "firewall") {
    device_type = "router";
  } else if (inferredDeviceType === "workstation" || inferredDeviceType === "server" || inferredDeviceType === "notebook") {
    device_type = "hypervisor";
  } else {
    device_type = inferDeviceTypeFromClassification(host.classification);
  }
```

con:

```ts
  const PROMOTABLE = new Set<string>([
    "router", "switch", "firewall", "hypervisor", "access_point", "nas", "server",
  ]);
  const device_type: PromotableDeviceType = inferredDeviceType && PROMOTABLE.has(inferredDeviceType)
    ? (inferredDeviceType as PromotableDeviceType)
    : inferDeviceTypeFromClassification(inferredDeviceType ?? host.classification);
```

Infine, nel `<Select>` che edita `device_type` (cerca `form.device_type` nel JSX), aggiungi le voci mancanti accanto a quelle esistenti, mantenendo lo stesso stile dei `SelectItem` già presenti:

```tsx
<SelectItem value="firewall">Firewall</SelectItem>
<SelectItem value="access_point">Access Point</SelectItem>
<SelectItem value="nas">NAS</SelectItem>
<SelectItem value="server">Server</SelectItem>
```

In `src/lib/device-product-profiles.ts`, riga 196, sostituisci il `return "switch";` finale di `suggestDeviceTypeFromProductProfile` con:

```ts
  if (profile.startsWith("ubiquiti_access_point") || profile.includes("_access_point")) {
    return "access_point";
  }
  return "switch";
```

- [ ] **Step 5: Verify build**

Run: `npm run lint && npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db-tenant-schema.ts src/lib/db-tenant.ts src/components/devices/promote-host-dialog.tsx src/lib/device-product-profiles.ts
git commit -m "fix(devices): access_point/nas/server tra i device_type promuovibili

Un AP promosso finiva hypervisor o switch: il CHECK non li prevedeva e i
fallback ripiegavano sul primo valore ammesso. Migrazione idempotente con
ricostruzione tabella (stesso idiom di network_devices_hypervisor_new)."
```

---

### Task 4: Verifica sui dati reali e release

Le tre correzioni vanno misurate sul tenant di produzione, non solo sui test unitari. La riclassificazione si lancia con l'endpoint esistente `POST /api/networks/[id]/refresh` (pulsante "Solo classifica"), che ricalcola dai dati già in IPAM senza rilanciare scansioni.

**Files:**
- Modify: nessuno (solo verifica ed esecuzione)

**Interfaces:**
- Consumes: `mapSysObjCategory` (Task 1), le evidenze votanti (Task 2), il nuovo CHECK (Task 3).
- Produces: nessuna.

- [ ] **Step 1: Registra la baseline PRIMA del deploy**

```bash
ssh root@192.168.4.8 'cd /opt/da-invent && sqlite3 data/tenants/70791.db "
SELECT COUNT(*) AS totali FROM hosts;
SELECT COUNT(*) AS unknown FROM hosts WHERE classification = \"unknown\";
SELECT COUNT(*) AS conf_zero FROM hosts WHERE COALESCE(inferred_confidence,0) = 0;
SELECT classification, COUNT(*) FROM hosts GROUP BY 1 ORDER BY 2 DESC LIMIT 8;
"'
```

Expected (baseline 2026-07-26): 375 totali, 38 `unknown`, 145 a confidence 0.
Annota i valori: servono per il confronto allo Step 4.

- [ ] **Step 2: Verifica completa e release**

```bash
cd /Users/riccardo/Progetti/Domarc/DA-IPAM
npm run lint && npx tsc --noEmit && npm run build
npm test
npm run version:release && git push origin dev
```

Expected: lint e tsc puliti, build completata, tutti i test verdi, commit `release: vX.Y.Z` pushato su `dev`.

- [ ] **Step 3: Deploy in produzione**

Segui la skill `deploy-prod` (`.claude/skills/deploy-prod/SKILL.md`): `git pull` su `/opt/da-invent`, poi **sempre** `npm run build`, poi restart del servizio.

```bash
ssh root@192.168.4.8 'cd /opt/da-invent && git pull && npm run build && systemctl restart da-invent && systemctl is-active da-invent'
```

Expected: `active`.

- [ ] **Step 4: Riclassifica e misura il delta**

Dalla UI della subnet lancia **"Solo classifica"** su ciascuna rete del tenant (oppure `POST /api/networks/<id>/refresh`). Poi:

```bash
ssh root@192.168.4.8 'cd /opt/da-invent && sqlite3 data/tenants/70791.db "
SELECT COUNT(*) AS unknown FROM hosts WHERE classification = \"unknown\";
SELECT COUNT(*) AS conf_zero FROM hosts WHERE COALESCE(inferred_confidence,0) = 0;
SELECT COUNT(*) AS conf_40 FROM hosts WHERE inferred_confidence = 40;
SELECT classification, COUNT(*) FROM hosts WHERE classification IN (\"networking\",\"wireless\") GROUP BY 1;
SELECT classification, COUNT(*) FROM hosts GROUP BY 1 ORDER BY 2 DESC LIMIT 10;
"'
```

Criteri di accettazione:
- `networking` e `wireless` in `hosts.classification`: **zero righe**.
- Host a confidence 0 e a confidence esattamente 40: **in calo** rispetto alla baseline.
- Gli host Ubiquiti con sysObjectID noto risultano `access_point` o `switch`, non `unknown`.
- Nessun host con `classification_manual = 1` è cambiato (la policy di lock deve reggere):

```bash
ssh root@192.168.4.8 'cd /opt/da-invent && sqlite3 data/tenants/70791.db "
SELECT COUNT(*) FROM host_classification_history h
JOIN hosts ON hosts.id = h.host_id
WHERE hosts.classification_manual = 1 AND h.at > datetime(\"now\", \"-1 hour\");
"'
```

Expected: `0`.

- [ ] **Step 5: Aggiorna la spec con l'esito**

In `docs/superpowers/specs/2026-07-26-attribution-v2-design.md`, nella tabella §9, marca la riga **Fase 0** come completata aggiungendo la data e i numeri misurati (unknown e confidence-0 prima → dopo). Commit:

```bash
git add docs/superpowers/specs/2026-07-26-attribution-v2-design.md
git commit -m "docs(spec): Attribution v2 fase 0 completata, delta misurato in produzione"
git push origin dev
```

---

## Fasi successive

Questo piano copre la **Fase 0** della spec. Le fasi seguenti avranno un piano dedicato ciascuna, perché ognuna è un sottosistema autonomo:

- **Fase 1** — tassonomia a 2 livelli, `attribution_evidence`, `fuse.ts`, emettitori dai segnali già in DB (LLDP, AD, Wazuh, agent).
- **Fase 1b** — catena credenziali unica, anti-lockout, esiti auth come evidenze.
- **Fase 2** — KB SQLite vendorizzata e `mac_product_map`.
- **Fase 3 / 3b** — probe nuovi (HTTP/TLS, mDNS, SSDP, WSD, SMB2) e UI subnet.
- **Fase 4 / 4b / 5** — ritiro del sistema B, protocolli nuovi, opzionali (Fingerbank, AI).
