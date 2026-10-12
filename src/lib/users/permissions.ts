/**
 * Chi può gestire quali utenti (UI-18, tappa 1 del piano di miglioramento).
 *
 * Decisioni pure, senza database. Tutte le rotte /api/users* passano dal
 * servizio `service.ts`, che legge dal database chi chiede (l'attore) e
 * l'utente su cui agisce (il bersaglio) e poi chiede il permesso qui.
 * Prove: `__tests__/permissions.test.ts` (tutte le combinazioni) e
 * `__tests__/service.test.ts` (le stesse regole sul database vero).
 *
 * Le regole:
 * - **superadmin**: tutto, come prima. L'unico limite resta: non elimina sé stesso.
 * - **admin**: solo gli utenti dei clienti che amministra. TUTTI i clienti
 *   dell'utente devono essere fra i suoi: reimpostare la password di chi ha
 *   accesso anche a un altro cliente vorrebbe dire entrare in quel cliente.
 *   Mai un superadmin, mai il ruolo superadmin. Non elimina sé stesso, non si
 *   toglie il ruolo admin e non cambia i propri clienti: un'installazione non
 *   deve restare senza amministratori. Gli utenti che crea vanno nel suo cliente.
 * - **viewer**: nessuna gestione. Lo esclude già `resolveUserManager`, prima
 *   di arrivare qui.
 */

export type UserRole = "superadmin" | "admin" | "viewer";

export const USER_ROLES: readonly UserRole[] = ["superadmin", "admin", "viewer"];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

/** Chi gestisce: un superadmin o un admin (mai un viewer). */
export interface UserManager {
  role: "superadmin" | "admin";
  /** id della riga in hub.users; null per l'utenza di servizio, che non ha riga. */
  userId: number | null;
  username: string;
  /** Clienti che amministra (accesso con ruolo admin). Per il superadmin non serve: vuoto. */
  tenantIds: readonly number[];
  /** Cliente su cui sta lavorando, solo se è fra quelli che amministra. */
  currentTenantId: number | null;
}

/** L'utente su cui si agisce, con i clienti a cui ha accesso. */
export interface ManagedUser {
  id: number;
  username: string;
  role: string;
  tenantIds: readonly number[];
}

export type Denial = { ok: false; status: 400 | 403; error: string };
export type Decision = { ok: true } | Denial;
/** Decisione che porta con sé i clienti da assegnare. */
export type TenantDecision = { ok: true; tenantIds: number[] } | Denial;

const deny = (status: 400 | 403, error: string): Denial => ({ ok: false, status, error });

const NEED_TENANT = "Seleziona almeno un cliente per questo ruolo";
const NOT_SUPERADMIN_ROLE = "Non puoi assegnare il ruolo di super amministratore";
const ONLY_OWN_TENANTS = "Puoi assegnare solo i clienti che amministri";

function isSubset(values: readonly number[], allowed: readonly number[]): boolean {
  return values.every((v) => allowed.includes(v));
}

function isSameSet(a: readonly number[], b: readonly number[]): boolean {
  return isSubset(a, b) && isSubset(b, a);
}

/** Ruoli che l'attore può assegnare: l'admin mai superadmin. */
export function assignableRoles(actor: UserManager): UserRole[] {
  return actor.role === "superadmin" ? ["superadmin", "admin", "viewer"] : ["admin", "viewer"];
}

/**
 * Il bersaglio è l'attore stesso. Per username, come faceva la rotta di
 * eliminazione, oppure per id quando l'attore ha una riga.
 */
export function isSelf(actor: UserManager, target: Pick<ManagedUser, "id" | "username">): boolean {
  return target.username === actor.username || (actor.userId !== null && actor.userId === target.id);
}

/**
 * L'attore può vedere e gestire questo utente. Per l'admin: non un superadmin,
 * almeno un cliente, e tutti i suoi clienti fra quelli che l'admin amministra.
 */
export function canManageUser(actor: UserManager, target: ManagedUser): boolean {
  if (actor.role === "superadmin") return true;
  if (target.role === "superadmin") return false;
  if (target.tenantIds.length === 0) return false;
  return isSubset(target.tenantIds, actor.tenantIds);
}

/** Il rifiuto per un bersaglio che l'admin non gestisce: sempre 403. */
function denyTarget(target: ManagedUser, superadminMessage: string): Denial {
  return target.role === "superadmin"
    ? deny(403, superadminMessage)
    : deny(403, "L'utente ha accesso a clienti che non amministri");
}

/** Clienti predefiniti per un utente nuovo creato da un admin: il suo cliente. */
function defaultTenantsFor(actor: UserManager): number[] {
  if (actor.currentTenantId !== null) return [actor.currentTenantId];
  if (actor.tenantIds.length === 1) return [actor.tenantIds[0]];
  return [];
}

/**
 * Creazione. Il superadmin come prima (i ruoli diversi da superadmin vogliono
 * almeno un cliente). L'admin crea solo admin e viewer, nei suoi clienti; se
 * non ne indica, l'utente va nel cliente su cui sta lavorando.
 */
export function decideCreate(
  actor: UserManager,
  input: { role: UserRole; tenantIds?: readonly number[] },
): TenantDecision {
  if (actor.role === "superadmin") {
    if (input.role === "superadmin") return { ok: true, tenantIds: [] };
    if (!input.tenantIds || input.tenantIds.length === 0) return deny(400, NEED_TENANT);
    return { ok: true, tenantIds: [...input.tenantIds] };
  }
  if (input.role === "superadmin") return deny(403, NOT_SUPERADMIN_ROLE);
  const tenantIds =
    input.tenantIds && input.tenantIds.length > 0 ? [...input.tenantIds] : defaultTenantsFor(actor);
  if (tenantIds.length === 0) return deny(400, NEED_TENANT);
  if (!isSubset(tenantIds, actor.tenantIds)) return deny(403, ONLY_OWN_TENANTS);
  return { ok: true, tenantIds };
}

/**
 * Modifica di ruolo e clienti. Restituisce i clienti da assegnare; il controllo
 * «almeno un cliente» e le protezioni sull'ultimo amministratore restano nel
 * servizio, nello stesso ordine di prima.
 *
 * Per l'admin, clienti non indicati = restano quelli che l'utente ha già.
 */
export function decideUpdate(
  actor: UserManager,
  target: ManagedUser,
  input: { role: UserRole; tenantIds?: readonly number[] },
): TenantDecision {
  if (actor.role === "superadmin") {
    return { ok: true, tenantIds: input.role === "superadmin" ? [] : [...(input.tenantIds ?? [])] };
  }
  if (!canManageUser(actor, target)) {
    return denyTarget(target, "Non puoi modificare un super amministratore");
  }
  if (input.role === "superadmin") return deny(403, NOT_SUPERADMIN_ROLE);
  const tenantIds = input.tenantIds !== undefined ? [...input.tenantIds] : [...target.tenantIds];
  if (!isSubset(tenantIds, actor.tenantIds)) return deny(403, ONLY_OWN_TENANTS);
  if (isSelf(actor, target)) {
    if (input.role !== "admin") {
      return deny(400, "Non puoi toglierti il ruolo di amministratore: chiedilo a un altro amministratore");
    }
    if (!isSameSet(tenantIds, target.tenantIds)) {
      return deny(400, "Non puoi cambiare i clienti del tuo account: chiedilo a un altro amministratore");
    }
  }
  return { ok: true, tenantIds };
}

/** Eliminazione. Nessuno elimina sé stesso (come prima); l'admin solo i suoi utenti. */
export function decideDelete(actor: UserManager, target: ManagedUser): Decision {
  if (isSelf(actor, target)) return deny(400, "Non puoi eliminare il tuo stesso account");
  if (!canManageUser(actor, target)) {
    return denyTarget(target, "Non puoi eliminare un super amministratore");
  }
  return { ok: true };
}

/** Reimpostazione della password. L'admin solo per i suoi utenti, mai per un superadmin. */
export function decideResetPassword(actor: UserManager, target: ManagedUser): Decision {
  if (!canManageUser(actor, target)) {
    return denyTarget(target, "Non puoi reimpostare la password di un super amministratore");
  }
  return { ok: true };
}
