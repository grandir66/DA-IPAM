"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { Etichetta, Pannello, VoceSelezionabile, Vuoto } from "@/components/shared/console";
import { fetchJson } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";
import { TIPI_RILIEVO, type CategoriaRilievo, type GravitaRilievo, type TipoRilievo } from "@/lib/trunk/rilievi-tipi";
import type { RiepilogoRilievi, RilievoRiga } from "@/lib/trunk/rilievi";

const PAGINA = 50;

/** Gravità = segno + fondo pieno (mai la sola tinta): ✕ alta, ▲ media, ● bassa. */
export const GRAVITA: Record<GravitaRilievo, { segno: string; testo: string; classe: string }> = {
  alta: { segno: "✕", testo: "alta", classe: "bg-[#8E1B20] text-white border-[#8E1B20]" },
  media: { segno: "▲", testo: "media", classe: "bg-[#FFD400] text-[#0D2537] border-[#C9A800]" },
  bassa: { segno: "●", testo: "bassa", classe: "bg-card text-foreground border-foreground/40" },
};

const CATEGORIE: Array<{ id: CategoriaRilievo; titolo: string; spiega: string }> = [
  { id: "allarme", titolo: "Allarmi", spiega: "cose successe, da guardare subito" },
  { id: "esposizione", titolo: "Esposizioni", spiega: "come è fatta la rete, con cosa fare" },
  { id: "novita", titolo: "Novità", spiega: "apparati e VLAN che non conosciamo" },
];

export function SegnoGravita({ g }: { g: GravitaRilievo }) {
  const s = GRAVITA[g];
  return (
    <span title={`Gravità ${s.testo}`} className={cn("inline-flex h-6 min-w-6 items-center justify-center rounded-md border px-1 text-[13px] font-bold", s.classe)}>
      {s.segno}
    </span>
  );
}

function fa(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  if (Number.isNaN(t)) return iso;
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "adesso";
  if (s < 3600) return `${Math.round(s / 60)} min fa`;
  if (s < 86400) return `${Math.round(s / 3600)} h fa`;
  return `${Math.round(s / 86400)} g fa`;
}

function testo(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/** I MAC coinvolti: uno solo, o l'elenco per gli IP contesi. */
function Schede({ r }: { r: RilievoRiga }) {
  const elenco = Array.isArray(r.dettaglio.mac)
    ? (r.dettaglio.mac as Array<{ mac?: unknown; produttore?: unknown }>).map((m) => ({ mac: testo(m.mac), produttore: testo(m.produttore) }))
    : r.mac ? [{ mac: r.mac, produttore: testo(r.dettaglio.produttore) }] : [];
  if (!elenco.length) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col gap-0.5">
      {elenco.map((m) => (
        <span key={m.mac ?? ""} className="whitespace-nowrap">
          <span className="font-mono text-[13px]">{m.mac}</span>
          {m.produttore && <span className="ml-1.5 text-[13px] text-muted-foreground">{m.produttore}</span>}
        </span>
      ))}
    </div>
  );
}

export interface DatiRilievi {
  rilievi: RilievoRiga[];
  totale: number;
  riepilogo: RiepilogoRilievi;
}

export function PannelloRilievi({ iniziale, admin }: { iniziale: DatiRilievi; admin: boolean }) {
  const router = useRouter();
  const [righe, setRighe] = useState(iniziale.rilievi);
  const [totale, setTotale] = useState(iniziale.totale);
  const [riepilogo, setRiepilogo] = useState(iniziale.riepilogo);
  const [tipo, setTipo] = useState<TipoRilievo | null>(null);
  const [daPrendere, setDaPrendere] = useState(false);
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [errore, setErrore] = useState<string | null>(null);

  const carica = useCallback(async (f: { tipo: TipoRilievo | null; daPrendere: boolean; q: string; off: number }) => {
    const p = new URLSearchParams({ limit: String(PAGINA), offset: String(f.off) });
    if (f.tipo) p.set("tipo", f.tipo);
    if (f.daPrendere) p.set("daPrendere", "1");
    if (f.q.trim()) p.set("q", f.q.trim());
    const res = await fetchJson<DatiRilievi>(`/api/trunk/rilievi?${p.toString()}`);
    if (!res.ok) {
      setErrore(res.message);
      return;
    }
    setErrore(null);
    setRighe(res.data.rilievi);
    setTotale(res.data.totale);
    setRiepilogo(res.data.riepilogo);
    setOffset(f.off);
  }, []);

  const filtra = (c: Partial<{ tipo: TipoRilievo | null; daPrendere: boolean; q: string; off: number }>) => {
    const f = { tipo, daPrendere, q, off: 0, ...c };
    setTipo(f.tipo);
    setDaPrendere(f.daPrendere);
    void carica(f);
  };

  const prendi = async (r: RilievoRiga, preso: boolean) => {
    const res = await fetchJson<{ ok: boolean }>("/api/trunk/rilievi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: r.id, preso }),
    });
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(preso ? "Rilievo preso in carico" : "Rilievo di nuovo da prendere in carico");
    await carica({ tipo, daPrendere, q, off: offset });
    router.refresh();
  };

  const nessuno = riepilogo.perTipo.length === 0;
  const scelto = tipo ? TIPI_RILIEVO[tipo] : null;

  return (
    <Pannello titolo="Sicurezza della rete" conteggio={riepilogo.allarmi + riepilogo.esposizioni + riepilogo.novita}
      sottotitolo="Quello che si capisce ascoltando il trunk: allarmi, esposizioni e apparati sconosciuti"
      piede={scelto ? <><b className="text-foreground">Cosa fare:</b> {scelto.cosaFare}</> : "Scegli un tipo di rilievo per filtrare l'elenco e leggere cosa fare."}>
      {nessuno ? (
        <Vuoto titolo="Nessun rilievo aperto"
          testo="Si calcolano a ogni lettura del sensore, ogni 2 minuti. Se il sensore non ha ancora dati, qui resta vuoto." />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-3">
            {CATEGORIE.map((c) => {
              const voci = riepilogo.perTipo.filter((t) => t.categoria === c.id);
              return (
                <div key={c.id} className="space-y-2">
                  <p className="text-[13px] font-bold uppercase tracking-wider text-cian-testo">
                    {c.titolo} <span className="font-normal normal-case tracking-normal text-muted-foreground">· {c.spiega}</span>
                  </p>
                  {voci.length === 0 ? (
                    <p className="rounded-xl border border-dashed px-3 py-2.5 text-[13px] text-muted-foreground">✓ nessuno</p>
                  ) : voci.map((t) => (
                    <VoceSelezionabile key={t.tipo} scelta={tipo === t.tipo} className="flex items-center gap-2.5 p-2.5"
                      onScegli={() => filtra({ tipo: tipo === t.tipo ? null : t.tipo })}>
                      <SegnoGravita g={t.gravita} />
                      <span className="min-w-0 flex-1 truncate font-medium">{TIPI_RILIEVO[t.tipo].etichetta}</span>
                      <span className="font-mono font-semibold">{t.n}</span>
                      {t.daPrendere < t.n && <span className="text-[13px] text-muted-foreground">{t.n - t.daPrendere} presi</span>}
                    </VoceSelezionabile>
                  ))}
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {scelto && <Etichetta tono="marca" mono={false}>{scelto.etichetta}</Etichetta>}
              <div className="flex overflow-hidden rounded-lg border" role="group" aria-label="Quali rilievi">
                {[{ v: false, t: "Tutti" }, { v: true, t: "Da prendere in carico" }].map((b) => (
                  <button key={b.t} type="button" aria-pressed={daPrendere === b.v} onClick={() => filtra({ daPrendere: b.v })}
                    className={cn("min-h-8 px-2.5 text-[13px]", daPrendere === b.v ? "bg-primary font-semibold text-[#0D2537]" : "bg-card hover:bg-muted/50")}>
                    {b.t}
                  </button>
                ))}
              </div>
            </div>
            <div className="relative w-64 max-w-full">
              <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
              <Input className="h-8 pl-8" placeholder="Cerca IP, MAC, testo" value={q} onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") filtra({ q }); }} />
            </div>
          </div>

          {errore && <LoadError what="i rilievi di sicurezza" message={errore} onRetry={() => filtra({ off: offset })} />}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">Gr.</TableHead>
                  <TableHead>Rilievo</TableHead>
                  <TableHead>VLAN</TableHead>
                  <TableHead>Indirizzo IP</TableHead>
                  <TableHead>MAC e produttore</TableHead>
                  <TableHead>Ultimo visto</TableHead>
                  <TableHead className="text-right">Presa in carico</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {righe.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">Nessun rilievo con questi filtri.</TableCell></TableRow>
                )}
                {righe.map((r) => (
                  <TableRow key={r.id} className={cn(r.preso_in_carico === 1 && "opacity-70")}>
                    <TableCell><SegnoGravita g={r.gravita} /></TableCell>
                    <TableCell className="min-w-64">
                      <div className="font-medium">{r.descrizione}</div>
                      <div className="text-[13px] text-muted-foreground">{TIPI_RILIEVO[r.tipo]?.etichetta ?? r.tipo}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-[13px] text-cian-testo">
                      {r.vid == null ? "più VLAN" : r.vid === 0 ? "Nativa" : `VLAN ${r.vid}`}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono">{r.ip ?? "—"}</TableCell>
                    <TableCell><Schede r={r} /></TableCell>
                    <TableCell className="whitespace-nowrap text-[13px] text-muted-foreground" title={r.ultima_vista ?? r.rilevato_il}>
                      {fa(r.ultima_vista ?? r.rilevato_il)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {r.preso_in_carico === 1 ? (
                        <span className="inline-flex items-center gap-2 text-[13px]">
                          <span title={r.preso_il ?? undefined}>✓ {r.preso_da ?? "preso"}</span>
                          {admin && <Button size="sm" variant="outline" onClick={() => void prendi(r, false)}>Riapri</Button>}
                        </span>
                      ) : admin ? (
                        <Button size="sm" variant="outline" onClick={() => void prendi(r, true)}>Prendi in carico</Button>
                      ) : <span className="text-[13px] text-muted-foreground">da prendere</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><SegnoGravita g="alta" /> grave: conta nel numero rosso del menu</span>
              <span className="inline-flex items-center gap-1.5"><SegnoGravita g="media" /> da controllare</span>
              <span className="inline-flex items-center gap-1.5"><SegnoGravita g="bassa" /> da sapere</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => filtra({ off: Math.max(offset - PAGINA, 0) })}>Precedenti</Button>
              <span className="text-muted-foreground">{totale === 0 ? "0" : `${offset + 1}–${Math.min(offset + PAGINA, totale)}`} di {totale}</span>
              <Button size="sm" variant="outline" disabled={offset + PAGINA >= totale} onClick={() => filtra({ off: offset + PAGINA })}>Successivi</Button>
            </div>
          </div>
        </div>
      )}
    </Pannello>
  );
}
