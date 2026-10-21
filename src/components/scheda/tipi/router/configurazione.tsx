"use client";

/**
 * Tab «Configurazione» di router e firewall: conteggi delle regole (filter · NAT · mangle, dalla scansione), stato
 * del firewall se l'apparato lo dichiara, hardware, informazioni di rete (SNMP) e — per i MikroTik in SSH e solo
 * all'amministratore — la configurazione in diretta con «Scarica .rsc». L'elenco delle regole, le copie di
 * configurazione e le VPN non si raccolgono ancora: non hanno un riquadro.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import { nomeFileExport, ripulisciExport } from "@/lib/scheda/mikrotik";
import { Campo } from "../../blocchi";
import { Riquadro } from "../../riquadro";
import { SezioneSnmp } from "../../dettagli/sistema";
import type { ContestoScheda } from "../../contesto";
import { eMikrotikSsh, regoleDi } from "./dati-router";

interface ConfigMikrotik {
  exportFull: string;
  /** sezioni tolte dal server (nome senza «/»): la ripulitura vera avviene lì, qui si ripassa per sicurezza */
  exportTolte?: string[];
  systemInfo?: { identity?: string; version?: string; boardName?: string; serialNumber?: string; uptime?: string };
}

function Numero({ etichetta, valore }: { etichetta: string; valore: number | null }) {
  return (
    <div className="rounded-xl border-2 border-border px-4 py-3">
      <span className="block text-[13px] font-semibold text-muted-foreground">{etichetta}</span>
      <span className="block text-2xl font-semibold leading-tight">{valore ?? "—"}</span>
    </div>
  );
}

export function ConfigurazioneRouter({ ctx }: { ctx: ContestoScheda }) {
  const { device, isAdmin, displayName } = ctx;
  const mk = eMikrotikSsh(ctx);
  const regole = regoleDi(ctx);
  const di = device?.device_info ?? null;
  const statoFw = di && (di.firewall_active != null || di.firewall_type || di.firewall_rules_count != null) ? di : null;
  const haHardware = !!(di && (di.cpu_model || di.ram_total_gb || di.ram_total_mb));

  const [cfg, setCfg] = useState<ConfigMikrotik | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [leggo, setLeggo] = useState(false);
  const [mostra, setMostra] = useState(false);
  const [letto, setLetto] = useState<Date | null>(null);
  // l'export arriva già ripulito dal server (script e scheduler portano la password SFTP); il secondo passaggio qui
  // non toglie nulla in condizioni normali, le sezioni tolte si leggono da `exportTolte`
  const pulito = useMemo(() => {
    if (!cfg?.exportFull) return null;
    const r = ripulisciExport(cfg.exportFull);
    const dalServer = (cfg.exportTolte ?? []).map((t) => `/${t}`);
    return { ...r, tolte: [...new Set([...dalServer, ...r.tolte])] };
  }, [cfg]);
  const nomeFile = cfg ? nomeFileExport(cfg.systemInfo?.identity ?? displayName, letto ?? new Date()) : "";

  async function carica() {
    if (!device) return;
    setLeggo(true);
    setErrore(null);
    const r = await fetchJson<{ config: ConfigMikrotik | null }>(`/api/devices/${device.id}/mikrotik?action=config`);
    setLeggo(false);
    if (r.ok) { setCfg(r.data.config); setLetto(new Date()); } else setErrore(r.message);
  }

  function scarica() {
    if (!pulito?.testo) return;
    const url = URL.createObjectURL(new Blob([pulito.testo], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeFile;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Configurazione scaricata");
  }

  return (
    <div className="space-y-4">
      <Riquadro titolo="Regole del firewall" vuoto={!regole && !statoFw}>
        {regole && (
          <div className="grid max-w-xl grid-cols-3 gap-3">
            <Numero etichetta="Filter" valore={regole.filter} />
            <Numero etichetta="NAT" valore={regole.nat} />
            <Numero etichetta="Mangle" valore={regole.mangle} />
          </div>
        )}
        {statoFw && (
          <dl className={`grid grid-cols-3 gap-3 ${regole ? "mt-4" : ""}`}>
            <Campo label="Firewall" value={statoFw.firewall_active === true ? "✓ attivo" : statoFw.firewall_active === false ? "▲ disattivo" : null} />
            <Campo label="Tipo" value={statoFw.firewall_type} />
            <Campo label="Regole" value={statoFw.firewall_rules_count != null ? String(statoFw.firewall_rules_count) : null} />
          </dl>
        )}
      </Riquadro>

      {!regole && !statoFw && (
        <p className="text-sm text-muted-foreground">Le regole del firewall non vengono raccolte da questo apparato{mk ? ": i conteggi arrivano con la prossima scansione SSH" : " (i conteggi filter, NAT e mangle esistono solo per i MikroTik)"}.</p>
      )}

      <Riquadro titolo="Hardware" vuoto={!haHardware}>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Campo label="CPU" value={di?.cpu_model} />
          <Campo label="Core" value={di?.cpu_cores != null ? String(di.cpu_cores) : null} />
          <Campo label="RAM" value={di?.ram_total_gb != null ? `${di.ram_total_gb} GB` : di?.ram_total_mb ? `${di.ram_total_mb} MB` : null} />
        </dl>
      </Riquadro>

      <SezioneSnmp ctx={ctx} />

      {mk && !isAdmin && (
        <p className="text-sm text-muted-foreground">L&apos;export della configurazione del router è riservato agli amministratori.</p>
      )}
      {mk && isAdmin && (
        <Riquadro
          titolo="Configurazione del router"
          azione={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={carica} disabled={leggo}>
                <RefreshCw className={`mr-1.5 h-4 w-4 ${leggo ? "animate-spin" : ""}`} />
                {leggo ? "Lettura…" : cfg ? "Rileggi" : "Leggi dal router"}
              </Button>
              {pulito?.testo ? <Button variant="outline" size="sm" onClick={scarica}><Download className="mr-1.5 h-4 w-4" />Scarica .rsc</Button> : null}
            </div>
          }
        >
          {errore && <LoadError what="la configurazione" message={errore} onRetry={carica} />}
          {!errore && !cfg && <p className="text-sm text-muted-foreground">Legge in questo momento l&apos;export completo dal router (SSH). Contiene indirizzi, regole e utenti di servizio: va trattato come riservato.</p>}
          {cfg?.systemInfo && (
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Campo label="Identity" value={cfg.systemInfo.identity} />
              <Campo label="Scheda" value={cfg.systemInfo.boardName} />
              <Campo label="RouterOS" value={cfg.systemInfo.version} />
              <Campo label="Seriale" value={cfg.systemInfo.serialNumber} mono />
              <Campo label="Acceso da" value={cfg.systemInfo.uptime} />
            </dl>
          )}
          {pulito?.testo ? (
            <div className="mt-4">
              <p className="font-mono text-[13px] text-muted-foreground">
                {nomeFile} · {Math.max(1, Math.round(new Blob([pulito.testo]).size / 1024))} KB · {pulito.righe} righe
              </p>
              <Button className="mt-2" variant="outline" size="sm" onClick={() => setMostra((m) => !m)}>{mostra ? "Nascondi l'export" : "Mostra l'export"}</Button>
              {mostra && <pre className="mt-3 max-h-[400px] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-4 font-mono text-[13px]">{pulito.testo}</pre>}
              {mostra && pulito.tolte.length > 0 && <p className="mt-2 font-mono text-[13px] text-muted-foreground"># [tolte: {pulito.tolte.join(", ")}]</p>}
            </div>
          ) : null}
        </Riquadro>
      )}
    </div>
  );
}
