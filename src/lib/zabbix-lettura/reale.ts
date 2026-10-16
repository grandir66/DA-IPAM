/**
 * Le dipendenze vere del pannello Zabbix, per le rotte: DB del tenant della sessione,
 * diritto dall'offerta, trasporto TLS, proxy della macchina, orologio.
 *
 * `db-tenant` si importa solo staticamente (regola 14, ADR 0002).
 */
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { opzioneAcquistata } from "@/lib/modules/offerta";
import { normalizzaBase } from "./client";
import { leggiProxyLocale } from "./proxy-locale";
import type { DipendenzePannello } from "./servizio";
import { trasportoTls } from "./trasporto";

/** Da chiamare dentro `withTenantFromSession`. */
export function dipendenzeReali(): DipendenzePannello {
  const tenant = getCurrentTenantCode();
  if (!tenant) throw new Error("pannello Zabbix: nessun cliente nel contesto");
  return {
    tenant,
    db: getTenantDb(tenant),
    acquistato: () => opzioneAcquistata("zabbix"),
    trasporto: (cfg, chiave) =>
      trasportoTls({ base: new URL(normalizzaBase(cfg.baseUrl)), chiave, impronta: cfg.impronta }),
    proxyLocale: leggiProxyLocale,
    adesso: () => new Date(),
  };
}
