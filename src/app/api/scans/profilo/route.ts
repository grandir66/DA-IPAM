/**
 * POST /api/scans/profilo — esegue un profilo di scansione sugli host SCELTI.
 *
 * `host_ids` e' obbligatorio, come per `credential_validate`: sono scansioni
 * lunghe e, col profilo IoT/OT, pacchetti verso apparati di campo. Si decide
 * nella lista quali host, non "tutta la rete".
 *
 * Il giro parte in sottofondo e si segue da `/api/scans/progress/[jobId]`,
 * come le altre scansioni.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getHostById, getNetworkById } from "@/lib/db";
import { getCurrentTenantCode, getTenantSetting, withTenant } from "@/lib/db-tenant";
import { withTenantFromSession } from "@/lib/api-tenant";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { registraProgresso, aggiornaProgresso } from "@/lib/scanner/discovery";
import {
  prendiRete,
  isScanInCorso,
  corpoScanInCorso,
  sogliaAllarmeDa,
  CHIAVE_SOGLIA_ALLARME,
} from "@/lib/scanner/network-scan-lock";
import { profiloPerId } from "@/lib/scanner/profili/profili";
import { eseguiProfilo } from "@/lib/scanner/profili/motore";
import { salvaEsitoProfilo } from "@/lib/scanner/profili/salva";
import type { ScanProgress } from "@/types";

const Corpo = z.object({
  network_id: z.coerce.number().int().positive(),
  profilo: z.enum(["approfondito", "iot_ot"]),
  host_ids: z.array(z.coerce.number().int().positive()).min(1, "Seleziona almeno un host"),
});

/** Ultime 200 righe di registro: il resto non serve e la mappa sta in memoria. */
const RIGHE_REGISTRO = 200;

let contatore = Date.now();

export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) {
      return NextResponse.json({ error: "Scansione senza contesto tenant: non avviata" }, { status: 500 });
    }

    const parsed = Corpo.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { network_id: networkId, host_ids: hostIds } = parsed.data;

    const profilo = profiloPerId(parsed.data.profilo);
    if (!profilo) {
      return NextResponse.json({ error: "Profilo sconosciuto" }, { status: 400 });
    }
    const network = getNetworkById(networkId);
    if (!network) {
      return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
    }

    /* Solo host che appartengono DAVVERO a questa rete: l'id arriva dal client.
     * La mappa IP -> id si costruisce qui e si passa al salvataggio: risolvere
     * l'IP a valle userebbe `getHostByIp`, che non guarda la rete, e con lo
     * stesso indirizzo in due reti scriverebbe sull'host sbagliato. */
    const hostPerIp = new Map<string, number>();
    for (const id of hostIds) {
      const h = getHostById(id);
      if (h && h.network_id === networkId) hostPerIp.set(h.ip, id);
    }
    const ips = [...hostPerIp.keys()];
    if (ips.length === 0) {
      return NextResponse.json(
        { error: "Nessun host valido tra quelli selezionati per questa rete" },
        { status: 400 }
      );
    }

    const id = `profilo-${++contatore}-${Date.now()}`;
    let sogliaAllarmeMinuti: number | undefined;
    try {
      sogliaAllarmeMinuti = sogliaAllarmeDa(getTenantSetting(CHIAVE_SOGLIA_ALLARME));
    } catch {
      sogliaAllarmeMinuti = undefined;
    }

    let rilasciaRete: () => void;
    try {
      rilasciaRete = prendiRete(
        tenantCode,
        networkId,
        { scanId: id, scanType: `profilo_${profilo.id}` },
        { sogliaAllarmeMinuti }
      );
    } catch (e) {
      if (isScanInCorso(e)) return NextResponse.json(corpoScanInCorso(e.giro), { status: 409 });
      throw e;
    }

    const progress: ScanProgress = {
      id,
      network_id: networkId,
      scan_type: `profilo_${profilo.id}`,
      status: "running",
      total: ips.length,
      scanned: 0,
      found: 0,
      phase: `${profilo.nome}: avvio su ${ips.length} host`,
      started_at: new Date().toISOString(),
      logs: [],
    };
    registraProgresso(progress);

    const righe: string[] = [];
    const giro = async () => {
      try {
        const esito = await eseguiProfilo(profilo, ips, {
          onLog: (m) => {
            righe.push(m);
            if (righe.length > RIGHE_REGISTRO) righe.splice(0, righe.length - RIGHE_REGISTRO);
            aggiornaProgresso(id, { logs: [...righe] });
          },
        });
        aggiornaProgresso(id, { scanned: esito.host.length, phase: `${profilo.nome}: salvataggio` });
        const salvato = salvaEsitoProfilo(esito, hostPerIp);
        const avvisi: string[] = [];
        if (esito.scriptMancanti.length > 0) {
          avvisi.push(`script non presenti su questa macchina: ${esito.scriptMancanti.join(", ")}`);
        }
        if (esito.osDetectionSaltata) avvisi.push("riconoscimento del sistema operativo saltato (privilegi)");
        if (salvato.ipSenzaHost.length > 0) {
          avvisi.push(`${salvato.ipSenzaHost.length} IP senza host in archivio`);
        }
        aggiornaProgresso(id, {
          status: "completed",
          scanned: esito.host.length,
          found: salvato.rilieviScritti,
          phase:
            `${profilo.nome} completato: ${salvato.rilieviScritti} rilievi su ${salvato.hostToccati} host, ` +
            `${salvato.campiRiempiti} campi riempiti, ${salvato.evidenzeScritte} evidenze` +
            (avvisi.length > 0 ? ` — ${avvisi.join("; ")}` : ""),
          logs: [...righe],
        });
      } catch (e) {
        aggiornaProgresso(id, {
          status: "failed",
          phase: `${profilo.nome} fallito`,
          error: e instanceof Error ? e.message : "errore sconosciuto",
          logs: [...righe],
        });
      } finally {
        rilasciaRete();
      }
    };

    /* Come `discoverNetwork`: il giro riparte dentro il contesto del tenant e
     * NON si attende, cosi' la rotta risponde subito. */
    void withTenant(tenantCode, giro);

    return NextResponse.json({ id, progress });
  });
}
