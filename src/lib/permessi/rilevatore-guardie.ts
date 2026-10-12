/**
 * Rilevatore delle guardie dei gestori HTTP (T3-24).
 *
 * Legge il sorgente di una `route.ts` con l'albero sintattico di TypeScript (non
 * con espressioni regolari) e, per ogni metodo HTTP esportato, dice quale
 * guardia lo protegge. Riconosce le quattro forme di export che Next accetta:
 *
 *   export async function GET(…) { … }
 *   export { handle as GET, handle as POST }
 *   export const GET = …
 *   export const { GET, POST } = handlers
 *
 * Perché l'albero e non il testo: lo script di audit della «Wave 0» cercava solo
 * la prima e la terza forma e nei due proxy (forma due) vedeva zero metodi; e
 * tagliava il sorgente «fino al prossimo export», così una funzione d'appoggio
 * scritta dopo il gestore gli prestava la sua guardia.
 *
 * Regole della classificazione:
 * - conta solo una guardia chiamata **sempre** (non dentro un ramo di `if`, di
 *   `? :`, a destra di `&&`/`||`/`??`, in un `case`, in un `catch` o in un ciclo):
 *   una guardia condizionale non protegge l'altro ramo, e si vede in `condizionali`;
 * - una funzione dello stesso file chiamata dal gestore porta con sé le sue
 *   guardie (anche a più livelli); una funzione importata no, salvo quelle note
 *   in `GUARDIE_NOTE`;
 * - un gestore che non è una funzione del file (re-export, `handlers` di
 *   NextAuth, un wrapper importato) è `esterna`: il rilevatore non la vede e il
 *   censimento la tratta come «nessuna guardia» finché non c'è un'eccezione con
 *   motivo. Mai muta.
 *
 * Modulo puro: niente accesso a disco, niente database. Lo usano la prova
 * `src/lib/permessi/__tests__/rotte-censite.test.ts` e `scripts/audit-api-auth.ts`.
 */
import ts from "typescript";

export const METODI_HTTP = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export type MetodoHttp = (typeof METODI_HTTP)[number];

/**
 * Guardia rilevata, dalla più debole alla più forte.
 * - `nessuna`: nessuna chiamata di guardia riconosciuta;
 * - `esterna`: il gestore non è codice di questo file, non si può leggere;
 * - `token`: autenticazione a token macchina (agenti), non di sessione;
 * - `sessione`: `withTenantFromSession` (401 senza sessione, nessun ruolo);
 * - `auth-diretto`: `auth()` di NextAuth chiamato a mano;
 * - `auth`: `requireAuth`;
 * - `admin-o-onboarding`: `requireAdminOrOnboarding` (admin, oppure chiunque non
 *   sia viewer finché la prima configurazione non è finita): livello a sé;
 * - `admin`: `requireAdmin` (e i suoi alias);
 * - `superadmin`: `requireSuperAdmin`.
 */
export type Guardia =
  | "nessuna"
  | "esterna"
  | "token"
  | "sessione"
  | "auth-diretto"
  | "auth"
  | "admin-o-onboarding"
  | "admin"
  | "superadmin";

/** Forza di una guardia per il confronto «almeno pari». */
export const FORZA_GUARDIA: Record<Guardia, number> = {
  nessuna: 0,
  esterna: 0,
  token: 1,
  sessione: 1,
  "auth-diretto": 1,
  auth: 1,
  "admin-o-onboarding": 2,
  admin: 3,
  superadmin: 4,
};

/** Tutte le guardie dalla più debole alla più forte (spareggio a pari forza). */
export const ORDINE_GUARDIE: readonly Guardia[] = [
  "nessuna",
  "esterna",
  "token",
  "sessione",
  "auth-diretto",
  "auth",
  "admin-o-onboarding",
  "admin",
  "superadmin",
];

/**
 * Funzioni importate che sono guardie, col livello che impongono. Una guardia
 * nuova (un helper che chiama `requireAdmin` in un altro file) va aggiunta qui:
 * finché non c'è, il gestore che la usa risulta più debole e il censimento lo
 * segnala.
 */
export const GUARDIE_NOTE: Record<string, Guardia> = {
  requireSuperAdmin: "superadmin",
  requireAdmin: "admin",
  // src/lib/patch/route-guard.ts: alias dichiarato di requireAdmin.
  requirePatchOperator: "admin",
  requireAdminOrOnboarding: "admin-o-onboarding",
  requireAuth: "auth",
  withTenantFromSession: "sessione",
  auth: "auth-diretto",
  // src/lib/inventory-agent/auth.ts: token dell'agente d'inventario (Bearer).
  resolveTenantFromIngestToken: "token",
};

export type FormaExport = "funzione" | "rinomina" | "costante" | "destrutturata";

export interface GestoreRilevato {
  metodo: MetodoHttp;
  forma: FormaExport;
  /** La guardia più forte chiamata sempre. */
  guardia: Guardia;
  /** Guardie più forti di `guardia` chiamate solo in un ramo. */
  condizionali: Guardia[];
}

function eMetodo(nome: string): nome is MetodoHttp {
  return (METODI_HTTP as readonly string[]).includes(nome);
}

function haExport(n: ts.Node): boolean {
  const mods = ts.canHaveModifiers(n) ? ts.getModifiers(n) : undefined;
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/** Dichiarazioni di primo livello del file per nome: funzioni e costanti. */
function dichiarazioniLocali(sf: ts.SourceFile): Map<string, ts.Node> {
  const mappa = new Map<string, ts.Node>();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) mappa.set(st.name.text, st);
    else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer) mappa.set(d.name.text, d.initializer);
      }
    }
  }
  return mappa;
}

/** Nomi importati nel file (per distinguere `auth` di NextAuth da una variabile locale). */
function nomiImportati(sf: ts.SourceFile): Set<string> {
  const nomi = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause) continue;
    const c = st.importClause;
    if (c.name) nomi.add(c.name.text);
    const nb = c.namedBindings;
    if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) nomi.add(el.name.text);
    if (nb && ts.isNamespaceImport(nb)) nomi.add(nb.name.text);
  }
  return nomi;
}

interface Raccolta {
  sempre: Set<Guardia>;
  condizionali: Set<Guardia>;
}

/**
 * Visita un nodo raccogliendo le chiamate di guardia. `cond` dice se il nodo sta
 * in un ramo che può non essere eseguito.
 */
function visita(
  nodo: ts.Node,
  cond: boolean,
  locali: Map<string, ts.Node>,
  importati: Set<string>,
  visitati: Set<ts.Node>,
  r: Raccolta,
): void {
  const giu = (n: ts.Node | undefined, c: boolean) => {
    if (n) visita(n, c, locali, importati, visitati, r);
  };

  // Una funzione dichiarata dentro il gestore conta solo se la si chiama.
  if (ts.isFunctionDeclaration(nodo)) return;

  if (ts.isCallExpression(nodo) && ts.isIdentifier(nodo.expression)) {
    const nome = nodo.expression.text;
    const nota = GUARDIE_NOTE[nome];
    // `auth` conta solo se è l'import di NextAuth, non una variabile qualunque.
    if (nota && (nome !== "auth" || importati.has("auth")) && !locali.has(nome)) {
      (cond ? r.condizionali : r.sempre).add(nota);
    } else if (locali.has(nome)) {
      const decl = locali.get(nome)!;
      if (!visitati.has(decl)) {
        visitati.add(decl);
        giu(ts.isFunctionDeclaration(decl) ? decl.body : decl, cond);
      }
    }
  }

  if (ts.isIfStatement(nodo)) {
    giu(nodo.expression, cond);
    giu(nodo.thenStatement, true);
    giu(nodo.elseStatement, true);
    return;
  }
  if (ts.isConditionalExpression(nodo)) {
    giu(nodo.condition, cond);
    giu(nodo.whenTrue, true);
    giu(nodo.whenFalse, true);
    return;
  }
  if (ts.isBinaryExpression(nodo)) {
    const op = nodo.operatorToken.kind;
    if (
      op === ts.SyntaxKind.AmpersandAmpersandToken ||
      op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.QuestionQuestionToken
    ) {
      giu(nodo.left, cond);
      giu(nodo.right, true);
      return;
    }
  }
  if (ts.isSwitchStatement(nodo)) {
    giu(nodo.expression, cond);
    giu(nodo.caseBlock, true);
    return;
  }
  if (ts.isCatchClause(nodo)) {
    giu(nodo.block, true);
    return;
  }
  if (
    ts.isForStatement(nodo) ||
    ts.isForInStatement(nodo) ||
    ts.isForOfStatement(nodo) ||
    ts.isWhileStatement(nodo) ||
    ts.isDoStatement(nodo)
  ) {
    ts.forEachChild(nodo, (c) => giu(c, true));
    return;
  }
  ts.forEachChild(nodo, (c) => giu(c, cond));
}

function guardiaDi(
  nodo: ts.Node,
  locali: Map<string, ts.Node>,
  importati: Set<string>,
): { guardia: Guardia; condizionali: Guardia[] } {
  const r: Raccolta = { sempre: new Set(), condizionali: new Set() };
  const inizio = ts.isFunctionDeclaration(nodo) ? nodo.body : nodo;
  if (inizio) visita(inizio, false, locali, importati, new Set([nodo]), r);
  // A pari forza vince la più esplicita (requireAuth su withTenantFromSession):
  // l'ordine di ORDINE_GUARDIE segue FORZA_GUARDIA.
  let guardia: Guardia = "nessuna";
  for (const g of r.sempre) if (ORDINE_GUARDIE.indexOf(g) > ORDINE_GUARDIE.indexOf(guardia)) guardia = g;
  const condizionali = [...r.condizionali]
    .filter((g) => FORZA_GUARDIA[g] > FORZA_GUARDIA[guardia])
    .sort((a, b) => FORZA_GUARDIA[b] - FORZA_GUARDIA[a]);
  return { guardia, condizionali };
}

/**
 * Il gestore è codice di questo file? Un'espressione che si riduce a un nome
 * importato (o a un `export … from`) non si può leggere: `esterna`.
 */
function eFunzioneLocale(nodo: ts.Node, locali: Map<string, ts.Node>): boolean {
  if (ts.isFunctionDeclaration(nodo) || ts.isArrowFunction(nodo) || ts.isFunctionExpression(nodo)) return true;
  if (ts.isIdentifier(nodo)) {
    const d = locali.get(nodo.text);
    return d ? eFunzioneLocale(d, locali) : false;
  }
  // Un wrapper chiamato (`conGuardia(async () => …)`): locale se lo è almeno un
  // argomento funzione; la guardia si cerca nell'intera espressione.
  if (ts.isCallExpression(nodo)) return nodo.arguments.some((a) => eFunzioneLocale(a, locali));
  if (ts.isParenthesizedExpression(nodo) || ts.isAsExpression(nodo) || ts.isSatisfiesExpression(nodo)) {
    return eFunzioneLocale(nodo.expression, locali);
  }
  return false;
}

/** Tutti i gestori HTTP esportati da un sorgente `route.ts`, con la loro guardia. */
export function rilevaGestori(sorgente: string, nomeFile = "route.ts"): GestoreRilevato[] {
  const sf = ts.createSourceFile(nomeFile, sorgente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const locali = dichiarazioniLocali(sf);
  const importati = nomiImportati(sf);
  const out: GestoreRilevato[] = [];

  const aggiungi = (metodo: MetodoHttp, forma: FormaExport, corpo: ts.Node | undefined) => {
    if (!corpo || !eFunzioneLocale(corpo, locali)) {
      out.push({ metodo, forma, guardia: "esterna", condizionali: [] });
      return;
    }
    out.push({ metodo, forma, ...guardiaDi(corpo, locali, importati) });
  };

  for (const st of sf.statements) {
    // export async function GET(…) { … }
    if (ts.isFunctionDeclaration(st) && st.name && haExport(st) && eMetodo(st.name.text)) {
      aggiungi(st.name.text, "funzione", st);
      continue;
    }
    // export { handle as GET } · export { GET } from "…"
    if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) {
        const esportato = el.name.text;
        if (!eMetodo(esportato)) continue;
        const locale = (el.propertyName ?? el.name).getText(sf);
        aggiungi(esportato, "rinomina", st.moduleSpecifier ? undefined : locali.get(locale));
      }
      continue;
    }
    // export const GET = … · export const { GET, POST } = handlers
    if (ts.isVariableStatement(st) && haExport(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && eMetodo(d.name.text)) {
          aggiungi(d.name.text, "costante", d.initializer);
        } else if (ts.isObjectBindingPattern(d.name)) {
          for (const el of d.name.elements) {
            const nome = ts.isIdentifier(el.name) ? el.name.text : "";
            if (eMetodo(nome)) aggiungi(nome, "destrutturata", undefined);
          }
        }
      }
    }
  }
  return out;
}
