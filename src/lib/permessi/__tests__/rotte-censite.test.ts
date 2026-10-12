/**
 * INVARIANTE (T3-24): ogni gestore HTTP sotto src/app/api ha una guardia almeno
 * pari a quella attesa, oppure un'eccezione con motivo, oppure un debito con
 * codice (src/lib/permessi/rotte.ts). Una rotta nuova non dichiarata fa fallire
 * il cancello.
 *
 * Perché (12/10, tappa 3): l'audit della «Wave 0» leggeva i sorgenti con
 * espressioni regolari e nei due proxy (`export { handle as GET, … }`) vedeva
 * zero metodi: 14 gestori fuori dal conto, proprio quelli dove un utente in sola
 * lettura arrivava più lontano. E nessuna prova copriva le rotte che non erano
 * nell'elenco puntuale di api-auth-guards.test.ts.
 *
 * Run: node --import tsx --test src/lib/permessi/__tests__/rotte-censite.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { rilevaGestori } from "../rilevatore-guardie";
import {
  censisci,
  consentitiDaAuthConfig,
  DEBITI,
  ECCEZIONI,
  gestoriDellAlbero,
  type Elenchi,
  type GestoreCensito,
} from "../rotte";

const RADICE = process.cwd();

// ---------------------------------------------------------------------------
// Rilevatore, su sorgenti finti con la forma delle rotte vere
// ---------------------------------------------------------------------------

const PROXY = `
import { requireAuth, isAuthError } from "@/lib/api-auth";
export const dynamic = "force-dynamic";
async function handle(req: Request): Promise<Response> {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;
  return new Response("ok");
}
export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as HEAD, handle as OPTIONS };
`;

test("rilevatore: vede i metodi esportati come `export { handle as GET }` (l'audit vecchio ne vedeva 0)", () => {
  const g = rilevaGestori(PROXY);
  assert.deepEqual(g.map((x) => x.metodo), ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
  assert.ok(g.every((x) => x.forma === "rinomina" && x.guardia === "auth"));
});

test("rilevatore: `export const { GET, POST } = handlers` è esterna (NextAuth)", () => {
  const src = `import { handlers } from "@/lib/auth";\nexport const { GET, POST } = handlers;\n`;
  const g = rilevaGestori(src);
  assert.deepEqual(g.map((x) => [x.metodo, x.forma, x.guardia]), [
    ["GET", "destrutturata", "esterna"],
    ["POST", "destrutturata", "esterna"],
  ]);
});

test("rilevatore: `export const GET = …` con funzione locale o wrapper importato", () => {
  const src = `
import { requireAdmin } from "@/lib/api-auth";
import { conLimite } from "@/lib/limiti";
export const POST = async (req: Request) => {
  const a = await requireAdmin();
  return new Response(String(a));
};
export const PUT = conLimite;
export const DELETE = conLimite(async () => { await requireAdmin(); return new Response(""); });
`;
  const g = rilevaGestori(src);
  assert.deepEqual(g.map((x) => [x.metodo, x.forma, x.guardia]), [
    ["POST", "costante", "admin"],
    ["PUT", "costante", "esterna"],
    ["DELETE", "costante", "admin"],
  ]);
});

test("rilevatore: `export async function` con la guardia dentro withTenantFromSession", () => {
  const src = `
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
export async function GET() {
  return withTenantFromSession(async () => new Response("[]"));
}
export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    return new Response("ok");
  });
}
export async function PATCH() {
  const a = await requireAuth();
  if (isAuthError(a)) return a;
  return withTenantFromSession(async () => new Response("ok"));
}
`;
  assert.deepEqual(rilevaGestori(src).map((x) => [x.metodo, x.guardia]), [
    ["GET", "sessione"],
    ["POST", "admin"],
    ["PATCH", "auth"],
  ]);
});

test("rilevatore: una guardia solo in un ramo non conta, e si vede fra le condizionali", () => {
  const src = `
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
export async function GET(request: Request) {
  return withTenantFromSession(async () => {
    const forEdit = new URL(request.url).searchParams.get("for_edit") === "1";
    if (forEdit) {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
    }
    return new Response("{}");
  });
}
export async function DELETE(request: Request) {
  const ok = request.headers.get("x") && (await requireAdmin());
  return new Response(String(ok));
}
`;
  assert.deepEqual(rilevaGestori(src).map((x) => [x.metodo, x.guardia, x.condizionali]), [
    ["GET", "sessione", ["admin"]],
    ["DELETE", "nessuna", ["admin"]],
  ]);
});

test("rilevatore: una funzione d'appoggio dello stesso file presta la guardia solo a chi la chiama", () => {
  // Il taglio «fino al prossimo export» dell'audit vecchio dava a GET la guardia
  // di `controlla`, scritta subito dopo.
  const src = `
import { requireAdmin, isAuthError } from "@/lib/api-auth";
export async function GET() {
  return new Response("[]");
}
async function controlla() {
  const a = await requireAdmin();
  return isAuthError(a) ? a : null;
}
export async function POST() {
  const negato = await controlla();
  if (negato) return negato;
  return new Response("ok");
}
`;
  assert.deepEqual(rilevaGestori(src).map((x) => [x.metodo, x.guardia]), [
    ["GET", "nessuna"],
    ["POST", "admin"],
  ]);
});

test("rilevatore: re-export da un altro file è esterna; `auth` conta solo se importato", () => {
  const reexport = `export { GET, POST } from "../altro/route";\n`;
  assert.deepEqual(rilevaGestori(reexport).map((x) => x.guardia), ["esterna", "esterna"]);

  const finto = `
export async function GET() {
  const auth = () => true;
  auth();
  return new Response("");
}
`;
  assert.equal(rilevaGestori(finto)[0].guardia, "nessuna");
  const vero = `
import { auth } from "@/lib/auth";
export async function POST() {
  const session = await auth();
  if (!session?.user) return new Response("", { status: 401 });
  return new Response("");
}
`;
  assert.equal(rilevaGestori(vero)[0].guardia, "auth-diretto");
});

// ---------------------------------------------------------------------------
// Censimento su dati finti
// ---------------------------------------------------------------------------

const CONSENTITI_FINTI = { esatti: ["/api/health"], prefissi: ["/api/auth"] };

function gestore(rotta: string, metodo: GestoreCensito["metodo"], guardia: GestoreCensito["guardia"]): GestoreCensito {
  return { rotta, metodo, guardia, forma: "funzione", condizionali: [] };
}

const BASE: GestoreCensito[] = [
  gestore("/api/health", "GET", "nessuna"),
  gestore("/api/auth/[...nextauth]", "GET", "esterna"),
  gestore("/api/hosts", "GET", "sessione"),
  gestore("/api/hosts", "POST", "admin"),
];
const ELENCHI_BASE: Elenchi = {
  attesi: [],
  eccezioni: [
    { rotta: "/api/health", metodi: ["GET"], tipo: "pubblica", guardia: "nessuna", motivo: "salute" },
    { rotta: "/api/auth/[...nextauth]", metodi: ["GET"], tipo: "pubblica", guardia: "esterna", motivo: "NextAuth" },
  ],
  debiti: [],
};

test("censimento: i dati finti di base sono in regola", () => {
  assert.deepEqual(censisci(BASE, CONSENTITI_FINTI, ELENCHI_BASE).problemi, []);
});

test("censimento: una scrittura nuova senza admin e non dichiarata fa fallire", () => {
  const r = censisci([...BASE, gestore("/api/hosts/[id]", "DELETE", "sessione")], CONSENTITI_FINTI, ELENCHI_BASE);
  assert.equal(r.problemi.length, 1);
  assert.match(r.problemi[0], /DELETE \/api\/hosts\/\[id\]: guardia sessione, attesa admin/);
});

test("censimento: una lettura sensibile chiede admin", () => {
  const r = censisci([...BASE, gestore("/api/credentials", "GET", "sessione")], CONSENTITI_FINTI, ELENCHI_BASE);
  assert.match(r.problemi.join("\n"), /GET \/api\/credentials: guardia sessione, attesa admin/);
});

test("censimento: un debito sanato fa fallire finché non si toglie dall'elenco", () => {
  const elenchi: Elenchi = { ...ELENCHI_BASE, debiti: [{ rotta: "/api/hosts", metodi: ["POST"], codice: "SEC-0" }] };
  assert.match(censisci(BASE, CONSENTITI_FINTI, elenchi).problemi.join("\n"), /debito SEC-0 sanato/);
});

test("censimento: togliere un debito senza alzare la guardia non torna verde se il livello è dichiarato", () => {
  const conAtteso: Elenchi = {
    ...ELENCHI_BASE,
    attesi: [{ rotta: "/api/hosts", metodi: ["GET"], livello: "admin", motivo: "finto", codice: "SEC-0" }],
  };
  assert.match(censisci(BASE, CONSENTITI_FINTI, conAtteso).problemi.join("\n"), /GET \/api\/hosts: guardia sessione, attesa admin/);
  const conDebito: Elenchi = { ...conAtteso, debiti: [{ rotta: "/api/hosts", metodi: ["GET"], codice: "SEC-0" }] };
  assert.deepEqual(censisci(BASE, CONSENTITI_FINTI, conDebito).problemi, []);
});

test("censimento: eccezione superflua, guardia cambiata, voce di una rotta che non c'è", () => {
  const elenchi: Elenchi = {
    ...ELENCHI_BASE,
    eccezioni: [
      ...ELENCHI_BASE.eccezioni,
      { rotta: "/api/hosts", metodi: ["POST"], tipo: "motivata", guardia: "sessione", motivo: "finto" },
      { rotta: "/api/sparita", metodi: ["PUT"], tipo: "motivata", guardia: "auth", motivo: "finto" },
    ],
  };
  const p = censisci(BASE, CONSENTITI_FINTI, elenchi).problemi.join("\n");
  assert.match(p, /POST \/api\/hosts: eccezione superflua/);
  assert.match(p, /PUT \/api\/sparita non esiste più/);

  const cambiata = censisci([...BASE, gestore("/api/x", "PUT", "auth")], CONSENTITI_FINTI, {
    ...ELENCHI_BASE,
    eccezioni: [...ELENCHI_BASE.eccezioni, { rotta: "/api/x", metodi: ["PUT"], tipo: "motivata", guardia: "sessione", motivo: "finto" }],
  });
  assert.match(cambiata.problemi.join("\n"), /scritta per la guardia sessione, il rilevatore vede auth/);
});

test("censimento: un gestore senza sessione fuori dall'elenco di auth.config.ts fa fallire anche con eccezione", () => {
  const r = censisci([...BASE, gestore("/api/aperta", "GET", "nessuna")], CONSENTITI_FINTI, {
    ...ELENCHI_BASE,
    eccezioni: [...ELENCHI_BASE.eccezioni, { rotta: "/api/aperta", metodi: ["GET"], tipo: "pubblica", guardia: "nessuna", motivo: "finto" }],
  });
  assert.match(r.problemi.join("\n"), /GET \/api\/aperta: nessuna guardia di sessione/);
});

test("censimento: una via consentita da auth.config.ts che non serve a nessun gestore pubblico fa fallire", () => {
  const r = censisci(BASE, { esatti: ["/api/health", "/api/vecchia"], prefissi: ["/api/auth"] }, ELENCHI_BASE);
  assert.match(r.problemi.join("\n"), /lascia passare \/api\/vecchia/);
});

// ---------------------------------------------------------------------------
// L'albero vero
// ---------------------------------------------------------------------------

const ALBERO = gestoriDellAlbero(RADICE);
const CONSENTITI = consentitiDaAuthConfig(readFileSync(join(RADICE, "src", "lib", "auth.config.ts"), "utf8"));

test("albero: l'elenco consentito di auth.config.ts si legge (esatti e prefissi)", () => {
  assert.ok(CONSENTITI.esatti.includes("/api/health"));
  assert.ok(CONSENTITI.prefissi.includes("/api/auth"));
});

test("albero: i due proxy espongono i sette metodi e il rilevatore li vede tutti", () => {
  for (const nome of ["librenms", "wazuh"]) {
    const metodi = ALBERO.gestori.filter((g) => g.rotta === `/api/integrations/proxy/${nome}/[[...path]]`).map((g) => g.metodo);
    assert.deepEqual(metodi.sort(), ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]);
  }
});

test("albero: ogni gestore ha la guardia attesa, un'eccezione con motivo o un debito con codice", () => {
  const { problemi } = censisci(ALBERO.gestori, CONSENTITI);
  assert.deepEqual(problemi, []);
});

/**
 * T3-30 (12/10): la tappa 3a ha chiuso tutti i debiti di guardia; l'ultimo erano
 * le scritture del proxy Wazuh aperte a chi ha solo una sessione (SEC-6). Un
 * debito nuovo si dichiara cambiando anche questa prova, di proposito.
 */
test("albero: nessun debito di guardia aperto", () => {
  assert.deepEqual(DEBITI, []);
});

test("albero: il proxy Wazuh accetta scritture solo dall'admin, letture da chi ha una sessione", () => {
  const proxy = ALBERO.gestori.filter((g) => g.rotta === "/api/integrations/proxy/wazuh/[[...path]]");
  const guardia = (m: string) => proxy.find((g) => g.metodo === m)?.guardia;
  for (const m of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal(guardia(m), "admin", m);
  for (const m of ["GET", "HEAD", "OPTIONS"]) assert.equal(guardia(m), "auth", m);
});

test("albero: le eccezioni mascherate rimandano a una prova che esiste", () => {
  for (const e of ECCEZIONI.filter((x) => x.tipo === "mascherata")) {
    assert.ok(e.prova && existsSync(join(RADICE, e.prova)), `${e.rotta}: prova ${e.prova} mancante`);
  }
});
