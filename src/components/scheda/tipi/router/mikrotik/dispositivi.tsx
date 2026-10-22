"use client";

/**
 * Tab «Dispositivi» dei router MikroTik in SSH (artboard MkDispositivi, M19-M21): ARP, lease DHCP, vicini e host IPAM
 * uniti per IP. Ricerca, chip con i conteggi, tabella (scorre dentro il riquadro, non la pagina) e pagine da 14:
 * filtro e pagina li fa la rotta (`/api/devices/[id]/dispositivi`), qui si chiede e si disegna.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import { parseDbDate, FUSO_UTENTI } from "@/lib/db-date";
import type { FiltroDispositivi, FonteNome, PaginaDispositivi } from "@/lib/scheda/dispositivi-router";
import { Riquadro } from "../../../riquadro";
import { RigaFonti } from "../../../riga-fonti";
import type { ContestoScheda } from "../../../contesto";

const th = "whitespace-nowrap px-3 py-2 text-left text-[13px] font-semibold text-muted-foreground";
const td = "whitespace-nowrap px-3 py-1.5 text-[13px]";

const CHIP: { id: FiltroDispositivi; testo: string }[] = [
  { id: "tutti", testo: "Tutti" },
  { id: "dhcp", testo: "DHCP" },
  { id: "statici", testo: "Lease statici" },
  { id: "lldp", testo: "LLDP" },
  { id: "discordanti", testo: "▲ MAC discordante" },
];

/** La fonte del nome in parola, con forma diversa per chi non distingue i colori: pieno · bordo pieno · tratteggiato. */
const STILE_FONTE: Record<FonteNome, string> = {
  dhcp: "border-2 border-[#0D2537] bg-[#0D2537] text-white dark:border-sky-200 dark:bg-sky-200 dark:text-[#0D2537]",
  lldp: "border-2 border-[#0D2537] bg-card text-[#0D2537] dark:border-sky-200 dark:text-sky-200",
  dns: "border-2 border-dashed border-muted-foreground bg-card text-muted-foreground",
};

/** Ora italiana: «09:40» se è di oggi, altrimenti «ieri 18:02» o «21/10 18:02». */
function visto(iso: string | null): string {
  if (!iso) return "—";
  const d = parseDbDate(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const giorno = (x: Date) => x.toLocaleDateString("it-IT", { timeZone: FUSO_UTENTI });
  const ora = d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: FUSO_UTENTI });
  const adesso = new Date();
  if (giorno(d) === giorno(adesso)) return ora;
  if (giorno(d) === giorno(new Date(adesso.getTime() - 86_400_000))) return `ieri ${ora}`;
  return `${d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", timeZone: FUSO_UTENTI })} ${ora}`;
}

export function DispositiviMikrotik({ ctx }: { ctx: ContestoScheda }) {
  const deviceId = ctx.device?.id;
  const [ricerca, setRicerca] = useState("");
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<FiltroDispositivi>("tutti");
  const [pagina, setPagina] = useState(1);
  const [n, setN] = useState(0);
  const [stato, setStato] = useState<{ fase: "carico" } | { fase: "errore"; messaggio: string } | { fase: "ok"; dati: PaginaDispositivi }>({ fase: "carico" });

  // La ricerca parte 250 ms dopo l'ultimo tasto, e riporta alla prima pagina.
  useEffect(() => {
    const t = setTimeout(() => { setQ(ricerca.trim()); setPagina(1); }, 250);
    return () => clearTimeout(t);
  }, [ricerca]);

  useEffect(() => {
    if (!deviceId) return;
    let vivo = true;
    const p = new URLSearchParams({ pagina: String(pagina), filtro, q });
    fetchJson<PaginaDispositivi>(`/api/devices/${deviceId}/dispositivi?${p}`)
      .then((r) => { if (vivo) setStato(r.ok ? { fase: "ok", dati: r.data } : { fase: "errore", messaggio: r.message }); })
      .catch(() => { if (vivo) setStato({ fase: "errore", messaggio: "Richiesta annullata" }); });
    return () => { vivo = false; };
  }, [deviceId, pagina, filtro, q, n]);

  if (!deviceId) return null;
  if (stato.fase === "errore") return <LoadError what="i dispositivi" message={stato.messaggio} onRetry={() => { setStato({ fase: "carico" }); setN((x) => x + 1); }} />;
  if (stato.fase === "carico") return <Riquadro titolo="Dispositivi visti dal router"><p className="text-sm text-muted-foreground">Caricamento…</p></Riquadro>;

  const { righe, totale, conteggi, pagine } = stato.dati;
  const pulisci = () => { setRicerca(""); setQ(""); setFiltro("tutti"); setPagina(1); };
  const chip = (c: (typeof CHIP)[number]) => (
    <button
      key={c.id}
      type="button"
      aria-pressed={filtro === c.id}
      onClick={() => { setFiltro(c.id); setPagina(1); }}
      className={`h-7 rounded-full border px-3 text-[13px] font-semibold ${filtro === c.id ? "border-[#0D2537] bg-[#0D2537] text-white dark:border-sky-200 dark:bg-sky-200 dark:text-[#0D2537]" : "border-border bg-card hover:bg-muted"}`}
    >
      {c.testo} {conteggi[c.id]}
    </button>
  );

  return (
    <div className="space-y-3">
      <Riquadro titolo="Dispositivi visti dal router">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={ricerca}
              onChange={(e) => setRicerca(e.target.value)}
              placeholder="Cerca per IP, MAC, nome, produttore, commento…"
              aria-label="Cerca"
              className="h-8 w-full max-w-sm rounded-lg border border-border bg-card px-3 text-sm"
            />
            <button type="button" onClick={pulisci} className="h-8 rounded-lg border border-border bg-card px-3 text-[13px] font-semibold hover:bg-muted">Pulisci</button>
            <div className="flex flex-wrap gap-2">{CHIP.map(chip)}</div>
          </div>
          {righe.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {conteggi.tutti === 0 ? "Il router non ha ancora riportato ARP, lease o vicini." : "Nessun dispositivo corrisponde a filtro e ricerca."}
            </p>
          ) : (
            <div className="max-h-[calc(100vh-480px)] min-h-[240px] overflow-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="sticky top-0 z-10 border-b-2 bg-muted">
                    <th className={th}>IP</th><th className={th}>MAC</th><th className={th}>Produttore</th><th className={th}>Nome</th>
                    <th className={th}>Interfaccia</th><th className={th}>Tipo</th><th className={th}>Commento DHCP</th><th className={th}>Visto</th>
                  </tr>
                </thead>
                <tbody>
                  {righe.map((r) => (
                    <tr key={r.ip} className="border-b last:border-0">
                      <td className={`${td} font-mono`}>
                        {r.hostId ? <Link href={`/objects/${r.hostId}`} className="font-semibold text-[#006C96] underline-offset-2 hover:underline dark:text-sky-300">{r.ip}</Link> : r.ip}
                      </td>
                      <td className={`${td} font-mono`}>
                        {r.mac ?? "—"}
                        {r.macArpDiverso && <div className="font-semibold text-[#8E1B20] dark:text-[#E8625A]">▲ ARP {r.macArpDiverso}</div>}
                      </td>
                      <td className={td}>{r.produttore ?? "—"}</td>
                      <td className={td}>
                        {r.nome ?? "—"}
                        {r.fonteNome && <span className={`ml-1.5 inline-flex h-5 items-center rounded px-1.5 text-[13px] font-bold ${STILE_FONTE[r.fonteNome]}`}>{r.fonteNome.toUpperCase()}</span>}
                      </td>
                      <td className={td}>{r.interfaccia ?? "—"}</td>
                      <td className={td}>
                        {r.lease ? (
                          <span className={`inline-flex h-[22px] items-center rounded border-2 border-[#0D2537] px-1.5 text-[13px] font-bold dark:border-sky-200 ${r.lease === "statico" ? "bg-[#0D2537] text-white dark:bg-sky-200 dark:text-[#0D2537]" : "bg-card text-[#0D2537] dark:text-sky-200"}`}>
                            {r.lease === "statico" ? "STAT" : "DYN"}
                          </span>
                        ) : "—"}
                      </td>
                      <td className={td}>{r.commentoDhcp ?? "—"}</td>
                      <td className={td}>{visto(r.visto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted-foreground">
            <span>
              DYN lease dinamico · STAT lease statico · nome da DHCP / LLDP / DNS · ▲ MAC del lease ≠ MAC dell&apos;ARP · IP in blu = c&apos;è in IPAM, apre l&apos;host
            </span>
            <span className="flex items-center gap-2">
              <button type="button" aria-label="Pagina precedente" disabled={stato.dati.pagina <= 1} onClick={() => setPagina(stato.dati.pagina - 1)} className="h-7 rounded border border-border px-2 font-semibold disabled:opacity-40">‹</button>
              {righe.length} di {totale} · pagina {stato.dati.pagina} di {pagine}
              <button type="button" aria-label="Pagina successiva" disabled={stato.dati.pagina >= pagine} onClick={() => setPagina(stato.dati.pagina + 1)} className="h-7 rounded border border-border px-2 font-semibold disabled:opacity-40">›</button>
            </span>
          </div>
          <p className="text-[13px] text-muted-foreground">MAC: DHCP &gt; ARP &gt; LLDP · nome: DHCP &gt; LLDP &gt; DNS · ARP «failed» scartato se nessun&apos;altra fonte conferma l&apos;IP.</p>
        </div>
      </Riquadro>
      <RigaFonti fonti={[
        { nome: "ARP", esito: "ok" }, { nome: "lease DHCP", esito: "ok" }, { nome: "vicini", esito: "ok" }, { nome: "host IPAM", esito: "ok" },
      ]} />
    </div>
  );
}
