/**
 * Copia delle voci del vault da OpenBao a DA-Link (vault semplice, passo 6 → passo 7 sul live; piano DA-Link
 * `2026-10-29-vault-passo6-app.md`, S2). L'hub passa da OpenBao a DA-Link per le password: prima si copia, voce per voce,
 * e si verifica, con OpenBao ancora acceso e DA-Link ancora spento.
 *
 * - **Elenco = quello che l'app usa**: le cartelle dell'app in OpenBao (con le sottocartelle) e i `credential_ref` del
 *   database (`riferimentiDelleCredenziali`), senza doppioni. Un riferimento malformato non si copia: si dice.
 * - **Classificazione** di ogni percorso: `copierei` (manca in DA-Link), `uguale`, `diversa` (c'è ma con valori
 *   diversi: serve `sostituisci`), `manca_in_openbao`, `non_valido`, `non_copiabile` (la voce di OpenBao ha qualcosa che
 *   DA-Link non può tenere: mai scritta, vedi sotto).
 * - **Le regole di DA-Link** (`vault_kdbx._controlla_valori`) le conosce anche la copia: nomi di campo `[a-z0-9._-]{1,64}`
 *   e mai `otp`, valori senza i caratteri che KeePass/XML non può contenere; un campo con valore vuoto DA-Link lo scarta,
 *   quindi nel confronto non conta. Una voce che non le rispetta è `non_copiabile`: si vede già a vuoto (codice d'uscita
 *   2) invece di fermare la scrittura a metà con un 422.
 * - **Modi**: `a_vuoto` (di serie: non scrive niente, da nessuna parte), `applica` (scrive i `copierei`; le `diversa`
 *   solo con `sostituisci`), `verifica` (solo confronto). Dopo la scrittura DA-Link si rilegge da capo (nuovo giro
 *   dell'ambito) e la classificazione finale è quella riletta: «scritto» non vuol dire «arrivato».
 * - **Un errore di uno dei due backend ferma tutto** (`ErroreCopia`, col nome del backend): mai «0 voci» perché OpenBao o
 *   DA-Link non rispondono. Un errore a metà scrittura ferma le scritture e lo dice nell'esito (le voci già scritte
 *   restano, la copia si può rilanciare: le uguali non si riscrivono).
 * - **Mai valori**: l'esito porta percorsi e classi, non i valori; i messaggi d'errore sono quelli degli store (solo
 *   percorso e stato HTTP), mai gettone, token, secret_id o corpo delle risposte.
 */
import { ErroreVault, percorsoValido, type SecretStore, type ValoreSegreto } from "./tipi";

export type ClasseVoce = "copierei" | "uguale" | "diversa" | "manca_in_openbao" | "non_valido" | "non_copiabile";
export type ModoCopia = "a_vuoto" | "applica" | "verifica";

export interface VoceCopia {
  percorso: string;
  /** Da dove viene il riferimento (cliente e credenziale, es. «C70001#12»); vuoto per le voci della cartella dell'app. */
  origini: string[];
  /** Con `applica`, la classe riletta dopo la scrittura; negli altri modi quella trovata. */
  classe: ClasseVoce;
  /** Scritta in DA-Link da questa esecuzione. */
  scritta: boolean;
}

export interface EsitoCopia {
  modo: ModoCopia;
  sostituisci: boolean;
  voci: VoceCopia[];
  scritte: number;
  /** Una scrittura che si è fermata a metà: il messaggio nomina il percorso, mai il corpo della risposta. */
  errore: string | null;
  /**
   * Il codice d'uscita 0. `a_vuoto`: niente di diverso, mancante o non valido (un `copierei` è il lavoro che resta da fare,
   * non un errore). `applica`/`verifica`: tutte `uguale`. Sempre falso con 0 voci (cartella o mount sbagliati) e con `errore`.
   */
  ok: boolean;
}

/** Un guasto di uno dei due backend: ferma la copia. `backend` dice quale. */
export class ErroreCopia extends Error {
  readonly backend: "OpenBao" | "DA-Link";
  constructor(backend: "OpenBao" | "DA-Link", messaggio: string) {
    super(`${backend}: ${messaggio}`);
    this.name = "ErroreCopia";
    this.backend = backend;
  }
}

/** Lo store di DA-Link che serve alla copia: l'interfaccia comune più il giro dell'ambito (senza `avvia()`). */
export interface StoreDalinkCopia extends SecretStore {
  aggiorna(): Promise<void>;
}

function messaggio(e: unknown): string {
  if (e instanceof ErroreVault) return e.message;
  return `errore imprevisto (${e instanceof Error ? e.name : "sconosciuto"})`;
}

/** Come DA-Link: nome di campo `[a-z0-9._-]{1,64}` (python `fullmatch`; `$` senza il flag `m` non ammette l'a capo finale). */
const CAMPO_DALINK = /^[a-z0-9._-]{1,64}$/;
/** I caratteri che XML 1.0 non può contenere (`_NON_XML` di `vault_kdbx.py`): anche le metà di coppie surrogate spaiate. */
const NON_XML = /[^\t\n\r\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/u;

/** Perché DA-Link non può tenere la voce (nome del campo ma mai il valore), o null se può. */
function nonCopiabile(v: ValoreSegreto): string | null {
  for (const [campo, valore] of Object.entries(v)) {
    if (!CAMPO_DALINK.test(campo) || campo === "otp") return "nome di campo non valido per DA-Link";
    if (typeof valore !== "string") return "valore che non è testo";
    if (NON_XML.test(valore)) return `il campo «${campo}» ha caratteri che KeePass non può contenere`;
  }
  return null;
}

/** I campi che DA-Link terrebbe: quelli con un valore (un valore vuoto lo scarta). */
function conValore(v: ValoreSegreto): Array<[string, string]> {
  return Object.entries(v)
    .filter(([, x]) => x !== "")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function uguali(a: ValoreSegreto, b: ValoreSegreto): boolean {
  const ka = conValore(a);
  const kb = conValore(b);
  return ka.length === kb.length && ka.every(([k, x], i) => k === kb[i][0] && x === kb[i][1]);
}

async function conErrore<T>(backend: "OpenBao" | "DA-Link", f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    throw new ErroreCopia(backend, messaggio(e));
  }
}

/** Il valore del percorso, o null se lo store dice che non c'è; ogni altro errore ferma la copia. */
async function leggiOppureNull(backend: "OpenBao" | "DA-Link", store: SecretStore, percorso: string): Promise<ValoreSegreto | null> {
  try {
    return await store.get(percorso);
  } catch (e) {
    if (e instanceof ErroreVault && e.codice === "non_trovato") return null;
    throw new ErroreCopia(backend, messaggio(e));
  }
}

export async function copiaVersoDalink(op: {
  openbao: SecretStore;
  dalink: StoreDalinkCopia;
  /** Le cartelle dell'app in OpenBao (di serie `app/da-ipam`), con le sottocartelle. */
  cartelle: string[];
  /** I `credential_ref` del database (`riferimentiDelleCredenziali()`). */
  riferimenti: Array<{ percorso: string; origine: string }>;
  modo?: ModoCopia;
  sostituisci?: boolean;
}): Promise<EsitoCopia> {
  const modo = op.modo ?? "a_vuoto";
  const sostituisci = op.sostituisci === true;

  // 1. L'elenco: cartelle di OpenBao, poi riferimenti; un percorso una volta sola (le origini si sommano).
  const origini = new Map<string, string[]>();
  const aggiungi = (percorso: string, origine?: string) => {
    const o = origini.get(percorso) ?? [];
    if (origine && !o.includes(origine)) o.push(origine);
    origini.set(percorso, o);
  };
  for (const cartella of op.cartelle) {
    for (const p of await conErrore("OpenBao", () => op.openbao.list(cartella))) aggiungi(p);
  }
  for (const r of op.riferimenti) aggiungi(r.percorso, r.origine);
  const percorsi = [...origini.keys()];

  // 2. Le due letture, prima di qualsiasi scrittura: un guasto qui non lascia niente a metà.
  const daOpenBao = new Map<string, ValoreSegreto | null>();
  for (const p of percorsi) daOpenBao.set(p, percorsoValido(p) ? await leggiOppureNull("OpenBao", op.openbao, p) : null);
  await conErrore("DA-Link", () => op.dalink.aggiorna());

  const classifica = async (p: string): Promise<ClasseVoce> => {
    if (!percorsoValido(p)) return "non_valido";
    const sorgente = daOpenBao.get(p);
    if (!sorgente) return "manca_in_openbao";
    if (nonCopiabile(sorgente) !== null) return "non_copiabile";
    const attuale = await leggiOppureNull("DA-Link", op.dalink, p);
    if (!attuale) return "copierei";
    return uguali(sorgente, attuale) ? "uguale" : "diversa";
  };

  const voci: VoceCopia[] = [];
  for (const p of percorsi) voci.push({ percorso: p, origini: origini.get(p) ?? [], classe: await classifica(p), scritta: false });

  // 3. Le scritture, solo con `applica`.
  let errore: string | null = null;
  let scritte = 0;
  if (modo === "applica") {
    for (const v of voci) {
      if (v.classe !== "copierei" && !(v.classe === "diversa" && sostituisci)) continue;
      const valore = daOpenBao.get(v.percorso);
      if (!valore) continue;
      try {
        await op.dalink.put(v.percorso, valore);
        v.scritta = true;
        scritte += 1;
      } catch (e) {
        const indizio = e instanceof ErroreVault && e.codice === "non_trovato" ? " (percorso fuori dall'ambito del gettone di DA-Link?)" : "";
        errore = `scrittura di «${v.percorso}» non riuscita${indizio}: ${messaggio(e)}. Scritte prima: ${scritte}; le altre non sono state tentate`;
        break;
      }
    }
    // 4. Si rilegge da DA-Link da capo (un giro nuovo dell'ambito): la classe finale è quella che c'è davvero.
    if (errore === null && scritte > 0) {
      await conErrore("DA-Link", () => op.dalink.aggiorna());
      for (const v of voci) v.classe = await classifica(v.percorso);
    }
  }

  const tutteUguali = voci.length > 0 && voci.every((v) => v.classe === "uguale");
  const nessunProblema = voci.length > 0 && voci.every((v) => v.classe === "uguale" || v.classe === "copierei");
  const ok = errore === null && (modo === "a_vuoto" ? nessunProblema : tutteUguali);
  return { modo, sostituisci, voci, scritte, errore, ok };
}
