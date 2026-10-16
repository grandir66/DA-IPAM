/**
 * Censimento delle guardie di tutte le rotte API (T3-24).
 *
 * Ogni gestore HTTP sotto `src/app/api` deve avere una guardia almeno pari a
 * quella attesa, oppure stare in uno di due elenchi:
 * - `ECCEZIONI`: la guardia è più debole del predefinito **per scelta**, col
 *   motivo (e, per una lettura «mascherata», la prova che lo dimostra);
 * - `DEBITI`: la guardia è più debole di quella giusta e va alzata; ogni debito
 *   porta il codice del difetto che lo chiude.
 *
 * Livello atteso: GET/HEAD/OPTIONS → `auth`; scritture → `admin`; le letture
 * con un nome sensibile (`SENSIBILE`) → `admin`; `ATTESI` dichiara il livello
 * giusto dove il predefinito non basta o non vale (una volta scritto qui, togliere
 * un debito senza alzare la guardia non fa tornare verde la prova).
 *
 * La prova `src/lib/permessi/__tests__/rotte-censite.test.ts` fallisce quando:
 * un gestore nuovo è sotto il livello e non è dichiarato; un'eccezione non serve
 * più o la guardia è cambiata; un debito è stato sanato (si toglie dall'elenco);
 * una voce cita una rotta o un metodo che non esiste; un gestore senza sessione
 * non è fra quelli consentiti da `src/lib/auth.config.ts`.
 *
 * Non ridichiara ciò che provano già `src/lib/__tests__/api-auth-guards.test.ts`
 * (guardie puntuali) e `src/lib/users/__tests__/routes-use-service.test.ts`
 * (rotte degli utenti): copre il resto con le regole generali.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { FORZA_GUARDIA, rilevaGestori, type GestoreRilevato, type Guardia, type MetodoHttp } from "./rilevatore-guardie";

export type LivelloAtteso = "auth" | "admin-o-onboarding" | "admin" | "superadmin";

const SCRITTURE: ReadonlySet<MetodoHttp> = new Set<MetodoHttp>(["POST", "PUT", "PATCH", "DELETE"]);

/** Letture che dal nome toccano credenziali, segreti, prove verso l'esterno o esportazioni. */
export const SENSIBILE = /(test-|\/credentials|secret|password|decrypt|for_edit|\/export)/i;

/** Guardie che non chiedono una sessione: ammesse solo dove `auth.config.ts` lascia passare. */
export const SENZA_SESSIONE: ReadonlySet<Guardia> = new Set<Guardia>(["nessuna", "esterna", "token"]);

interface Voce {
  /** Rotta come URL, es. `/api/credentials/[id]`. */
  rotta: string;
  metodi: MetodoHttp[];
}

export interface Atteso extends Voce {
  livello: LivelloAtteso;
  motivo: string;
  /** Codice del difetto, quando il livello giusto nasce da lì. */
  codice?: string;
}

export interface Eccezione extends Voce {
  /**
   * - `pubblica`: nessuna sessione, ammessa da `auth.config.ts`;
   * - `motivata`: guardia più debole del predefinito, per una ragione scritta;
   * - `mascherata`: lettura sensibile aperta a chi non è admin perché non
   *   restituisce segreti; `prova` dice dove lo si dimostra.
   */
  tipo: "pubblica" | "motivata" | "mascherata";
  /** La guardia che il rilevatore vede oggi: se cambia, l'eccezione si rilegge. */
  guardia: Guardia;
  motivo: string;
  prova?: string;
}

export interface Debito extends Voce {
  codice: string;
}

const MOTIVO_ONBOARDING =
  "procedura guidata di prima configurazione: accetta chi non è viewer finché non è finita";

/** Livello giusto dove il predefinito non vale. */
export const ATTESI: Atteso[] = [
  { rotta: "/api/ad", metodi: ["POST"], livello: "admin-o-onboarding", motivo: MOTIVO_ONBOARDING },
  { rotta: "/api/credentials", metodi: ["POST"], livello: "admin-o-onboarding", motivo: MOTIVO_ONBOARDING },
  { rotta: "/api/devices", metodi: ["POST"], livello: "admin-o-onboarding", motivo: MOTIVO_ONBOARDING },
  { rotta: "/api/networks", metodi: ["POST"], livello: "admin-o-onboarding", motivo: MOTIVO_ONBOARDING },
  // Tappa 4 credenziali (15/10): il punto raggiunto, letto all'apertura e salvato a ogni passo.
  { rotta: "/api/onboarding/progresso", metodi: ["GET", "PUT"], livello: "admin-o-onboarding", motivo: MOTIVO_ONBOARDING },
  // Revisione della tappa 4: il router già creato si modifica con colonne, porta e binding insieme.
  { rotta: "/api/onboarding/router", metodi: ["PUT"], livello: "admin-o-onboarding", motivo: MOTIVO_ONBOARDING },
  { rotta: "/api/settings", metodi: ["PUT"], livello: "admin-o-onboarding", motivo: MOTIVO_ONBOARDING },
  { rotta: "/api/tls", metodi: ["POST"], livello: "admin-o-onboarding", motivo: MOTIVO_ONBOARDING },
  {
    rotta: "/api/integrations/[component]",
    metodi: ["GET"],
    livello: "admin",
    codice: "SEC-5",
    motivo: "configurazione delle integrazioni: per chi non è admin solo senza segreti",
  },
  {
    rotta: "/api/settings",
    metodi: ["GET"],
    livello: "admin",
    codice: "SEC-5",
    motivo: "impostazioni dell'hub: per chi non è admin solo senza le chiavi dei segreti",
  },
  {
    rotta: "/api/integrations/install-progress/[jobId]",
    metodi: ["GET"],
    livello: "admin",
    codice: "SEC-13",
    motivo: "avanzamento di un'installazione lanciata da un admin",
  },
  {
    rotta: "/api/topology/traccia",
    metodi: ["GET"],
    livello: "admin",
    motivo: "«Cosa cambierebbe con la mappa nuova»: un calcolo per chi decide quando accendere la mappa nuova (spec topologia §13.11.3)",
  },
];

const PROVA_MASCHERATE = "src/lib/permessi/__tests__/letture-mascherate.test.ts";
const MOTIVO_LETTURA_POST = "lettura in blocco con l'elenco nel corpo (POST per la lunghezza): non scrive";
const MOTIVO_ESPORTA = "esporta gli stessi dati che l'utente vede nelle pagine, senza segreti";

export const ECCEZIONI: Eccezione[] = [
  // --- pubbliche: coincidono con l'elenco consentito di src/lib/auth.config.ts
  { rotta: "/api/auth/[...nextauth]", metodi: ["GET", "POST"], tipo: "pubblica", guardia: "esterna", motivo: "gestori di NextAuth: accesso e uscita" },
  { rotta: "/api/auth/lock-state", metodi: ["GET"], tipo: "pubblica", guardia: "nessuna", motivo: "la pagina di accesso la interroga prima che esista una sessione" },
  { rotta: "/api/health", metodi: ["GET"], tipo: "pubblica", guardia: "nessuna", motivo: "controllo di salute per il monitoraggio" },
  { rotta: "/api/version", metodi: ["GET"], tipo: "pubblica", guardia: "nessuna", motivo: "versione installata, letta dall'aggiornamento" },
  { rotta: "/api/setup", metodi: ["GET", "POST"], tipo: "pubblica", guardia: "nessuna", motivo: "prima configurazione, prima che esista un utente" },
  { rotta: "/api/inventory/ingest", metodi: ["GET"], tipo: "pubblica", guardia: "nessuna", motivo: "risponde solo con la descrizione del servizio" },
  { rotta: "/api/inventory/ingest", metodi: ["POST"], tipo: "pubblica", guardia: "token", motivo: "l'agente d'inventario si autentica col proprio token, non con una sessione" },
  { rotta: "/api/integrations/inventory-agent/install/linux.sh", metodi: ["GET"], tipo: "pubblica", guardia: "nessuna", motivo: "script d'installazione scaricato dall'host del cliente, senza sessione" },
  { rotta: "/api/integrations/inventory-agent/install/macos.sh", metodi: ["GET"], tipo: "pubblica", guardia: "nessuna", motivo: "script d'installazione scaricato dall'host del cliente, senza sessione" },
  { rotta: "/api/integrations/inventory-agent/install/windows.ps1", metodi: ["GET"], tipo: "pubblica", guardia: "nessuna", motivo: "script d'installazione scaricato dall'host del cliente, senza sessione" },

  // --- scritture senza ruolo admin, per scelta
  { rotta: "/api/auth/change-password", metodi: ["POST"], tipo: "motivata", guardia: "auth-diretto", motivo: "ogni utente cambia la propria password" },
  { rotta: "/api/auth/select-tenant", metodi: ["POST"], tipo: "motivata", guardia: "auth-diretto", motivo: "sceglie il cliente della propria sessione" },
  { rotta: "/api/user/preferences", metodi: ["PUT"], tipo: "motivata", guardia: "auth", motivo: "preferenze del proprio utente" },
  { rotta: "/api/integrations/meshcentral/host-status", metodi: ["POST"], tipo: "motivata", guardia: "auth", motivo: MOTIVO_LETTURA_POST },
  { rotta: "/api/integrations/wazuh/host-status", metodi: ["POST"], tipo: "motivata", guardia: "auth", motivo: MOTIVO_LETTURA_POST },
  { rotta: "/api/networks/export-csv", metodi: ["POST"], tipo: "motivata", guardia: "auth", motivo: "esportazione con l'elenco delle reti nel corpo: non scrive" },
  {
    rotta: "/api/integrations/proxy/librenms/[[...path]]",
    metodi: ["POST", "PUT", "PATCH", "DELETE"],
    tipo: "motivata",
    guardia: "auth",
    motivo:
      "proxy verso LibreNMS: l'accesso automatico solo per chi è admin; per gli altri, con l'accesso automatico acceso, inoltra senza i cookie di LibreNMS, che chiede il suo login (SEC-6)",
    prova: "src/lib/integrations/__tests__/librenms-accesso.test.ts",
  },

  // --- letture col nome sensibile che non restituiscono segreti
  { rotta: "/api/export", metodi: ["GET"], tipo: "motivata", guardia: "sessione", motivo: MOTIVO_ESPORTA },
  { rotta: "/api/inventory/export", metodi: ["GET"], tipo: "motivata", guardia: "sessione", motivo: MOTIVO_ESPORTA },
  { rotta: "/api/ad/healthcheck/export", metodi: ["GET"], tipo: "motivata", guardia: "sessione", motivo: MOTIVO_ESPORTA },
  {
    rotta: "/api/integrations/[component]/test-connection",
    metodi: ["GET"],
    tipo: "motivata",
    guardia: "auth",
    motivo: "prova solo l'indirizzo già salvato e risponde raggiungibile sì/no: non accetta indirizzi da chi chiama",
  },
  { rotta: "/api/credentials", metodi: ["GET"], tipo: "mascherata", guardia: "sessione", motivo: "campi cifrati sostituiti dalla maschera", prova: PROVA_MASCHERATE },
  // La lettura in chiaro (for_edit) chiede admin dentro il gestore: la prova
  // puntuale sta in src/lib/__tests__/api-auth-guards.test.ts.
  { rotta: "/api/credentials/[id]", metodi: ["GET"], tipo: "mascherata", guardia: "sessione", motivo: "campi cifrati sostituiti dalla maschera", prova: PROVA_MASCHERATE },
  // requireAuth dal 15/10 (tappa 1 credenziali): serve il ruolo, lo username in linea lo vede solo l'admin.
  { rotta: "/api/devices/[id]/credentials", metodi: ["GET"], tipo: "mascherata", guardia: "auth", motivo: "password in linea sostituita dalla maschera, username in linea solo all'admin", prova: PROVA_MASCHERATE },
  { rotta: "/api/hosts/[id]/credentials", metodi: ["GET"], tipo: "mascherata", guardia: "sessione", motivo: "solo le associazioni host-credenziale, nessun campo cifrato", prova: PROVA_MASCHERATE },
  { rotta: "/api/networks/[id]/credentials", metodi: ["GET"], tipo: "mascherata", guardia: "sessione", motivo: "solo le associazioni rete-credenziale, nessun campo cifrato", prova: PROVA_MASCHERATE },
  {
    rotta: "/api/integrations/[component]",
    metodi: ["GET"],
    tipo: "mascherata",
    guardia: "auth",
    motivo: "token e password vuoti con i flag «impostato» per chi non è admin (SEC-5)",
    prova: "src/lib/permessi/__tests__/politica.test.ts",
  },
  {
    rotta: "/api/settings",
    metodi: ["GET"],
    tipo: "mascherata",
    guardia: "auth",
    motivo: "chiavi dei segreti tolte per chi non è admin (SEC-5)",
    prova: "src/lib/permessi/__tests__/impostazioni-viewer.test.ts",
  },
];

/**
 * Guardie da alzare. Quando una guardia sale al livello atteso la prova fallisce
 * finché la voce non si toglie: l'elenco si svuota da solo.
 *
 * Vuoto dal 12/10 (T3-30): l'ultimo debito (scritture del proxy Wazuh, SEC-6) è
 * chiuso. La prova `rotte-censite.test.ts` lo tiene vuoto: un debito nuovo è una
 * scelta da scrivere anche lì, non una riga che si aggiunge di passaggio.
 */
export const DEBITI: Debito[] = [];

export interface GestoreCensito extends GestoreRilevato {
  rotta: string;
}

export type Esito = "ok" | "eccezione" | "debito" | "scoperto";

export interface Valutazione {
  rotta: string;
  metodo: MetodoHttp;
  guardia: Guardia;
  atteso: LivelloAtteso;
  esito: Esito;
  nota: string;
}

function trova<T extends Voce>(elenco: readonly T[], rotta: string, metodo: MetodoHttp): T | undefined {
  return elenco.find((v) => v.rotta === rotta && v.metodi.includes(metodo));
}

/** Livello atteso per un gestore, prima di eccezioni e debiti. */
export function livelloAtteso(rotta: string, metodo: MetodoHttp, attesi: readonly Atteso[] = ATTESI): LivelloAtteso {
  const dichiarato = trova(attesi, rotta, metodo);
  if (dichiarato) return dichiarato.livello;
  if (SCRITTURE.has(metodo)) return "admin";
  if (SENSIBILE.test(rotta)) return "admin";
  return "auth";
}

export function soddisfa(guardia: Guardia, atteso: LivelloAtteso): boolean {
  if (SENZA_SESSIONE.has(guardia)) return false;
  return FORZA_GUARDIA[guardia] >= FORZA_GUARDIA[atteso];
}

/** Rotte lasciate passare senza sessione da `auth.config.ts`, lette dal suo sorgente. */
export interface Consentiti {
  esatti: string[];
  prefissi: string[];
}

export function consentitiDaAuthConfig(sorgente: string): Consentiti {
  const esatti = [...sorgente.matchAll(/pathname\s*===\s*"(\/api[^"]*)"/g)].map((m) => m[1]);
  const prefissi = [...sorgente.matchAll(/pathname\.startsWith\(\s*"(\/api[^"]*)"\s*\)/g)].map((m) => m[1]);
  return { esatti, prefissi };
}

export function eConsentita(rotta: string, c: Consentiti): boolean {
  return c.esatti.includes(rotta) || c.prefissi.some((p) => rotta.startsWith(p));
}

export interface Elenchi {
  attesi: readonly Atteso[];
  eccezioni: readonly Eccezione[];
  debiti: readonly Debito[];
}

export interface Censimento {
  valutazioni: Valutazione[];
  /** Ogni riga è un motivo per cui la prova fallisce. Vuoto = censimento in regola. */
  problemi: string[];
}

/**
 * Valuta tutti i gestori contro gli elenchi. Funzione pura: la prova la usa sia
 * sull'albero vero sia su dati finti.
 */
export function censisci(
  gestori: readonly GestoreCensito[],
  consentiti: Consentiti,
  elenchi: Elenchi = { attesi: ATTESI, eccezioni: ECCEZIONI, debiti: DEBITI },
): Censimento {
  const problemi: string[] = [];
  const valutazioni: Valutazione[] = [];
  const chiave = (rotta: string, metodo: string) => `${metodo} ${rotta}`;
  const esistenti = new Set(gestori.map((g) => chiave(g.rotta, g.metodo)));

  // Le voci degli elenchi devono riferirsi a gestori che esistono, una volta sola.
  const viste = new Map<string, string>();
  const controllaVoci = (nome: string, voci: readonly Voce[], esclusivo: boolean) => {
    for (const v of voci) {
      for (const m of v.metodi) {
        const k = chiave(v.rotta, m);
        if (!esistenti.has(k)) problemi.push(`${nome}: ${k} non esiste più (togliere la voce)`);
        if (esclusivo) {
          const prima = viste.get(k);
          if (prima) problemi.push(`${k} compare sia in ${prima} sia in ${nome}`);
          else viste.set(k, nome);
        }
      }
    }
  };
  controllaVoci("ATTESI", elenchi.attesi, false);
  controllaVoci("ECCEZIONI", elenchi.eccezioni, true);
  controllaVoci("DEBITI", elenchi.debiti, true);
  const dupAttesi = new Set<string>();
  for (const v of elenchi.attesi) {
    for (const m of v.metodi) {
      const k = chiave(v.rotta, m);
      if (dupAttesi.has(k)) problemi.push(`ATTESI: ${k} dichiarato due volte`);
      dupAttesi.add(k);
    }
  }

  for (const g of gestori) {
    const k = chiave(g.rotta, g.metodo);
    const atteso = livelloAtteso(g.rotta, g.metodo, elenchi.attesi);
    const ecc = trova(elenchi.eccezioni, g.rotta, g.metodo);
    const deb = trova(elenchi.debiti, g.rotta, g.metodo);
    const v: Valutazione = { rotta: g.rotta, metodo: g.metodo, guardia: g.guardia, atteso, esito: "ok", nota: "" };
    valutazioni.push(v);

    if (SENZA_SESSIONE.has(g.guardia) && !eConsentita(g.rotta, consentiti)) {
      problemi.push(`${k}: nessuna guardia di sessione (${g.guardia}) e la rotta non è fra quelle consentite da auth.config.ts`);
    }

    if (soddisfa(g.guardia, atteso)) {
      if (ecc) problemi.push(`${k}: eccezione superflua, la guardia (${g.guardia}) basta già per ${atteso}`);
      if (deb) problemi.push(`${k}: debito ${deb.codice} sanato (guardia ${g.guardia}): togliere la voce da DEBITI`);
      continue;
    }

    if (ecc) {
      v.esito = "eccezione";
      v.nota = `${ecc.tipo}: ${ecc.motivo}`;
      if (ecc.guardia !== g.guardia) {
        problemi.push(`${k}: l'eccezione è scritta per la guardia ${ecc.guardia}, il rilevatore vede ${g.guardia}`);
      }
      if (ecc.tipo === "pubblica" && !eConsentita(g.rotta, consentiti)) {
        problemi.push(`${k}: eccezione pubblica su una rotta che auth.config.ts non lascia passare`);
      }
      if (ecc.tipo !== "pubblica" && SENZA_SESSIONE.has(g.guardia)) {
        problemi.push(`${k}: senza sessione può essere solo un'eccezione pubblica`);
      }
      if (ecc.tipo === "mascherata" && !ecc.prova) {
        problemi.push(`${k}: eccezione mascherata senza la prova che la copre`);
      }
      continue;
    }
    if (deb) {
      v.esito = "debito";
      v.nota = deb.codice;
      continue;
    }
    v.esito = "scoperto";
    problemi.push(`${k}: guardia ${g.guardia}, attesa ${atteso} — alzarla, o dichiarare un'eccezione con motivo o un debito con codice`);
  }

  // Ogni via d'accesso senza sessione di auth.config.ts deve servire a un gestore pubblico.
  const pubbliche = valutazioni.filter((v) => SENZA_SESSIONE.has(v.guardia)).map((v) => v.rotta);
  for (const e of consentiti.esatti) {
    if (!pubbliche.includes(e)) problemi.push(`auth.config.ts lascia passare ${e} ma nessun gestore lì è senza sessione`);
  }
  for (const p of consentiti.prefissi) {
    if (!pubbliche.some((r) => r.startsWith(p))) {
      problemi.push(`auth.config.ts lascia passare il prefisso ${p} ma nessun gestore sotto è senza sessione`);
    }
  }
  return { valutazioni, problemi };
}

/** Rotta URL da un file `route.ts` sotto `src/app`. */
export function rottaDaFile(radice: string, file: string): string {
  return "/" + relative(join(radice, "src", "app"), file).replace(/\\/g, "/").replace(/\/route\.ts$/, "");
}

/** Tutti i gestori dell'albero `src/app/api` di un progetto, con la loro guardia. */
export function gestoriDellAlbero(radice: string): { file: number; gestori: GestoreCensito[] } {
  const cammina = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) return cammina(p);
      return n === "route.ts" ? [p] : [];
    });
  const files = cammina(join(radice, "src", "app", "api"));
  const gestori: GestoreCensito[] = [];
  for (const f of files) {
    const rotta = rottaDaFile(radice, f);
    for (const g of rilevaGestori(readFileSync(f, "utf8"), f)) gestori.push({ ...g, rotta });
  }
  return { file: files.length, gestori };
}
