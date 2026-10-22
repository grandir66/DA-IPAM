"use client";

/**
 * «Dettagli» > Generale: il resto della vecchia tab Generale che non ha trovato posto nei blocchi comuni.
 * Identità (MAC, nome, modello, seriale, firmware, inventario) è in Gestione; stato, ms e porte aperte in
 * intestazione e Panoramica; Rete e Hardware in Panoramica; IP precedenti in Storico. Restano il profilo MDM,
 * i dati d'identità che non sono in Gestione e LibreNMS con i grafici. Si svuota tipo per tipo.
 */
import { STILE_STATO } from "@/components/shared/stile-stato-modulo";
import { BadgeNeutro } from "@/components/devices/rendi-apparato-esito";
import { Button } from "@/components/ui/button";
import { Activity } from "lucide-react";
import { toast } from "sonner";
import dynamic from "next/dynamic";
import { MobileProfilePanel } from "@/components/mobile/MobileProfilePanel";
import { useUrlPerBrowser } from "@/components/shared/url-per-browser";
import { InfoRow, Section } from "../blocchi";
import type { ContestoScheda } from "../contesto";

const LibreNMSDeviceGraphs = dynamic(() => import("@/components/integrations/librenms-device-graphs").then((m) => ({ default: m.LibreNMSDeviceGraphs })), { ssr: false });

export function DettagliGenerale({ ctx }: { ctx: ContestoScheda }) {
  const { host, device, tipo } = ctx;
  return (
    <div className="space-y-4">
      {/* Profilo MDM (Mobile): si auto-nasconde se l'host non ha dati MDM associati. Per host e generico sta già in Panoramica. */}
      {tipo !== "host" && tipo !== "generico" && <MobileProfilePanel hostId={host.id} />}

      {/* ─── Sistema e fornitore: i campi d'identità che Gestione non ha. */}
      <Section icon={<Activity className="h-4 w-4" />} title="Sistema e fornitore">
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <InfoRow label="Vendor (MAC OUI)" value={host.vendor} />
          <InfoRow label="Manufacturer" value={host.device_manufacturer} />
          <InfoRow label="OS" value={device?.device_info?.os_name ?? host.os_info} />
          <InfoRow label="Kernel/Build" value={device?.device_info?.os_version ?? device?.device_info?.kernel_version ?? null} />
          <InfoRow label="IP assignment" value={host.ip_assignment} />
        </dl>
      </Section>

      <SezioneLibreNms ctx={ctx} />
    </div>
  );
}

/** LibreNMS (fatti e grafici), se configurato. Esportato: la scheda switch lo riusa in «Porte», senza «Dettagli». */
export function SezioneLibreNms({ ctx }: { ctx: ContestoScheda }) {
  const { host, librenms, ricarica } = ctx;
  const perBrowser = useUrlPerBrowser();
  if (!librenms?.configured) return null;
  return (
      <Section icon={<Activity className="h-4 w-4" />} title="LibreNMS"
        badge={
          librenms.mapped
            ? <span className={`ml-2 inline-flex min-h-[26px] items-center gap-1.5 rounded-md border-2 px-2.5 py-0.5 text-[13px] font-semibold leading-tight ${STILE_STATO.ok.classi}`}>✓ mappato</span>
            : <BadgeNeutro className="ml-2">non mappato</BadgeNeutro>
        }>
        {librenms.mapped && librenms.device ? (
          <>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <InfoRow label="Status" value={librenms.device.status === 1 || librenms.device.status === "1" ? "Online" : "Offline"} />
              <InfoRow label="LibreNMS ID" value={librenms.librenmsDeviceId != null ? String(librenms.librenmsDeviceId) : null} />
              <InfoRow label="Hostname" value={librenms.librenmsHostname ?? librenms.device.sysname ?? null} />
              <InfoRow label="OS" value={librenms.device.os ?? null} />
              <InfoRow label="Hardware" value={librenms.device.hardware ?? null} />
              <InfoRow label="Uptime" value={librenms.device.uptime_seconds ? `${Math.floor(librenms.device.uptime_seconds / 86400)} giorni` : null} />
              <InfoRow label="Ultimo poll" value={librenms.device.lastpolled ?? null} />
              <InfoRow label="Ultimo sync" value={librenms.lastSyncedAt ?? null} />
            </dl>
            {librenms.librenmsUrl && librenms.librenmsDeviceId && (
              <div className="mt-3">
                <a
                  href={`${perBrowser(librenms.librenmsUrl)}/device/device=${librenms.librenmsDeviceId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  Apri in LibreNMS <Activity className="h-3 w-3" />
                </a>
              </div>
            )}
            {librenms.librenmsDeviceId && (
              <div className="mt-4">
                <LibreNMSDeviceGraphs deviceId={librenms.librenmsDeviceId} />
              </div>
            )}
          </>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              LibreNMS configurato ma questo host non è ancora mappato — quindi nessun grafico disponibile.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (!host) return;
                try {
                  const r = await fetch("/api/integrations/librenms/host", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ host_id: host.id }),
                  });
                  const data = await r.json();
                  if (r.ok) {
                    toast.success(data.message || "Host aggiunto a LibreNMS — i grafici saranno disponibili dopo il primo polling.");
                    void ricarica();
                  } else {
                    toast.error(data.error || "Errore aggiunta a LibreNMS");
                  }
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Errore di rete");
                }
              }}
            >
              <Activity className="h-3.5 w-3.5 mr-1.5" />
              Aggiungi a LibreNMS
            </Button>
          </div>
        )}
      </Section>
  );
}
