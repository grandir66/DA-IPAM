/**
 * Reset del tenant per demo, pre-consegna o nuovo cliente (anche POST /api/reset).
 *
 * Decisione di Riccardo (19/10, analisi F02): via dati di rete, credenziali,
 * inventario e job; restano le impostazioni del cliente e gli utenti dell'hub.
 *
 * Revisione del 19/10: prima si cancellava un elenco scelto a mano, e restavano
 * controller di rete (con le password), telefoni, agenti Wazuh, vulnerabilità,
 * apparati fisici e topologia del cliente di prima. Ora la regola è capovolta:
 * si dichiara cosa RESTA (`TABELLE_TENUTE`) e si svuota ogni altra tabella del
 * DB del tenant, comprese quelle che nasceranno dopo.
 */
import { setSetting, setTenantOnboardingCompleted } from "./db-hub";
import { getTenantDb, withTenant } from "./db-tenant";
import { invalidateModulesHealth } from "./modules/health";
import { chiaveProgresso } from "./onboarding/progresso";

/**
 * Le sole tabelle del tenant che il reset non tocca: impostazioni e configurazione
 * dei moduli dell'appliance (lo scanner Edge, il server MeshCentral, il server MDM,
 * la lettura Zabbix) e il catalogo delle classificazioni scritte a mano.
 */
export const TABELLE_TENUTE: readonly string[] = [
  "tenant_settings",
  "settings",
  "vuln_scanners",
  "mc_config",
  "mdm_config",
  "zabbix_lettura_config",
  "device_classifications_custom",
];

export interface LabConfigResetResult {
  tenantCode: string;
  clearedTables: string[];
  onboardingReset: true;
}

/** Svuota ogni tabella del tenant fuori da TABELLE_TENUTE e riapre il wizard di questo tenant. */
export function resetLabNetworkConfig(tenantCode: string): LabConfigResetResult {
  const cleared: string[] = [];

  withTenant(tenantCode, () => {
    const db = getTenantDb(tenantCode);
    const tabelle = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]
    ).map((r) => r.name).filter((t) => !TABELLE_TENUTE.includes(t));

    // Le FK si spengono FUORI dalla transazione (dentro è un no-op): si svuota tutto,
    // l'ordine fra padri e figli non conta.
    db.pragma("foreign_keys = OFF");
    try {
      db.transaction(() => {
        for (const t of tabelle) {
          const n = (db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n;
          if (n === 0) continue;
          db.prepare(`DELETE FROM "${t}"`).run();
          cleared.push(`${t}(${n})`);
        }
      })();
    } finally {
      db.pragma("foreign_keys = ON");
    }
  });

  // Solo il flag di questo tenant: quello globale apre requireAdminOrOnboarding su
  // tutta l'installazione (revisione del 19/10).
  setTenantOnboardingCompleted(tenantCode, false);
  // Il punto raggiunto nel wizard: router, rete e credenziali non ci sono più,
  // e riaprendo si ripartiva dall'ultimo passo con niente dietro (revisione
  // della tappa 4 credenziali, 15/10).
  setSetting(chiaveProgresso(tenantCode), "");
  invalidateModulesHealth(tenantCode);

  return {
    tenantCode,
    clearedTables: cleared,
    onboardingReset: true,
  };
}
