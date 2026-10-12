/**
 * Verifica dei permessi dal di fuori (T3-30): i casi e il giudizio sulle risposte.
 *
 * Il censimento (`rotte.ts`) dice quale guardia ha ogni gestore leggendo il
 * codice; questa verifica chiede all'applicazione accesa, come farebbe un
 * browser, e guarda cosa risponde. Serve perché uno strato prima del gestore
 * (il middleware) o una rotta che fa qualcosa prima della guardia non si vedono
 * nel codice provato.
 *
 * Tre domande, solo GET:
 * - **anonimo**: ogni lettura non pubblica rifiuta chi non ha una sessione
 *   (401, o rinvio alla pagina di accesso);
 * - **viewer, rifiuto**: ogni lettura che il censimento vuole da admin in su, e
 *   che ha davvero la guardia admin, risponde 403 a un utente in sola lettura.
 *   Si scelgono solo queste perché la guardia viene prima di tutto: il gestore
 *   non arriva a fare niente;
 * - **viewer, senza segreti**: le letture aperte al viewer che toccano segreti
 *   (configurazione delle integrazioni, SEC-5) rispondono senza i valori, e
 *   l'accesso automatico a LibreNMS non consegna i suoi cookie (SEC-6).
 *
 * Modulo puro: niente rete, niente database. Lo usa `scripts/verifica-permessi.ts`
 * contro l'applicazione accesa in locale; la prova
 * `__tests__/verifica-esterna.test.ts` lo esercita con risposte della forma vera,
 * vecchie (che devono fallire) e nuove.
 */
import { CAMPI_SEGRETI_INTEGRAZIONE } from "./politica";
import { eConsentita, type Consentiti, type Valutazione } from "./rotte";

export type Chi = "anonimo" | "viewer";
export type Attesa = "rifiuto-anonimo" | "rifiuto-viewer" | "config-senza-segreti" | "accesso-automatico-negato";

export interface Caso {
  chi: Chi;
  /** Sempre GET: la verifica non scrive. */
  metodo: "GET";
  percorso: string;
  attesa: Attesa;
  /** Rotta del censimento da cui nasce il caso, o il codice del difetto. */
  origine: string;
}

export interface Risposta {
  status: number;
  /** Intestazione Location, se c'è. */
  location: string | null;
  /** Tutte le intestazioni Set-Cookie. */
  setCookie: string[];
  corpo: string;
}

export type Esito = "ok" | "ko" | "non-provato";

export interface Giudizio {
  esito: Esito;
  nota: string;
}

const LIVELLI_ADMIN = new Set(["admin", "admin-o-onboarding", "superadmin"]);
const GUARDIE_ADMIN = new Set(["admin", "admin-o-onboarding", "superadmin"]);

/**
 * Percorso chiamabile da una rotta del censimento: un segmento dinamico diventa
 * `0` (la guardia viene prima della ricerca, quindi basta un valore qualsiasi),
 * un segmento facoltativo «tutto il resto» sparisce.
 */
export function percorsoConcreto(rotta: string): string {
  return rotta
    .split("/")
    .filter((s) => !/^\[\[\.\.\..+\]\]$/.test(s))
    .map((s) => (/^\[.+\]$/.test(s) ? "0" : s))
    .join("/");
}

/** Integrazioni la cui configurazione un viewer legge (e che non deve contenere segreti). */
export const INTEGRAZIONI_LEGGIBILI = ["librenms", "graylog", "loki", "unifi"] as const;

/** Casi che non nascono dal censimento: le letture «mascherate» con segreti dietro. */
export const CASI_SEGRETI: Caso[] = [
  ...INTEGRAZIONI_LEGGIBILI.map(
    (c): Caso => ({
      chi: "viewer",
      metodo: "GET",
      percorso: `/api/integrations/${c}`,
      attesa: "config-senza-segreti",
      origine: "SEC-5",
    }),
  ),
  {
    chi: "viewer",
    metodo: "GET",
    percorso: "/api/integrations/librenms/sso",
    attesa: "accesso-automatico-negato",
    origine: "SEC-6",
  },
];

/**
 * Tutti i casi: dal censimento (anonimo su ogni lettura non pubblica; viewer
 * sulle letture con guardia admin) più quelli dei segreti. Solo GET.
 */
export function casiDiVerifica(valutazioni: readonly Valutazione[], consentiti: Consentiti): Caso[] {
  const casi: Caso[] = [];
  const visti = new Set<string>();
  const aggiungi = (c: Caso) => {
    const k = `${c.chi} ${c.percorso}`;
    if (visti.has(k)) return;
    visti.add(k);
    casi.push(c);
  };
  for (const v of valutazioni) {
    if (v.metodo !== "GET") continue;
    if (eConsentita(v.rotta, consentiti)) continue;
    const percorso = percorsoConcreto(v.rotta);
    aggiungi({ chi: "anonimo", metodo: "GET", percorso, attesa: "rifiuto-anonimo", origine: v.rotta });
    if (LIVELLI_ADMIN.has(v.atteso) && GUARDIE_ADMIN.has(v.guardia)) {
      aggiungi({ chi: "viewer", metodo: "GET", percorso, attesa: "rifiuto-viewer", origine: v.rotta });
    }
  }
  for (const c of CASI_SEGRETI) aggiungi(c);
  return casi;
}

/** Rinvio alla pagina di accesso: è come il middleware rifiuta chi non ha sessione. */
function rinvioAlLogin(r: Risposta): boolean {
  if (r.status < 300 || r.status >= 400 || !r.location) return false;
  try {
    return new URL(r.location, "http://x").pathname === "/login";
  } catch {
    return false;
  }
}

function leggiJson(corpo: string): unknown {
  try {
    return JSON.parse(corpo);
  } catch {
    return undefined;
  }
}

/** Cookie dell'accesso automatico a LibreNMS. */
const COOKIE_LIBRENMS = /^\s*(laravel_session|XSRF-TOKEN)=/i;

/** Giudica la risposta a un caso. Mai muto: ogni esito dice perché. */
export function giudica(caso: Caso, r: Risposta): Giudizio {
  switch (caso.attesa) {
    case "rifiuto-anonimo":
      if (r.status === 401) return { esito: "ok", nota: "401" };
      if (rinvioAlLogin(r)) return { esito: "ok", nota: `${r.status} verso la pagina di accesso` };
      return { esito: "ko", nota: `senza sessione risponde ${r.status}` };

    case "rifiuto-viewer":
      if (r.status === 403) return { esito: "ok", nota: "403" };
      if (r.status === 401 || rinvioAlLogin(r)) {
        return { esito: "ko", nota: `${r.status}: la sessione del viewer non è valida, il caso non prova il ruolo` };
      }
      return { esito: "ko", nota: `il viewer riceve ${r.status} invece di 403` };

    case "config-senza-segreti": {
      if (r.status !== 200) return { esito: "ko", nota: `il viewer riceve ${r.status} invece di 200` };
      const j = leggiJson(r.corpo);
      const cfg = j && typeof j === "object" ? (j as { config?: unknown }).config : undefined;
      if (!cfg || typeof cfg !== "object") return { esito: "ko", nota: "risposta senza il campo config" };
      const c = cfg as Record<string, unknown>;
      const pieni = CAMPI_SEGRETI_INTEGRAZIONE.filter((k) => typeof c[k] === "string" && (c[k] as string) !== "");
      if (pieni.length) return { esito: "ko", nota: `segreti consegnati al viewer: ${pieni.join(", ")}` };
      // I flag «impostato» provano che la maschera è passata: senza, una
      // configurazione vuota passerebbe anche col codice vecchio.
      const senzaFlag = CAMPI_SEGRETI_INTEGRAZIONE.filter((k) => typeof c[`${k}Set`] !== "boolean");
      if (senzaFlag.length) return { esito: "ko", nota: `configurazione non mascherata (manca ${senzaFlag.map((k) => `${k}Set`).join(", ")})` };
      return { esito: "ok", nota: "segreti vuoti, flag «impostato» presenti" };
    }

    case "accesso-automatico-negato": {
      const consegnati = r.setCookie.filter((c) => COOKIE_LIBRENMS.test(c));
      if (consegnati.length) return { esito: "ko", nota: "il viewer riceve i cookie dell'accesso automatico" };
      if (r.status === 404) return { esito: "non-provato", nota: "LibreNMS non configurato qui: nessun accesso automatico da negare" };
      if (r.status >= 300 && r.status < 400) return { esito: "ok", nota: `${r.status} all'indirizzo diretto, senza cookie` };
      return { esito: "ko", nota: `risposta inattesa ${r.status}` };
    }
  }
}

/** Riepilogo per la riga finale e il codice d'uscita: ko > 0 → la verifica fallisce. */
export function riepiloga(giudizi: readonly Giudizio[]): Record<Esito, number> {
  const out: Record<Esito, number> = { ok: 0, ko: 0, "non-provato": 0 };
  for (const g of giudizi) out[g.esito]++;
  return out;
}
