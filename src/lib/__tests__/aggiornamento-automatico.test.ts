/**
 * Aggiornamento automatico (scripts/auto-update.sh → scripts/update.sh) su un
 * repo git temporaneo, con `npm`, `systemctl`, `curl` e `sleep` finti nel PATH.
 * Nessun servizio vero, nessuna rete, nessun file del repo reale toccato.
 *
 * Perché (16/10/2026): un build fallito lasciava HEAD = origin, il giro dopo
 * diceva «già aggiornato» e non ritentava; il processo acceso restava senza
 * riavvio su una .next rotta; una salute negativa diventava «Aggiornamento
 * completato». Queste prove fissano il comportamento nuovo.
 *
 * Il build finto scrive BUILD_ID = commit nella cartella di DA_INVENT_BUILD_DIR;
 * fallisce se il commit contiene `rompi-build`; se contiene `rompi-salute` la
 * build risponde 503 a /api/health (il curl finto guarda la build in uso).
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applica, leggiCampo } from "../../../scripts/stato-aggiornamento.mjs";

type VariabiliAmbiente = Record<string, string | undefined>;
// I tipi di Next rendono NODE_ENV obbligatorio in ProcessEnv: agli script non serve.
const comeProcessEnv = (env: VariabiliAmbiente): NodeJS.ProcessEnv => env as NodeJS.ProcessEnv;

const REPO = path.resolve(__dirname, "../../..");

const NPM_FINTO = `#!/bin/bash
echo "npm $*" >> "$FINTO_LOG"
if [ "$1" = "install" ]; then exit 0; fi
if [ "$1" = "run" ] && [ "$2" = "build" ]; then
  dir="\${DA_INVENT_BUILD_DIR:-.next}"
  mkdir -p "$dir"
  if [ -f rompi-build ]; then echo "a metà" > "$dir/parziale"; exit 1; fi
  git rev-parse HEAD > "$dir/BUILD_ID"
  if [ -f rompi-salute ]; then touch "$dir/MALATA"; fi
  exit 0
fi
exit 0
`;

const SYSTEMCTL_FINTO = `#!/bin/bash
if [ "$1" = "is-active" ]; then
  [ -f "$FINTO_DIR/servizio-attivo" ] && [ "$3" = "da-invent" ] && exit 0
  exit 3
fi
if [ "$1" = "restart" ]; then
  echo "restart $2 $(cat .next-attiva 2>/dev/null || echo .next)" >> "$FINTO_LOG"
  exit 0
fi
exit 0
`;

/** Salute della build in uso: quella di .next-attiva, altrimenti .next. */
const CURL_FINTO = `#!/bin/bash
case "$*" in
  *api/health*)
    dir="$(cat .next-attiva 2>/dev/null || echo .next)"
    echo "curl salute $dir" >> "$FINTO_LOG"
    [ -f "$dir/BUILD_ID" ] && [ ! -f "$dir/MALATA" ] && exit 0
    exit 22 ;;
esac
exit 0
`;

interface Ambiente {
  radice: string;
  origin: string;
  app: string;
  log: string;
  statoFile: string;
  env: VariabiliAmbiente;
}

function sh(cmd: string, cwd: string, env?: VariabiliAmbiente): string {
  const r = spawnSync("bash", ["-c", cmd], { cwd, env: env ? comeProcessEnv(env) : process.env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`«${cmd}» in ${cwd}: ${r.stderr}${r.stdout}`);
  return r.stdout.trim();
}

function preparaAmbiente(): Ambiente {
  const radice = fs.mkdtempSync(path.join(os.tmpdir(), "aggiornamento-"));
  const origin = path.join(radice, "origin.git");
  const lavoro = path.join(radice, "lavoro");
  const app = path.join(radice, "app");
  const bin = path.join(radice, "bin");
  const log = path.join(radice, "chiamate.log");
  fs.mkdirSync(bin);
  for (const [nome, testo] of [["npm", NPM_FINTO], ["systemctl", SYSTEMCTL_FINTO], ["curl", CURL_FINTO], ["sleep", "#!/bin/bash\nexit 0\n"],
    // Da utente normale (la CI) update.sh riavvia con `sudo systemctl`: il sudo vero
    // azzera il PATH e salterebbe il systemctl finto.
    ["sudo", '#!/bin/bash\nexec "$@"\n']]) {
    fs.writeFileSync(path.join(bin, nome), testo, { mode: 0o755 });
  }
  fs.writeFileSync(log, "");
  fs.writeFileSync(path.join(radice, "servizio-attivo"), "");

  sh(`git init -q --bare -b main "${origin}"`, radice);
  sh(`git init -q -b main "${lavoro}"`, radice);
  fs.mkdirSync(path.join(lavoro, "scripts"));
  for (const f of ["auto-update.sh", "update.sh", "stato-aggiornamento.mjs"]) {
    fs.copyFileSync(path.join(REPO, "scripts", f), path.join(lavoro, "scripts", f));
  }
  fs.writeFileSync(path.join(lavoro, "package.json"), JSON.stringify({ name: "prova", version: "1.0.0" }));
  fs.writeFileSync(path.join(lavoro, ".gitignore"), "/.next/\n/.next-a/\n/.next-b/\n/.next-attiva\n/data/\n");
  fs.writeFileSync(path.join(lavoro, "app.ts"), "export const v = 1;\n");
  sh(
    `git -c user.email=t@t -c user.name=t add -A && git -c user.email=t@t -c user.name=t commit -qm primo && git remote add origin "${origin}" && git push -q origin main`,
    lavoro,
  );
  sh(`git clone -q "${origin}" "${app}"`, radice);
  // La build che gira all'inizio: .next storica, col commit iniziale.
  fs.mkdirSync(path.join(app, ".next"));
  fs.writeFileSync(path.join(app, ".next", "BUILD_ID"), sh("git rev-parse HEAD", app));

  const statoFile = path.join(radice, "stato.json");
  const env: VariabiliAmbiente = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    HOME: radice,
    FINTO_LOG: log,
    FINTO_DIR: radice,
    DA_INVENT_BRANCH: "main",
    DA_INVENT_LOCK: path.join(radice, "lock"),
    DA_INVENT_STATO_AGGIORNAMENTO: statoFile,
    DA_INVENT_ATTESA_SALUTE: "4",
  };
  return { radice, origin, app, log, statoFile, env };
}

/** Un commit nuovo su origin/<ramo>, con i file dati (contenuto o null = cancella). */
function pubblica(a: Ambiente, file: Record<string, string | null>, ramo = "main"): string {
  const lavoro = path.join(a.radice, "lavoro");
  sh(`git checkout -q -B ${ramo} && git pull -q origin ${ramo} 2>/dev/null || true`, lavoro);
  for (const [nome, testo] of Object.entries(file)) {
    const p = path.join(lavoro, nome);
    if (testo === null) fs.rmSync(p, { force: true });
    else {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, testo);
    }
  }
  sh(`git add -A && git -c user.email=t@t -c user.name=t commit -qm "c ${Date.now()}" && git push -q origin ${ramo}`, lavoro);
  return sh("git rev-parse HEAD", lavoro);
}

function giro(a: Ambiente, extra: VariabiliAmbiente = {}): { codice: number; uscita: string; chiamate: string[] } {
  fs.writeFileSync(a.log, "");
  const r = spawnSync("bash", [path.join(a.app, "scripts", "auto-update.sh")], {
    cwd: a.app,
    env: comeProcessEnv({ ...a.env, ...extra }),
    encoding: "utf8",
  });
  return {
    codice: r.status ?? -1,
    uscita: `${r.stdout}\n${r.stderr}`,
    chiamate: fs.readFileSync(a.log, "utf8").split("\n").filter(Boolean),
  };
}

function stato(a: Ambiente): Record<string, unknown> & { ultimo_tentativo?: Record<string, unknown> } {
  return JSON.parse(fs.readFileSync(a.statoFile, "utf8"));
}

const head = (a: Ambiente) => sh("git rev-parse HEAD", a.app);
const buildInUso = (a: Ambiente) => {
  const p = path.join(a.app, ".next-attiva");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8").trim() : ".next";
};
const buildId = (a: Ambiente, dir = buildInUso(a)) => fs.readFileSync(path.join(a.app, dir, "BUILD_ID"), "utf8").trim();

describe("aggiornamento automatico", () => {
  let a: Ambiente;
  beforeEach(() => {
    a = preparaAmbiente();
  });
  afterEach(() => {
    fs.rmSync(a.radice, { recursive: true, force: true });
  });

  test("niente di nuovo: nessun build, nessun riavvio; il primo giro registra HEAD come avviato", () => {
    const r = giro(a);
    assert.equal(r.codice, 0, r.uscita);
    assert.match(r.uscita, /già aggiornato/);
    assert.deepEqual(r.chiamate, []);
    assert.equal(stato(a).commit_avviato, head(a));
  });

  test("commit nuovo: build nella cartella libera, scambio, riavvio, salute, stato riuscito", () => {
    giro(a);
    const nuovo = pubblica(a, { "app.ts": "export const v = 2;\n" });
    const r = giro(a);
    assert.equal(r.codice, 0, r.uscita);
    assert.equal(head(a), nuovo);
    assert.equal(buildInUso(a), ".next-a");
    assert.equal(buildId(a), nuovo);
    assert.ok(r.chiamate.includes("restart da-invent .next-a"), r.chiamate.join("\n"));
    assert.equal(fs.readlinkSync(path.join(a.app, ".next")), ".next-a", ".next diventa il collegamento alla build in uso");
    const s = stato(a);
    assert.equal(s.commit_avviato, nuovo);
    assert.equal(s.ultimo_tentativo?.esito, "riuscito");

    // Il giro dopo usa l'altra cartella e butta la vecchia.
    const terzo = pubblica(a, { "app.ts": "export const v = 3;\n" });
    assert.equal(giro(a).codice, 0);
    assert.equal(buildInUso(a), ".next-b");
    assert.equal(buildId(a), terzo);
    assert.equal(fs.existsSync(path.join(a.app, ".next-a")), false);
  });

  test("build fallito: la build accesa resta intatta, niente riavvio, codice di prima, e il giro dopo ritenta", () => {
    giro(a);
    const prima = head(a);
    const rotto = pubblica(a, { "rompi-build": "x" });

    const r = giro(a);
    assert.notEqual(r.codice, 0);
    assert.equal(buildInUso(a), ".next", "la build in uso non cambia");
    assert.equal(buildId(a), prima);
    assert.equal(r.chiamate.some((c) => c.startsWith("restart")), false, "nessun riavvio");
    assert.equal(head(a), prima, "il codice torna al commit che gira");
    assert.equal(fs.existsSync(path.join(a.app, ".next-a")), false, "la build a metà si butta");
    let s = stato(a);
    assert.equal(s.commit_avviato, prima);
    assert.equal(s.ultimo_tentativo?.esito, "fallito");
    assert.equal(s.ultimo_tentativo?.fase, "build");
    assert.equal(s.ultimo_tentativo?.commit, rotto);

    // Prima era «già aggiornato» per sempre: ora si ritenta, fino a 3 volte.
    assert.ok(giro(a).chiamate.includes("npm run build"));
    assert.ok(giro(a).chiamate.includes("npm run build"));
    assert.equal(stato(a).ultimo_tentativo?.tentativi, 3);
    const fermo = giro(a);
    assert.equal(fermo.codice, 0);
    assert.match(fermo.uscita, /fallito 3 volte/);
    assert.deepEqual(fermo.chiamate, []);

    // Un commit nuovo che si costruisce riparte da solo.
    const sano = pubblica(a, { "rompi-build": null });
    assert.equal(giro(a).codice, 0);
    s = stato(a);
    assert.equal(s.commit_avviato, sano);
    assert.equal(buildId(a), sano);
  });

  test("salute negativa dopo il riavvio: si torna alla build e al commit di prima e si riavvia di nuovo", () => {
    giro(a);
    const prima = head(a);
    pubblica(a, { "rompi-salute": "x" });
    const r = giro(a);
    assert.notEqual(r.codice, 0);
    assert.doesNotMatch(r.uscita, /Aggiornamento completato/);
    assert.deepEqual(
      r.chiamate.filter((c) => c.startsWith("restart")),
      ["restart da-invent .next-a", "restart da-invent .next"],
    );
    assert.equal(buildInUso(a), ".next");
    assert.equal(buildId(a), prima);
    assert.equal(head(a), prima);
    const s = stato(a);
    assert.equal(s.ultimo_tentativo?.esito, "fallito");
    assert.equal(s.ultimo_tentativo?.fase, "salute");
    assert.equal(s.commit_avviato, prima);
  });

  test("cambio di ramo: il checkout non salta più build e riavvio", () => {
    giro(a);
    const dev = pubblica(a, { "app.ts": "export const v = 9;\n" }, "dev");
    const r = giro(a, { DA_INVENT_BRANCH: "dev" });
    assert.equal(r.codice, 0, r.uscita);
    assert.ok(r.chiamate.includes("npm run build"), r.chiamate.join("\n"));
    assert.equal(buildId(a), dev);
    assert.equal(stato(a).commit_avviato, dev);
  });

  test("solo documentazione: file aggiornati senza build né riavvio", () => {
    giro(a);
    const doc = pubblica(a, { "docs/nota.md": "ciao\n" });
    const r = giro(a);
    assert.equal(r.codice, 0, r.uscita);
    assert.deepEqual(r.chiamate, []);
    assert.equal(head(a), doc);
    assert.equal(stato(a).commit_avviato, doc);
  });

  test("dopo un build fallito il confronto parte dal commit che gira, non da HEAD", () => {
    giro(a);
    pubblica(a, { "rompi-build": "x" });
    giro(a);
    // Il codice torna uguale a quello che gira, più un documento: niente build.
    const doc = pubblica(a, { "rompi-build": null, "docs/nota.md": "ciao\n" });
    let r = giro(a);
    assert.deepEqual(r.chiamate, []);
    assert.equal(stato(a).commit_avviato, doc);
    // Un cambio di codice dopo il fallimento si costruisce.
    pubblica(a, { "rompi-build": "x" });
    giro(a);
    pubblica(a, { "rompi-build": null, "app.ts": "export const v = 7;\n" });
    r = giro(a);
    assert.ok(r.chiamate.includes("npm run build"), r.chiamate.join("\n"));
  });

  test("giro morto a metà: registrato come interrotto e contato fra i tentativi", () => {
    giro(a);
    const rotto = pubblica(a, { "app.ts": "export const v = 5;\n" });
    fs.writeFileSync(
      a.statoFile,
      JSON.stringify({
        ...stato(a),
        ultimo_tentativo: { commit: rotto, esito: "in_corso", fase: "build", tentativi: 3 },
      }),
    );
    const r = giro(a);
    assert.equal(r.codice, 0);
    assert.match(r.uscita, /fallito 3 volte/);
    assert.equal(stato(a).ultimo_tentativo?.esito, "interrotto");
    // Con DA_INVENT_FORZA_AGGIORNAMENTO=1 si riprova subito.
    assert.equal(giro(a, { DA_INVENT_FORZA_AGGIORNAMENTO: "1" }).codice, 0);
    assert.equal(stato(a).commit_avviato, rotto);
  });
});

describe("stato-aggiornamento.mjs (funzioni pure)", () => {
  const ORA = "2026-10-16T17:00:00.000Z";

  test("i tentativi si contano sullo stesso commit e ripartono da 1 su un commit nuovo", () => {
    let s = applica({}, "inizio", ["c1", "c0"], ORA);
    s = applica(s, "fine", ["fallito", "build"], ORA);
    s = applica(s, "inizio", ["c1", "c0"], ORA);
    assert.equal(s.ultimo_tentativo.tentativi, 2);
    s = applica(s, "inizio", ["c2", "c0"], ORA);
    assert.equal(s.ultimo_tentativo.tentativi, 1);
  });

  test("solo «riuscito» sposta il commit avviato", () => {
    let s = applica({ commit_avviato: "c0" }, "inizio", ["c1", "c0"], ORA);
    s = applica(s, "fine", ["fallito"], ORA);
    assert.equal(leggiCampo(s, "commit_avviato"), "c0");
    s = applica(s, "inizio", ["c1", "c0"], ORA);
    s = applica(s, "fine", ["riuscito"], ORA);
    assert.equal(leggiCampo(s, "commit_avviato"), "c1");
    assert.deepEqual(s.ultimo_successo, { commit: "c1", il: ORA });
  });

  test("esito sconosciuto rifiutato; stato vuoto si legge come vuoto", () => {
    assert.throws(() => applica({}, "fine", ["boh"], ORA));
    assert.equal(leggiCampo({}, "commit_avviato"), "");
    assert.equal(leggiCampo({}, "tentativi"), "");
  });
});
