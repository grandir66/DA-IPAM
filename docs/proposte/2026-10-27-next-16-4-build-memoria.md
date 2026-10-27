# Next.js 16.4: la build non sta in memoria sull'hub (27/10/2026)

Stato: **corretto in locale sul ramo `fix/next164-build-data`** (27/10, sezione «Esito» in fondo); manca la prova
sull'hub (passo 4 del metodo), poi `dev`. Dev e hub sono ancora a Next 16.1.6 (v0.9.915).

## Perché serve la 16.4

Avviso di Next.js del 14/10/2026: due esecuzioni di codice da remoto senza autenticazione
(GHSA-673q-mjm6-r5xr nelle funzioni «use cache», CVE-2026-96889 nell'ottimizzazione delle
immagini SVG) e un DoS dei Server Actions (CVE-2026-94482). Corrette in 16.4.1; la 16.4.2 è
quella di DA-Vul-can. La 16.1.6 resta esposta.

## Cosa è successo

- v0.9.914 (16.4.2) su `dev`: l'hub segue `dev` con `da-ipam-update.timer` e ha lanciato la
  build. Uccisa per memoria (OOM globale, `next-build` a 7,5 GB, VM da 12 GB senza swap) dopo
  20 secondi. Portata la VM a 20 GB: stessa fine.
- Le build della 16.1.6 sulla stessa macchina e con gli stessi dati passano (25/10 e 27/10,
  60 secondi).
- Le appliance dei clienti seguono `main`: promuovere la 16.4 senza correzione porterebbe lo
  stesso guasto da loro (con dati più piccoli, ma la memoria cresce coi dati).

## Misure

| Dove | Build | Picco | Esito |
| --- | --- | --- | --- |
| hub, copia del repo **senza** `data/` | 16.4.2 | 3,3 GB | riuscita in 1'46" |
| hub, copia con `data/` vera (54 GB) montata in sola lettura, limite 8 GB | 16.4.2 | > 8 GB | uccisa |
| idem, con `turbopackIgnore` (patch sotto) | 16.4.2 | > 8 GB | uccisa |
| Mac, nessun dato | 16.4.2 | 3,2 GB | riuscita |
| Mac, 6 GB di file finti (sparsi) in `data/backups` e `data/tenants` | 16.4.2 | 4,2 GB | riuscita |
| idem | 16.1.6 | 3,5 GB | riuscita |

`data/` sull'hub: 230 file, 28 GB in `tenants/`, 27 GB in `backups/`.

## Meccanismo (parziale)

Turbopack 16.4 traccia i file usati dalle rotte e li legge. L'errore di una prova con un
collegamento simbolico lo mostra: da `src/app/api/custom-oui/route.ts` nasce un
`DirAssetReference` su `data/`. Il percorso dei dati viene da `resolveDataDir()`
(`src/lib/data-dir.ts`), che ripiega su `path.join(process.cwd(), "data")`; lo usano
`db.ts`, `db-hub.ts`, `db-tenant.ts` (`TENANTS_DIR`), `client-config.ts`, `backup/engine.ts`.

Con `/* turbopackIgnore: true */` sui 7 `path.join(process.cwd(), "data"…)` (patch sotto),
nei `.nft.json` della build sparisce `data/backups`, ma **441 rotte e il middleware** elencano
ancora `data/tenants/*` e `data/ipam.empty.db`. Da capire quale chiamata li porta dentro.

## Come studiarlo senza produzione

1. Worktree da `origin/dev`, `npm ci`, poi file finti in `data/tenants/` e
   `data/backups/` (`mkfile -n 1g`).
2. `npx next build`, poi `grep -rl finto .next --include='*.nft.json'`: le rotte elencate sono
   quelle che si portano dietro i dati. Obiettivo: zero.
3. Strade: `turbopackIgnore` anche sui `path.join(DATA_DIR, …)` e `path.join(resolveDataDir(), …)`;
   un `resolveDataDir()` che l'analisi non sappia valutare; `outputFileTracingExcludes` (da
   solo non abbassa la memoria); spostare i dati dell'hub fuori dal codice con
   `DA_INVENT_DATA_DIR`, che il codice già prevede (non basta per le appliance).
4. Solo con zero rotte che tracciano `data/`: prova sull'hub in una copia con `data/` montata
   in sola lettura e `systemd-run --scope -p MemoryMax=8G`, poi `dev`, poi la promozione.

## Patch parziale (`turbopackIgnore`)

```diff
diff --git a/src/app/api/custom-oui/route.ts b/src/app/api/custom-oui/route.ts
index a4f2037b..97379d4e 100644
--- a/src/app/api/custom-oui/route.ts
+++ b/src/app/api/custom-oui/route.ts
@@ -4,7 +4,7 @@ import fs from "fs";
 import { invalidateCustomOuiCache } from "@/lib/scanner/mac-vendor";
 import { requireAdmin, isAuthError } from "@/lib/api-auth";
 
-const DATA_DIR = path.join(process.cwd(), "data");
+const DATA_DIR = path.join(/* turbopackIgnore: true */ process.cwd(), "data");
 const CUSTOM_OUI_PATH = path.join(DATA_DIR, "custom_oui.txt");
 
 export async function GET() {
diff --git a/src/app/api/snmp-profiles/route.ts b/src/app/api/snmp-profiles/route.ts
index 32baeccb..7e713b7a 100644
--- a/src/app/api/snmp-profiles/route.ts
+++ b/src/app/api/snmp-profiles/route.ts
@@ -110,7 +110,7 @@ export async function POST(request: NextRequest) {
 
   if (action === "export-to-files") {
     try {
-      const dataDir = path.join(process.cwd(), "data");
+      const dataDir = path.join(/* turbopackIgnore: true */ process.cwd(), "data");
       if (!fs.existsSync(dataDir)) {
         fs.mkdirSync(dataDir, { recursive: true });
       }
diff --git a/src/app/api/tls/route.ts b/src/app/api/tls/route.ts
index 430cb578..acd31786 100644
--- a/src/app/api/tls/route.ts
+++ b/src/app/api/tls/route.ts
@@ -113,7 +113,7 @@ export async function POST(request: Request) {
       const san = [...sanSet].join(",");
 
       const days = Math.max(1, Math.min(body.days || 365, 3650));
-      const certDir = path.join(process.cwd(), "data", "certs");
+      const certDir = path.join(/* turbopackIgnore: true */ process.cwd(), "data", "certs");
       mkdirSync(certDir, { recursive: true });
 
       const certPath = path.join(certDir, "cert.pem");
@@ -153,7 +153,7 @@ export async function POST(request: Request) {
         );
       }
 
-      const certDir = path.join(process.cwd(), "data", "certs");
+      const certDir = path.join(/* turbopackIgnore: true */ process.cwd(), "data", "certs");
       mkdirSync(certDir, { recursive: true });
 
       const certPath = path.join(certDir, "cert.pem");
diff --git a/src/lib/attribution/kb.ts b/src/lib/attribution/kb.ts
index ef18eacc..bf06c368 100644
--- a/src/lib/attribution/kb.ts
+++ b/src/lib/attribution/kb.ts
@@ -32,7 +32,7 @@ export interface KbSysObjMatch {
   category: CategorySlug | null;
 }
 
-const KB_PATH = path.join(process.cwd(), "data", "attribution-kb.sqlite");
+const KB_PATH = path.join(/* turbopackIgnore: true */ process.cwd(), "data", "attribution-kb.sqlite");
 
 /** Mappa TYPE GLPI → categoria v2 (spec Task 1, tabella nel piano). Il tipo
  *  NETWORKING non distingue router/switch/access_point: livello 1 soltanto
diff --git a/src/lib/data-dir.ts b/src/lib/data-dir.ts
index 4d6c33dd..a86ec358 100644
--- a/src/lib/data-dir.ts
+++ b/src/lib/data-dir.ts
@@ -22,5 +22,5 @@ import path from "path";
  *   arrivano col checkout e restano in `<cwd>/data`, non nel volume dati.
  */
 export function resolveDataDir(): string {
-  return process.env.DA_INVENT_DATA_DIR?.trim() || path.join(process.cwd(), "data");
+  return process.env.DA_INVENT_DATA_DIR?.trim() || path.join(/* turbopackIgnore: true */ process.cwd(), "data");
 }
diff --git a/src/lib/patch/dictionary.ts b/src/lib/patch/dictionary.ts
index d2c2e188..810b5fd8 100644
--- a/src/lib/patch/dictionary.ts
+++ b/src/lib/patch/dictionary.ts
@@ -40,7 +40,7 @@ let cachedDict: DictionaryEntry[] | null = null;
 export function loadDictionary(): DictionaryEntry[] {
   if (cachedDict) return cachedDict;
   try {
-    const filePath = path.join(process.cwd(), "data", "package-dictionary.json");
+    const filePath = path.join(/* turbopackIgnore: true */ process.cwd(), "data", "package-dictionary.json");
     const raw = readFileSync(filePath, "utf-8");
     let parsed: DictionaryFile;
     try {
diff --git a/src/lib/scanner/mac-vendor.ts b/src/lib/scanner/mac-vendor.ts
index eadb212a..50b54660 100644
--- a/src/lib/scanner/mac-vendor.ts
+++ b/src/lib/scanner/mac-vendor.ts
@@ -8,7 +8,7 @@ let customOuiCache: Record<string, string> | null = null;
 let customOuiMtime = 0;
 
 function getCustomOui(): Record<string, string> {
-  const dataDir = path.join(process.cwd(), "data");
+  const dataDir = path.join(/* turbopackIgnore: true */ process.cwd(), "data");
   const customPath = path.join(dataDir, "custom_oui.txt");
   try {
     if (!fs.existsSync(customPath)) return {};
```

## Esito (27/10, sul Mac)

- **Meccanismo, provato su un'app minima**: Turbopack 16.4 fa di ogni `path.join`/`path.resolve` scritto
  nel modulo un riferimento; con un pezzo fisso e uno variabile diventa un glob su tutto il progetto, anche
  se il prefisso è ignoto (`path.join(os.tmpdir(), `${x}.db`)` prende tutti i `.db` di `data/`). Per questo
  `turbopackIgnore` non bastava. Lo stesso fanno le chiamate `fs` su valori misti: `ambiente || "/assoluto"`,
  un elenco con percorsi assoluti e valori ignoti, il ripiego `|| ""`, la proprietà di un oggetto esportato
  con un percorso assoluto. I file del glob vengono letti: 0,9 GB senza riferimenti, 3,8 GB con 4 GB finti;
  `outputFileTracingExcludes` non cambia la memoria.
- **Correzione**: `src/lib/percorsi.ts` (`unisci`/`risolvi`, chiamate da un altro modulo l'analisi non vede
  i pezzi) al posto di `path.join`/`path.resolve` in tutto `src/`, più i quattro valori misti resi opachi.
  ESLint vieta le chiamate dirette; `scripts/controlla-tracciamento.mjs` (postbuild) ferma la build se un
  `.nft.json` torna a elencare `data/`.
- **Misure**: 441 rotte su 454 → 0; picco 3,4 GB con 18 GB di dati finti (sparsi), come senza dati.
  Cancello: lint 0 errori, `tsc`, build, 6150 prove verdi.
- **Prossimo**: prova sull'hub (passo 4) con `systemd-run --scope -p MemoryMax=8G`, poi `dev`.
