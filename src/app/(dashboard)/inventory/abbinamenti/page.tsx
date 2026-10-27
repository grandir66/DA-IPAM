"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { BadgeSegno, quando } from "@/components/assegnatari/segni";
import { fetchJson } from "@/lib/fetch-json";
import type { Abbinamenti, EsitoConferma, GruppoAbbinamento, VoceAbbinamento } from "@/lib/assegnatari/abbinamenti";

const PER_PAGINA = 50;
const CATEGORIE = ["Desktop", "Laptop", "VM", "Other"] as const;
type Filtro = GruppoAbbinamento | "tutti";
const ETICHETTA: Record<Filtro, string> = {
  proposto: "Proposti", da_rivedere: "Da rivedere", abbinato: "Già abbinati", pochi_dati: "Pochi dati", escluso: "Esclusi", tutti: "Tutti",
};
const selectCls = "h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground";

/**
 * Una voce scelta per la conferma: la persona vista quando si è spuntata, la categoria se l'asset va creato, e con un
 * asset omonimo in inventario la scelta fra «Collega» (il suo numero) e «Crea nuovo».
 */
interface Scelta { account: string; categoria?: string; asset?: "nuovo" | number }

function Accessi({ v }: { v: VoceAbbinamento }) {
  return <>{v.accessi.toLocaleString("it-IT")} su {v.totale.toLocaleString("it-IT")} <span className="text-muted-foreground">{v.base === "rete" ? "di rete" : "alla tastiera"}</span></>;
}

export default function AbbinamentiPage() {
  const [filtro, setFiltro] = useState<Filtro>("proposto");
  const [senzaAsset, setSenzaAsset] = useState(false);
  const [cerca, setCerca] = useState("");
  const [cercaAttiva, setCercaAttiva] = useState("");
  const [pagina, setPagina] = useState(1);
  const [dati, setDati] = useState<Abbinamenti | null>(null);
  const [rivedere, setRivedere] = useState<VoceAbbinamento[]>([]);
  const [esclusi, setEsclusi] = useState<VoceAbbinamento[]>([]);
  const [errore, setErrore] = useState<string | null>(null);
  const [scelti, setScelti] = useState<Map<number, Scelta>>(new Map());
  const [seminato, setSeminato] = useState(false);
  const [confermando, setConfermando] = useState(false);
  const attesa = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (attesa.current) clearTimeout(attesa.current);
    attesa.current = setTimeout(() => { setCercaAttiva(cerca); setPagina(1); }, 400);
    return () => { if (attesa.current) clearTimeout(attesa.current); };
  }, [cerca]);

  const carica = useCallback(async () => {
    const q = new URLSearchParams({ gruppo: filtro, senzaAsset: senzaAsset ? "1" : "0", pagina: String(pagina), perPagina: String(PER_PAGINA) });
    if (cercaAttiva.trim()) q.set("q", cercaAttiva.trim());
    const [principale, riv, esc] = await Promise.all([
      fetchJson<Abbinamenti>(`/api/assegnatari/abbinamenti?${q}`, { cache: "no-store" }),
      fetchJson<Abbinamenti>("/api/assegnatari/abbinamenti?gruppo=da_rivedere&perPagina=200", { cache: "no-store" }),
      fetchJson<Abbinamenti>("/api/assegnatari/abbinamenti?gruppo=escluso&perPagina=200", { cache: "no-store" }),
    ]);
    if (!principale.ok) { setErrore(principale.message); return; }
    setErrore(null);
    setDati(principale.data);
    if (riv.ok) setRivedere(riv.data.voci);
    if (esc.ok) setEsclusi(esc.data.voci);
  }, [filtro, senzaAsset, cercaAttiva, pagina]);

  useEffect(() => { void carica(); }, [carica]);

  // La spunta di serie va su tutti i proposti, una volta sola: dopo la cambia solo chi guarda.
  useEffect(() => {
    if (!dati || seminato) return;
    setScelti(new Map(Object.entries(dati.proposti).map(([id, p]) => [Number(id), { account: p.account }])));
    setSeminato(true);
  }, [dati, seminato]);

  function spunta(v: VoceAbbinamento, si: boolean) {
    if (!v.persona) return;
    setScelti((m) => {
      const n = new Map(m);
      if (si) n.set(v.hostId, { ...m.get(v.hostId), account: v.persona!.account });
      else n.delete(v.hostId);
      return n;
    });
  }
  function categoria(v: VoceAbbinamento, c: string) {
    setScelti((m) => new Map(m).set(v.hostId, { ...m.get(v.hostId), account: v.persona!.account, categoria: c || undefined }));
  }
  function sceltaAsset(v: VoceAbbinamento, x: string) {
    const asset = x === "" ? undefined : x === "nuovo" ? "nuovo" as const : Number(x);
    setScelti((m) => new Map(m).set(v.hostId, { ...m.get(v.hostId), account: v.persona!.account, asset }));
  }

  // Il riepilogo ㉔: per i proposti dal riepilogo del server (tutte le pagine), per i «da rivedere» dalle loro voci.
  const riepilogo = useMemo(() => {
    let asset = 0, collega = 0, importa = 0, senzaCategoria = 0, senzaScelta = 0;
    for (const [id, s] of scelti) {
      const p = dati?.proposti[id];
      const r = rivedere.find((x) => x.hostId === id);
      const collegaQui = typeof s.asset === "number";
      if (p?.creaAsset && collegaQui) collega++;
      else if (p?.creaAsset) asset++;
      if (p ? p.importaAssegnatario : r ? r.assegnatarioPersona === null : false) importa++;
      if (p?.omonimi && s.asset === undefined) senzaScelta++;
      else if (p?.categoriaDaScegliere && !collegaQui && !s.categoria) senzaCategoria++;
    }
    return { totale: scelti.size, asset, collega, importa, senzaCategoria, senzaScelta };
  }, [scelti, dati, rivedere]);

  async function conferma() {
    setConfermando(true);
    const voci = [...scelti].map(([hostId, s]) => ({
      hostId, account: s.account,
      ...(s.categoria && typeof s.asset !== "number" ? { categoria: s.categoria } : {}),
      ...(s.asset !== undefined ? { asset: s.asset } : {}),
    }));
    const r = await fetchJson<EsitoConferma>("/api/assegnatari/abbinamenti", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voci }),
    });
    setConfermando(false);
    if (!r.ok) { toast.error(`Errore: ${r.message}`); return; }
    const e = r.data;
    toast.success(`Abbinati ${e.assegnati} PC: ${e.assetCreati} asset creati, ${e.assetCollegati} collegati, ${e.assegnatariCreati} assegnatari importati da AD`);
    if (e.saltati.length > 0) toast.warning(`${e.saltati.length} non abbinati: ${e.saltati.slice(0, 3).map((s) => s.motivo).join("; ")}`);
    setSeminato(false);
    setScelti(new Map());
    void carica();
  }

  const c = dati?.contatori;
  const da = dati && dati.totale > 0 ? (pagina - 1) * PER_PAGINA + 1 : 0;
  const a = dati ? Math.min(pagina * PER_PAGINA, dati.totale) : 0;
  const tabellaRivedere = filtro === "da_rivedere";

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold">Abbinamenti</h1>
        <span className="text-[13px] text-muted-foreground">Chi usa i PC, dagli accessi degli ultimi {dati?.giorni ?? 30} giorni</span>
        <Link href="/settings/opzioni#automatismo.accessi_pc" className="text-sm font-semibold text-[#006C96] underline">Giro degli accessi ›</Link>
      </div>

      {errore && !dati ? (
        <LoadError what="gli abbinamenti" message={errore} onRetry={() => void carica()} />
      ) : !dati || !c ? (
        <p className="py-8 text-center text-muted-foreground">Calcolo degli abbinamenti…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <button type="button" onClick={() => { setFiltro("proposto"); setPagina(1); }} className="rounded-lg border-2 border-[#006C96] bg-card px-4 py-3 text-left">
              <div className="text-2xl font-bold">{c.proposto}</div>
              <div className="text-[13px] text-muted-foreground">proposti · {Object.values(dati.proposti).filter((p) => !p.creaAsset).length} su asset, {Object.values(dati.proposti).filter((p) => p.creaAsset).length} senza asset</div>
            </button>
            <button type="button" onClick={() => { setFiltro("da_rivedere"); setPagina(1); }} className="rounded-lg border-2 border-[#8A6D00] bg-[#FFF6C2] px-4 py-3 text-left text-[#0D2537]">
              <div className="text-2xl font-bold">▲ {c.da_rivedere}</div>
              <div className="text-[13px]">da rivedere: assegnato a un altro</div>
            </button>
            <button type="button" onClick={() => { setFiltro("pochi_dati"); setPagina(1); }} className="rounded-lg border bg-card px-4 py-3 text-left">
              <div className="text-2xl font-bold text-muted-foreground">{c.pochi_dati}</div>
              <div className="text-[13px] text-muted-foreground">pochi dati · {c.abbinato} già abbinati</div>
            </button>
            <button type="button" onClick={() => { setFiltro("escluso"); setPagina(1); }} className="rounded-lg border border-dashed border-[#5B6B77] bg-card px-4 py-3 text-left">
              <div className="text-2xl font-bold text-muted-foreground">{c.escluso}</div>
              <div className="text-[13px] text-muted-foreground">esclusi: server, apparati, condivisi</div>
            </button>
          </div>

          <Card>
            <CardContent className="flex flex-wrap items-center gap-5 py-3">
              <label className="flex items-center gap-2 text-sm">Mostra
                <select className={selectCls} value={filtro} onChange={(e) => { setFiltro(e.target.value as Filtro); setPagina(1); }}>
                  {(Object.keys(ETICHETTA) as Filtro[]).map((g) => <option key={g} value={g}>{ETICHETTA[g]}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-[#00A7E7]" checked={senzaAsset} onChange={(e) => { setSenzaAsset(e.target.checked); setPagina(1); }} /> Solo PC senza asset
              </label>
              <Input aria-label="Cerca" placeholder="Cerca PC o persona" value={cerca} onChange={(e) => setCerca(e.target.value)} className="w-56" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center gap-3 space-y-0">
              <CardTitle className="flex-1">{ETICHETTA[filtro]}</CardTitle>
              {filtro === "proposto" && <span className="text-[13px] text-muted-foreground">la spunta è già messa su tutti: si toglie da quelli che non vanno</span>}
            </CardHeader>
            <CardContent>
              {dati.voci.length === 0 ? (
                <p className="py-6 text-center text-muted-foreground">Nessun PC in questo gruppo.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10"><span className="sr-only">Scelta</span></TableHead>
                        <TableHead>PC</TableHead>
                        <TableHead>Asset</TableHead>
                        <TableHead>Usato da</TableHead>
                        <TableHead>{tabellaRivedere ? "Assegnato a" : "Assegnatario"}</TableHead>
                        <TableHead>Accessi</TableHead>
                        <TableHead>Ultima volta</TableHead>
                        {(filtro === "escluso" || filtro === "pochi_dati" || filtro === "tutti") && <TableHead>Perché</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dati.voci.map((v) => {
                        const scelta = scelti.get(v.hostId);
                        const spuntabile = (v.gruppo === "proposto" || v.gruppo === "da_rivedere") && !!v.persona;
                        const conOmonimi = !v.asset && v.omonimi.length > 0;
                        const collegaQui = typeof scelta?.asset === "number";
                        const daScegliere = !v.asset && ((conOmonimi && scelta?.asset === undefined) || (!v.categoriaProposta && !collegaQui));
                        return (
                          <TableRow key={v.hostId} className={daScegliere && spuntabile ? "bg-[#FFFBE6] dark:bg-[#3A3415]" : undefined}>
                            <TableCell>
                              {spuntabile && (
                                <input type="checkbox" className="size-4 accent-[#00A7E7]" aria-label={`Abbina ${v.pc}`} checked={!!scelta} onChange={(e) => spunta(v, e.target.checked)} />
                              )}
                            </TableCell>
                            <TableCell>
                              <span className="font-semibold">{v.pc}</span>{" "}
                              <span className="text-[13px] text-muted-foreground">· {v.ip}{v.classificazione && daScegliere ? ` · classificato «${v.classificazione}»` : ""}</span>
                            </TableCell>
                            <TableCell>
                              {v.asset ? (
                                <Link href={`/inventory/${v.asset.id}`} className="font-semibold text-[#006C96] underline">{v.asset.categoria ?? "Asset"}</Link>
                              ) : conOmonimi && spuntabile ? (
                                <div className="flex flex-col gap-1">
                                  <select aria-label={`Asset per ${v.pc}`} className={selectCls} value={scelta?.asset === undefined ? "" : String(scelta.asset)} onChange={(e) => sceltaAsset(v, e.target.value)}>
                                    <option value="">▲ esiste già un asset con questo nome</option>
                                    {v.omonimi.map((o) => <option key={o.id} value={o.id}>Collega a n. {o.id} · {o.nome}{o.ip ? ` · ${o.ip}` : ""}</option>)}
                                    <option value="nuovo">Crea nuovo{v.categoriaProposta ? ` (${v.categoriaProposta})` : ""}</option>
                                  </select>
                                  {scelta?.asset === "nuovo" && !v.categoriaProposta && (
                                    <select aria-label={`Categoria per ${v.pc}`} className={selectCls} value={scelta?.categoria ?? ""} onChange={(e) => categoria(v, e.target.value)}>
                                      <option value="">▲ categoria da scegliere</option>
                                      {CATEGORIE.map((k) => <option key={k} value={k}>{k}</option>)}
                                    </select>
                                  )}
                                </div>
                              ) : v.categoriaProposta ? (
                                <BadgeSegno tipo="neutro">Si crea: {v.categoriaProposta}</BadgeSegno>
                              ) : spuntabile ? (
                                <select aria-label={`Categoria per ${v.pc}`} className={selectCls} value={scelta?.categoria ?? ""} onChange={(e) => categoria(v, e.target.value)}>
                                  <option value="">▲ categoria da scegliere</option>
                                  {CATEGORIE.map((k) => <option key={k} value={k}>{k}</option>)}
                                </select>
                              ) : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell>{v.persona ? <>{v.persona.nome}{v.persona.ruolo ? <span className="text-[13px] text-muted-foreground"> · {v.persona.ruolo}</span> : null}</> : "—"}</TableCell>
                            <TableCell>
                              {tabellaRivedere || v.gruppo === "abbinato" || v.gruppo === "da_rivedere"
                                ? <>{v.assegnato?.nome ?? "—"}{v.assegnato?.origine === "manuale" ? <span className="text-[13px] text-muted-foreground"> · a mano</span> : null}</>
                                : !v.persona ? "—"
                                  : v.assegnatarioPersona !== null ? <BadgeSegno tipo="ok">Già assegnatario</BadgeSegno> : <BadgeSegno tipo="neutro">Si importa da AD</BadgeSegno>}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">{v.totale > 0 ? <Accessi v={v} /> : "—"}</TableCell>
                            <TableCell className="whitespace-nowrap">{quando(v.ultimo)}</TableCell>
                            {(filtro === "escluso" || filtro === "pochi_dati" || filtro === "tutti") && <TableCell className="text-[13px] text-muted-foreground">{v.motivo ?? ""}</TableCell>}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              {dati.totale > 0 && (
                <div className="flex items-center gap-3 pt-3 text-[13px] text-muted-foreground">
                  <span>{da}–{a} di {dati.totale}</span>
                  {pagina > 1 && <Button variant="link" className="h-auto p-0 text-[13px] text-[#006C96]" onClick={() => setPagina((p) => p - 1)}>pagina precedente</Button>}
                  {a < dati.totale && <Button variant="link" className="h-auto p-0 text-[13px] text-[#006C96]" onClick={() => setPagina((p) => p + 1)}>pagina successiva</Button>}
                </div>
              )}
            </CardContent>
          </Card>

          {filtro === "proposto" && rivedere.length > 0 && (
            <section className="space-y-2 rounded-lg border-2 border-[#8A6D00] bg-[#FFF6C2] px-4 py-3 text-[#0D2537]">
              <h2 className="text-[16px] font-semibold">▲ Da rivedere — assegnato a un altro ({rivedere.length})</h2>
              <div className="overflow-x-auto rounded-md bg-white dark:bg-card">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Sostituisci</TableHead><TableHead>PC</TableHead><TableHead>Assegnato a</TableHead><TableHead>Usato da</TableHead><TableHead>Accessi</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {rivedere.map((v) => (
                      <TableRow key={v.hostId}>
                        <TableCell><input type="checkbox" className="size-4 accent-[#00A7E7]" aria-label={`Sostituisci su ${v.pc}`} checked={scelti.has(v.hostId)} onChange={(e) => spunta(v, e.target.checked)} /></TableCell>
                        <TableCell className="font-semibold">{v.pc}</TableCell>
                        <TableCell>{v.assegnato?.nome}{v.assegnato?.origine === "manuale" ? <span className="text-[13px] text-muted-foreground"> · a mano</span> : null}</TableCell>
                        <TableCell>{v.persona?.nome ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap"><Accessi v={v} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-[13px]">Senza spunta di serie: l&apos;assegnazione resta finché non la sostituisci tu.</p>
            </section>
          )}

          {filtro === "proposto" && esclusi.length > 0 && (
            <details className="rounded-lg border border-dashed border-[#5B6B77] bg-card px-4 py-3">
              <summary className="cursor-pointer text-[15px] font-semibold">Esclusi ({esclusi.length}) — perché non sono proposti</summary>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {esclusi.map((v) => (
                  <li key={v.hostId}>
                    <span className="font-semibold text-foreground">{v.pc}</span> — {v.motivo}
                    {v.persona ? <Fragment>; usato da {v.persona.nome}</Fragment> : null}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3 rounded-lg border bg-card px-4 py-3">
            <span className="flex-1 text-sm">
              Selezionati: <strong className="font-semibold">{riepilogo.totale}</strong> — {riepilogo.asset} asset da creare,
              {riepilogo.collega > 0 ? ` ${riepilogo.collega} da collegare,` : ""} {riepilogo.importa}{" "}
              {riepilogo.importa === 1 ? "assegnatario" : "assegnatari"} da importare da AD, {riepilogo.totale} assegnazioni. Ogni asset scrive una riga nel suo diario.
              {riepilogo.senzaScelta > 0 && <span className="ml-2 font-semibold text-[#8A6D00] dark:text-[#FFD400]">▲ {riepilogo.senzaScelta} con un asset dallo stesso nome: scegli «Collega» o «Crea nuovo»</span>}
              {riepilogo.senzaCategoria > 0 && <span className="ml-2 font-semibold text-[#8A6D00] dark:text-[#FFD400]">▲ {riepilogo.senzaCategoria} senza categoria: sceglila nella riga</span>}
            </span>
            <Button className="min-h-11 text-[#0D2537]" disabled={riepilogo.totale === 0 || riepilogo.senzaCategoria > 0 || riepilogo.senzaScelta > 0 || confermando} onClick={() => void conferma()}>
              {confermando ? "Conferma…" : `Conferma ${riepilogo.totale} ${riepilogo.totale === 1 ? "abbinamento" : "abbinamenti"}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
