/**
 * Gestione utenti con la sessione in mano (UI-18, tappa 1 del piano di miglioramento).
 *
 * Le rotte /api/users* chiedono `requireAdmin()` e passano qui la sessione:
 * questo modulo legge dal database chi chiede (l'attore) e su chi agisce (il
 * bersaglio), chiede il permesso a `permissions.ts` e solo allora scrive.
 * Restituisce stato HTTP e corpo, così le stesse regole si provano con sessioni
 * simulate (`__tests__/service.test.ts`); che ogni rotta passi da qui lo verifica
 * `__tests__/routes-use-service.test.ts`.
 *
 * Nessuno si fida del token: ruolo (e, per l'admin, clienti) si rileggono dal
 * database a ogni richiesta, così chi è stato declassato smette subito di gestire
 * utenti, anche con la sessione vecchia ancora aperta. Fa eccezione solo l'utenza
 * di servizio Domarc (id "0"), che una riga nel database non ce l'ha.
 */
import bcrypt from "bcrypt";
import {
  createUser,
  deleteUser,
  getAllUserTenantAccess,
  getHubDb,
  getTenantByCode,
  getTenants,
  getUserById,
  getUserByUsername,
  getUserTenantAccess,
  getUsers,
  impostaSecondaVerifica,
  removeUserTenantAccess,
  setUserTenantAccess,
  updateUserPassword,
  updateUserRole,
} from "@/lib/db-hub";
import {
  canManageUser,
  decideCreate,
  decideDelete,
  decideResetPassword,
  decideSecondaVerifica,
  decideUpdate,
  isUserRole,
  type Denial,
  type ManagedUser,
  type UserManager,
  type UserRole,
} from "./permissions";
import { scriviRegistroAccessi } from "@/lib/accesso/registro-accessi";

/** Quel che serve della sessione di NextAuth (`requireAdmin()` la restituisce così). */
export interface SessionLike {
  user?: {
    id?: string | null;
    name?: string | null;
    role?: string;
    tenantCode?: string | null;
  } | null;
}

/** Esito di un'operazione: la rotta lo trasforma in risposta così com'è. */
export interface UsersResult {
  status: number;
  body: unknown;
}

const NEED_TENANT = "Seleziona almeno un cliente per questo ruolo";
const INVALID_ROLE = "Il ruolo deve essere 'superadmin', 'admin' o 'viewer'";

const fail = (status: number, error: string): UsersResult => ({ status, body: { error } });

/**
 * Lo username dell'utenza di servizio Domarc (`DOMARC_USERNAME`, «domarc» se non
 * è impostato), che entra senza una riga nel database. Un utente locale con lo
 * stesso nome passerebbe per lei: nei log le sue azioni sembrerebbero del
 * supporto Domarc, e quando il supporto entra `isSelf` lo scambierebbe per sé.
 */
function isServiceUsername(username: string): boolean {
  const service = (process.env.DOMARC_USERNAME || "domarc").trim().toLowerCase();
  return username.trim().toLowerCase() === service;
}
const fromDenial = (d: Denial): UsersResult => fail(d.status, d.error);

/** id positivo intero, altrimenti null. */
function parseId(raw: string | null | undefined): number | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Chi sta chiedendo, con i clienti che amministra. Il viewer (o un ruolo che
 * non si riconosce) non gestisce utenti: 403 su tutto, lettura compresa.
 */
export function resolveUserManager(session: SessionLike): { ok: true; actor: UserManager } | Denial {
  const user = session.user;
  const role = user?.role;
  const username = (user?.name ?? "").trim();

  if (role !== "superadmin" && role !== "admin") {
    return { ok: false, status: 403, error: "Richiesti privilegi di amministratore" };
  }

  const stale: Denial = {
    ok: false,
    status: 403,
    error: "Il tuo account non risulta più amministratore: esci e rientra",
  };
  const userId = parseId(user?.id);

  if (role === "superadmin") {
    // id null = utenza di servizio Domarc (id "0"), senza riga: vale il token.
    if (userId !== null) {
      const row = getUserById(userId);
      if (!row || row.role !== "superadmin" || row.username.trim() !== username) return stale;
    }
    return { ok: true, actor: { role: "superadmin", userId, username, tenantIds: [], currentTenantId: null } };
  }

  if (userId === null) return stale;
  const row = getUserById(userId);
  if (!row || row.role !== "admin" || row.username.trim() !== username) return stale;

  const tenantIds = getUserTenantAccess(userId)
    .filter((a) => a.role === "admin")
    .map((a) => a.tenant_id);
  if (tenantIds.length === 0) {
    return { ok: false, status: 403, error: "Non amministri nessun cliente" };
  }

  const current = user?.tenantCode ? getTenantByCode(user.tenantCode) : undefined;
  const currentTenantId = current && tenantIds.includes(current.id) ? current.id : null;
  return { ok: true, actor: { role: "admin", userId, username, tenantIds, currentTenantId } };
}

async function readBody(request: Request): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false }> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return { ok: false };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false };
  return { ok: true, body: parsed as Record<string, unknown> };
}

/** `tenant_ids` della richiesta: assente → undefined; non un elenco di id → "invalid". */
function parseTenantIds(value: unknown): number[] | undefined | "invalid" {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return "invalid";
  if (!value.every((v) => typeof v === "number" && Number.isInteger(v) && v > 0)) return "invalid";
  return [...new Set(value as number[])];
}

/** Il bersaglio come lo vede `permissions.ts`: con i clienti a cui ha accesso. */
function managedUser(row: { id: number; username: string; role: string }): ManagedUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    tenantIds: getUserTenantAccess(row.id).map((a) => a.tenant_id),
  };
}

function unknownTenant(tenantIds: readonly number[]): boolean {
  if (tenantIds.length === 0) return false;
  const known = new Set(getTenants().map((t) => t.id));
  return tenantIds.some((id) => !known.has(id));
}

// ─── GET /api/users ───

/** Elenco: il superadmin vede tutti, l'admin solo gli utenti che può gestire. */
export function listUsersAs(session: SessionLike): UsersResult {
  const who = resolveUserManager(session);
  if (!who.ok) return fromDenial(who);

  const accessByUser = new Map<number, Array<{ tenant_id: number; codice_cliente: string; ragione_sociale: string; role: string }>>();
  for (const a of getAllUserTenantAccess()) {
    const list = accessByUser.get(a.user_id) ?? [];
    list.push({ tenant_id: a.tenant_id, codice_cliente: a.codice_cliente, ragione_sociale: a.ragione_sociale, role: a.role });
    accessByUser.set(a.user_id, list);
  }

  const users = getUsers().flatMap((user) => {
    const tenant_access = accessByUser.get(user.id) ?? [];
    const target: ManagedUser = {
      id: user.id,
      username: user.username,
      role: user.role,
      tenantIds: tenant_access.map((a) => a.tenant_id),
    };
    return canManageUser(who.actor, target) ? [{ ...user, tenant_access }] : [];
  });
  return { status: 200, body: users };
}

// ─── POST /api/users ───

export async function createUserAs(session: SessionLike, request: Request): Promise<UsersResult> {
  const who = resolveUserManager(session);
  if (!who.ok) return fromDenial(who);

  const read = await readBody(request);
  if (!read.ok) return fail(400, "JSON non valido");
  const b = read.body;

  const username = typeof b.username === "string" ? b.username : "";
  const password = typeof b.password === "string" ? b.password : "";
  if (!username || !password) return fail(400, "Username e password sono obbligatori");
  if (username.length < 3 || username.length > 50) {
    return fail(400, "Lo username deve avere tra 3 e 50 caratteri");
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
    return fail(400, "Lo username può contenere solo lettere, numeri, punti, trattini e underscore");
  }
  if (password.length < 8) return fail(400, "La password deve avere almeno 8 caratteri");
  if (isServiceUsername(username)) return fail(409, "Username riservato all'utenza di servizio Domarc");

  // Ruolo assente → viewer, come prima.
  const rawRole = b.role;
  const roleGiven = rawRole !== undefined && rawRole !== null && rawRole !== "";
  if (roleGiven && !isUserRole(rawRole)) return fail(400, INVALID_ROLE);
  const role: UserRole = isUserRole(rawRole) ? rawRole : "viewer";

  if (b.email !== undefined && b.email !== null && typeof b.email !== "string") {
    return fail(400, "Email non valida");
  }
  const email = typeof b.email === "string" ? b.email : null;

  const tenantInput = parseTenantIds(b.tenant_ids);
  if (tenantInput === "invalid") return fail(400, "Elenco clienti non valido");

  const decision = decideCreate(who.actor, { role, tenantIds: tenantInput });
  if (!decision.ok) return fromDenial(decision);
  if (unknownTenant(decision.tenantIds)) return fail(400, "Cliente non trovato");

  if (getUserByUsername(username)) return fail(409, "Username già in uso");

  const passwordHash = await bcrypt.hash(password, 12);
  // Utente e clienti insieme: niente utente creato a metà, senza clienti.
  const user = getHubDb().transaction(() => {
    const created = createUser(username, passwordHash, role, undefined, email);
    if (role !== "superadmin") {
      for (const tid of decision.tenantIds) setUserTenantAccess(created.id, tid, role);
    }
    return created;
  })();

  // Campi elencati uno per uno: una colonna nuova non esce da sola (password_hash mai).
  const safeUser = {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    tenant_id: user.tenant_id,
    created_at: user.created_at,
    last_login: user.last_login,
  };
  return { status: 201, body: safeUser };
}

// ─── PUT /api/users/[id] ───

export async function updateUserAs(session: SessionLike, rawId: string, request: Request): Promise<UsersResult> {
  const who = resolveUserManager(session);
  if (!who.ok) return fromDenial(who);

  const userId = parseId(rawId);
  if (userId === null) return fail(400, "ID utente non valido");

  const read = await readBody(request);
  if (!read.ok) return fail(400, "JSON non valido");
  const b = read.body;

  if (!isUserRole(b.role)) return fail(400, INVALID_ROLE);
  const role = b.role;

  const tenantInput = parseTenantIds(b.tenant_ids);
  if (tenantInput === "invalid") return fail(400, "Elenco clienti non valido");

  const user = getUserById(userId);
  if (!user) return fail(404, "Utente non trovato");

  const decision = decideUpdate(who.actor, managedUser(user), { role, tenantIds: tenantInput });
  if (!decision.ok) return fromDenial(decision);

  // Protezioni di prima: non resta l'installazione senza superadmin o senza amministratori.
  const hub = getHubDb();
  if (user.role === "superadmin" && role !== "superadmin") {
    const supers = hub.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'superadmin'").get() as { c: number };
    if (supers.c <= 1) return fail(400, "Impossibile modificare il ruolo dell'ultimo super amministratore");
  }
  if (user.role === "admin" && role === "viewer") {
    const admins = hub.prepare("SELECT COUNT(*) as c FROM users WHERE role IN ('admin', 'superadmin')").get() as { c: number };
    if (admins.c <= 1) return fail(400, "Impossibile rimuovere il ruolo admin dall'ultimo amministratore");
  }

  const newTenantIds = role === "superadmin" ? [] : decision.tenantIds;
  if (role !== "superadmin" && newTenantIds.length === 0) return fail(400, NEED_TENANT);
  if (unknownTenant(newTenantIds)) return fail(400, "Cliente non trovato");

  hub.transaction(() => {
    updateUserRole(userId, role);
    const currentAccess = getUserTenantAccess(userId);
    const wanted = new Set(newTenantIds);
    for (const a of currentAccess) {
      if (!wanted.has(a.tenant_id)) removeUserTenantAccess(userId, a.tenant_id);
    }
    for (const tid of wanted) {
      const existing = currentAccess.find((a) => a.tenant_id === tid);
      if (!existing || existing.role !== role) setUserTenantAccess(userId, tid, role);
    }
  })();

  return { status: 200, body: { success: true, message: "Utente aggiornato" } };
}

// ─── DELETE /api/users/[id] ───

export function deleteUserAs(session: SessionLike, rawId: string): UsersResult {
  const who = resolveUserManager(session);
  if (!who.ok) return fromDenial(who);

  const userId = parseId(rawId);
  if (userId === null) return fail(400, "ID utente non valido");

  const user = getUserById(userId);
  if (!user) return fail(404, "Utente non trovato");

  const decision = decideDelete(who.actor, managedUser(user));
  if (!decision.ok) return fromDenial(decision);

  try {
    if (!deleteUser(userId)) return fail(404, "Utente non trovato");
  } catch (err) {
    if (err instanceof Error && err.message.includes("ultimo amministratore")) return fail(400, err.message);
    throw err;
  }
  return { status: 200, body: { success: true, message: "Utente eliminato" } };
}

// ─── POST /api/users/[id]/reset-password ───

// ─── POST /api/users/[id]/seconda-verifica ───

const AZIONI_SECONDA_VERIFICA = ["richiedi", "azzera", "togli"] as const;
type AzioneSecondaVerifica = (typeof AZIONI_SECONDA_VERIFICA)[number];

const ESITO_SECONDA_VERIFICA: Record<AzioneSecondaVerifica, string> = {
  richiedi: "verifica in due passaggi richiesta: al prossimo accesso vedrà il QR",
  azzera: "verifica in due passaggi azzerata: al prossimo accesso vedrà un QR nuovo",
  togli: "verifica in due passaggi tolta: entra con la sola password",
};

/**
 * Verifica in due passaggi decisa dall'admin (Riccardo, 20/10; ADR 0023): regole in
 * `decideSecondaVerifica`. Ogni azione va nel registro degli accessi.
 */
export async function secondaVerificaAs(session: SessionLike, rawId: string, request: Request): Promise<UsersResult> {
  const who = resolveUserManager(session);
  if (!who.ok) return fromDenial(who);

  const userId = parseId(rawId);
  if (userId === null) return fail(400, "ID utente non valido");

  const read = await readBody(request);
  if (!read.ok) return fail(400, "JSON non valido");
  const azione = read.body.azione;
  if (typeof azione !== "string" || !(AZIONI_SECONDA_VERIFICA as readonly string[]).includes(azione)) {
    return fail(400, "Azione non valida: richiedi, azzera o togli");
  }

  const user = getUserById(userId);
  if (!user) return fail(404, "Utente non trovato");

  const a = azione as AzioneSecondaVerifica;
  const decision = decideSecondaVerifica(who.actor, managedUser(user), a);
  if (!decision.ok) return fromDenial(decision);

  impostaSecondaVerifica(userId, a);
  scriviRegistroAccessi({
    azione: `seconda_verifica_${a}`,
    utente: user.username,
    utenteId: user.id,
    da: session.user?.name ?? "?",
  });
  return { status: 200, body: { success: true, message: `«${user.username}»: ${ESITO_SECONDA_VERIFICA[a]}` } };
}

export async function resetPasswordAs(session: SessionLike, rawId: string, request: Request): Promise<UsersResult> {
  const who = resolveUserManager(session);
  if (!who.ok) return fromDenial(who);

  const userId = parseId(rawId);
  if (userId === null) return fail(400, "ID utente non valido");

  const read = await readBody(request);
  if (!read.ok) return fail(400, "JSON non valido");

  const newPassword = typeof read.body.new_password === "string" ? read.body.new_password : "";
  if (newPassword.length < 8) return fail(400, "La nuova password deve avere almeno 8 caratteri");

  const user = getUserById(userId);
  if (!user) return fail(404, "Utente non trovato");

  const decision = decideResetPassword(who.actor, managedUser(user));
  if (!decision.ok) return fromDenial(decision);

  updateUserPassword(userId, await bcrypt.hash(newPassword, 12));
  return { status: 200, body: { success: true, message: `Password di "${user.username}" reimpostata` } };
}
