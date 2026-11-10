"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Etichetta, Legenda, Vuoto } from "@/components/shared/console";
import { LoadError } from "@/components/shared/load-error";
import { SkeletonTable } from "@/components/shared/skeleton-table";
import { useEAdmin } from "@/hooks/use-e-admin";
import { fetchJson } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";
import type { CellaContesa, ElencoContesi, EsitoScelte, RigaContesa, SceltaConteso } from "@/lib/attribution/contesi";
import type { AttributionDimension, AttributionSource } from "@/lib/attribution/types";

const NOME_DIMENSIONE: Record<AttributionDimension, string> = {
  category: "Categoria",
  os: "OS",
  vendor: "Produttore",
};

const NOME_FONTE: Record<AttributionSource, string> = {
  manual: "Manuale", ad: "AD", wazuh: "Wazuh", inv_agent: "Agente", winrm: "WinRM",
  snmp_sysobj: "SNMP OID", snmp_sysdescr: "SNMP descr.", lldp: "LLDP", cdp: "CDP", mndp: "MNDP (MikroTik)", ubnt: "Scoperta Ubiquiti",
  oui: "MAC (OUI)", mac_product: "MAC prodotto", http_banner: "HTTP", tls_cert: "TLS",
  wsd: "WSD", mdns: "mDNS", ssdp: "SSDP", smb: "SMB", ssh: "SSH", redfish: "Redfish",
  onvif: "ONVIF", fingerbank: "Fingerbank", netbios: "NetBIOS", nmap_service: "Nmap servizi",
  nmap_os: "Nmap OS", hostname: "Nome host", ports: "Porte", dhcp: "DHCP", ttl: "TTL",
  ai: "IA", rdp_ntlm: "RDP", ot_probe: "Sonda OT", mac_gemello: "Stesso MAC",
};

const STILE_ATTUALE = "border-dashed border-foreground/60";
const STILE_SCELTA = "border-primary bg-primary text-primary-foreground";

type Filtro = "tutti" | AttributionDimension;

const chiave = (r: Pick<RigaContesa, "host_id" | "dimensione">) => `${r.host_id}:${r.dimensione}`;

/** `compute.server` → «server»: la radice la dice gia' il resto della riga. */
function valoreLeggibile(dimensione: AttributionDimension, valore: string): string {
  return dimensione === "category" ? valore.slice(valore.indexOf(".") + 1) : valore;
}

function Cella({ riga, cella, scelta, attivo, onScegli }: {
  riga: RigaContesa;
  cella: CellaContesa;
  scelta: boolean;
  attivo: boolean;
  onScegli: () => void;
}) {
  const attuale = cella.valore === riga.attuale;
  const titolo = [cella.valore, cella.dettaglio].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      disabled={!attivo}
      onClick={onScegli}
      title={titolo}
      aria-pressed={scelta}
      className={cn(
        "flex w-full min-w-24 items-center justify-between gap-2 rounded-md border-2 px-2 py-1 text-left text-[13px]",
        "disabled:cursor-default enabled:hover:border-primary",
        scelta ? STILE_SCELTA : attuale ? STILE_ATTUALE : "border-transparent bg-muted/50",
      )}
    >
      <span className="flex min-w-0 items-center gap-1 font-medium">
        {scelta && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
        <span className="truncate">{valoreLeggibile(riga.dimensione, cella.valore)}</span>
      </span>
      <span className={cn("font-mono tabular-nums", !scelta && "text-muted-foreground")}>{cella.confidenza}%</span>
    </button>
  );
}

export function IpContesiDialog({ open, onOpenChange, networkId, onApplied }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  networkId: number;
  onApplied?: () => void;
}) {
  const admin = useEAdmin();
  const [elenco, setElenco] = useState<ElencoContesi | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [caricamento, setCaricamento] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>("tutti");
  const [manuali, setManuali] = useState(false);
  const [scelte, setScelte] = useState<Map<string, SceltaConteso>>(new Map());
  const [applicando, setApplicando] = useState(false);

  const carica = useCallback(async () => {
    setCaricamento(true);
    setErrore(null);
    const esito = await fetchJson<ElencoContesi>(
      `/api/attribution/contesi?network_id=${networkId}${manuali ? "&manuali=1" : ""}`,
    );
    if (esito.ok) setElenco(esito.data);
    else setErrore(esito.message);
    setCaricamento(false);
  }, [networkId, manuali]);

  useEffect(() => {
    if (!open) return;
    setScelte(new Map());
    void carica();
  }, [open, carica]);

  const righe = useMemo(() => elenco?.righe ?? [], [elenco]);
  const visibili = useMemo(
    () => (filtro === "tutti" ? righe : righe.filter((r) => r.dimensione === filtro)),
    [righe, filtro],
  );
  /* Solo le colonne che servono alle righe a schermo, nell'ordine dato dal server. */
  const colonne = useMemo(() => {
    const presenti = new Set(visibili.flatMap((r) => r.celle.map((c) => c.fonte)));
    return (elenco?.fonti ?? []).filter((f) => presenti.has(f));
  }, [elenco, visibili]);

  function scegli(riga: RigaContesa, valore: string) {
    setScelte((prima) => {
      const dopo = new Map(prima);
      if (dopo.get(chiave(riga))?.valore === valore) dopo.delete(chiave(riga));
      else dopo.set(chiave(riga), { host_id: riga.host_id, dimensione: riga.dimensione, valore });
      return dopo;
    });
  }

  async function applicaScelte() {
    setApplicando(true);
    const esito = await fetchJson<EsitoScelte>("/api/attribution/contesi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scelte: [...scelte.values()] }),
    });
    setApplicando(false);
    if (!esito.ok) {
      toast.error(esito.message);
      return;
    }
    const { applicate, rifiutate } = esito.data;
    if (applicate > 0) {
      toast.success(applicate === 1 ? "1 scelta applicata" : `${applicate} scelte applicate`);
      onApplied?.();
    }
    if (rifiutate.length === 0) {
      onOpenChange(false);
      return;
    }
    toast.error(`${rifiutate.length} non applicate: ${rifiutate[0].motivo}`);
    setScelte(new Map());
    void carica();
  }

  /** Ex «Applica diretto» della testata: ricalcola tutta la rete, senza scelte umane. */
  async function applicaTutto() {
    setApplicando(true);
    const esito = await fetchJson<{ message?: string }>("/api/attribution/recompute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ network_id: networkId }),
    });
    setApplicando(false);
    if (!esito.ok) {
      toast.error(esito.message);
      return;
    }
    toast.success(esito.data.message || "Attribuzione ricalcolata");
    onApplied?.();
    onOpenChange(false);
  }

  const voci: Array<[Filtro, string, number]> = [
    ["tutti", "Tutti", righe.length],
    ...(["category", "os", "vendor"] as const).map((d): [Filtro, string, number] => [
      d, NOME_DIMENSIONE[d], righe.filter((r) => r.dimensione === d).length,
    ]),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!gap-0 !p-0 flex !flex-col max-h-[min(88vh,100dvh-1.5rem)] w-full !max-w-[min(96rem,calc(100vw-2rem))] overflow-hidden">
        <DialogHeader className="shrink-0 border-b border-border/50 px-4 pt-4 pb-3">
          <DialogTitle>
            IP contesi
            {elenco && (
              <span className="ml-2 font-mono text-[13px] font-normal text-muted-foreground">
                {elenco.totale} dati su {elenco.host_valutati} host
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/50 px-4 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {voci.map(([id, nome, quanti]) => (
              <Button
                key={id}
                size="sm"
                variant={filtro === id ? "default" : "outline"}
                className="text-[13px]"
                onClick={() => setFiltro(id)}
              >
                {nome} <span className="ml-1 font-mono tabular-nums">{quanti}</span>
              </Button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[13px]">
            <Checkbox checked={manuali} onCheckedChange={(v) => setManuali(v === true)} />
            Mostra anche i manuali
          </label>
          <Legenda
            className="ml-auto"
            voci={[
              { classe: "bg-primary border-primary", testo: "Scelta tua (✓)" },
              { classe: "border-2 border-dashed border-foreground/60 bg-transparent", testo: "Valore attuale" },
            ]}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {errore ? (
            <div className="p-4"><LoadError what="gli IP contesi" message={errore} onRetry={() => void carica()} /></div>
          ) : caricamento && !elenco ? (
            <div className="p-4"><SkeletonTable /></div>
          ) : visibili.length === 0 ? (
            <div className="p-4">
              <Vuoto
                titolo="Nessun IP conteso"
                testo="Su questa rete le fonti dicono la stessa cosa, o il dato è già stato deciso a mano."
              />
            </div>
          ) : (
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <thead className="sticky top-0 z-20 bg-card">
                <tr>
                  <th className="sticky left-0 z-30 w-44 min-w-44 border-b bg-card px-3 py-2 text-left font-semibold">IP</th>
                  <th className="sticky left-44 z-30 w-32 min-w-32 border-b border-r bg-card px-2 py-2 text-left font-semibold">Dato e attuale</th>
                  {colonne.map((f) => (
                    <th key={f} className="whitespace-nowrap border-b px-2 py-2 text-left font-semibold">{NOME_FONTE[f]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibili.map((r) => {
                  const attivo = admin && !r.manuale;
                  return (
                    <tr key={chiave(r)} className="align-top">
                      <td className="sticky left-0 z-10 w-44 min-w-44 max-w-44 border-b bg-card px-3 py-1.5">
                        <div className="font-mono">{r.ip}</div>
                        {r.hostname && <div className="truncate text-muted-foreground" title={r.hostname}>{r.hostname}</div>}
                      </td>
                      {/* Fissa anche questa: scorrendo le fonti non si deve perdere quale dato si sta scegliendo. */}
                      <td className="sticky left-44 z-10 w-32 min-w-32 max-w-32 border-b border-r bg-card px-2 py-1.5">
                        <div className="text-muted-foreground">{NOME_DIMENSIONE[r.dimensione]}</div>
                        <div className="truncate font-medium" title={r.attuale ?? undefined}>
                          {r.attuale ? valoreLeggibile(r.dimensione, r.attuale) : "—"}
                        </div>
                        {r.manuale && <Etichetta mono={false}>Manuale</Etichetta>}
                      </td>
                      {colonne.map((f) => (
                        <td key={f} className="border-b px-1 py-1">
                          <div className="flex flex-col gap-1">
                            {r.celle.filter((c) => c.fonte === f).map((c) => (
                              <Cella
                                key={c.valore}
                                riga={r}
                                cella={c}
                                attivo={attivo}
                                scelta={scelte.get(chiave(r))?.valore === c.valore}
                                onScegli={() => scegli(r, c.valore)}
                              />
                            ))}
                          </div>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {elenco && elenco.totale > elenco.righe.length && (
            <p className="px-4 py-2 text-[13px] text-muted-foreground">
              Mostrati i primi {elenco.righe.length} di {elenco.totale}: applica questi e riapri per vedere gli altri.
            </p>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-border/50 px-4 py-3">
          <Button
            variant="outline"
            className="mr-auto"
            onClick={() => void applicaTutto()}
            disabled={applicando || !admin}
            title="Ricalcola e applica l'attribuzione su tutta la rete, senza scelte a mano."
          >
            Applica tutto senza rivedere
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={applicando}>Annulla</Button>
          <Button onClick={() => void applicaScelte()} disabled={applicando || scelte.size === 0 || !admin}>
            {applicando && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Applica scelte ({scelte.size})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
