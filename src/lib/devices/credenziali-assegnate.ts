/**
 * «Credenziali assegnate» della scheda apparato (tappa 5, 21/10): la credenziale che il motore usa
 * davvero per ogni protocollo (`usata_adesso`), con l'esito dell'ultima prova del suo binding.
 * Modulo puro: lo usano la scheda e le prove.
 */
import type { UsataAdesso } from "@/lib/devices/usata-adesso";

/** Il pezzo di un binding che serve qui (la riga di `device_credential_bindings`). */
export interface BindingPerEsito {
  id: number;
  credential_id: number | null;
  protocol_type: string;
  test_status: "success" | "failed" | "untested";
  tested_at: string | null;
}

export type EsitoBinding = "riuscita" | "rifiutata" | "non_provata";

export interface RigaAssegnata {
  key: string;
  /** Nome della voce d'archivio, o «public» / «Nessuna». */
  nome: string;
  /** «SSH · 22», «SNMP · 161». */
  per: string;
  /** Com'è stata scelta («binding dell'apparato», «ripiego dichiarato») o perché manca. */
  nota: string;
  esito: EsitoBinding;
  testedAt: string | null;
  /** Il binding da provare; null = nessuno (ripiego «public» o nessuna credenziale). */
  bindingId: number | null;
}

const ESITO: Record<BindingPerEsito["test_status"], EsitoBinding> = {
  success: "riuscita",
  failed: "rifiutata",
  untested: "non_provata",
};

function etichettaProtocollo(p: string): string {
  return p === "snmp" ? "SNMP" : p === "winrm" ? "WinRM" : p === "api" ? "API" : p.toUpperCase();
}

/** Una riga per ogni credenziale scelta dal motore, abbinata al suo binding per voce e protocollo. */
export function righeAssegnate(usate: readonly UsataAdesso[], bindings: readonly BindingPerEsito[], nomeFonte: (f: NonNullable<UsataAdesso["fonte"]>) => string, versioneSnmp?: string | null): RigaAssegnata[] {
  return usate.map((u) => {
    const b = u.credential_id != null ? bindings.find((x) => x.credential_id === u.credential_id && x.protocol_type === u.protocollo) : undefined;
    const per = `${etichettaProtocollo(u.protocollo)}${u.protocollo === "snmp" && versioneSnmp ? ` ${versioneSnmp}` : ""}${u.porta != null ? ` · ${u.porta}` : ""}`;
    return {
      key: `${u.ruolo}-${u.protocollo}`,
      nome: u.nome ?? "Nessuna",
      per,
      nota: u.fonte == null ? (u.motivo ?? "Nessuna credenziale") : nomeFonte(u.fonte),
      esito: b ? ESITO[b.test_status] : "non_provata",
      testedAt: b?.tested_at ?? null,
      bindingId: b?.id ?? null,
    };
  });
}

/** Vero se l'apparato non ha nessun binding con prova riuscita: la scheda e le liste lo segnalano. */
export function senzaCredenzialeProvata(bindings: readonly Pick<BindingPerEsito, "test_status">[]): boolean {
  return !bindings.some((b) => b.test_status === "success");
}

/** Per le liste, che non hanno i binding: apparato (ha `device_id`) senza nessun protocollo validato sull'host. */
export function hostGestitoSenzaProva(deviceId: number | null | undefined, protocolliValidati: readonly string[] | null | undefined): boolean {
  return deviceId != null && (protocolliValidati?.length ?? 0) === 0;
}
