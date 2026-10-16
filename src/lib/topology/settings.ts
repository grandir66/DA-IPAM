/**
 * Soglia «non visto» dei collegamenti (decisione di Riccardo, 13/10: 2 giorni;
 * con una lettura UniFi al giorno un giorno esatto farebbe diventare grigio
 * tutto a ogni lettura in ritardo). Impostazione dell'hub: un'installazione =
 * un cliente.
 */
import { getSetting, setSetting } from "@/lib/db-hub";
import { DEFAULT_STALE_DAYS } from "@/lib/topology/links";

const KEY = "topology_link_stale_days";
export const LINK_STALE_DAYS_MIN = 1;
export const LINK_STALE_DAYS_MAX = 30;

export function getLinkStaleDays(): number {
  const n = Number(getSetting(KEY));
  return Number.isInteger(n) && n >= LINK_STALE_DAYS_MIN && n <= LINK_STALE_DAYS_MAX ? n : DEFAULT_STALE_DAYS;
}

export function setLinkStaleDays(days: number): void {
  if (!Number.isInteger(days) || days < LINK_STALE_DAYS_MIN || days > LINK_STALE_DAYS_MAX) {
    throw new Error(`La soglia va da ${LINK_STALE_DAYS_MIN} a ${LINK_STALE_DAYS_MAX} giorni`);
  }
  setSetting(KEY, String(days));
}
