/**
 * Profili assessment letti dall'edge (EDG-1, piano di miglioramento 2026-10-12,
 * tappa 1).
 *
 * Prima DA-IPAM offriva una lista fissa di quattro profili; l'edge ne conosce
 * solo tre, e due di quelli offerti non li ha mai avuti. L'id si salvava senza
 * errori e l'assessment falliva dopo la scansione, sull'edge, con «Profilo
 * sconosciuto»: DA-IPAM non lo mostrava. Qui: la lettura della risposta di
 * `GET /api/v1/profiles` con la forma vera, l'id sicuro, le regole che decidono
 * quale profilo vale per una richiesta, e due lucchetti sul sorgente.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/vuln/__tests__/edge-profiles.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  ASSESSMENT_PROFILE_ID_RE,
  assessmentProfileIdSchema,
  effectiveAssessment,
  findEdgeProfile,
  missingProfileMessage,
  parseEdgeProfilesResponse,
} from "@/lib/vuln/edge-profiles";

/**
 * Risposta vera: `list_profiles()` di scanner_edge (DA-Vul-can,
 * `infra/scanner-edge/app/scanner_edge/services/profile_runner.py`, commit
 * 85ea21c) eseguita in sola lettura sul catalogo `data/assessment_profiles.json`
 * il 2026-10-12. Ordinata per id, `steps` sono i nomi dei moduli.
 */
const RISPOSTA_VERA = JSON.parse(
  '{"profiles":[{"id":"safe-esterno","label":"Safe esterno","image":"advanced","requires_authorization":false,"steps":["amass","dns-enum","tls-deep"]},{"id":"smoke-interno","label":"Smoke interno","image":"advanced","requires_authorization":false,"steps":["service-fp"]},{"id":"validation-plus","label":"Validation plus","image":"advanced","requires_authorization":true,"steps":["enum4linux-ng","ldap-enum","cred-bind","tls-deep","cis-check","service-fp","snmp-enum"]}]}',
) as unknown;

function okList(raw: unknown) {
  const r = parseEdgeProfilesResponse(raw);
  assert.ok(r.ok, `atteso ok, ricevuto: ${r.ok ? "" : r.error}`);
  return r.list;
}

test("parse: la risposta vera dell'edge diventa l'elenco dei suoi tre profili", () => {
  const list = okList(RISPOSTA_VERA);
  assert.equal(list.ignored, 0);
  assert.deepEqual(
    list.profiles.map((p) => p.id),
    ["safe-esterno", "smoke-interno", "validation-plus"],
  );
  assert.deepEqual(list.profiles[2], {
    id: "validation-plus",
    label: "Validation plus",
    image: "advanced",
    requires_authorization: true,
    steps: ["enum4linux-ng", "ldap-enum", "cred-bind", "tls-deep", "cis-check", "service-fp", "snmp-enum"],
  });
  assert.equal(list.profiles[0].requires_authorization, false);
});

test("parse: catalogo vuoto (anche col filtro ?image= senza corrispondenze) è un elenco vuoto, non un errore", () => {
  const list = okList({ profiles: [] });
  assert.deepEqual(list.profiles, []);
  assert.equal(list.ignored, 0);
});

test("parse: una risposta con la forma sbagliata è un errore, mai una lista vuota", () => {
  for (const raw of [null, undefined, 42, "profiles", [], {}, { items: [] }, { profiles: null }, { profiles: {} }, { profiles: "x" }]) {
    const r = parseEdgeProfilesResponse(raw);
    assert.equal(r.ok, false, `doveva essere un errore: ${JSON.stringify(raw)}`);
    if (!r.ok) assert.match(r.error, /profili/i);
  }
});

test("parse: etichetta assente, nulla o vuota → si mostra l'id (l'edge fa label = get('label', id), che può dare None)", () => {
  const list = okList({
    profiles: [
      { id: "senza-label" },
      { id: "label-nulla", label: null },
      { id: "label-vuota", label: "   " },
      { id: "label-numero", label: 7 },
      { id: "con-label", label: "  Con etichetta  " },
    ],
  });
  assert.deepEqual(
    list.profiles.map((p) => p.label),
    ["senza-label", "label-nulla", "label-vuota", "label-numero", "Con etichetta"],
  );
});

test("parse: voci non valide, id non sicuri o ripetuti si scartano e si contano", () => {
  const list = okList({
    profiles: [
      "non-un-oggetto",
      null,
      { label: "senza id" },
      { id: 5, label: "id numerico" },
      { id: "Validation-Plus" },
      { id: "con_trattino_basso" },
      { id: "../etc/passwd" },
      { id: "" },
      { id: "a".repeat(65) },
      { id: "smoke-interno", label: "Smoke interno" },
      { id: "smoke-interno", label: "doppione" },
    ],
  });
  assert.deepEqual(list.profiles.map((p) => p.id), ["smoke-interno"]);
  assert.equal(list.profiles[0].label, "Smoke interno");
  assert.equal(list.ignored, 10);
});

test("parse: steps e campi accessori con forme impreviste non rompono la voce", () => {
  const list = okList({
    profiles: [
      { id: "a", steps: ["service-fp", null, 3, "tls-deep"], image: 12, requires_authorization: "true" },
      { id: "b", steps: "service-fp" },
      { id: "c" },
    ],
  });
  assert.deepEqual(list.profiles[0], {
    id: "a",
    label: "a",
    image: null,
    requires_authorization: false,
    steps: ["service-fp", "tls-deep"],
  });
  assert.deepEqual(list.profiles[1].steps, []);
  assert.deepEqual(list.profiles[2].steps, []);
  assert.equal(list.profiles[2].image, null);
});

test("id sicuro: ^[a-z0-9-]{1,64}$", () => {
  for (const ok of ["validation-plus", "smoke-interno", "safe-esterno", "a", "0", "a".repeat(64)]) {
    assert.ok(ASSESSMENT_PROFILE_ID_RE.test(ok), `doveva passare: ${ok}`);
    assert.equal(assessmentProfileIdSchema.safeParse(ok).success, true, `schema: ${ok}`);
  }
  for (const ko of ["", "a".repeat(65), "Validation-plus", "a_b", "a b", "a.b", "../etc", "a/b", "à", "abc\n", "a\u0000"]) {
    assert.equal(ASSESSMENT_PROFILE_ID_RE.test(ko), false, `doveva fallire: ${JSON.stringify(ko)}`);
    assert.equal(assessmentProfileIdSchema.safeParse(ko).success, false, `schema: ${JSON.stringify(ko)}`);
  }
});

test("id sicuro: lo schema spiega l'errore in italiano, anche per un valore che non è una stringa", () => {
  for (const ko of ["Profilo Strano", 5, true]) {
    const r = assessmentProfileIdSchema.safeParse(ko);
    assert.equal(r.success, false);
    if (!r.success) assert.match(r.error.issues[0].message, /Profilo assessment non valido/);
  }
});

test("findEdgeProfile e messaggio del profilo assente", () => {
  const { profiles } = okList(RISPOSTA_VERA);
  assert.equal(findEdgeProfile(profiles, "validation-plus")?.label, "Validation plus");
  assert.equal(findEdgeProfile(profiles, "interno-approfondito"), null);
  assert.equal(findEdgeProfile(profiles, null), null);
  assert.equal(findEdgeProfile(profiles, ""), null);

  const msg = missingProfileMessage("interno-approfondito", profiles);
  assert.match(msg, /«interno-approfondito»/);
  assert.match(msg, /safe-esterno, smoke-interno, validation-plus/);
  assert.match(missingProfileMessage("x", []), /nessuno/);
});

test("effectiveAssessment: quale profilo vale per una richiesta", () => {
  const salvato = { enabled: true, profileId: "validation-plus" };
  const spento = { enabled: false, profileId: null };

  // Spento esplicitamente: nessun profilo, qualunque cosa ci fosse.
  assert.deepEqual(effectiveAssessment({ enabled: false, profileId: "smoke-interno" }, salvato), {
    ok: true,
    enabled: false,
    profileId: null,
  });
  // Acceso con un id: vale quello.
  assert.deepEqual(effectiveAssessment({ enabled: true, profileId: "smoke-interno" }, spento), {
    ok: true,
    enabled: true,
    profileId: "smoke-interno",
  });
  // Acceso senza id: resta quello salvato.
  assert.deepEqual(effectiveAssessment({ enabled: true }, salvato), {
    ok: true,
    enabled: true,
    profileId: "validation-plus",
  });
  // Niente nella richiesta: vale la configurazione salvata.
  assert.deepEqual(effectiveAssessment({}, salvato), { ok: true, enabled: true, profileId: "validation-plus" });
  assert.deepEqual(effectiveAssessment({}, { enabled: false, profileId: "smoke-interno" }), {
    ok: true,
    enabled: false,
    profileId: null,
  });
  assert.deepEqual(effectiveAssessment({ profileId: "smoke-interno" }, salvato), {
    ok: true,
    enabled: true,
    profileId: "smoke-interno",
  });

  // Acceso senza alcun profilo: errore, non più "validation-plus" inventato.
  for (const [req, saved] of [
    [{ enabled: true }, spento],
    [{ enabled: true, profileId: null }, salvato],
    [{}, { enabled: true, profileId: null }],
  ] as const) {
    const r = effectiveAssessment(req, saved);
    assert.equal(r.ok, false, JSON.stringify({ req, saved }));
    if (!r.ok) assert.match(r.error, /Scegli il profilo assessment/);
  }
});

// ── Lucchetti sul sorgente ─────────────────────────────────────────────────

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      out.push(...sourceFiles(p));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

test("lucchetto: nessuna lista fissa di profili assessment nel codice (si leggono dall'edge)", () => {
  const vecchi = /["'`](smoke-interno|safe-interno|validation-plus|interno-approfondito)["'`]/;
  const colpevoli = sourceFiles(SRC)
    .filter((f) => vecchi.test(readFileSync(f, "utf8")))
    .map((f) => relative(process.cwd(), f));
  assert.deepEqual(colpevoli, [], "id di profili scritti a mano: vanno letti da GET /api/v1/profiles dell'edge");
});

test("lucchetto: la rotta dei profili chiede l'autenticazione per prima e lavora nel tenant della sessione", () => {
  const src = readFileSync(join(SRC, "app/api/integrations/scanner-edge/profiles/route.ts"), "utf8");
  const start = src.search(/export\s+async\s+function\s+GET\b/);
  assert.ok(start >= 0, "GET esportato");
  const body = src.slice(start);
  const auth = body.indexOf("requireAuth()");
  const tenant = body.indexOf("withTenantFromSession(");
  const edge = body.indexOf("listEdgeProfiles(");
  assert.ok(auth > 0, "requireAuth() nel GET");
  assert.ok(tenant > auth, "withTenantFromSession dopo l'auth");
  assert.ok(edge > tenant, "la chiamata all'edge dentro il contesto tenant");
});
