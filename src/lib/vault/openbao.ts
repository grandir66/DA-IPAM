/**
 * Backend `openbao` di `@domarc/vault` (piano da-vault 2026-10-23, passo 5): l'hub e le app interne TypeScript.
 *
 * - **Solo `fetch`**: nessun client di OpenBao in più. Il certificato della CA interna si dà al processo con
 *   `NODE_EXTRA_CA_CERTS` (l'unità systemd), non qui.
 * - **AppRole**: `role_id` dalla configurazione, `secret_id` letto quando serve (sull'appliance sta in
 *   `$CREDENTIALS_DIRECTORY`, sigillato sul TPM). Il token dura al massimo **20 minuti** (`DURATA_TOKEN_MS`) anche se
 *   OpenBao ne concede di più; un 403 rifà il login una volta e ripete la richiesta.
 * - **Cache in memoria a tempo**: `aggiorna()` carica la cartella dell'app (con le sottocartelle) e i percorsi in più
 *   (i `credentialRef` delle credenziali), ogni `aggiornaOgniMs`; le letture dell'app la usano senza una chiamata per
 *   scansione. `leggiSync` serve al lettore unico dei segreti, che è sincrono.
 * - **Niente ripieghi muti**: se OpenBao non risponde, la cache vale fino a `durataCacheMs` dall'ultimo giro buono
 *   (lo stato lo dice: «degradato»); oltre, ogni lettura è un `ErroreVault("non_raggiungibile")`.
 * - **Letture per conto di una persona** (la «mostra password»): `get(p, { perConto })` va sempre a OpenBao, manda
 *   `X-Domarc-Utente` (OpenBao lo scrive nel registro, `sys/config/auditing/request-headers`) e non usa la cache.
 *
 * Nessun messaggio contiene valori, token o secret_id.
 */
import { controllaPercorso, ErroreVault, percorsoValido, type OpzioniGet, type SecretStore, type StatoStore, type ValoreSegreto } from "./tipi";

export const DURATA_TOKEN_MS = 20 * 60_000;
/** Il token si rinnova un minuto prima della scadenza. */
const MARGINE_TOKEN_MS = 60_000;
const AGGIORNA_OGNI_MS = 5 * 60_000;
const DURATA_CACHE_MS = 30 * 60_000;
const TIMEOUT_MS = 10_000;
/** Un percorso che manca dalla cache fa partire un giro, ma non più di uno ogni 30 secondi (niente raffica). */
const RICARICA_PER_MANCANZA_OGNI_MS = 30_000;

export interface ConfigOpenBao {
  /** Es. `https://openbao.interno:8200` (senza `/v1`). */
  url: string;
  /** Il motore KV v2; di serie `kv-domarc`. */
  mount?: string;
  roleId: string;
  /** Letto a ogni login: il file può cambiare (rotazione del secret_id). */
  secretId: () => string;
  /** Le cartelle caricate nella cache (di solito `app/<app>`). */
  cartelle: string[];
  /**
   * Percorsi singoli caricati nella cache a ogni giro (i riferimenti delle credenziali). Una voce può dire anche da
   * dove viene (`origine`: es. «C70001#12», cliente e credenziale): un riferimento malformato si salta con un avviso
   * che nomina l'origine, senza far fallire il giro di tutte le altre.
   */
  percorsiExtra?: () => Array<string | { percorso: string; origine: string }>;
  aggiornaOgniMs?: number;
  durataCacheMs?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  ora?: () => number;
}

type Risposta = { status: number; corpo: unknown };

function testoValore(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function valoreDa(dati: unknown): ValoreSegreto {
  const out: Record<string, string> = {};
  if (dati && typeof dati === "object") {
    for (const [k, v] of Object.entries(dati as Record<string, unknown>)) {
      if (v === null || v === undefined) continue;
      out[k] = testoValore(v);
    }
  }
  return Object.freeze(out);
}

function minuti(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m === 1 ? "1 minuto" : `${m} minuti`;
}

export class OpenBaoStore implements SecretStore {
  readonly backend = "openbao" as const;
  private readonly c: Required<Omit<ConfigOpenBao, "percorsiExtra">> & Pick<ConfigOpenBao, "percorsiExtra">;
  private token: { valore: string; scade: number } | null = null;
  private cache = new Map<string, ValoreSegreto>();
  /** Ultimo giro andato a buon fine (ms); null = mai. */
  private caricatoAlle: number | null = null;
  private ultimoErrore: { alle: number; codice: string } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inCorso: Promise<void> | null = null;
  /** Riferimenti malformati saltati nell'ultimo giro (numero) e già segnalati nel log (per non ripetere l'avviso). */
  private saltati = 0;
  private saltatiSegnalati = new Set<string>();
  /** Ultimo giro fatto partire da un percorso mancante (ms); 0 = mai. */
  private ultimaRicaricaPerMancanza = 0;

  constructor(config: ConfigOpenBao) {
    this.c = {
      mount: "kv-domarc",
      aggiornaOgniMs: AGGIORNA_OGNI_MS,
      durataCacheMs: DURATA_CACHE_MS,
      timeoutMs: TIMEOUT_MS,
      fetch: globalThis.fetch.bind(globalThis),
      ora: Date.now,
      ...config,
      url: config.url.replace(/\/+$/, ""),
    };
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────

  private async richiesta(metodo: string, percorsoApi: string, op: { token?: string; corpo?: unknown; utente?: string } = {}): Promise<Risposta> {
    const intestazioni: Record<string, string> = { accept: "application/json" };
    if (op.token) intestazioni["X-Vault-Token"] = op.token;
    if (op.utente) intestazioni["X-Domarc-Utente"] = op.utente;
    if (op.corpo !== undefined) intestazioni["content-type"] = "application/json";
    let r: Response;
    try {
      r = await this.c.fetch(`${this.c.url}/v1/${percorsoApi}`, {
        method: metodo,
        headers: intestazioni,
        body: op.corpo === undefined ? undefined : JSON.stringify(op.corpo),
        signal: AbortSignal.timeout(this.c.timeoutMs),
      });
    } catch (e) {
      const tipo = e instanceof Error ? e.name : "errore";
      throw new ErroreVault("non_raggiungibile", `OpenBao non risponde (${tipo})`);
    }
    let corpo: unknown = null;
    const testo = await r.text().catch(() => "");
    if (testo) {
      try {
        corpo = JSON.parse(testo);
      } catch {
        corpo = null;
      }
    }
    return { status: r.status, corpo };
  }

  private async login(): Promise<string> {
    let secretId: string;
    try {
      secretId = this.c.secretId();
    } catch {
      // Il file del secret_id (credenziale di systemd) manca o non si legge: l'eccezione grezza porta il percorso, non si propaga.
      throw new ErroreVault("configurazione", "Il secret_id di OpenBao non è leggibile: file della credenziale mancante o senza permessi (configurazione dell'appliance)");
    }
    const r = await this.richiesta("POST", "auth/approle/login", { corpo: { role_id: this.c.roleId, secret_id: secretId } });
    const auth = (r.corpo as { auth?: { client_token?: unknown; lease_duration?: unknown } } | null)?.auth;
    if (r.status !== 200 || typeof auth?.client_token !== "string") {
      throw new ErroreVault("rifiutato", `OpenBao ha rifiutato il login AppRole (HTTP ${r.status})`);
    }
    const lease = typeof auth.lease_duration === "number" && auth.lease_duration > 0 ? auth.lease_duration * 1000 : DURATA_TOKEN_MS;
    this.token = { valore: auth.client_token, scade: this.c.ora() + Math.min(lease, DURATA_TOKEN_MS) };
    return this.token.valore;
  }

  private async tokenValido(): Promise<string> {
    if (this.token && this.c.ora() < this.token.scade - MARGINE_TOKEN_MS) return this.token.valore;
    return this.login();
  }

  /** Una richiesta col token; un 403 rifà il login una volta e ripete. */
  private async conToken(metodo: string, percorsoApi: string, op: { corpo?: unknown; utente?: string } = {}): Promise<Risposta> {
    const r = await this.richiesta(metodo, percorsoApi, { ...op, token: await this.tokenValido() });
    if (r.status !== 403) return r;
    this.token = null;
    return this.richiesta(metodo, percorsoApi, { ...op, token: await this.login() });
  }

  private apiDati(percorso: string): string {
    return `${this.c.mount}/data/${percorso.split("/").map(encodeURIComponent).join("/")}`;
  }

  private apiMeta(percorso: string): string {
    return `${this.c.mount}/metadata/${percorso.split("/").map(encodeURIComponent).join("/")}`;
  }

  /** Il segreto letto da OpenBao; null se non c'è (404). */
  private async leggiRemoto(percorso: string, utente?: string): Promise<ValoreSegreto | null> {
    const r = await this.conToken("GET", this.apiDati(percorso), { utente });
    if (r.status === 404) return null;
    if (r.status !== 200) throw new ErroreVault("rifiutato", `OpenBao ha rifiutato la lettura di «${percorso}» (HTTP ${r.status})`);
    const dati = (r.corpo as { data?: { data?: unknown } } | null)?.data?.data;
    return valoreDa(dati);
  }

  /** I figli diretti di una cartella (`nome` o `nome/`); [] se la cartella non c'è. */
  private async figli(cartella: string): Promise<string[]> {
    const r = await this.conToken("LIST", this.apiMeta(cartella));
    if (r.status === 404) return [];
    if (r.status !== 200) throw new ErroreVault("rifiutato", `OpenBao ha rifiutato l'elenco di «${cartella}» (HTTP ${r.status})`);
    const chiavi = (r.corpo as { data?: { keys?: unknown } } | null)?.data?.keys;
    return Array.isArray(chiavi) ? chiavi.filter((k): k is string => typeof k === "string") : [];
  }

  private async percorsiSotto(cartella: string): Promise<string[]> {
    const out: string[] = [];
    for (const f of await this.figli(cartella)) {
      if (f.endsWith("/")) out.push(...(await this.percorsiSotto(`${cartella}/${f.slice(0, -1)}`)));
      else out.push(`${cartella}/${f}`);
    }
    return out;
  }

  // ── Cache ─────────────────────────────────────────────────────────────────

  /** Un giro: ricarica cartelle e percorsi in più. Se fallisce la cache di prima resta (fino alla sua durata). */
  async aggiorna(): Promise<void> {
    if (this.inCorso) return this.inCorso;
    this.inCorso = (async () => {
      try {
        const nuova = new Map<string, ValoreSegreto>();
        for (const cartella of this.c.cartelle) {
          controllaPercorso(cartella);
          for (const p of await this.percorsiSotto(cartella)) {
            const v = await this.leggiRemoto(p);
            if (v) nuova.set(p, v);
          }
        }
        const extra = this.c.percorsiExtra ? this.c.percorsiExtra() : [];
        const visti = new Set<string>();
        let saltati = 0;
        for (const voce of extra) {
          const p = typeof voce === "string" ? voce : voce.percorso;
          if (visti.has(p)) continue;
          visti.add(p);
          if (nuova.has(p)) continue;
          // Un riferimento malformato in una voce non deve fermare la cache delle altre: si salta, si dice, si conta.
          if (!percorsoValido(p)) {
            saltati += 1;
            const origine = typeof voce === "string" ? "(origine non indicata)" : voce.origine;
            if (!this.saltatiSegnalati.has(origine)) {
              this.saltatiSegnalati.add(origine);
              console.warn(`[vault] OpenBao: riferimento non valido nella credenziale ${origine}: voce saltata, i suoi segreti non si leggono finché non si corregge`);
            }
            continue;
          }
          const v = await this.leggiRemoto(p);
          if (v) nuova.set(p, v);
        }
        this.saltati = saltati;
        this.cache = nuova;
        this.caricatoAlle = this.c.ora();
        this.ultimoErrore = null;
      } catch (e) {
        this.ultimoErrore = { alle: this.c.ora(), codice: e instanceof ErroreVault ? e.codice : "errore" };
        throw e;
      } finally {
        this.inCorso = null;
      }
    })();
    return this.inCorso;
  }

  /** La cache vale ancora? Lancia l'errore dichiarato se no. */
  private controllaCache(): void {
    if (this.caricatoAlle === null) {
      if (this.ultimoErrore) throw new ErroreVault("non_raggiungibile", "OpenBao non risponde e i segreti non sono mai stati caricati");
      throw new ErroreVault("non_pronto", "I segreti di OpenBao non sono ancora stati caricati");
    }
    const eta = this.c.ora() - this.caricatoAlle;
    if (eta > this.c.durataCacheMs) {
      throw new ErroreVault(
        "non_raggiungibile",
        `OpenBao non risponde da ${minuti(eta)}: la cache dei segreti (${minuti(this.c.durataCacheMs)}) è scaduta`,
      );
    }
  }

  /** Lettura dalla cache, sincrona: per il lettore unico dei segreti. */
  leggiSync(percorso: string): ValoreSegreto {
    controllaPercorso(percorso);
    this.controllaCache();
    const v = this.cache.get(percorso);
    if (v) return v;
    // Un riferimento nuovo (dopo `--applica` ad app accesa) non è in cache fino al giro successivo. La lettura è sincrona
    // e non può aspettare: dà l'errore dichiarato e fa partire UN giro, così la lettura dopo trova la voce. Il giro per
    // mancanza è uno alla volta e al più uno ogni 30 secondi. (Stessa correzione di DA-Vul-can, revisione PR #50.)
    const avviato = this.ricaricaPerMancanza();
    throw new ErroreVault(
      "non_trovato",
      avviato
        ? `Il segreto «${percorso}» non è in OpenBao (o non è ancora nella cache: ricaricamento avviato, riprova fra qualche secondo)`
        : `Il segreto «${percorso}» non è in OpenBao (o non è fra quelli caricati)`,
    );
  }

  /** true se un giro è in corso o è appena partito per questa mancanza; false se è troppo presto per un altro. */
  private ricaricaPerMancanza(): boolean {
    if (this.inCorso) return true;
    const ora = this.c.ora();
    if (this.ultimaRicaricaPerMancanza !== 0 && ora - this.ultimaRicaricaPerMancanza < RICARICA_PER_MANCANZA_OGNI_MS) return false;
    this.ultimaRicaricaPerMancanza = ora;
    this.aggiorna().catch((e: unknown) => {
      console.warn(`[vault] OpenBao: giro per un segreto mancante non riuscito (${e instanceof ErroreVault ? e.codice : "errore"})`);
    });
    return true;
  }

  // ── SecretStore ───────────────────────────────────────────────────────────

  async get(percorso: string, opzioni: OpzioniGet = {}): Promise<ValoreSegreto> {
    controllaPercorso(percorso);
    if (opzioni.perConto !== undefined) {
      const u = opzioni.perConto.trim();
      if (!u || /[\x00-\x1f\x7f]/.test(u) || u.length > 200) {
        throw new ErroreVault("configurazione", "Nome utente non valido per X-Domarc-Utente");
      }
      const id = opzioni.perContoId?.trim();
      if (opzioni.perContoId !== undefined && (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id))) {
        throw new ErroreVault("configurazione", "Id utente non valido per X-Domarc-Utente");
      }
      // L'intestazione HTTP è ASCII: il nome va percent-encoded (un «Ł» farebbe lanciare fetch, e l'errore diventerebbe un
      // finto «OpenBao non risponde»); l'id accanto dice chi è davvero anche se due persone si chiamano uguale.
      const intestazione = id ? `${encodeURIComponent(u)};id=${id}` : encodeURIComponent(u);
      const v = await this.leggiRemoto(percorso, intestazione);
      if (!v) throw new ErroreVault("non_trovato", `Il segreto «${percorso}» non è in OpenBao`);
      return v;
    }
    const inCache = this.cache.get(percorso);
    if (inCache && this.caricatoAlle !== null && this.c.ora() - this.caricatoAlle <= this.c.aggiornaOgniMs) return inCache;
    try {
      const v = await this.leggiRemoto(percorso);
      if (!v) throw new ErroreVault("non_trovato", `Il segreto «${percorso}» non è in OpenBao`);
      return v;
    } catch (e) {
      if (!(e instanceof ErroreVault) || e.codice !== "non_raggiungibile" || !inCache) throw e;
      this.controllaCache();
      return inCache;
    }
  }

  async put(percorso: string, valore: ValoreSegreto): Promise<void> {
    controllaPercorso(percorso);
    const r = await this.conToken("POST", this.apiDati(percorso), { corpo: { data: { ...valore } } });
    if (r.status !== 200 && r.status !== 204) throw new ErroreVault("rifiutato", `OpenBao ha rifiutato la scrittura di «${percorso}» (HTTP ${r.status})`);
    if (this.cache.has(percorso)) this.cache.set(percorso, valoreDa(valore));
  }

  async list(prefisso: string): Promise<string[]> {
    controllaPercorso(prefisso);
    return (await this.percorsiSotto(prefisso)).sort();
  }

  async delete(percorso: string): Promise<void> {
    controllaPercorso(percorso);
    const r = await this.conToken("DELETE", this.apiMeta(percorso));
    if (r.status !== 204 && r.status !== 200 && r.status !== 404) {
      throw new ErroreVault("rifiutato", `OpenBao ha rifiutato la cancellazione di «${percorso}» (HTTP ${r.status})`);
    }
    this.cache.delete(percorso);
  }

  stato(): StatoStore {
    try {
      this.controllaCache();
    } catch (e) {
      return { pronto: false, motivo: e instanceof Error ? e.message : "OpenBao non pronto" };
    }
    const saltati = this.saltati > 0 ? { riferimentiSaltati: this.saltati } : {};
    const testoSaltati = this.saltati > 0 ? `${this.saltati} riferimenti di credenziali non validi saltati (il log del servizio dice quali)` : null;
    if (this.ultimoErrore) {
      return {
        pronto: true,
        aggiornatoAlle: this.caricatoAlle,
        degradato:
          `OpenBao non risponde dall'ultimo giro: si usano i segreti caricati ${minuti(this.c.ora() - (this.caricatoAlle ?? 0))} fa` +
          (testoSaltati ? `; ${testoSaltati}` : ""),
        ...saltati,
      };
    }
    if (testoSaltati) return { pronto: true, aggiornatoAlle: this.caricatoAlle, degradato: testoSaltati, ...saltati };
    return { pronto: true, aggiornatoAlle: this.caricatoAlle };
  }

  /** Avvia i giri periodici (il primo subito). Gli errori si scrivono nel log col solo codice. Restituisce lo stop. */
  avvia(): () => void {
    const giro = () => {
      this.aggiorna().catch((e: unknown) => {
        console.warn(`[vault] OpenBao: giro della cache non riuscito (${e instanceof ErroreVault ? e.codice : "errore"})`);
      });
    };
    giro();
    this.timer = setInterval(giro, this.c.aggiornaOgniMs);
    this.timer.unref?.();
    return () => {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    };
  }
}
