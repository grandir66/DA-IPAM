"use client";

/**
 * Tab «DHCP» di router e firewall: uso dei pool (barre, ▲ da 85%), lease noti dal DB (ultima lettura) e, per i
 * MikroTik in SSH, la lettura in diretta dei lease dal router con importazione in IPAM (POST import-dhcp, solo
 * admin). Spostato da `devices/[id]` (tab MikroTik) e da Dettagli > Rete.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Database, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import { parseDbDate } from "@/lib/db-date";
import { SOGLIA_POOL } from "@/lib/scheda/router";
import { BarraUso } from "../../barra-uso";
import { Riquadro } from "../../riquadro";
import type { ContestoScheda } from "../../contesto";
import { eMikrotikSsh, leaseDi, useUsoPool } from "./dati-router";

const MAX = 200;
const th = "whitespace-nowrap px-3 py-2 text-left text-[13px] font-semibold text-muted-foreground";

/** Un lease letto in diretta dal router (forma di DhcpLeaseEntry). */
interface LeaseLive {
  ip: string; mac: string; hostname: string | null; status?: string; server?: string; expiresAfter?: string; comment?: string; dynamic?: boolean;
}

const quando = (iso: string | null | undefined): string =>
  !iso ? "—" : Number.isNaN(parseDbDate(iso).getTime()) ? iso : parseDbDate(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function DhcpRouter({ ctx }: { ctx: ContestoScheda }) {
  const { device, isAdmin } = ctx;
  const mk = eMikrotikSsh(ctx);
  const { stato: pool, riprova } = useUsoPool(ctx, mk);
  const lease = leaseDi(ctx);
  const [filtro, setFiltro] = useState("");
  const [live, setLive] = useState<LeaseLive[] | null>(null);
  const [erroreLive, setErroreLive] = useState<string | null>(null);
  const [leggo, setLeggo] = useState(false);
  const [scelti, setScelti] = useState<Set<string>>(new Set());
  const [importo, setImporto] = useState(false);

  const q = filtro.trim().toLowerCase();
  const visibili = useMemo(
    () => lease.filter((l) => !q || [l.ip_address ?? l.ip, l.mac_address ?? l.mac, l.hostname, l.server_name ?? l.server].some((c) => String(c ?? "").toLowerCase().includes(q))),
    [lease, q],
  );

  async function leggiLive() {
    if (!device) return;
    setLeggo(true);
    setErroreLive(null);
    const r = await fetchJson<{ leases: LeaseLive[] }>(`/api/devices/${device.id}/mikrotik?action=dhcp`);
    setLeggo(false);
    if (r.ok) { setLive(r.data.leases ?? []); setScelti(new Set()); } else setErroreLive(r.message);
  }

  async function importa() {
    if (!device || !live) return;
    const daImportare = scelti.size > 0 ? live.filter((l) => scelti.has(l.ip)) : live;
    if (daImportare.length === 0) { toast.info("Nessun lease da importare"); return; }
    setImporto(true);
    const r = await fetchJson<{ imported: number; updated: number; skipped: number }>(`/api/devices/${device.id}/mikrotik?action=import-dhcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leases: daImportare, overwriteHostname: false }),
    });
    setImporto(false);
    if (r.ok) toast.success(`Importati: ${r.data.imported}, aggiornati: ${r.data.updated}, saltati: ${r.data.skipped}`);
    else toast.error(`Errore importazione: ${r.message}`);
  }

  const alternaScelta = (ip: string) => setScelti((s) => { const n = new Set(s); if (n.has(ip)) n.delete(ip); else n.add(ip); return n; });

  return (
    <div className="space-y-4">
      {mk && pool.fase === "carico" && <Riquadro titolo="Pool DHCP"><p className="text-sm text-muted-foreground">Lettura dal router…</p></Riquadro>}
      {mk && pool.fase === "errore" && <LoadError what="i pool DHCP" message={pool.messaggio} onRetry={riprova} />}
      {mk && pool.fase === "ok" && pool.dati.length === 0 && (
        <p className="text-sm text-muted-foreground">Il router non ha restituito server DHCP attivi con un pool leggibile: l&apos;uso dei pool non si calcola.</p>
      )}
      <Riquadro titolo={`Pool DHCP (${pool.fase === "ok" ? pool.dati.length : 0})`} vuoto={pool.fase !== "ok" || pool.dati.length === 0}>
        <ul className="space-y-2.5">
          {(pool.fase === "ok" ? pool.dati : []).map((p) => (
            <li key={p.server} className="grid grid-cols-[minmax(0,12rem)_1fr] items-center gap-4 text-[13px]">
              <span className="truncate" title={p.interfaccia}><span className="font-semibold">{p.server}</span> <span className="text-muted-foreground">· {p.interfaccia}</span></span>
              <BarraUso percento={p.percento} etichetta={`${p.usati} / ${p.totale}`} soglia={SOGLIA_POOL} />
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[13px] text-muted-foreground">Lease contati dall&apos;ultima lettura del router; ▲ da {SOGLIA_POOL}% di pool occupato.</p>
      </Riquadro>

      <Riquadro
        titolo={`Lease noti (${lease.length})`}
        vuoto={lease.length === 0}
        azione={<input type="search" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Filtra…" aria-label="Filtra i lease" className="h-8 w-48 rounded-md border bg-background px-2 text-[13px]" />}
      >
        <div className="-mx-4 -mt-4 max-h-[420px] overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 border-b-2 bg-muted">
              <tr><th className={th}>IP</th><th className={th}>MAC</th><th className={th}>Hostname</th><th className={th}>Stato</th><th className={th}>Server</th><th className={th}>Tipo</th><th className={th}>Scade</th></tr>
            </thead>
            <tbody>
              {visibili.slice(0, MAX).map((l, n) => (
                <tr key={l.id ?? n} className="border-b">
                  <td className="px-3 py-1.5 font-mono font-semibold">{l.ip_address ?? l.ip}</td>
                  <td className="px-3 py-1.5 font-mono">{l.mac_address ?? l.mac}</td>
                  <td className="px-3 py-1.5">{l.hostname ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">{l.status ? (l.status === "bound" || l.status === "active" ? `✓ ${l.status}` : `● ${l.status}`) : "—"}</td>
                  <td className="px-3 py-1.5">{l.server_name ?? l.server ?? "—"}</td>
                  <td className="px-3 py-1.5">{l.dynamic_lease === 1 ? "dinamico" : l.dynamic_lease === 0 ? "statico" : (l.lease_type ?? "—")}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{quando(l.lease_expires ?? l.expires_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {visibili.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nessun lease corrisponde al filtro.</p>}
        </div>
        {visibili.length > MAX && <p className="mt-3 text-[13px] text-muted-foreground">Mostrati i primi {MAX} di {visibili.length}.</p>}
      </Riquadro>

      {lease.length === 0 && !mk && <p className="text-sm text-muted-foreground">Nessun lease DHCP letto da questo apparato.</p>}

      {mk && (
        <Riquadro
          titolo={`Lease sul router${live ? ` (${live.length})` : ""}`}
          azione={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={leggiLive} disabled={leggo}>
                <RefreshCw className={`mr-1.5 h-4 w-4 ${leggo ? "animate-spin" : ""}`} />
                {leggo ? "Lettura…" : live ? "Rileggi" : "Leggi dal router"}
              </Button>
              {isAdmin && live && live.length > 0 && (
                <Button variant="outline" size="sm" onClick={importa} disabled={importo}>
                  <Database className="mr-1.5 h-4 w-4" />
                  {importo ? "Importazione…" : scelti.size > 0 ? `Importa selezionati (${scelti.size})` : `Importa tutti (${live.length})`}
                </Button>
              )}
            </div>
          }
        >
          {erroreLive && <LoadError what="i lease dal router" message={erroreLive} onRetry={leggiLive} />}
          {!erroreLive && !live && <p className="text-sm text-muted-foreground">Legge i lease in questo momento dal router (SSH). {isAdmin ? "Da qui si possono importare in IPAM." : "L'importazione in IPAM è riservata agli amministratori."}</p>}
          {live && live.length === 0 && <p className="text-sm text-muted-foreground">Il router non ha lease DHCP.</p>}
          {live && live.length > 0 && (
            <div className="-mx-4 -mt-4 max-h-[420px] overflow-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 border-b-2 bg-muted">
                  <tr>{isAdmin && <th className={th}><span className="sr-only">Scelta</span></th>}<th className={th}>IP</th><th className={th}>MAC</th><th className={th}>Hostname</th><th className={th}>Server</th><th className={th}>Stato</th><th className={th}>Scade tra</th></tr>
                </thead>
                <tbody>
                  {live.slice(0, MAX).map((l) => (
                    <tr key={l.ip} className="border-b">
                      {isAdmin && <td className="px-3 py-1.5"><input type="checkbox" checked={scelti.has(l.ip)} onChange={() => alternaScelta(l.ip)} aria-label={`Scegli ${l.ip}`} className="h-4 w-4" /></td>}
                      <td className="px-3 py-1.5 font-mono font-semibold">{l.ip}</td>
                      <td className="px-3 py-1.5 font-mono">{l.mac}</td>
                      <td className="px-3 py-1.5">{l.hostname ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-1.5">{l.server ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">{l.status === "bound" ? "✓ bound" : `● ${l.status ?? "non noto"}`}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{l.expiresAfter ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {live.length > MAX && <p className="p-3 text-[13px] text-muted-foreground">Mostrati i primi {MAX} di {live.length}; «Importa tutti» li importa tutti.</p>}
            </div>
          )}
        </Riquadro>
      )}
    </div>
  );
}
