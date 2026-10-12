/**
 * T3-27 (SEC-13): segreti d'installazione generati e mai nei registri.
 *
 * Installazioni di LibreNMS e Graylog con docker finto (le risposte hanno la
 * forma di quelle vere: id del container da `docker run -d`, `1` dalla query
 * sullo schema, `Config.Env` come elenco `NOME=valore` da `docker inspect`):
 * - nessuna riga del registro contiene un segreto generato, e nessun
 *   argomento passato a docker lo contiene (il valore va per ambiente);
 * - due installazioni hanno segreti diversi;
 * - la rotta senza password non usa un valore predefinito;
 * - un'installazione «vecchia» (senza segreti salvati) viene migrata: il
 *   valore storico si legge dal container, si salva cifrato e un comando sul
 *   database lo usa.
 *
 * Hub di prova isolato: `support/hub-isolato` va importato PER PRIMO.
 * Run: node --import tsx --test src/lib/integrations/__tests__/install-segreti.test.ts
 */
import { removeTestHubDb } from "./support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb, getSetting, setSetting } from "@/lib/db-hub";
import type { DockerIniettabile, OpzioniDocker } from "../docker";
import type { InstallJob } from "../types";
import { leggiSegretiLibreNMS, setIntegrationConfig, leggiSegretiGraylog } from "../config";
import { dipendenzeLibreNMSReali, eseguiSqlLibreNMS, installLibreNMS, type DipendenzeLibreNMS } from "../librenms";
import { installGraylog, type DipendenzeGraylog } from "../graylog";
import {
  generaSegretiGraylog,
  generaSegretiLibreNMS,
  isAppKeyLibreNMSValida,
  LUNGHEZZA_MINIMA_SEGRETO_GRAYLOG,
  parametriInstallazione,
  type SegretiGraylog,
  type SegretiLibreNMS,
} from "../segreti-installazione";
import { dipendenzeMigrazioneReali, migraSegretiInstallazioni } from "../segreti-migrazione";
import type { ComponentConfig } from "../types";

after(() => {
  closeHubDb();
  removeTestHubDb();
});

// ── Docker finto ─────────────────────────────────────────────────────────────

interface Chiamata {
  args: string[];
  env?: Record<string, string>;
  input?: string;
}

type Risposta = { stdout?: string; stderr?: string; fallisce?: boolean };

function dockerFinto(risponde: (args: string[], env?: Record<string, string>) => Risposta) {
  const chiamate: Chiamata[] = [];
  const docker: DockerIniettabile = {
    async exec(args: string[], opzioni?: OpzioniDocker) {
      chiamate.push({ args, env: opzioni?.env, input: opzioni?.input });
      const r = risponde(args, opzioni?.env);
      if (r.fallisce) {
        // Come execFile: il messaggio riporta la riga di comando.
        throw Object.assign(new Error(`Command failed: docker ${args.join(" ")}`), {
          stdout: r.stdout ?? "",
          stderr: r.stderr ?? "",
        });
      }
      return { stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
    async stream(args, onLine, opzioni) {
      chiamate.push({ args, env: opzioni?.env });
      // `docker run -d` stampa l'id del container; `pull` lo stato.
      onLine(args[0] === "run" ? "3f1c9a7be2d04c11a8e5b6f0d9c2e1a47b3c5d6e7f8091a2b3c4d5e6f7a8b9c0" : "Status: Image is up to date");
      return 0;
    },
  };
  return { docker, chiamate };
}

/** Risposte di MariaDB/LibreNMS a un'installazione che va a buon fine. */
function rispostaLibreNMS(args: string[]): Risposta {
  const sql = args[args.length - 1] ?? "";
  if (args.includes("mysql") && sql.includes("information_schema")) return { stdout: "1\n" };
  if (args.includes("mysql") && sql.includes("SELECT user_id")) return { stdout: "1\n" };
  if (args.some((a) => a.includes("lnms user:add"))) return { stdout: "User admin created.\n" };
  return {};
}

function rispostaGraylog(args: string[]): Risposta {
  if (args[0] === "logs") return { stdout: "[INFO ][o.o.h.AbstractHttpServerTransport] publish_address {172.18.0.3:9200}\n" };
  if (args.includes("mongosh")) return { stdout: "{ ok: 1 }\n" };
  return {};
}

interface Raccolta {
  righe: string[];
  fasi: string[];
  config: Partial<ComponentConfig>[];
  segretiLibre: SegretiLibreNMS[];
  segretiGraylog: SegretiGraylog[];
}

function nuovaRaccolta(): Raccolta {
  return { righe: [], fasi: [], config: [], segretiLibre: [], segretiGraylog: [] };
}

const aggiornaJobFinto = (r: Raccolta) => (_id: string, patch: Partial<InstallJob>) => {
  if (patch.phase) r.fasi.push(patch.phase);
};

function dipLibre(r: Raccolta, docker: DockerIniettabile): DipendenzeLibreNMS {
  return {
    ...dipendenzeLibreNMSReali,
    docker,
    attendi: async () => {},
    fetch: async () => new Response(null, { status: 401 }),
    registro: (_id, riga) => r.righe.push(riga),
    aggiornaJob: aggiornaJobFinto(r),
    salvaConfig: (c) => r.config.push(c),
    salvaSegreti: (s) => r.segretiLibre.push(s),
  };
}

let contatoreToken = 0;
function dipGraylog(r: Raccolta, docker: DockerIniettabile): DipendenzeGraylog {
  return {
    docker,
    attendi: async () => {},
    ora: () => Date.now(),
    fetch: async (input, init) => {
      const url = String(input);
      if (init?.method === "POST" && url.includes("/tokens/")) {
        contatoreToken++;
        return Response.json({ name: "da-invent", token: `1q2w3e4r5t6y7u8i9o0pzxcvbnmlkjhgfdsa${contatoreToken}` });
      }
      return new Response("{}", { status: 200 });
    },
    registro: (_id, riga) => r.righe.push(riga),
    aggiornaJob: aggiornaJobFinto(r),
    salvaConfig: (c) => r.config.push(c),
    salvaSegreti: (s) => r.segretiGraylog.push(s),
    // Il generatore vero: la prova controlla proprio che dia valori diversi.
    generaSegreti: generaSegretiGraylog,
    preparaHost: async () => {},
  };
}

/** Ogni segreto noto dell'installazione, più i primi 8 caratteri del token (stampati fino a v0.3.271). */
function segretiDi(r: Raccolta): string[] {
  const out: string[] = [];
  for (const s of r.segretiLibre) out.push(s.dbPassword, s.dbRootPassword, s.appKey);
  for (const s of r.segretiGraylog) out.push(s.passwordSecret);
  for (const c of r.config) {
    if (c.adminPassword) out.push(c.adminPassword);
    if (c.password) out.push(c.password);
    if (c.apiToken) out.push(c.apiToken, c.apiToken.slice(0, 8));
  }
  return out.filter(Boolean);
}

function nessunSegretoIn(testi: string[], segreti: string[], dove: string): void {
  for (const s of segreti) {
    const trovato = testi.find((t) => t.includes(s));
    assert.equal(trovato, undefined, `un segreto compare in ${dove}`);
  }
}

// ── (1) registro e argomenti senza segreti ───────────────────────────────────

test("LibreNMS: installazione riuscita, nessun segreto nel registro né negli argomenti di docker", async () => {
  const r = nuovaRaccolta();
  const { docker, chiamate } = dockerFinto(rispostaLibreNMS);
  const admin = parametriInstallazione({}).adminPassword;

  await installLibreNMS("job-1", "da-librenms", admin, "http://10.0.0.5:8090", dipLibre(r, docker));

  assert.equal(r.fasi.at(-1), "done");
  assert.equal(r.segretiLibre.length, 1);
  assert.equal(r.config.at(-1)?.adminPassword, admin);
  assert.equal(r.config.at(-1)?.apiToken?.length, 40);
  const segreti = segretiDi(r);
  assert.ok(segreti.length >= 6);
  nessunSegretoIn(r.righe, segreti, "una riga del registro");
  nessunSegretoIn(chiamate.flatMap((c) => c.args), segreti, "un argomento di docker");

  // I segreti arrivano ai container per ambiente.
  const s = r.segretiLibre[0];
  const runDb = chiamate.find((c) => c.args[0] === "run" && c.args.includes("da-librenms-db"));
  assert.equal(runDb?.env?.MYSQL_PASSWORD, s.dbPassword);
  assert.equal(runDb?.env?.MYSQL_ROOT_PASSWORD, s.dbRootPassword);
  const runWeb = chiamate.find((c) => c.args[0] === "run" && c.args.includes("APP_KEY"));
  assert.equal(runWeb?.env?.APP_KEY, s.appKey);
  const mysql = chiamate.filter((c) => c.args.includes("mysql"));
  assert.ok(mysql.length >= 3);
  for (const c of mysql) {
    assert.equal(c.env?.MYSQL_PWD, s.dbPassword);
    assert.ok(!c.args.some((a) => a.startsWith("-p")), "la password del database non va come -p");
  }
  const lnms = chiamate.find((c) => c.args.some((a) => a.includes("lnms user:add")));
  assert.equal(lnms?.env?.DA_LNMS_ADMIN_PW, admin);
  // Il token entra nel database dallo standard input (`docker exec -i`).
  const ins = chiamate.find((c) => c.input?.includes("INSERT INTO api_tokens"));
  assert.ok(ins?.input?.includes(r.config.at(-1)?.apiToken ?? "?"));
  assert.equal(ins?.args[1], "-i");
});

test("LibreNMS: un errore che riporta un segreto arriva al registro mascherato", async () => {
  const r = nuovaRaccolta();
  const admin = parametriInstallazione({}).adminPassword;
  const base = dockerFinto(rispostaLibreNMS).docker;
  const d = dipLibre(r, {
    ...base,
    // Un client docker che ripete nell'errore i valori ricevuti per ambiente.
    async stream(args, onLine, opzioni) {
      if (args[0] === "run" && opzioni?.env?.MYSQL_PASSWORD) {
        onLine(`docker: errore con ${opzioni.env.MYSQL_PASSWORD} e ${admin}`);
        throw new Error(`docker run uscito con codice 125: ${opzioni.env.MYSQL_ROOT_PASSWORD}`);
      }
      return base.stream(args, onLine, opzioni);
    },
  });
  await installLibreNMS("job-err", "da-librenms", admin, "http://10.0.0.5:8090", d);
  assert.equal(r.fasi.at(-1), "error");
  nessunSegretoIn(r.righe, [...segretiDi(r), admin], "una riga del registro");
  assert.ok(r.righe.some((l) => l.includes("***")));
});

test("Graylog: installazione riuscita, nessun segreto nel registro né negli argomenti di docker", async () => {
  const r = nuovaRaccolta();
  const { docker, chiamate } = dockerFinto(rispostaGraylog);
  const admin = parametriInstallazione({}).adminPassword;

  await installGraylog("job-2", "da-graylog", admin, "http://10.0.0.5:9000", dipGraylog(r, docker));

  assert.equal(r.fasi.at(-1), "done");
  assert.equal(r.segretiGraylog.length, 1);
  const segreti = segretiDi(r);
  nessunSegretoIn(r.righe, segreti, "una riga del registro");
  nessunSegretoIn(chiamate.flatMap((c) => c.args), segreti, "un argomento di docker");
  const run = chiamate.find((c) => c.args[0] === "run" && c.args.includes("GRAYLOG_PASSWORD_SECRET"));
  assert.equal(run?.env?.GRAYLOG_PASSWORD_SECRET, r.segretiGraylog[0].passwordSecret);
  assert.match(run?.env?.GRAYLOG_ROOT_PASSWORD_SHA2 ?? "", /^[0-9a-f]{64}$/);
});

// ── (2) ogni installazione ha segreti propri ─────────────────────────────────

test("due installazioni producono segreti diversi, nel formato atteso", async () => {
  const a = nuovaRaccolta();
  const b = nuovaRaccolta();
  await installLibreNMS("j-a", "da-librenms", parametriInstallazione({}).adminPassword, "http://h:8090", dipLibre(a, dockerFinto(rispostaLibreNMS).docker));
  await installLibreNMS("j-b", "da-librenms", parametriInstallazione({}).adminPassword, "http://h:8090", dipLibre(b, dockerFinto(rispostaLibreNMS).docker));
  const [sa, sb] = [a.segretiLibre[0], b.segretiLibre[0]];
  assert.notEqual(sa.dbPassword, sb.dbPassword);
  assert.notEqual(sa.dbRootPassword, sb.dbRootPassword);
  assert.notEqual(sa.appKey, sb.appKey);
  assert.notEqual(a.config.at(-1)?.adminPassword, b.config.at(-1)?.adminPassword);
  assert.ok(isAppKeyLibreNMSValida(sa.appKey) && isAppKeyLibreNMSValida(sb.appKey));

  const ga = nuovaRaccolta();
  const gb = nuovaRaccolta();
  await installGraylog("g-a", "da-graylog", "password-scelta-1", "http://h:9000", dipGraylog(ga, dockerFinto(rispostaGraylog).docker));
  await installGraylog("g-b", "da-graylog", "password-scelta-1", "http://h:9000", dipGraylog(gb, dockerFinto(rispostaGraylog).docker));
  const [pa, pb] = [ga.segretiGraylog[0].passwordSecret, gb.segretiGraylog[0].passwordSecret];
  assert.notEqual(pa, pb);
  assert.ok(pa.length >= LUNGHEZZA_MINIMA_SEGRETO_GRAYLOG);
});

test("chiave applicativa di LibreNMS: 32 byte in base64 col prefisso; le forme sbagliate si riconoscono", () => {
  const k = generaSegretiLibreNMS().appKey;
  assert.ok(isAppKeyLibreNMSValida(k));
  assert.equal(Buffer.from(k.slice(7), "base64").length, 32);
  assert.equal(isAppKeyLibreNMSValida(k.slice(7)), false);
  assert.equal(isAppKeyLibreNMSValida(`base64:${Buffer.alloc(16).toString("base64")}`), false);
});

// ── (4) la rotta senza password non usa un valore predefinito ────────────────

test("richiesta d'installazione senza password (o troppo corta): se ne genera una, mai «admin»", () => {
  for (const corpo of [{}, null, { adminPassword: "" }, { adminPassword: "abc" }, { adminPassword: 12345678 }]) {
    const p = parametriInstallazione(corpo);
    assert.equal(p.passwordGenerata, true);
    assert.notEqual(p.adminPassword, "admin");
    assert.ok(p.adminPassword.length >= 12);
  }
  assert.notEqual(parametriInstallazione({}).adminPassword, parametriInstallazione({}).adminPassword);
  const scelta = parametriInstallazione({ adminPassword: "  scelta-dall-admin ", serverUrl: "http://10.0.0.5:8090/" });
  assert.deepEqual(scelta, { adminPassword: "scelta-dall-admin", passwordGenerata: false, serverUrl: "http://10.0.0.5:8090" });
});

// ── (5) installazione «vecchia»: migrazione e comando sul database ────────────

const CHIAVI_SEGRETI = [
  "integration_librenms_secret_db_password",
  "integration_librenms_secret_db_root_password",
  "integration_librenms_secret_app_key",
  "integration_graylog_secret_password_secret",
];

// Valori storici finti, nella forma in cui `docker inspect` li restituisce.
const STORICO_DB = "storico-db-finto-1234";
const STORICO_ROOT = "storico-root-finto-5678";
const STORICO_APP_KEY = `base64:${Buffer.alloc(32, 7).toString("base64")}`;
const STORICO_GRAYLOG = "storico-graylog-finto-".padEnd(70, "x");

function inspectVecchio(args: string[]): Risposta {
  if (args[0] !== "inspect") return {};
  const nome = args[args.length - 1];
  const env: Record<string, string[]> = {
    "da-librenms-db": [
      `MYSQL_ROOT_PASSWORD=${STORICO_ROOT}`, "MYSQL_DATABASE=librenms", "MYSQL_USER=librenms",
      `MYSQL_PASSWORD=${STORICO_DB}`, "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      "GOSU_VERSION=1.17", "MARIADB_VERSION=1:10.11.9+maria~ubu2204",
    ],
    "da-librenms": [
      `APP_KEY=${STORICO_APP_KEY}`, "DB_HOST=da-librenms-db", "DB_PORT=3306", "DB_USER=librenms",
      `DB_PASSWORD=${STORICO_DB}`, "DB_NAME=librenms", "REDIS_HOST=da-librenms-redis", "TZ=UTC",
    ],
    "da-graylog": [`GRAYLOG_PASSWORD_SECRET=${STORICO_GRAYLOG}`, "GRAYLOG_HTTP_EXTERNAL_URI=http://10.0.0.5:9000/"],
  };
  const righe = env[nome];
  if (!righe) return { fallisce: true, stderr: `Error: No such object: ${nome}` };
  return { stdout: `${JSON.stringify(righe)}\n` };
}

beforeEach(() => {
  for (const k of CHIAVI_SEGRETI) setSetting(k, "");
  setIntegrationConfig("librenms", { mode: "disabled", containerName: "da-librenms" });
  setIntegrationConfig("graylog", { mode: "disabled", containerName: "da-graylog" });
});

test("installazione vecchia di LibreNMS: senza migrazione il comando sul database rifiuta, non indovina", async () => {
  setIntegrationConfig("librenms", { mode: "managed", containerName: "da-librenms" });
  const { docker, chiamate } = dockerFinto(() => ({ stdout: "1\n" }));
  const r = await eseguiSqlLibreNMS("da-librenms", "SELECT 1;", { ...dipendenzeLibreNMSReali, docker });
  assert.equal(r.ok, false);
  assert.equal(chiamate.length, 0);
});

test("installazione vecchia: la migrazione salva cifrato il valore storico e il comando sul database lo usa", async () => {
  setIntegrationConfig("librenms", { mode: "managed", containerName: "da-librenms" });
  setIntegrationConfig("graylog", { mode: "managed", containerName: "da-graylog" });
  const { docker } = dockerFinto(inspectVecchio);

  const esiti = await migraSegretiInstallazioni({ ...dipendenzeMigrazioneReali, docker });
  assert.deepEqual(esiti, [
    { componente: "librenms", esito: "migrati" },
    { componente: "graylog", esito: "migrati" },
  ]);
  // Nel database dell'hub c'è il cifrato, non il valore.
  for (const k of CHIAVI_SEGRETI) {
    const grezzo = getSetting(k) ?? "";
    assert.match(grezzo, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i, `${k} non cifrata`);
  }
  assert.deepEqual(leggiSegretiLibreNMS(), { dbPassword: STORICO_DB, dbRootPassword: STORICO_ROOT, appKey: STORICO_APP_KEY });
  assert.deepEqual(leggiSegretiGraylog(), { passwordSecret: STORICO_GRAYLOG });

  // Comando di manutenzione: la password arriva per ambiente, dal salvato.
  const mysql = dockerFinto((args, env) =>
    args.includes("mysql") && env?.MYSQL_PWD === STORICO_DB ? { stdout: "1\n" } : { fallisce: true, stderr: "Access denied" },
  );
  const r = await eseguiSqlLibreNMS("da-librenms", "SELECT 1;", { ...dipendenzeLibreNMSReali, docker: mysql.docker });
  assert.deepEqual(r, { ok: true, stdout: "1\n" });
  assert.deepEqual(mysql.chiamate[0].args, ["exec", "-e", "MYSQL_PWD", "da-librenms-db", "mysql", "-ulibrenms", "librenms", "-se", "SELECT 1;"]);

  // Rieseguita non cambia niente e non interroga docker.
  const seconda = dockerFinto(() => ({ fallisce: true }));
  const esiti2 = await migraSegretiInstallazioni({ ...dipendenzeMigrazioneReali, docker: seconda.docker });
  assert.deepEqual(esiti2.map((e) => e.esito), ["gia_presenti", "gia_presenti"]);
  assert.equal(seconda.chiamate.length, 0);
});

test("container non leggibile o variabile assente: «non recuperabili», niente salvato, nessun valore nel motivo", async () => {
  setIntegrationConfig("librenms", { mode: "managed", containerName: "da-librenms" });
  setIntegrationConfig("graylog", { mode: "managed", containerName: "da-graylog-altro" });
  const { docker } = dockerFinto((args) => {
    // Il container del database esiste ma senza MYSQL_PASSWORD.
    if (args.at(-1) === "da-librenms-db") return { stdout: `${JSON.stringify([`MYSQL_ROOT_PASSWORD=${STORICO_ROOT}`])}\n` };
    return inspectVecchio(args);
  });
  const esiti = await migraSegretiInstallazioni({ ...dipendenzeMigrazioneReali, docker });
  assert.deepEqual(esiti.map((e) => e.esito), ["non_recuperabili", "non_recuperabili"]);
  for (const e of esiti) assert.ok(e.motivo && !e.motivo.includes(STORICO_ROOT));
  assert.equal(leggiSegretiLibreNMS(), null);
  assert.equal(leggiSegretiGraylog(), null);
});
