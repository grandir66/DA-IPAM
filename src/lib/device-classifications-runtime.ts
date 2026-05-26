/**
 * Runtime layer per le classification custom per-tenant (v0.2.632).
 *
 * Le funzioni in [device-classifications.ts] restano pure/sync e basate solo
 * sui built-in. Qui aggiungiamo un layer che fetcha dal tenant DB e fonde con
 * il catalog statico. Cache in-memory per evitare query a ogni request.
 *
 * Il caller fornisce esplicitamente il tenant code: NON usiamo
 * `getCurrentTenantCode()` qui dentro per restare riutilizzabile fuori dal
 * contesto AsyncLocalStorage (es. tool CLI, test).
 *
 * Invalidazione: chiamare `invalidateCustomClassificationsCache(tenant)` dopo
 * POST/PUT/DELETE. Senza invalidazione il TTL di 60s scade naturalmente.
 */

import {
  DEVICE_CLASSIFICATIONS_ORDERED,
  getClassificationLabel,
  getDeviceCategoryGroup,
  type DeviceCategoryGroup,
} from "./device-classifications";
import { listCustomClassifications, withTenant, type CustomClassificationRow } from "./db-tenant";

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  items: CustomClassificationRow[];
  expires: number;
}

const cache = new Map<string, CacheEntry>();

function fetchFromDb(tenant: string): CustomClassificationRow[] {
  return withTenant(tenant, () => listCustomClassifications());
}

export function getCustomClassifications(tenant: string | null | undefined): CustomClassificationRow[] {
  if (!tenant) return [];
  const cached = cache.get(tenant);
  if (cached && cached.expires > Date.now()) return cached.items;
  try {
    const items = fetchFromDb(tenant);
    cache.set(tenant, { items, expires: Date.now() + CACHE_TTL_MS });
    return items;
  } catch (e) {
    console.warn(`[device-classifications-runtime] fetch failed for tenant ${tenant}:`, e);
    return cached?.items ?? [];
  }
}

export function invalidateCustomClassificationsCache(tenant: string | null | undefined): void {
  if (!tenant) return;
  cache.delete(tenant);
}

/** Union di built-in + custom (slug only, ordinati per label visibile). */
export function getAllClassifications(tenant: string | null | undefined): string[] {
  const custom = getCustomClassifications(tenant).map((c) => c.slug);
  return [...DEVICE_CLASSIFICATIONS_ORDERED, ...custom];
}

/** Label effettiva: custom prevale sul built-in. */
export function getEffectiveClassificationLabel(slug: string, tenant: string | null | undefined): string {
  const c = getCustomClassifications(tenant).find((x) => x.slug === slug);
  if (c) return c.label;
  return getClassificationLabel(slug);
}

/** Macro-categoria effettiva: per custom, eredita dal parent. */
export function getEffectiveDeviceCategoryGroup(slug: string, tenant: string | null | undefined): DeviceCategoryGroup {
  const c = getCustomClassifications(tenant).find((x) => x.slug === slug);
  if (c) return getDeviceCategoryGroup(c.parent_slug);
  return getDeviceCategoryGroup(slug);
}
