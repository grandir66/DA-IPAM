import path from "path";

/**
 * Directory UNICA dei dati persistenti dell'applicazione:
 * hub.db, tenant DB (`tenants/<code>.db`), client-config, sorgente dei backup.
 *
 * SORGENTE DI VERITÀ SINGOLA per il data dir. Rispetta `DA_INVENT_DATA_DIR`
 * (deploy systemd/Docker che montano un volume dati esterno — es.
 * `/var/lib/docker/volumes/appliance-stack_ipam_data/_data`) con fallback a
 * `<cwd>/data` per dev locale e install systemd senza volume.
 *
 * ⚠️ Ogni modulo che legge/scrive DB o dati utente persistenti DEVE usare questo
 * helper. NON duplicare `path.join(process.cwd(), "data")`: la divergenza tra
 * moduli (alcuni onoravano `DA_INVENT_DATA_DIR`, altri no) è la causa del bug
 * "il service legge i DB dal posto sbagliato → parte il wizard di setup e i dati
 * risultano vuoti" (incident 2026-06-25 su .50 dopo migrazione Docker→systemd).
 *
 * Distinzioni (NON usare questo helper):
 * - SEGRETI (`.env.local` / `ENCRYPTION_KEY`): logica separata in
 *   `env-secrets.ts` (`resolveEnvSecretsPath`) — su systemd vivono in `<cwd>`.
 * - ASSET read-only del deploy (`package-dictionary.json`, OUI mac-vendor):
 *   arrivano col checkout e restano in `<cwd>/data`, non nel volume dati.
 */
export function resolveDataDir(): string {
  return process.env.DA_INVENT_DATA_DIR?.trim() || path.join(process.cwd(), "data");
}
