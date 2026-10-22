/**
 * Contratto auth su route sensibili (WAVE 1 / W1-5).
 *
 * Verifica statica: per ogni {route, metodo} nella lista, il corpo del metodo
 * deve invocare la guardia attesa (`requireAdmin` o `requireSuperAdmin`).
 * Blocca le regressioni: se qualcuno rimuove la guardia, il test fallisce.
 *
 * Non è un test comportamentale (non fa una request reale) — è un lucchetto sul
 * sorgente, complementare all'audit `scripts/audit-api-auth.ts`. Estendere la
 * lista `CONTRACT` man mano che Wave 1 eleva altre route.
 *
 * Run:  node --import tsx --test src/lib/__tests__/api-auth-guards.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

interface Contract {
  route: string; // path sotto src/app/api
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  guard: "requireAuth" | "requireAdmin" | "requireSuperAdmin";
}

// Nota: per `credentials/[id]` GET la guardia admin è condizionale (solo con
// ?for_edit=1); il test verifica solo che requireAdmin sia invocato nel metodo.

// Contratto atteso. I primi due sono i fix di Wave 1; gli altri sono controlli
// positivi su route già protette (documentano l'intento e catturano rimozioni).
const CONTRACT: Contract[] = [
  { route: "devices/test-provisional", method: "POST", guard: "requireAdmin" },
  // scelta del principale del cluster fisico (22/10): scrittura, solo admin
  { route: "physical-devices/[id]/principale", method: "PUT", guard: "requireAdmin" },
  { route: "analytics/anomalies/[id]", method: "PATCH", guard: "requireAdmin" },
  { route: "analytics/anomalies/[id]", method: "DELETE", guard: "requireAdmin" },
  // probe diagnostici verso host/credenziali arbitrari (audit SEC-9)
  { route: "test-snmp", method: "GET", guard: "requireAdmin" },
  { route: "test-arp", method: "GET", guard: "requireAdmin" },
  { route: "networks/[id]/test-snmp", method: "GET", guard: "requireAdmin" },
  { route: "networks/[id]/test-dns", method: "GET", guard: "requireAdmin" },
  { route: "credentials/[id]", method: "GET", guard: "requireAdmin" }, // condizionale (for_edit)
  { route: "credentials/[id]", method: "PUT", guard: "requireAdmin" },
  { route: "credentials/[id]", method: "DELETE", guard: "requireAdmin" },
  { route: "client-config/export", method: "GET", guard: "requireAdmin" },
  // scheda router e firewall (21/10): interfacce con la sessione; l'export RouterOS solo admin (esitoAzioneMikrotik,
  // la condizione è provata da src/lib/devices/__tests__/mikrotik-guardia.test.ts).
  { route: "devices/[id]/interfacce", method: "GET", guard: "requireAuth" },
  { route: "devices/[id]/mikrotik", method: "GET", guard: "requireAuth" },
  { route: "devices/[id]/dispositivi", method: "GET", guard: "requireAuth" },
  { route: "devices/[id]/mikrotik-scheda", method: "GET", guard: "requireAuth" },
  { route: "devices/[id]/vlan-switch", method: "GET", guard: "requireAuth" },
  // Utenti del router MikroTik (Task 10): dato riservato, solo l'admin (la scheda per tutti non li porta).
  { route: "devices/[id]/mikrotik-utenti", method: "GET", guard: "requireAdmin" },
  // scheda dei server (21/10): dipendenze NIS2 e Active Directory di un host, sola lettura con la sessione.
  { route: "hosts/[id]/dipendenze", method: "GET", guard: "requireAuth" },
  { route: "hosts/[id]/ad", method: "GET", guard: "requireAuth" },
  { route: "hosts/[id]/proxmox-vm", method: "GET", guard: "requireAuth" },
  { route: "hosts/[id]/zabbix", method: "GET", guard: "requireAuth" },
  { route: "devices/[id]/proxmox-match", method: "GET", guard: "requireAuth" },
  { route: "devices/[id]/proxmox-match", method: "POST", guard: "requireAdmin" },
  { route: "devices/[id]/mikrotik", method: "POST", guard: "requireAdmin" },
  // Controller di rete (ADR 0007): la sync scrive nel tenant; le prove mandano
  // le credenziali al controller e al primo uso fissano l'impronta del
  // certificato; aggiungere, modificare e togliere salvano credenziali → admin.
  { route: "controllers", method: "POST", guard: "requireAdmin" },
  { route: "controllers/[id]", method: "PUT", guard: "requireAdmin" },
  { route: "controllers/[id]", method: "DELETE", guard: "requireAdmin" },
  { route: "controllers/[id]/sync", method: "POST", guard: "requireAdmin" },
  { route: "controllers/[id]/test", method: "POST", guard: "requireAdmin" },
  { route: "controllers/probe", method: "POST", guard: "requireAdmin" },
  // l'impronta del certificato decide di quale controller fidarsi: admin.
  { route: "controllers/[id]/cert-pin", method: "POST", guard: "requireAdmin" },
  // route hub globali → superadmin (H3: requireSuperAdmin era definito ma inutilizzato)
  // utenti → admin dal 2026-10-12 (UI-18, decisione «un'installazione = un cliente»):
  // l'admin gestisce gli utenti del proprio cliente. I limiti fini (solo il proprio
  // cliente, mai superadmin, mai sé stesso) stanno in src/lib/users/service.ts e
  // sono provati da src/lib/users/__tests__/{service,routes-use-service}.test.ts.
  { route: "users", method: "POST", guard: "requireAdmin" },
  { route: "users/[id]", method: "DELETE", guard: "requireAdmin" },
  { route: "users/[id]/reset-password", method: "POST", guard: "requireAdmin" },
  { route: "tenants", method: "POST", guard: "requireSuperAdmin" },
  { route: "tenants/[id]", method: "DELETE", guard: "requireSuperAdmin" },
  // Topologia (M6 della revisione finale di T2, piano di T3 «Scelte» 13): gli interruttori delle letture in più e della
  // mappa nuova li cambia solo un admin; «Cosa cambierebbe con la mappa nuova» è un calcolo per chi decide quando
  // accenderla. Il 403 a chi non è admin si prova qui sul sorgente: `mock.module` non gira sotto Node 22 con tsx e
  // `requireAdmin` legge la sessione. Il corpo (400, 409, strict) lo prova src/lib/topology/letture/__tests__/corpo.test.ts.
  { route: "topology/settings/letture", method: "PUT", guard: "requireAdmin" },
  { route: "topology/settings/mappa", method: "PUT", guard: "requireAdmin" },
  { route: "topology/traccia", method: "GET", guard: "requireAdmin" },
  // T3, Task 8: le scritture coi valori nuovi (togliere una correzione con la ★ per cavo, i ruoli «core» e «accesso»)
  // restano a un admin. I corpi li provano api-input.test.ts e topology-t3-scritture.test.ts.
  { route: "topology/links/[id]", method: "DELETE", guard: "requireAdmin" },
  { route: "topology/nodes/role", method: "PATCH", guard: "requireAdmin" },
  // Unioni a mano (piano 2026-10-16): scrivono il DB del cliente, anche l'anteprima resta a un admin.
  { route: "topology/unioni", method: "POST", guard: "requireAdmin" },
  { route: "topology/unioni/separa", method: "POST", guard: "requireAdmin" },
  // Passo 5 (16/10): «Istanza esterna» → «Installato dall'appliance» solo da un admin.
  { route: "integrations/librenms/converti", method: "POST", guard: "requireAdmin" },
  // Passo 3 (16/10): la configurazione MDM porta credenziali e accende/toglie il job mdm_sync.
  { route: "mdm/config", method: "GET", guard: "requireAdmin" },
  { route: "mdm/config", method: "PUT", guard: "requireAdmin" },
  // Passo 7.4 (16/10): pannello Zabbix in sola lettura. La configurazione porta la chiave di
  // lettura del centro e decide verso dove parte; gli abbinamenti scrivono il DB del cliente;
  // «Riprova adesso» (POST) ignora l'attesa crescente. Il pannello si legge con la sessione.
  { route: "zabbix/config", method: "GET", guard: "requireAdmin" },
  { route: "zabbix/config", method: "PUT", guard: "requireAdmin" },
  { route: "zabbix/config", method: "DELETE", guard: "requireAdmin" },
  { route: "zabbix/pannello", method: "GET", guard: "requireAuth" },
  { route: "zabbix/pannello", method: "POST", guard: "requireAdmin" },
  { route: "zabbix/abbinamenti", method: "POST", guard: "requireAdmin" },
  { route: "zabbix/abbinamenti", method: "DELETE", guard: "requireAdmin" },
  // Scansione automatica dei device scelti (piano 2026-10-22, Task 6): creare, modificare e leggere il job (anteprima
  // con host e IP, finestra in modifica, esiti) solo da admin; la pastiglia della testata (J4) con la sessione.
  // I corpi (400, 404, 409) li prova src/app/api/jobs/apparati-scelti/__tests__/route.test.ts.
  { route: "jobs/apparati-scelti", method: "POST", guard: "requireAdmin" },
  { route: "jobs/apparati-scelti/anteprima", method: "POST", guard: "requireAdmin" },
  { route: "jobs/apparati-scelti/[id]", method: "GET", guard: "requireAdmin" },
  { route: "jobs/apparati-scelti/[id]", method: "PUT", guard: "requireAdmin" },
  { route: "jobs/apparati-scelti/[id]/esiti", method: "GET", guard: "requireAdmin" },
  { route: "jobs", method: "PUT", guard: "requireAdmin" },
  { route: "jobs", method: "DELETE", guard: "requireAdmin" },
  { route: "devices/[id]/scansione-automatica", method: "GET", guard: "requireAuth" },
];

/** Estrae il corpo di un metodo HTTP esportato (slice fino al prossimo export). */
function methodSlice(src: string, method: string): string | null {
  const re = new RegExp(
    `export\\s+(?:async\\s+)?(?:function\\s+${method}\\b|const\\s+${method}\\s*=)`
  );
  const start = src.search(re);
  if (start < 0) return null;
  const rest = src.slice(start + 1);
  const nextRel = rest.search(
    /export\s+(?:async\s+)?(?:function\s+(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b|const\s+(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=)/
  );
  const end = nextRel < 0 ? src.length : start + 1 + nextRel;
  return src.slice(start, end);
}

for (const c of CONTRACT) {
  test(`${c.method} /api/${c.route} → ${c.guard}`, () => {
    const file = join(ROOT, "src/app/api", c.route, "route.ts");
    const src = readFileSync(file, "utf8");
    const slice = methodSlice(src, c.method);
    assert.ok(slice, `metodo ${c.method} non trovato in ${c.route}/route.ts`);
    const re = new RegExp(`\\b${c.guard}\\s*\\(`);
    assert.match(
      slice,
      re,
      `${c.method} /api/${c.route} deve invocare ${c.guard}() — guardia mancante o indebolita`
    );
  });
}

// Le prove dei controller mandano le credenziali al controller e al primo uso
// fissano la fiducia nel certificato: un effetto, quindi niente GET (un link
// seguito con la sessione aperta, cookie SameSite=Lax, le farebbe partire).
test("le prove dei controller non hanno un GET: sono POST", () => {
  for (const r of ["controllers/[id]/test", "controllers/probe", "controllers/[id]/sync", "controllers/[id]/cert-pin"]) {
    const src = readFileSync(join(ROOT, `src/app/api/${r}/route.ts`), "utf8");
    assert.equal(methodSlice(src, "GET"), null, r);
  }
});
