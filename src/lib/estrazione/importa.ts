/**
 * Import dell'estrazione del tecnico in un apparato (Riccardo, 09/11/2026: «inghiottire il json»). Lo stesso percorso del
 * pulsante «Aggiorna» con l'acquisizione modulare: archivio (`salvaSnapshot`), proiezioni sull'apparato (`applicaSnapshot`),
 * e la Mappa porte prende lo strato «parser» dall'ultimo snapshot da sola. In più le rotte in `routing_table`.
 * Va chiamata dentro il contesto del tenant (`withTenantFromSession`).
 */
import { salvaSnapshot, contieneSegreto } from "@/lib/acquisizione-modulare/archivio";
import { applicaSnapshot, type EsitoApplicazione } from "@/lib/acquisizione-modulare/applica";
import { lettoreDb, segretiDi } from "@/lib/acquisizione-modulare/richiesta";
import { getCurrentTenantCode, getDeviceCredentialBindings, getNetworkDeviceById, getTenantDb, upsertRoutes } from "@/lib/db-tenant";
import { safeDecrypt } from "@/lib/crypto";
import type { UsoSegreto } from "@/lib/credentials/segreti";
import { COLLECTOR_IDS } from "@/lib/acquisition/catalogo";
import { famigliaDaTipo, righeRotte, stessoApparato, validaBusta } from "./busta";

export type EsitoImport =
  | { ok: true; snapshotId: number; collector: string; nelCatalogo: boolean; applicazione: EsitoApplicazione; rotte: number | null }
  | { ok: false; status: 400 | 404 | 409 | 422; errore: string; dettagli?: string[] };

const USI: ReadonlySet<string> = new Set(["ssh", "snmp", "api", "winrm"]);

/** I segreti delle credenziali dell'apparato: se uno compare nello snapshot, l'import si rifiuta senza dire quale. */
function segretiApparato(deviceId: number): string[] {
  const code = getCurrentTenantCode();
  if (!code) return [];
  const leggi = lettoreDb(getTenantDb(code));
  const out: string[] = [];
  for (const b of getDeviceCredentialBindings(deviceId)) {
    if (b.inline_encrypted_password) {
      const p = safeDecrypt(b.inline_encrypted_password);
      if (p) out.push(p);
    }
    if (b.credential_id == null || !USI.has(b.protocol_type)) continue;
    for (const v3 of [false, true]) {
      const e = leggi(b.credential_id, b.protocol_type as UsoSegreto, v3);
      if (e.ok) out.push(...segretiDi(e.segreto));
    }
  }
  return out.filter((s) => s.length >= 3);
}

export function importaEstrazione(deviceId: number, dato: unknown, utente: { id: number | null; nome: string | null }): EsitoImport {
  const device = getNetworkDeviceById(deviceId);
  if (!device) return { ok: false, status: 404, errore: "Apparato non trovato" };
  const v = validaBusta(dato, famigliaDaTipo(device.device_type));
  if (!v.ok) return { ok: false, status: 422, errore: "Estrazione non conforme al formato da-ipam-estrazione 1.0", dettagli: v.errori };
  const stesso = stessoApparato(device, v.busta, v.snapshot);
  if (!stesso.ok) return { ok: false, status: 409, errore: stesso.motivo };
  const segreti = segretiApparato(deviceId);
  if (contieneSegreto(v.snapshot, segreti)) return { ok: false, status: 422, errore: "L'estrazione contiene una credenziale dell'apparato: non si importa" };

  const snapshotId = salvaSnapshot(deviceId, v.snapshot, { credenziali: {}, utente, segreti, trigger: "import_tecnico" });
  const applicazione = applicaSnapshot(deviceId, snapshotId, v.snapshot);
  const r = v.snapshot.routes;
  let rotte: number | null = null;
  if (r && (r.status === "ok" || r.status === "partial")) {
    const righe = righeRotte(r.data);
    upsertRoutes(deviceId, righe); // DELETE + INSERT in una transazione (regola 7)
    rotte = righe.length;
  }
  const nelCatalogo = (COLLECTOR_IDS as readonly string[]).includes(v.snapshot.collector);
  return { ok: true, snapshotId, collector: v.snapshot.collector, nelCatalogo, applicazione, rotte };
}
