/**
 * Con quale utenza si scrive sul DNS del DC (Riccardo, 17/11/2026: «per Domarc usiamo quella
 * memorizzata, per la configurazione generale prevediamone una dedicata»).
 *
 * Spento di serie. Acceso: la voce Windows dedicata (`dns_credential_id`, gruppi DnsAdmins e
 * Remote Management Users) se c'è; altrimenti la voce WinRM del DC SOLO se un amministratore ha
 * messo `dns_usa_winrm_dc`. Mai l'account LDAP come ripiego: niente utenza = niente scrittura,
 * e si dice cosa manca.
 */
import type { AdIntegration } from "@/lib/db-tenant";
import { accessoWinrmDelDc } from "@/lib/ad/credenziale-ldap";

export type AccessoDns =
  | { ok: true; fonte: "dedicata" | "winrm_dc"; nome: string; username: string; password: string; port: number }
  | { ok: false; motivo: string };

/** Lo stato per la pagina, senza segreti. */
export type StatoScritturaDns = { accesa: true; fonte: "dedicata" | "winrm_dc"; utenza: string } | { accesa: false; motivo: string };

export const SCRITTURA_DNS_SPENTA = "Le correzioni del DNS sono spente per questo dominio";

export function accessoDnsDi(integrazione: AdIntegration, leggi: typeof accessoWinrmDelDc = accessoWinrmDelDc): AccessoDns {
  if (!integrazione.dns_scrittura) return { ok: false, motivo: SCRITTURA_DNS_SPENTA };
  if (integrazione.dns_credential_id) {
    const a = leggi(integrazione.dns_credential_id);
    return a.ok ? { ...a, fonte: "dedicata" } : { ok: false, motivo: `Utenza dedicata al DNS non utilizzabile: ${a.motivo}` };
  }
  if (integrazione.dns_usa_winrm_dc && integrazione.winrm_credential_id) {
    const a = leggi(integrazione.winrm_credential_id);
    return a.ok ? { ...a, fonte: "winrm_dc" } : { ok: false, motivo: `Voce WinRM del DC non utilizzabile: ${a.motivo}` };
  }
  return { ok: false, motivo: "Manca l'utenza: scegli una voce Windows dedicata al DNS, oppure consenti l'uso della voce WinRM del DC" };
}

export function statoScritturaDns(integrazione: AdIntegration, leggi: typeof accessoWinrmDelDc = accessoWinrmDelDc): StatoScritturaDns {
  const a = accessoDnsDi(integrazione, leggi);
  return a.ok ? { accesa: true, fonte: a.fonte, utenza: a.nome } : { accesa: false, motivo: a.motivo };
}
