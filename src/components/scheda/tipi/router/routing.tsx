"use client";

/**
 * Tab «Routing e ARP» di router e firewall (spostate da Dettagli > Rete): la tabella delle rotte con lo stato
 * attiva/inattiva (le default per prime) e la tabella ARP, ognuna con un filtro di testo. Fino a 200 righe
 * per tabella, con «prime N di M» quando ce ne sono di più.
 */
import { useMemo, useState } from "react";
import { parseDbDate } from "@/lib/db-date";
import { eRottaDefault } from "@/lib/scheda/router";
import { statoArp } from "@/lib/scheda/mikrotik";
import { Riquadro } from "../../riquadro";
import type { ContestoScheda } from "../../contesto";
import { StatoRotta } from "./celle";
import { arpDi, rotteDi } from "./dati-router";

const MAX = 200;
const th = "whitespace-nowrap px-3 py-2 text-left text-[13px] font-semibold text-muted-foreground";

function Filtro({ valore, onCambia, etichetta }: { valore: string; onCambia: (v: string) => void; etichetta: string }) {
  return (
    <input
      type="search"
      value={valore}
      onChange={(e) => onCambia(e.target.value)}
      placeholder="Filtra…"
      aria-label={etichetta}
      className="h-8 w-48 rounded-md border bg-background px-2 text-[13px]"
    />
  );
}

export function RoutingRouter({ ctx }: { ctx: ContestoScheda }) {
  const rotte = useMemo(() => {
    const r = [...rotteDi(ctx)];
    // le default per prime, poi le attive, poi l'ordine di lettura
    return r.sort((a, b) => Number(eRottaDefault(b)) - Number(eRottaDefault(a)) || Number(b.active ?? 1) - Number(a.active ?? 1));
  }, [ctx]);
  const arp = arpDi(ctx);
  const [fr, setFr] = useState("");
  const [fa, setFa] = useState("");

  const q = (s: string, ...campi: (string | number | null | undefined)[]) => !s.trim() || campi.some((c) => String(c ?? "").toLowerCase().includes(s.trim().toLowerCase()));
  const rotteVisibili = rotte.filter((r) => q(fr, r.destination, r.gateway, r.interface_name, r.protocol));
  // Stato e Tipo vengono dalla lettura SSH: per i router letti in SNMP sono vuoti per tutte le voci e le colonne spariscono
  const haStato = arp.some((a) => statoArp(a.status));
  const haTipo = arp.some((a) => a.dynamic != null);
  const arpVisibili = arp.filter((a) => q(fa, a.ip, a.mac, a.interface_name, a.hostname, a.host_name, a.host_ip));

  return (
    <div className="space-y-4">
      <Riquadro
        titolo={`Rotte (${rotte.length})`}
        vuoto={rotte.length === 0}
        azione={<Filtro valore={fr} onCambia={setFr} etichetta="Filtra le rotte" />}
      >
        <div className="-mx-4 -mt-4 max-h-[420px] overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 border-b-2 bg-muted">
              <tr><th className={th}>Destinazione</th><th className={th}>Gateway</th><th className={th}>Interfaccia</th><th className={th}>Protocollo</th><th className={th}>Distanza</th><th className={th}>Stato</th></tr>
            </thead>
            <tbody>
              {rotteVisibili.slice(0, MAX).map((r, n) => (
                <tr key={r.id ?? n} className="border-b">
                  <td className="px-3 py-1.5 font-mono font-semibold">{r.destination ?? "—"}</td>
                  <td className="px-3 py-1.5 font-mono">{r.gateway ?? "—"}</td>
                  <td className="px-3 py-1.5">{r.interface_name ?? "—"}</td>
                  <td className="px-3 py-1.5">{r.protocol ?? "—"}</td>
                  <td className="px-3 py-1.5">{r.distance ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-1.5"><StatoRotta attiva={r.active == null || r.active === 1} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {rotteVisibili.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nessuna rotta corrisponde al filtro.</p>}
        </div>
        {rotteVisibili.length > MAX && <p className="mt-3 text-[13px] text-muted-foreground">Mostrate le prime {MAX} di {rotteVisibili.length}.</p>}
      </Riquadro>

      <Riquadro
        titolo={`Tabella ARP (${arp.length})`}
        vuoto={arp.length === 0}
        azione={<Filtro valore={fa} onCambia={setFa} etichetta="Filtra la tabella ARP" />}
      >
        <div className="-mx-4 -mt-4 max-h-[420px] overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 border-b-2 bg-muted">
              <tr><th className={th}>IP</th><th className={th}>MAC</th><th className={th}>Interfaccia</th><th className={th}>Host associato</th>{haStato && <th className={th}>Stato</th>}{haTipo && <th className={th}>Tipo</th>}<th className={th}>Visto</th></tr>
            </thead>
            <tbody>
              {arpVisibili.slice(0, MAX).map((a) => (
                <tr key={a.id} className="border-b">
                  <td className="px-3 py-1.5 font-mono font-semibold">{a.ip ?? "—"}</td>
                  <td className="px-3 py-1.5 font-mono">{a.mac}</td>
                  <td className="px-3 py-1.5">{a.interface_name ?? "—"}</td>
                  <td className="px-3 py-1.5">{a.hostname ?? a.host_name ?? <span className="text-muted-foreground">—</span>}</td>
                  {haStato && (
                    <td className="whitespace-nowrap px-3 py-1.5">
                      {(() => { const v = statoArp(a.status); return v ? <span className={v.forte ? "font-semibold" : "text-muted-foreground"}>{v.segno} {v.parola}</span> : <span className="text-muted-foreground">—</span>; })()}
                    </td>
                  )}
                  {haTipo && <td className="whitespace-nowrap px-3 py-1.5">{a.dynamic == null ? <span className="text-muted-foreground">—</span> : a.dynamic === 1 ? "dinamica" : "statica"}</td>}
                  <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{a.timestamp ? parseDbDate(a.timestamp).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {arpVisibili.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nessuna voce corrisponde al filtro.</p>}
        </div>
        {arpVisibili.length > MAX && <p className="mt-3 text-[13px] text-muted-foreground">Mostrate le prime {MAX} di {arpVisibili.length}.</p>}
      </Riquadro>

      {rotte.length === 0 && arp.length === 0 && (
        <p className="text-sm text-muted-foreground">Rotte e ARP non ancora lette da questo apparato. Aggiorna i dati per acquisirle.</p>
      )}
    </div>
  );
}
