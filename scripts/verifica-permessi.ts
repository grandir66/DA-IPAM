/**
 * verifica-permessi.ts — i permessi visti dal di fuori, sull'applicazione accesa
 * in locale (T3-30). Si lancia da `scripts/verifica-permessi.sh`.
 *
 * Cosa fa:
 * 1. crea nel database hub locale un utente **viewer di prova** con una password
 *    generata qui (mai stampata, mai in un argomento) e accesso in sola lettura
 *    al primo cliente attivo;
 * 2. entra con quell'utente come farebbe la pagina di accesso;
 * 3. fa solo GET, senza sessione e da viewer, sui casi di
 *    `src/lib/permessi/verifica-esterna.ts` (derivati dal censimento delle
 *    guardie) e giudica le risposte;
 * 4. toglie l'utente di prova, anche se qualcosa è andato storto.
 *
 * Solo in locale: rifiuta un indirizzo che non sia 127.0.0.1, localhost o ::1.
 * Un'utenza di prova su un server vero è una scrittura in produzione.
 *
 * Uso:   bash scripts/verifica-permessi.sh [http://127.0.0.1:3001]
 * Hub:   DA_IPAM_HUB_DB_PATH, altrimenti $DA_INVENT_DATA_DIR/hub.db, altrimenti
 *        ./data/hub.db — lo stesso che usa l'applicazione accesa.
 * Esce:  0 nessun caso fallito · 1 almeno un caso fallito o accesso non riuscito ·
 *        2 configurazione sbagliata (indirizzo non locale, hub mancante, nessun cliente).
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import bcrypt from "bcrypt";
import { censisci, consentitiDaAuthConfig, gestoriDellAlbero } from "../src/lib/permessi/rotte";
import { casiDiVerifica, giudica, riepiloga, type Caso, type Giudizio, type Risposta } from "../src/lib/permessi/verifica-esterna";

const HOST_LOCALI = new Set(["127.0.0.1", "localhost", "[::1]"]);
const TIMEOUT_MS = 60_000; // in sviluppo la prima richiesta a una rotta la compila

function esci(codice: number, messaggio: string): never {
  process.stderr.write(`${messaggio}\n`);
  process.exit(codice);
}

function percorsoHub(): string {
  const esplicito = process.env.DA_IPAM_HUB_DB_PATH?.trim();
  if (esplicito) return path.resolve(esplicito);
  const dati = process.env.DA_INVENT_DATA_DIR?.trim() || path.join(process.cwd(), "data");
  return path.join(path.resolve(dati), "hub.db");
}

/** Barattolo dei cookie minimo: nome → valore, i cookie cancellati si tolgono. */
class Cookie {
  private valori = new Map<string, string>();
  assorbi(r: Response): void {
    for (const c of r.headers.getSetCookie()) {
      const [coppia, ...attr] = c.split(";");
      const i = coppia.indexOf("=");
      if (i <= 0) continue;
      const nome = coppia.slice(0, i).trim();
      const valore = coppia.slice(i + 1).trim();
      const scaduto = attr.some((a) => /^\s*max-age=0\s*$/i.test(a)) || valore === "";
      if (scaduto) this.valori.delete(nome);
      else this.valori.set(nome, valore);
    }
  }
  intestazione(): string {
    return [...this.valori].map(([n, v]) => `${n}=${v}`).join("; ");
  }
}

async function chiama(base: string, percorso: string, cookie: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  return fetch(new URL(percorso, base), { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
}

async function rispostaDi(r: Response): Promise<Risposta> {
  return { status: r.status, location: r.headers.get("location"), setCookie: r.headers.getSetCookie(), corpo: await r.text() };
}

interface Utenza {
  id: number;
  username: string;
  password: string;
}

function creaViewer(db: Database.Database): Utenza {
  const cliente = db.prepare("SELECT id FROM tenants WHERE active = 1 ORDER BY id LIMIT 1").get() as { id: number } | undefined;
  if (!cliente) esci(2, "Nessun cliente attivo nel database hub locale: il viewer di prova non avrebbe dati da leggere.");
  const username = `verifica-viewer-${randomBytes(4).toString("hex")}`;
  const password = randomBytes(24).toString("base64url");
  const hash = bcrypt.hashSync(password, 12);
  const id = db.transaction(() => {
    const info = db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'viewer')").run(username, hash);
    const uid = Number(info.lastInsertRowid);
    db.prepare("INSERT INTO user_tenant_access (user_id, tenant_id, role) VALUES (?, ?, 'viewer')").run(uid, cliente.id);
    return uid;
  })();
  return { id, username, password };
}

function togliViewer(db: Database.Database, u: Utenza): void {
  db.transaction(() => {
    db.prepare("DELETE FROM user_tenant_access WHERE user_id = ?").run(u.id);
    db.prepare("DELETE FROM users WHERE id = ? AND username = ?").run(u.id, u.username);
  })();
}

/** Accesso come dalla pagina di login (NextAuth, provider «credentials»). */
async function entra(base: string, u: Utenza): Promise<string> {
  const barattolo = new Cookie();
  const csrf = await chiama(base, "/api/auth/csrf", "");
  barattolo.assorbi(csrf);
  let token = "";
  try {
    token = String((JSON.parse(await csrf.text()) as { csrfToken?: unknown }).csrfToken ?? "");
  } catch {
    token = "";
  }
  // Qui si lancia, non si esce: l'utente di prova va tolto anche quando l'accesso non riesce.
  if (!token) throw new Error(`accesso non riuscito: /api/auth/csrf ha risposto ${csrf.status} senza token`);
  const corpo = new URLSearchParams({ csrfToken: token, username: u.username, password: u.password, callbackUrl: new URL("/", base).href });
  const login = await chiama(base, "/api/auth/callback/credentials", barattolo.intestazione(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: corpo.toString(),
  });
  barattolo.assorbi(login);
  await login.text();

  const sessione = await chiama(base, "/api/auth/session", barattolo.intestazione());
  let ruolo: unknown;
  try {
    ruolo = (JSON.parse(await sessione.text()) as { user?: { role?: unknown } } | null)?.user?.role;
  } catch {
    ruolo = undefined;
  }
  if (ruolo !== "viewer") throw new Error(`accesso non riuscito: la sessione del viewer di prova ha ruolo ${String(ruolo ?? "nessuno")}`);
  return barattolo.intestazione();
}

async function main(): Promise<void> {
  const base = process.argv[2] || "http://127.0.0.1:3001";
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    esci(2, `Indirizzo non valido: ${base}`);
  }
  if (!HOST_LOCALI.has(url.hostname)) esci(2, "Solo in locale (127.0.0.1, localhost, ::1): un'utenza di prova su un server vero è una scrittura in produzione.");

  const hub = percorsoHub();
  if (!existsSync(hub)) esci(2, `Database hub non trovato: ${hub}`);

  const radice = process.cwd();
  const consentiti = consentitiDaAuthConfig(readFileSync(path.join(radice, "src", "lib", "auth.config.ts"), "utf8"));
  const { valutazioni } = censisci(gestoriDellAlbero(radice).gestori, consentiti);
  const casi = casiDiVerifica(valutazioni, consentiti);

  const db = new Database(hub);
  db.pragma("foreign_keys = ON");
  const utenza = creaViewer(db);
  const giudizi: Array<{ caso: Caso; g: Giudizio }> = [];
  try {
    const cookieViewer = await entra(base, utenza);
    for (const caso of casi) {
      let g: Giudizio;
      try {
        const r = await chiama(base, caso.percorso, caso.chi === "viewer" ? cookieViewer : "");
        g = giudica(caso, await rispostaDi(r));
      } catch (e) {
        g = { esito: "ko", nota: `nessuna risposta (${e instanceof Error ? e.name : "errore"})` };
      }
      giudizi.push({ caso, g });
    }
  } finally {
    togliViewer(db, utenza);
    db.close();
  }

  for (const { caso, g } of giudizi) {
    if (g.esito !== "ok") process.stdout.write(`${g.esito.toUpperCase()}  ${caso.chi.padEnd(7)} GET ${caso.percorso}  — ${g.nota} [${caso.origine}]\n`);
  }
  const n = riepiloga(giudizi.map((x) => x.g));
  const perChi = (chi: Caso["chi"]) => giudizi.filter((x) => x.caso.chi === chi).length;
  process.stdout.write(
    `casi ${giudizi.length} (anonimo ${perChi("anonimo")}, viewer ${perChi("viewer")}) · ok ${n.ok} · ko ${n.ko} · non provati ${n["non-provato"]}\n`,
  );
  process.exit(n.ko > 0 ? 1 : 0);
}

main().catch((e: unknown) => esci(1, `Verifica interrotta: ${e instanceof Error ? e.message : String(e)}`));
