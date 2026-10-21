"use client";

/**
 * Tab «Gestione» (comune a tutti gli apparati gestiti, artboard Gestione): come lo classifichiamo, la sua
 * identità e inventario, come ci arriviamo e con quali credenziali, asset NIS2 e collegamenti esterni.
 * Qui stanno UNA volta sola: l'editor della classificazione, MAC/modello/seriale/firmware/inventario/note, le
 * credenziali (prima in cinque punti). Le altre tab non li ripetono.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PackagePlus } from "lucide-react";
import { ClassificationEvidencePanel } from "@/components/shared/classification-evidence-panel";
import { ClassificazioneApparato, CredenzialiAssegnate } from "@/components/devices/credenziali-assegnate";
import { DeviceCredentialsTable } from "@/components/shared/device-credentials-table";
import { HostMeshcentralCard } from "@/components/hosts/host-meshcentral-card";
import { useUrlPerBrowser } from "@/components/shared/url-per-browser";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import { getClassificationLabel } from "@/lib/device-classifications";
import { ruoliDaJson } from "@/lib/classification/canonico";
import { etichettaVersioneSnmp } from "@/lib/protocols/snmp-sessione";
import { BadgeNeutro } from "@/components/devices/rendi-apparato-esito";
import { Campo } from "./blocchi";
import { Riquadro } from "./riquadro";
import type { ContestoScheda } from "./contesto";

/** Aggiunge l'host a LibreNMS (POST /api/integrations/librenms/host). Stessa chiamata del pulsante di «Dettagli» > Generale. */
async function abbinaLibreNms(hostId: number, dopo: () => Promise<void>) {
  try {
    const r = await fetch("/api/integrations/librenms/host", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host_id: hostId }),
    });
    const data = (await r.json()) as { message?: string; error?: string };
    if (r.ok) {
      toast.success(data.message || "Host aggiunto a LibreNMS — i grafici saranno disponibili dopo il primo polling.");
      await dopo();
    } else {
      toast.error(data.error || "Errore aggiunta a LibreNMS");
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Errore di rete");
  }
}

/** Riga «✓ nome — azione»: segno + parola, mai solo il colore. */
function RigaCollegamento({ ok, nome, stato, azione }: { ok: boolean; nome: string; stato: string; azione?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span aria-hidden className="font-semibold">{ok ? "✓" : "●"}</span>
      <span className="font-semibold">{nome}</span>
      <span className="text-muted-foreground">{stato}</span>
      {azione}
    </li>
  );
}

function CollegamentiEsterni({ ctx }: { ctx: ContestoScheda }) {
  const { host, librenms, displayName, ricarica } = ctx;
  const perBrowser = useUrlPerBrowser();
  const [zabbix, setZabbix] = useState<{ configurato: boolean; abbinato: boolean } | null>(null);
  const [erroreZabbix, setErroreZabbix] = useState<string | null>(null);
  const [giro, setGiro] = useState(0);

  useEffect(() => {
    let vivo = true;
    void fetchJson<{ configurato: boolean; abbinato: boolean }>(`/api/hosts/${host.id}/zabbix`, { cache: "no-store" }).then((r) => {
      if (!vivo) return;
      if (r.ok) { setZabbix(r.data); setErroreZabbix(null); } else setErroreZabbix(r.message);
    });
    return () => { vivo = false; };
  }, [host.id, giro]);

  const legame = "text-[#006C96] underline underline-offset-2 dark:text-[#3FBBF0]";
  return (
    <Riquadro titolo="Collegamenti esterni">
      <ul className="space-y-2">
        {librenms?.configured && (
          librenms.mapped && librenms.librenmsUrl && librenms.librenmsDeviceId ? (
            <RigaCollegamento
              ok nome="LibreNMS" stato="abbinato"
              azione={<a href={`${perBrowser(librenms.librenmsUrl)}/device/device=${librenms.librenmsDeviceId}`} target="_blank" rel="noreferrer" className={legame}>apri il grafico ›</a>}
            />
          ) : (
            <RigaCollegamento
              ok={false} nome="LibreNMS" stato="non abbinato"
              azione={<Button type="button" size="sm" variant="outline" onClick={() => void abbinaLibreNms(host.id, ricarica)}>Aggiungi</Button>}
            />
          )
        )}
        {zabbix?.configurato && (
          zabbix.abbinato ? (
            <RigaCollegamento ok nome="Zabbix" stato="abbinato" azione={<Link href="/zabbix" className={legame}>apri il pannello ›</Link>} />
          ) : (
            <RigaCollegamento ok={false} nome="Zabbix" stato="non abbinato" azione={<Link href="/zabbix" className={legame}>Abbina ›</Link>} />
          )
        )}
        {erroreZabbix && <li><LoadError what="lo stato di Zabbix" message={erroreZabbix} onRetry={() => setGiro((g) => g + 1)} /></li>}
        {!librenms?.configured && zabbix?.configurato !== true && erroreZabbix === null && zabbix !== null && (
          <li className="text-[13px] text-muted-foreground">LibreNMS e Zabbix non sono configurati su questa appliance.</li>
        )}
      </ul>
      {/* Controllo remoto (MeshCentral, RDP/VNC, SSH): si auto-nasconde se non c'è niente da offrire. */}
      <div className="mt-3 empty:hidden"><HostMeshcentralCard hostId={host.id} hostLabel={displayName} /></div>
    </Riquadro>
  );
}

export function TabGestione({ ctx }: { ctx: ContestoScheda }) {
  const { host, device, asset, isAsset, runtimeSummary, slugsClassificazione, etichettaClassificazione, versioneBinding, alCambioBinding, ricarica, salvaCampoHost, creaAsset } = ctx;

  // Campi editabili: stato locale, riletto quando la pagina ricarica l'host.
  const [seriale, setSeriale] = useState(host.serial_number ?? "");
  const [inventario, setInventario] = useState(host.inventory_code ?? "");
  const [note, setNote] = useState(host.notes ?? "");
  useEffect(() => { setSeriale(host.serial_number ?? ""); }, [host.serial_number]);
  useEffect(() => { setInventario(host.inventory_code ?? ""); }, [host.inventory_code]);
  useEffect(() => { setNote(host.notes ?? ""); }, [host.notes]);

  const tabellaRef = useRef<HTMLDivElement>(null);
  const alCambia = useCallback(() => tabellaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), []);

  if (!device) return null;

  const scelte = [
    { slug: "unknown", label: "— Sconosciuta —" },
    ...slugsClassificazione
      .filter((c) => c !== "unknown")
      .sort((a, b) => etichettaClassificazione(a).localeCompare(etichettaClassificazione(b), "it", { sensitivity: "base" }))
      .map((c) => ({ slug: c, label: etichettaClassificazione(c) })),
  ];
  const dns = [host.hostname, host.dns_reverse, host.dns_forward].filter((v, i, a): v is string => !!v && a.indexOf(v) === i);
  const automatica = host.classification_manual !== 1 && host.inferred_confidence != null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Riquadro titolo="Cos'è">
          <div className="space-y-3">
            <ClassificazioneApparato
              deviceId={device.id}
              classificazione={device.classification ?? host.classification ?? ""}
              etichetta={getClassificationLabel(device.classification ?? "") || device.device_type}
              aMano={device.classification_manual === 1}
              ruoli={ruoliDaJson(device.server_roles)}
              eServer={device.classification === "server"}
              scelte={scelte}
              onCambiata={() => void ricarica()}
            />
            <dl className="space-y-2">
              <Campo label="Piattaforma" value={device.vendor} />
              {automatica && <Campo label="Riconoscimento">automatico · {Math.round(host.inferred_confidence ?? 0)}%</Campo>}
            </dl>
            <ClassificationEvidencePanel
              reason={host.classification_reason ?? null}
              confidence={host.inferred_confidence ?? null}
              classificationJson={host.classification_json ?? null}
            />
            <p className="text-[13px] text-muted-foreground">Un solo editor: scrive su apparato e host insieme.</p>
          </div>
        </Riquadro>

        <Riquadro titolo="Identità e inventario">
          <dl className="space-y-3">
            <Campo label="MAC" value={host.mac} mono />
            <Campo label="Hostname · DNS" value={dns.length > 0 ? dns.join(" · ") : null} />
            <Campo label="Modello" value={device.model ?? host.model} />
            <Campo label="Firmware" value={device.firmware ?? host.firmware} />
          </dl>
          <div className="mt-3 space-y-3">
            <div className="space-y-1">
              <Label htmlFor="ed-serial" className="text-[13px] font-semibold text-muted-foreground">Seriale</Label>
              <Input id="ed-serial" value={seriale} onChange={(e) => setSeriale(e.target.value)}
                onBlur={() => void salvaCampoHost({ serial_number: seriale || null })}
                placeholder="Inserisci a mano se non rilevato" className="font-mono text-sm" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-code" className="text-[13px] font-semibold text-muted-foreground">N. inventario</Label>
              <Input id="inv-code" value={inventario} onChange={(e) => setInventario(e.target.value)}
                onBlur={() => void salvaCampoHost({ inventory_code: inventario || null })}
                placeholder="Es: INV-2026-001" className="font-mono text-sm" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-notes" className="text-[13px] font-semibold text-muted-foreground">Note</Label>
              <Textarea id="inv-notes" value={note} onChange={(e) => setNote(e.target.value)}
                onBlur={() => void salvaCampoHost({ notes: note })}
                placeholder="Annotazioni libere su questo apparato…" rows={2} className="max-h-40 overflow-y-auto text-sm" />
            </div>
          </div>
        </Riquadro>

        <div className="space-y-4">
          <Riquadro titolo="Come ci arrivo">
            <dl className="space-y-3">
              <Campo label="Protocollo · porta" value={`${device.protocol} · ${device.port}`} mono />
              <Campo label="Scansione" value={device.scan_target} />
              <Campo label="Nome SNMP" value={device.sysname} />
            </dl>
            {host.host_credentials && host.host_credentials.length > 0 && (
              <div className="mt-3">
                <p className="text-[13px] font-semibold text-muted-foreground">Provate sull&apos;host</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {host.host_credentials.map((hc) => (
                    <BadgeNeutro key={hc.id} className="font-mono">
                      {hc.credential_name} · {hc.protocol_type}:{hc.port}{hc.validated === 1 ? " ✓" : ""}
                    </BadgeNeutro>
                  ))}
                </div>
              </div>
            )}
          </Riquadro>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Riquadro titolo="Credenziali">
            <div className="space-y-5">
              <CredenzialiAssegnate
                deviceId={device.id}
                usate={device.usata_adesso ?? []}
                versione={versioneBinding}
                versioneSnmp={device.snmp_version && device.protocol !== "snmp_v3" ? etichettaVersioneSnmp(device.snmp_version) : null}
                validateSulHost={runtimeSummary.validatedCreds.length}
                onProvata={() => void ricarica()}
                onCambia={alCambia}
              />
              <div ref={tabellaRef}>
                <DeviceCredentialsTable deviceId={device.id} onBindingsChange={alCambioBinding} />
              </div>
            </div>
          </Riquadro>
        </div>
        <div className="space-y-4">
          {isAsset && asset ? (
            <Riquadro titolo="Asset NIS2" azione={<span className="font-mono text-[13px]">{asset.asset_tag ?? `#${asset.id}`}</span>}>
              <dl className="grid grid-cols-2 gap-3">
                <Campo label="Categoria NIS2" value={asset.categoria_nis2} />
                <Campo label="Criticità NIS2" value={asset.criticita_nis2} />
                <Campo label="Categoria" value={asset.categoria} />
                <Campo label="Stato" value={asset.stato} />
                <Campo label="Sede" value={asset.sede} />
                <Campo label="Reparto" value={asset.reparto} />
                <Campo label="Posizione fisica" value={asset.posizione_fisica} />
              </dl>
              <div className="mt-3">
                <Button variant="link" size="sm" nativeButton={false} render={<Link href={`/inventory/${asset.id}`} />}>
                  Apri l&apos;asset completo ›
                </Button>
              </div>
            </Riquadro>
          ) : (
            <Riquadro titolo="Asset NIS2">
              <p className="mb-3 text-sm text-muted-foreground">Questo apparato non è ancora nell&apos;inventario NIS2.</p>
              <Button type="button" variant="outline" onClick={() => void creaAsset()}>
                <PackagePlus className="mr-2 h-4 w-4" />
                Crea asset NIS2
              </Button>
            </Riquadro>
          )}
          <CollegamentiEsterni ctx={ctx} />
        </div>
      </div>
    </div>
  );
}
