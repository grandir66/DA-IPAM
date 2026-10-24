/**
 * Un OpenBao finto per le prove (nessun server vero): risponde come l'API HTTP di OpenBao 2.x per quello che
 * `@domarc/vault` usa — login AppRole, KV v2 (lettura, scrittura, LIST dei metadati, cancellazione) — con l'orologio
 * delle prove. Registra ogni richiesta (metodo, percorso, intestazioni utili) per guardare cosa esce.
 *
 * `giu = true` simula OpenBao spento: `fetch` lancia come undici quando la connessione è rifiutata.
 */
import { randomBytes } from "node:crypto";
import type { FetchSync } from "../../fetch-sync";
import { ErroreVault } from "../../tipi";

export interface RichiestaVista {
  metodo: string;
  percorso: string;
  token: string | null;
  utente: string | null;
  corpo: string | null;
}

export interface OpenBaoFinto {
  fetch: typeof fetch;
  /** La stessa logica, sincrona: per `OpenBaoStore.putSync/getSync` (config `fetchSync`) senza worker né rete. */
  fetchSync: FetchSync;
  kv: Map<string, Record<string, unknown>>;
  richieste: RichiestaVista[];
  giu: boolean;
  /** Se impostato, le scritture (POST/PUT su data) rispondono con questo stato e non scrivono (es. 403: policy senza `create`). */
  rifiutaScritture: number | null;
  /** Dopo questo numero di scritture riuscite le successive vengono rifiutate con 500 (null = mai). */
  scrittureAncoraPermesse: number | null;
  /** Durata dei token che il finto rilascia (lease_duration, secondi). */
  ttlSecondi: number;
  login: number;
  /** Revoca tutti i token (la prossima richiesta risponde 403). */
  revocaToken(): void;
  readonly roleId: string;
  readonly secretId: string;
  readonly url: string;
}

export function creaOpenBaoFinto(op: { ora: () => number; ttlSecondi?: number; mount?: string; url?: string }): OpenBaoFinto {
  const mount = op.mount ?? "kv-domarc";
  const token = new Map<string, number>();
  const roleId = `role-${randomBytes(4).toString("hex")}`;
  const secretId = `sid-${randomBytes(12).toString("hex")}`;
  const url = op.url ?? "https://openbao.prova:8200";

  const risp = (status: number, corpo: unknown): { status: number; corpo: unknown } => ({ status, corpo });
  const json = (status: number, corpo: unknown): Response =>
    new Response(corpo === null ? null : JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

  const finto: OpenBaoFinto = {
    kv: new Map(),
    richieste: [],
    giu: false,
    rifiutaScritture: null,
    scrittureAncoraPermesse: null,
    ttlSecondi: op.ttlSecondi ?? 3600,
    login: 0,
    roleId,
    secretId,
    url,
    revocaToken() {
      token.clear();
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (finto.giu) throw new TypeError("fetch failed");
      const r = gestisci(input, init);
      return json(r.status, r.corpo);
    }) as typeof fetch,
    fetchSync: (indirizzo, richiesta) => {
      if (finto.giu) throw new ErroreVault("non_raggiungibile", "OpenBao non risponde (TypeError)");
      const r = gestisci(indirizzo, { method: richiesta.method, headers: richiesta.headers, body: richiesta.body });
      return { status: r.status, testo: r.corpo === null ? "" : JSON.stringify(r.corpo) };
    },
  };
  return finto;

  function gestisci(input: RequestInfo | URL, init?: RequestInit): { status: number; corpo: unknown } {
    {
      const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const metodo = (init?.method ?? "GET").toUpperCase();
      const h = new Headers(init?.headers);
      const corpo = typeof init?.body === "string" ? init.body : null;
      finto.richieste.push({ metodo, percorso: u.pathname + u.search, token: h.get("x-vault-token"), utente: h.get("x-domarc-utente"), corpo });

      if (u.origin !== url) return risp(404, { errors: ["host sconosciuto"] });
      if (u.pathname === "/v1/auth/approle/login" && metodo === "POST") {
        let b: { role_id?: string; secret_id?: string } = {};
        try {
          b = JSON.parse(corpo ?? "{}") as typeof b;
        } catch {
          return risp(400, { errors: ["corpo non valido"] });
        }
        if (b.role_id !== roleId || b.secret_id !== secretId) return risp(400, { errors: ["invalid role or secret ID"] });
        finto.login += 1;
        const t = `hvs.${randomBytes(16).toString("hex")}`;
        token.set(t, op.ora() + finto.ttlSecondi * 1000);
        return risp(200, { auth: { client_token: t, lease_duration: finto.ttlSecondi, renewable: true } });
      }

      const t = h.get("x-vault-token");
      const scade = t ? token.get(t) : undefined;
      if (!t || scade === undefined || scade <= op.ora()) return risp(403, { errors: ["permission denied"] });

      const dati = `/v1/${mount}/data/`;
      const meta = `/v1/${mount}/metadata/`;
      if (u.pathname.startsWith(dati)) {
        const p = decodeURIComponent(u.pathname.slice(dati.length));
        if (metodo === "GET") {
          const v = finto.kv.get(p);
          if (!v) return risp(404, { errors: [] });
          return risp(200, { data: { data: v, metadata: { version: 1 } } });
        }
        if (metodo === "POST" || metodo === "PUT") {
          if (finto.rifiutaScritture !== null) return risp(finto.rifiutaScritture, { errors: ["permission denied"] });
          if (finto.scrittureAncoraPermesse !== null) {
            if (finto.scrittureAncoraPermesse <= 0) return risp(500, { errors: ["internal error"] });
            finto.scrittureAncoraPermesse -= 1;
          }
          let b: { data?: Record<string, unknown> } = {};
          try {
            b = JSON.parse(corpo ?? "{}") as typeof b;
          } catch {
            return risp(400, { errors: ["corpo non valido"] });
          }
          if (!b.data || typeof b.data !== "object") return risp(400, { errors: ["manca data"] });
          finto.kv.set(p, { ...b.data });
          return risp(200, { data: { version: 1 } });
        }
      }
      if (u.pathname.startsWith(meta)) {
        const p = decodeURIComponent(u.pathname.slice(meta.length)).replace(/\/$/, "");
        const elenco = metodo === "LIST" || (metodo === "GET" && u.searchParams.get("list") === "true");
        if (elenco) {
          const pref = p === "" ? "" : `${p}/`;
          const figli = new Set<string>();
          for (const k of finto.kv.keys()) {
            if (!k.startsWith(pref)) continue;
            const resto = k.slice(pref.length);
            const i = resto.indexOf("/");
            figli.add(i < 0 ? resto : `${resto.slice(0, i)}/`);
          }
          if (figli.size === 0) return risp(404, { errors: [] });
          return risp(200, { data: { keys: [...figli].sort() } });
        }
        if (metodo === "DELETE") {
          finto.kv.delete(p);
          return risp(204, null);
        }
      }
      return risp(405, { errors: ["metodo non previsto dal finto"] });
    }
  }
}

/**
 * Il finto dietro un server HTTP locale (porta scelta dal sistema), per provare le righe di comando che usano il
 * `fetch` vero. Restituisce l'URL e la chiusura.
 */
export async function servaOpenBaoFinto(op: { ora: () => number }): Promise<{ finto: OpenBaoFinto; url: string; chiudi: () => Promise<void> }> {
  const { createServer } = await import("node:http");
  let finto: OpenBaoFinto | null = null;
  const server = createServer((req, res) => {
    const parti: Buffer[] = [];
    req.on("data", (p: Buffer) => parti.push(p));
    req.on("end", () => {
      const corpo = parti.length ? Buffer.concat(parti).toString("utf8") : undefined;
      const intestazioni: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") intestazioni[k] = v;
      (finto as OpenBaoFinto)
        .fetch(`${(finto as OpenBaoFinto).url}${req.url ?? "/"}`, { method: req.method, headers: intestazioni, body: corpo })
        .then(async (r) => {
          res.writeHead(r.status, { "content-type": "application/json" });
          res.end(await r.text());
        })
        .catch(() => {
          res.writeHead(502);
          res.end();
        });
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const indirizzo = server.address();
  const porta = typeof indirizzo === "object" && indirizzo ? indirizzo.port : 0;
  const url = `http://127.0.0.1:${porta}`;
  finto = creaOpenBaoFinto({ ora: op.ora, url });
  return { finto, url, chiudi: () => new Promise<void>((ok) => server.close(() => ok())) };
}
