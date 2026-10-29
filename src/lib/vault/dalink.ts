/**
 * Backend `dalink` del vault (vault semplice, passo 6: piano DA-Link `2026-10-29-vault-passo6-app.md`): l'hub chiede le
 * password a DA-Link invece che a OpenBao, dietro la stessa interfaccia `SecretStore`. Contratto delle rotte: DA-Link
 * `docs/superpowers/specs/2026-10-27-vault-gettone-app-design.md` e `dalink/api/vault_app.py`.
 *
 * - **Trasporto**: `richiestaDalink` (`src/lib/dalink/trasporto.ts`), la stessa del segnale di vita: il certificato della
 *   8443 è autofirmato e l'autorità è la sua impronta SPKI (`DALINK_VAULT_IMPRONTA`), controllata PRIMA di scrivere un
 *   byte. Niente `NODE_EXTRA_CA_CERTS`; la verifica non si spegne mai.
 * - **Gettone** (`dlv_…`) solo in `Authorization: Bearer`: mai in un log, in un errore, in `stato()`.
 * - **Cache in memoria**: `aggiorna()` = `GET /api/v1/vault/ambito` (tutte le voci dell'ambito dell'app coi valori e la
 *   versione), ogni 5 minuti. La cache vale **24 ore** dall'ultimo giro riuscito (decisione di Riccardo del 27/10), poi
 *   le letture sono `ErroreVault("non_raggiungibile")`. Un giro fallito (503, rete, tempo, certificato, risposta
 *   illeggibile) tiene quello che c'è: una cache vuota sostituisce una piena solo con un 200 che dice 0 voci. Una voce
 *   illeggibile per forma dentro un 200 non tocca quella che la cache aveva per lo stesso percorso; se tutte le voci
 *   ricevute (almeno una) sono illeggibili il giro è una «risposta malformata» e fallisce. Un giro in volo non
 *   sovrascrive le voci che `put`/`delete` hanno cambiato dopo la sua partenza.
 * - **`get(p, { perConto })`** (la «mostra password»): sempre `GET /api/v1/vault/voce`, mai la cache. Chi ha guardato
 *   lo scrive il registro dell'app (`registraVisualizzazione`); DA-Link registra l'app.
 * - **`put`/`delete`**: `versione_attesa` sempre valorizzata, dalla cache (0 per una voce che la cache non ha). Un 409
 *   ricarica la voce e rifiuta con un messaggio chiaro, senza un secondo tentativo; un successo aggiorna la cache.
 *   `delete` di una voce che DA-Link non ha (404) è riuscito: l'effetto voluto c'è già (idempotente).
 * - **Errori HTTP** → `ErroreVault`: 401 configurazione (gettone rifiutato), 404 non_trovato, 409 rifiutato, 400
 *   percorso_non_valido, 413/422 rifiutato, 503 e 5xx non_raggiungibile. Il corpo delle risposte non entra mai nei
 *   messaggi: solo lo stato HTTP e il percorso.
 */
import { ErroreDalink, richiestaDalink } from "@/lib/dalink/trasporto";
import { controllaPercorso, ErroreVault, percorsoValido, type OpzioniGet, type SecretStore, type StatoStore, type ValoreSegreto } from "./tipi";

const AGGIORNA_OGNI_MS = 5 * 60_000;
const DURATA_CACHE_MS = 24 * 60 * 60_000;
const TIMEOUT_MS = 15_000;
/** Il giro dell'ambito porta tutte le voci dell'app coi valori: ben oltre i 64 KB del segnale. */
const MAX_AMBITO = 8 * 1024 * 1024;
/** Una voce: DA-Link accetta scritture fino a 64 KB. */
const MAX_VOCE = 256 * 1024;
/** Una voce che manca dalla cache fa partire un giro, ma non più di uno ogni 30 secondi (come `OpenBaoStore`). */
const RICARICA_PER_MANCANZA_OGNI_MS = 30_000;
const API = "/api/v1/vault";

export interface ConfigDaLink {
  /** Es. `https://192.168.4.44:8443` (senza `/api`). */
  url: string | URL;
  /** Il gettone dell'app (`dlv_…`). */
  gettone: string;
  /** Impronta SPKI del certificato della 8443, forma di DA-IPAM `sha256/<base64>` (`normalizzaImpronta`). */
  impronta: string;
  aggiornaOgniMs?: number;
  durataCacheMs?: number;
  timeoutMs?: number;
  ora?: () => number;
}

interface Voce {
  valore: ValoreSegreto;
  versione: number;
}

type Risposta = { status: number; corpo: unknown };

function valoreDa(dati: Record<string, unknown>): ValoreSegreto {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(dati)) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
  }
  return Object.freeze(out);
}

function oggetto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function versioneValida(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

/** `{valori: {…}, versione: n}` come lo dà DA-Link; null se non è in quella forma. */
function voceDa(v: unknown): Voce | null {
  if (!oggetto(v) || !oggetto(v.valori) || !versioneValida(v.versione)) return null;
  return { valore: valoreDa(v.valori), versione: v.versione };
}

function durata(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 120) return m === 1 ? "1 minuto" : `${m} minuti`;
  const h = Math.round(m / 60);
  return `${h} ore`;
}

/** Lo stato HTTP di un rifiuto → l'errore dichiarato. `cosa` = «la lettura di «p»», ecc.; mai il corpo. */
function erroreHttp(status: number, cosa: string): ErroreVault {
  if (status === 401) return new ErroreVault("configurazione", `DA-Link ha rifiutato ${cosa}: gettone di DA-Link rifiutato (DALINK_VAULT_GETTONE)`);
  if (status === 404) return new ErroreVault("non_trovato", `DA-Link ha risposto che non c'è (${cosa}, HTTP 404)`);
  if (status === 400) return new ErroreVault("percorso_non_valido", `DA-Link ha rifiutato il percorso (${cosa}, HTTP 400)`);
  if (status === 503) return new ErroreVault("non_raggiungibile", `Il vault di DA-Link non è disponibile (${cosa}, HTTP 503)`);
  if (status >= 500) return new ErroreVault("non_raggiungibile", `DA-Link ha dato un errore interno (${cosa}, HTTP ${status})`);
  return new ErroreVault("rifiutato", `DA-Link ha rifiutato ${cosa} (HTTP ${status})`);
}

export class DaLinkStore implements SecretStore {
  readonly backend = "dalink" as const;
  private readonly c: Required<Omit<ConfigDaLink, "url">> & { url: string };
  private cache = new Map<string, Voce>();
  /** Ultimo giro andato a buon fine (ms); null = mai. */
  private caricatoAlle: number | null = null;
  /** L'ultimo giro fallito: il messaggio è nostro (mai corpo né gettone). */
  private ultimoErrore: { alle: number; codice: string; messaggio: string } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inCorso: Promise<void> | null = null;
  private ultimaRicaricaPerMancanza = 0;
  /**
   * I percorsi che `put`/`delete`/la ricarica dopo un conflitto hanno cambiato mentre un giro è in volo (null = nessun
   * giro in volo): il giro, partito prima, ha una fotografia più vecchia e per questi tiene la cache com'è ora.
   */
  private toccatiDuranteIlGiro: Set<string> | null = null;

  constructor(config: ConfigDaLink) {
    this.c = {
      aggiornaOgniMs: AGGIORNA_OGNI_MS,
      durataCacheMs: DURATA_CACHE_MS,
      timeoutMs: TIMEOUT_MS,
      ora: Date.now,
      ...config,
      url: String(config.url).replace(/\/+$/, ""),
    };
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────

  private async richiesta(metodo: string, percorsoApi: string, op: { corpo?: unknown; max?: number } = {}): Promise<Risposta> {
    const intestazioni: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${this.c.gettone}` };
    if (op.corpo !== undefined) intestazioni["Content-Type"] = "application/json";
    let r: { status: number; body: string };
    try {
      r = await richiestaDalink(
        new URL(`${this.c.url}${API}${percorsoApi}`),
        this.c.impronta,
        metodo,
        intestazioni,
        op.corpo === undefined ? undefined : JSON.stringify(op.corpo),
        { timeoutMs: this.c.timeoutMs, maxRisposta: op.max ?? MAX_VOCE },
      );
    } catch (e) {
      if (e instanceof ErroreDalink) {
        if (e.tipo === "cert") {
          throw new ErroreVault("configurazione", "Certificato di DA-Link cambiato: non corrisponde a DALINK_VAULT_IMPRONTA, niente inviato");
        }
        if (e.tipo === "tempo") throw new ErroreVault("non_raggiungibile", "DA-Link non ha risposto in tempo");
        if (e.tipo === "risposta") throw new ErroreVault("non_raggiungibile", "La risposta di DA-Link non si legge (troppo grande o interrotta)");
        throw new ErroreVault("non_raggiungibile", e.message);
      }
      throw new ErroreVault("non_raggiungibile", `DA-Link non risponde (${e instanceof Error ? e.name : "errore"})`);
    }
    let corpo: unknown = null;
    if (r.body) {
      try {
        corpo = JSON.parse(r.body);
      } catch {
        corpo = undefined; // illeggibile: chi aspetta un corpo lo rifiuta
      }
    }
    return { status: r.status, corpo };
  }

  private static q(percorso: string, versioneAttesa?: number): string {
    const v = versioneAttesa === undefined ? "" : `&versione_attesa=${versioneAttesa}`;
    return `/voce?percorso=${encodeURIComponent(percorso)}${v}`;
  }

  /** La voce letta da DA-Link (`GET /voce`), senza cache. */
  private async leggiRemoto(percorso: string): Promise<Voce> {
    const r = await this.richiesta("GET", DaLinkStore.q(percorso));
    if (r.status !== 200) throw erroreHttp(r.status, `la lettura di «${percorso}»`);
    const v = voceDa(r.corpo);
    if (!v) throw new ErroreVault("non_raggiungibile", `La risposta di DA-Link per «${percorso}» non è nella forma attesa`);
    return v;
  }

  /** Dopo un 409: rilegge la voce e allinea la cache. Un errore qui non copre il conflitto (va nel log col codice). */
  private async ricaricaVoce(percorso: string): Promise<void> {
    try {
      this.scriviInCache(percorso, await this.leggiRemoto(percorso));
    } catch (e) {
      if (e instanceof ErroreVault && e.codice === "non_trovato") {
        this.scriviInCache(percorso, null);
        return;
      }
      console.warn(`[vault] DA-Link: voce «${percorso}» non ricaricata dopo un conflitto (${e instanceof ErroreVault ? e.codice : "errore"})`);
    }
  }

  private conflitto(percorso: string, cosa: string): ErroreVault {
    return new ErroreVault(
      "rifiutato",
      `La voce «${percorso}» è cambiata in DA-Link dopo l'ultima lettura (conflitto di versione): ${cosa} non fatta, voce ricaricata; riprova sui valori nuovi`,
    );
  }

  // ── Cache ─────────────────────────────────────────────────────────────────

  /** Un cambio alla cache dovuto a una scrittura o a una rilettura puntuale (`null` = la voce esce). */
  private scriviInCache(percorso: string, voce: Voce | null): void {
    if (voce) this.cache.set(percorso, voce);
    else this.cache.delete(percorso);
    this.toccatiDuranteIlGiro?.add(percorso);
  }

  /** Un giro: `GET /ambito`. Se fallisce la cache di prima resta (fino alla sua durata). */
  async aggiorna(): Promise<void> {
    if (this.inCorso) return this.inCorso;
    this.toccatiDuranteIlGiro = new Set();
    this.inCorso = (async () => {
      try {
        const r = await this.richiesta("GET", "/ambito", { max: MAX_AMBITO });
        if (r.status !== 200) throw erroreHttp(r.status, "il giro dell'ambito");
        const voci = oggetto(r.corpo) ? r.corpo.voci : undefined;
        if (!oggetto(voci)) throw new ErroreVault("non_raggiungibile", "La risposta di DA-Link al giro dell'ambito non è nella forma attesa: cache di prima tenuta");
        const nuova = new Map<string, Voce>();
        let scartate = 0;
        let illeggibili = 0;
        let ricevute = 0;
        for (const [p, grezza] of Object.entries(voci)) {
          ricevute += 1;
          const v = voceDa(grezza);
          if (!v) {
            illeggibili += 1;
            // Illeggibile per forma: la voce che la cache aveva per questo percorso (se il percorso è valido) non si tocca.
            const prima = percorsoValido(p) ? this.cache.get(p) : undefined;
            if (prima) nuova.set(p, prima);
            continue;
          }
          if (!percorsoValido(p)) {
            scartate += 1;
            continue;
          }
          nuova.set(p, v);
        }
        if (ricevute > 0 && illeggibili === ricevute) {
          throw new ErroreVault("non_raggiungibile", "La risposta di DA-Link al giro dell'ambito non è nella forma attesa (nessuna voce leggibile): cache di prima tenuta");
        }
        if (illeggibili + scartate > 0) console.warn(`[vault] DA-Link: ${illeggibili + scartate} voci dell'ambito non nella forma attesa, saltate`);
        // Quello che l'app ha scritto o cancellato dopo la partenza del giro vale più della fotografia del giro.
        for (const p of this.toccatiDuranteIlGiro ?? []) {
          const adesso = this.cache.get(p);
          if (adesso) nuova.set(p, adesso);
          else nuova.delete(p);
        }
        this.cache = nuova;
        this.caricatoAlle = this.c.ora();
        this.ultimoErrore = null;
      } catch (e) {
        const ev = e instanceof ErroreVault ? e : new ErroreVault("non_raggiungibile", "DA-Link non risponde");
        this.ultimoErrore = { alle: this.c.ora(), codice: ev.codice, messaggio: ev.message };
        throw ev;
      } finally {
        this.inCorso = null;
        this.toccatiDuranteIlGiro = null;
      }
    })();
    return this.inCorso;
  }

  /** La cache vale ancora? Lancia l'errore dichiarato se no. */
  private controllaCache(): void {
    if (this.caricatoAlle === null) {
      if (this.ultimoErrore) {
        throw new ErroreVault("non_raggiungibile", `I segreti di DA-Link non sono mai stati caricati: ${this.ultimoErrore.messaggio}`);
      }
      throw new ErroreVault("non_pronto", "I segreti di DA-Link non sono ancora stati caricati");
    }
    const eta = this.c.ora() - this.caricatoAlle;
    if (eta > this.c.durataCacheMs) {
      throw new ErroreVault(
        "non_raggiungibile",
        `DA-Link non risponde da ${durata(eta)}: la cache dei segreti (${durata(this.c.durataCacheMs)}) è scaduta` +
          (this.ultimoErrore ? ` (${this.ultimoErrore.messaggio})` : ""),
      );
    }
  }

  /** Lettura dalla cache, sincrona: per il lettore unico dei segreti. */
  leggiSync(percorso: string): ValoreSegreto {
    controllaPercorso(percorso);
    this.controllaCache();
    const v = this.cache.get(percorso);
    if (v) return v.valore;
    // Una voce scritta in DA-Link ad app accesa non è in cache fino al giro dopo: errore dichiarato e UN giro (al più uno
    // ogni 30 secondi), come `OpenBaoStore`.
    const avviato = this.ricaricaPerMancanza();
    throw new ErroreVault(
      "non_trovato",
      avviato
        ? `Il segreto «${percorso}» non è in DA-Link (o non è ancora nella cache: ricaricamento avviato, riprova fra qualche secondo)`
        : `Il segreto «${percorso}» non è in DA-Link (o non è fra quelli caricati)`,
    );
  }

  private ricaricaPerMancanza(): boolean {
    if (this.inCorso) return true;
    const ora = this.c.ora();
    if (this.ultimaRicaricaPerMancanza !== 0 && ora - this.ultimaRicaricaPerMancanza < RICARICA_PER_MANCANZA_OGNI_MS) return false;
    this.ultimaRicaricaPerMancanza = ora;
    this.aggiorna().catch((e: unknown) => {
      console.warn(`[vault] DA-Link: giro per un segreto mancante non riuscito (${e instanceof ErroreVault ? e.codice : "errore"})`);
    });
    return true;
  }

  // ── SecretStore ───────────────────────────────────────────────────────────

  async get(percorso: string, opzioni: OpzioniGet = {}): Promise<ValoreSegreto> {
    controllaPercorso(percorso);
    // Per conto di una persona: sempre da DA-Link, nessun ripiego sulla cache e nessuna scrittura in cache.
    if (opzioni.perConto !== undefined) return (await this.leggiRemoto(percorso)).valore;
    const inCache = this.cache.get(percorso);
    if (inCache && this.caricatoAlle !== null && this.c.ora() - this.caricatoAlle <= this.c.aggiornaOgniMs) return inCache.valore;
    try {
      const v = await this.leggiRemoto(percorso);
      this.scriviInCache(percorso, v);
      return v.valore;
    } catch (e) {
      if (e instanceof ErroreVault && e.codice === "non_trovato") this.scriviInCache(percorso, null);
      if (!(e instanceof ErroreVault) || e.codice !== "non_raggiungibile" || !inCache) throw e;
      this.controllaCache();
      return inCache.valore;
    }
  }

  async put(percorso: string, valore: ValoreSegreto): Promise<void> {
    controllaPercorso(percorso);
    const versioneAttesa = this.cache.get(percorso)?.versione ?? 0;
    const r = await this.richiesta("PUT", "/voce", { corpo: { percorso, valori: { ...valore }, versione_attesa: versioneAttesa } });
    if (r.status === 409) {
      await this.ricaricaVoce(percorso);
      throw this.conflitto(percorso, "la scrittura");
    }
    if (r.status !== 200) throw erroreHttp(r.status, `la scrittura di «${percorso}»`);
    const versione = oggetto(r.corpo) ? r.corpo.versione : undefined;
    if (!versioneValida(versione)) {
      // La scrittura è avvenuta ma la versione non si legge: la voce esce dalla cache, la riporta il giro che parte ora.
      this.scriviInCache(percorso, null);
      console.warn(`[vault] DA-Link: scrittura di «${percorso}» riuscita ma senza versione leggibile: cache ricaricata`);
      this.aggiorna().catch(() => undefined);
      return;
    }
    this.scriviInCache(percorso, { valore: valoreDa(valore), versione });
  }

  async list(prefisso: string): Promise<string[]> {
    controllaPercorso(prefisso);
    this.controllaCache();
    const sotto = `${prefisso}/`;
    return [...this.cache.keys()].filter((p) => p.startsWith(sotto)).sort();
  }

  async delete(percorso: string): Promise<void> {
    controllaPercorso(percorso);
    const versioneAttesa = this.cache.get(percorso)?.versione ?? 0;
    const r = await this.richiesta("DELETE", DaLinkStore.q(percorso, versioneAttesa));
    if (r.status === 409) {
      await this.ricaricaVoce(percorso);
      throw this.conflitto(percorso, "la cancellazione");
    }
    // 404 = DA-Link non ha la voce (già cancellata, o mai stata nell'ambito): l'effetto voluto c'è già, cancellare è idempotente.
    if (r.status !== 204 && r.status !== 200 && r.status !== 404) throw erroreHttp(r.status, `la cancellazione di «${percorso}»`);
    this.scriviInCache(percorso, null);
  }

  stato(): StatoStore {
    try {
      this.controllaCache();
    } catch (e) {
      return { pronto: false, motivo: e instanceof Error ? e.message : "DA-Link non pronto" };
    }
    if (this.ultimoErrore) {
      return {
        pronto: true,
        aggiornatoAlle: this.caricatoAlle,
        degradato: `DA-Link non risponde dall'ultimo giro (${this.ultimoErrore.messaggio}): si usano i segreti caricati ${durata(this.c.ora() - (this.caricatoAlle ?? 0))} fa`,
      };
    }
    return { pronto: true, aggiornatoAlle: this.caricatoAlle };
  }

  /** Avvia i giri periodici (il primo subito). Gli errori vanno nel log col solo codice. Restituisce lo stop. */
  avvia(): () => void {
    const giro = () => {
      this.aggiorna().catch((e: unknown) => {
        console.warn(`[vault] DA-Link: giro della cache non riuscito (${e instanceof ErroreVault ? e.codice : "errore"})`);
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
