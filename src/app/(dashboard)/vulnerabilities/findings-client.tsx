"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { Pagination } from "@/components/shared/pagination";
import {
  BadgeGravita,
  BarraGravita,
  DatoDettaglio,
  Etichetta,
  LegendaGravita,
  Pannello,
  TempoRelativo,
  Vuoto,
} from "@/components/shared/console";
import { Checkbox } from "@/components/ui/checkbox";
import { BadgeTriage, EditorTriage, TRIAGE_UI } from "@/components/shared/triage-riga";
import { useEAdmin } from "@/hooks/use-e-admin";
import { toast } from "sonner";
import { fetchJson } from "@/lib/fetch-json";
import { FONTI_RILIEVO_UI, MOTORI_RILIEVO, MOTORI_RILIEVO_UI, type ElencoRilievi, type MotoreRilievo, type RilievoUnito } from "@/lib/rilievi/tipi";
import type { GruppoRilievi, IndicatoriRilievi, Raggruppamento } from "@/lib/rilievi/gruppi";
import { STATI_TRIAGE, type StatoTriage } from "@/lib/triage/db";
import { SEVERITIES, type Severity } from "@/lib/severity-style";
import { VulnerabilitiesListClient } from "./vulnerabilities-list-client";

type Scheda = "findings" | "vulnerabilita";

function schedaDaIndirizzo(): Scheda {
  if (typeof window === "undefined") return "findings";
  const hash = window.location.hash.replace(/^#/, "");
  if (hash === "vulnerabilita") return "vulnerabilita";
  if (hash === "findings") return "findings";
  return "findings";
}

type Vista = "cve" | Raggruppamento;

/** I collegamenti di prima (`?vista=host`) aprono il raggruppamento giusto della pagina unica. */
function vistaDaIndirizzo(): Vista {
  if (typeof window === "undefined") return "cve";
  const v = new URLSearchParams(window.location.search).get("vista");
  return v === "host" || v === "software" || v === "rete" ? v : "cve";
}

const PER_PAGINA = 50;

export function FindingsClient() {
  const [scheda, setScheda] = useState<Scheda>("findings");
  const [pronta, setPronta] = useState(false);
  useEffect(() => {
    setScheda(schedaDaIndirizzo());
    setPronta(true);
    const onHash = () => setScheda(schedaDaIndirizzo());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function scegli(v: Scheda) {
    setScheda(v);
    const url = `${window.location.pathname}${window.location.search}#${v}`;
    window.history.replaceState(null, "", url);
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      {/* Una riga sola (Riccardo, 10/11/2026: «occupa metà schermo»): titolo, le due schede, l'azione. */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight">Findings</h1>
        {scheda === "vulnerabilita" ? (
          <Button type="button" size="sm" variant="outline" onClick={() => scegli("findings")}>
            ‹ Torna ai Findings
          </Button>
        ) : (
          <button
            type="button"
            className="text-[13px] underline underline-offset-2"
            title="La tabella di prima, per CVE o per host: EPSS, sistema operativo, ordinamento per colonna, archivio degli exploit"
            onClick={() => scegli("vulnerabilita")}
          >
            Tabella completa ›
          </button>
        )}
        <span className="flex-1" />
        <Button variant="default" size="sm" nativeButton={false} render={<Link href="/scans" />}>
          Lancia un giro
        </Button>
      </div>
      {!pronta ? null : scheda === "vulnerabilita" ? <VulnerabilitiesListClient embedded /> : <ElencoFindings vistaIniziale={vistaDaIndirizzo()} />}
    </div>
  );
}

interface RilievoRete {
  network_id: number;
  network_name: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}

const VISTE: ReadonlyArray<readonly [Vista, string]> = [
  ["cve", "Rilievo"],
  ["software", "Cosa aggiornare"],
  ["host", "Host"],
  ["rete", "Rete"],
];
const NOME_GRUPPO: Record<Raggruppamento, string> = { software: "Cosa aggiornare", host: "Host", rete: "Rete" };
const FASCIA_CHIUSA = "da-ipam.findings.fascia-chiusa";

function ElencoFindings({ vistaIniziale }: { vistaIniziale: Vista }) {
  const admin = useEAdmin();
  const [motore, setMotore] = useState<MotoreRilievo>("tutti");
  const [gravita, setGravita] = useState<Set<Severity>>(new Set());
  const [q, setQ] = useState("");
  const [cerca, setCerca] = useState("");
  const [page, setPage] = useState(1);
  // «cve» = una riga per rilievo, com'è sempre stata; «software» = raccolti per cosa aggiornare (10/11/2026).
  const [vista, setVista] = useState<Vista>(vistaIniziale);
  // Filtri uguali in ogni vista: cambiando raggruppamento non si perdono.
  const [exploit, setExploit] = useState<Set<"kev" | "edb">>(new Set());
  const [stato, setStato] = useState<Set<StatoTriage>>(new Set());
  const [rete, setRete] = useState<{ id: number; nome: string } | null>(null);
  const [ospite, setOspite] = useState<{ id: number; nome: string } | null>(null);
  const [perRete, setPerRete] = useState<RilievoRete[]>([]);
  const [fasciaChiusa, setFasciaChiusa] = useState(false);
  useEffect(() => {
    try {
      setFasciaChiusa(window.localStorage.getItem(FASCIA_CHIUSA) === "1");
    } catch {
      // senza archivio del browser la fascia resta aperta
    }
    void fetchJson<{ reti: RilievoRete[] }>("/api/vulnerabilities/per-rete").then((r) => {
      if (r.ok) setPerRete(r.data.reti);
    });
  }, []);
  function alternaFascia() {
    setFasciaChiusa((v) => {
      try {
        window.localStorage.setItem(FASCIA_CHIUSA, v ? "0" : "1");
      } catch {
        // come sopra
      }
      return !v;
    });
  }
  const [dati, setDati] = useState<ElencoRilievi | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [aperti, setAperti] = useState<Set<string>>(new Set());
  const [selezione, setSelezione] = useState<Set<string>>(new Set());

  const richiesta = useRef(0);

  const load = useCallback(async () => {
    const id = ++richiesta.current;
    const sp = new URLSearchParams();
    if (motore !== "tutti") sp.set("fonte", MOTORI_RILIEVO_UI[motore].fonti.join(","));
    if (gravita.size) sp.set("gravita", [...gravita].join(","));
    if (q.trim()) sp.set("q", q.trim());
    sp.set("page", String(page));
    sp.set("pageSize", String(PER_PAGINA));
    if (vista !== "cve") sp.set("raggruppa", vista);
    if (exploit.size) sp.set("exploit", [...exploit].join(","));
    if (stato.size) sp.set("stato", [...stato].join(","));
    if (rete) sp.set("rete", String(rete.id));
    if (ospite) sp.set("ospite", String(ospite.id));
    sp.set("indicatori", "1");
    const r = await fetchJson<ElencoRilievi>(`/api/rilievi?${sp}`, { cache: "no-store" });
    if (id !== richiesta.current) return;
    if (r.ok) {
      setDati(r.data);
      setErrore(null);
    } else setErrore(r.message);
  }, [motore, gravita, q, page, vista, exploit, stato, rete, ospite]);

  useEffect(() => {
    void load();
    return () => { richiesta.current += 1; };
  }, [load]);

  // La selezione vale per la vista corrente: cambiando tab, filtri, ricerca o pagina si azzera.
  useEffect(() => {
    setSelezione(new Set());
  }, [motore, gravita, q, page, vista, exploit, stato, rete, ospite]);

  function alterna<T>(set: (f: (prev: Set<T>) => Set<T>) => void, v: T) {
    set((prev) => {
      const n = new Set(prev);
      if (n.has(v)) n.delete(v);
      else n.add(v);
      return n;
    });
    setPage(1);
  }
  const filtriAttivi = gravita.size + exploit.size + stato.size + (rete ? 1 : 0) + (ospite ? 1 : 0) + (q.trim() ? 1 : 0);
  function azzeraFiltri() {
    setGravita(new Set());
    setExploit(new Set());
    setStato(new Set());
    setRete(null);
    setOspite(null);
    setQ("");
    setCerca("");
    setPage(1);
  }
  /** «Apri l'elenco» di un gruppo: l'elenco per rilievo, ristretto a quel gruppo. */
  function apriGruppo(g: GruppoRilievi) {
    if (g.filtro?.rete != null) setRete({ id: g.filtro.rete, nome: g.nome });
    if (g.filtro?.ospite != null) setOspite({ id: g.filtro.ospite, nome: g.nome });
    if (g.filtro?.q) {
      setCerca(g.filtro.q);
      setQ(g.filtro.q);
    }
    setPage(1);
    setVista("cve");
  }

  function alternaGravita(s: Severity) {
    setGravita((prev) => {
      const n = new Set(prev);
      if (n.has(s)) n.delete(s);
      else n.add(s);
      return n;
    });
    setPage(1);
  }

  function toggle(id: string) {
    setAperti((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  // Aggiorna lista e conteggi senza ricaricare: sposta il rilievo dallo stato vecchio al nuovo.
  const onCambioTriage = useCallback((id: string, t: { stato: StatoTriage; nota: string }) => {
    setDati((prev) => {
      if (!prev) return prev;
      const riga = prev.data.find((x) => x.id === id);
      const vecchio: StatoTriage = riga?.triage?.stato ?? "da_fare";
      const conteggiTriage = { ...prev.conteggiTriage };
      if (conteggiTriage[vecchio] > 0) conteggiTriage[vecchio] -= 1;
      conteggiTriage[t.stato] += 1;
      const data = prev.data.map((x) =>
        x.id === id
          ? { ...x, triage: { stato: t.stato, nota: t.nota, aggiornato_il: new Date().toISOString(), aggiornato_da: x.triage?.aggiornato_da ?? null } }
          : x,
      );
      return { ...prev, data, conteggiTriage };
    });
  }, []);

  function alternaSelezione(id: string, v: boolean) {
    setSelezione((prev) => {
      const n = new Set(prev);
      if (v) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  const idPagina = dati?.data.map((r) => r.id) ?? [];
  const tuttiSelezionati = idPagina.length > 0 && idPagina.every((id) => selezione.has(id));
  function alternaTutti(v: boolean) {
    setSelezione(v ? new Set(idPagina) : new Set());
  }

  // Imposta lo stesso stato sui rilievi selezionati (la nota di ciascuno resta). Poi ricarica.
  const applicaBlocco = useCallback(
    async (stato: StatoTriage) => {
      if (!dati || selezione.size === 0) return;
      const chiavi = dati.data.filter((r) => selezione.has(r.id)).map((r) => r.chiaveTriage);
      const r = await fetchJson<{ ok: boolean }>("/api/triage/blocco", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chiavi, stato }),
      });
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      setSelezione(new Set());
      await load();
    },
    [dati, selezione, load],
  );

  // «Prendi in carico» su un gruppo: «In corso» sulle sole CVE ancora da rivedere. L'API accetta
  // 1.000 chiavi per volta: i gruppi grossi vanno a pezzi.
  const prendiInCarico = useCallback(
    async (g: GruppoRilievi) => {
      for (let i = 0; i < g.chiaviDaFare.length; i += 1000) {
        const r = await fetchJson<{ ok: boolean }>("/api/triage/blocco", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chiavi: g.chiaviDaFare.slice(i, i + 1000), stato: "in_corso" }),
        });
        if (!r.ok) {
          toast.error(r.message);
          return;
        }
      }
      toast.success(`${g.nome}: ${g.chiaviDaFare.length} rilievi presi in carico`);
      await load();
    },
    [load],
  );

  const rollup = dati?.rollup ?? { Critical: 0, High: 0, Medium: 0, Low: 0 };
  const perFonte = dati?.perFonte ?? { edge: 0, wazuh: 0, trunk: 0, giro: 0 };
  const totale = dati?.total ?? 0;
  const conteggiTriage = dati?.conteggiTriage ?? { da_fare: 0, in_corso: 0, fatto: 0, ignorato: 0 };
  const triTot = conteggiTriage.da_fare + conteggiTriage.in_corso + conteggiTriage.fatto + conteggiTriage.ignorato;
  const triRivisti = conteggiTriage.fatto + conteggiTriage.ignorato;
  const triPct = triTot > 0 ? Math.round((triRivisti / triTot) * 100) : 0;

  return (
    <div className="space-y-4">
      {!!dati?.nonDisponibili.length && (
        <p role="status" className="text-[13px]">Fonti non disponibili · {dati.nonDisponibili.map((f) => FONTI_RILIEVO_UI[f].nome).join(", ")}</p>
      )}
      {!!dati?.parziali.length && (
        <p role="status" className="text-[13px] text-muted-foreground">Risultati e contatori parziali · {dati.parziali.map((f) => FONTI_RILIEVO_UI[f].nome).join(", ")}</p>
      )}

      <FasciaIndicatori
        chiusa={fasciaChiusa}
        onAlterna={alternaFascia}
        numeri={dati?.indicatori ?? null}
        daRivedere={conteggiTriage.da_fare}
        totale={triTot}
        reti={perRete}
        reteScelta={rete?.id ?? null}
        onDaRivedere={() => { setStato(new Set<StatoTriage>(["da_fare"])); setPage(1); setVista("cve"); }}
        onSfruttate={() => { setExploit(new Set<"kev" | "edb">(["kev"])); setPage(1); setVista("cve"); }}
        onAggiornamenti={() => { setGravita(new Set<Severity>(["Critical"])); setPage(1); setVista("software"); }}
        onHost={(o) => { if (o.ospite != null) setOspite({ id: o.ospite, nome: o.nome }); setPage(1); setVista("cve"); }}
        onRete={(r) => { setRete(rete?.id === r.network_id ? null : { id: r.network_id, nome: r.network_name }); setPage(1); }}
      />

      <Pannello
        titolo="Elenco"
        conteggio={totale}
        azioni={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
              <Input
                value={cerca}
                onChange={(e) => setCerca(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setQ(cerca);
                    setPage(1);
                  }
                }}
                placeholder="Cerca IP, titolo, rete"
                aria-label="Cerca"
                className="h-8 w-56 pl-8 sm:w-64"
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setAperti(dati ? new Set(dati.data.map((r) => r.id)) : new Set())}
            >
              Espandi tutto
            </Button>
            <LegendaGravita />
          </div>
        }
      >
        <div className="space-y-3">
          {/* Fonte come tab segmentati su una riga sua (Riccardo, 10/11): «Tutti» è la vista
              comune, gli altri separano per motore (Trunk e Giri sono IPAM/Nety; CVE è Edge+Wazuh). */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-muted-foreground">Raggruppa per</span>
            <div role="group" aria-label="Raggruppa per" className="inline-flex overflow-hidden rounded-lg border border-foreground/70">
              {VISTE.map(([v, nome], i) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={vista === v}
                  onClick={() => { setVista(v); setPage(1); }}
                  className={`h-8 px-3 text-sm ${i > 0 ? "border-l border-foreground/70" : ""} ${vista === v ? "bg-foreground text-background font-medium" : "bg-card hover:bg-muted"}`}
                >
                  {nome}
                </button>
              ))}
            </div>
          </div>
          <div role="group" aria-label="Motore" className="inline-flex flex-wrap overflow-hidden rounded-lg border border-foreground/70">
            {MOTORI_RILIEVO.map((m, i) => {
              const conteggio = m === "tutti" ? (dati?.totaleGlobale ?? 0) : MOTORI_RILIEVO_UI[m].fonti.reduce((a, x) => a + perFonte[x], 0);
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={motore === m}
                  onClick={() => { setMotore(m); setPage(1); }}
                  className={`h-8 px-3 text-sm ${i > 0 ? "border-l border-foreground/70" : ""} ${motore === m ? "bg-foreground text-background font-medium" : "bg-card hover:bg-muted"}`}
                >
                  {MOTORI_RILIEVO_UI[m].nome}{dati ? ` ${conteggio}` : ""}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {SEVERITIES.map((s) => (
              <button
                key={`f-${s}`}
                type="button"
                aria-pressed={gravita.has(s)}
                onClick={() => alternaGravita(s)}
                className={`rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${gravita.has(s) ? "ring-2 ring-foreground" : "opacity-70 hover:opacity-100"}`}
              >
                <BadgeGravita gravita={s} conteggio={dati ? rollup[s] : undefined} />
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {([["kev", "Sfruttate attivamente"], ["edb", "Exploit pubblico"]] as const).map(([v, nome]) => (
              <button key={v} type="button" aria-pressed={exploit.has(v)} onClick={() => alterna(setExploit, v)}
                className={`h-7 rounded-md border px-2 text-[13px] ${exploit.has(v) ? "border-foreground bg-foreground text-background font-medium" : "bg-card hover:bg-muted"}`}>
                {nome}
              </button>
            ))}
            {STATI_TRIAGE.map((v) => (
              <button key={v} type="button" aria-pressed={stato.has(v)} onClick={() => alterna(setStato, v)}
                className={`h-7 rounded-md border px-2 text-[13px] ${stato.has(v) ? "border-foreground bg-foreground text-background font-medium" : "bg-card hover:bg-muted"}`}>
                {TRIAGE_UI[v].parola}
              </button>
            ))}
            {rete && (
              <button type="button" onClick={() => { setRete(null); setPage(1); }} className="h-7 rounded-md border border-foreground bg-foreground px-2 text-[13px] font-medium text-background" title="Togli il filtro per rete">
                Rete {rete.nome} ✕
              </button>
            )}
            {ospite && (
              <button type="button" onClick={() => { setOspite(null); setPage(1); }} className="h-7 rounded-md border border-foreground bg-foreground px-2 text-[13px] font-medium text-background" title="Togli il filtro per host">
                Host {ospite.nome} ✕
              </button>
            )}
            {filtriAttivi > 0 && (
              <button type="button" onClick={azzeraFiltri} className="h-7 px-1 text-[13px] underline underline-offset-2">
                Togli i filtri
              </button>
            )}
          </div>
          {dati && triTot > 0 && (
            <span className="ml-auto flex items-center gap-2" title={`Da rivedere ${conteggiTriage.da_fare} · in corso ${conteggiTriage.in_corso} · rivisti ${conteggiTriage.fatto} · ignorati ${conteggiTriage.ignorato}`}>
              <span>
                <strong className="font-mono">{triRivisti}</strong> di <strong className="font-mono">{triTot}</strong> rivisti
                {conteggiTriage.in_corso > 0 && <span className="text-muted-foreground"> · {conteggiTriage.in_corso} in corso</span>}
              </span>
              <span className="h-2 w-32 overflow-hidden rounded-full bg-[#C5CED4]" aria-hidden>
                <span className="block h-full bg-[#1F7A4D]" style={{ width: `${triPct}%` }} />
              </span>
            </span>
          )}
          </div>

          {admin && selezione.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2 text-[13px]">
              <span>
                <strong className="font-mono">{selezione.size}</strong> selezionati · imposta stato:
              </span>
              {STATI_TRIAGE.map((s) => (
                <Button key={`b-${s}`} type="button" size="sm" variant="outline" onClick={() => void applicaBlocco(s)}>
                  {TRIAGE_UI[s].parola}
                </Button>
              ))}
              <Button type="button" size="sm" variant="ghost" onClick={() => setSelezione(new Set())}>
                Deseleziona
              </Button>
            </div>
          )}

          {errore ? (
            <LoadError what="i findings" message={errore} onRetry={() => void load()} />
          ) : !dati ? (
            <p className="p-6 text-center text-[13px] text-muted-foreground">Caricamento…</p>
          ) : dati.data.length === 0 ? (
            <Vuoto
              titolo="Nessun finding"
              testo="Lancia un giro di rete o una scansione VA. I certificati scaduti e gli allarmi del trunk compaiono da soli."
              azione={
                <Button size="sm" nativeButton={false} render={<Link href="/scans" />}>
                  Lancia un giro
                </Button>
              }
            />
          ) : vista !== "cve" ? (
            <GruppiRilievi per={vista} gruppi={dati.gruppi ?? []} admin={admin} onPrendi={(g) => void prendiInCarico(g)} onApri={apriGruppo} />
          ) : (
            <>
              {dati.totalPages > 1 && (
                <Pagination inTesta page={page} totalPages={dati.totalPages} onPageChange={setPage} pageSize={PER_PAGINA} total={totale} />
              )}
              <Table fissa>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    {admin && (
                      <TableHead className="w-8">
                        <Checkbox
                          checked={tuttiSelezionati}
                          onCheckedChange={(c) => alternaTutti(!!c)}
                          aria-label="Seleziona tutti i rilievi della pagina"
                        />
                      </TableHead>
                    )}
                    <TableHead>Stato</TableHead>
                    <TableHead>Rilievo</TableHead>
                    <TableHead>Fonte</TableHead>
                    <TableHead>Gravità</TableHead>
                    <TableHead>Dove</TableHead>
                    <TableHead>Visto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dati.data.map((r) => (
                    <Riga
                      key={r.id}
                      r={r}
                      aperto={aperti.has(r.id)}
                      onToggle={() => toggle(r.id)}
                      admin={admin}
                      selezionato={selezione.has(r.id)}
                      onSeleziona={(v) => alternaSelezione(r.id, v)}
                      onCambio={(t) => onCambioTriage(r.id, t)}
                    />
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </div>
      </Pannello>
    </div>
  );
}

/** Slug del controllo dall'id del rilievo (es. «giro:smb-signing:…» → «smb-signing»); null per CVE/trunk. */
function slugControllo(r: RilievoUnito): string | null {
  if (r.id.startsWith("giro:")) return r.id.split(":")[1] ?? null;
  return null;
}

function Riga({
  r,
  aperto,
  onToggle,
  admin,
  selezionato,
  onSeleziona,
  onCambio,
}: {
  r: RilievoUnito;
  aperto: boolean;
  onToggle: () => void;
  admin: boolean;
  selezionato: boolean;
  onSeleziona: (v: boolean) => void;
  onCambio: (t: { stato: StatoTriage; nota: string }) => void;
}) {
  const slug = slugControllo(r);
  return (
    <Fragment>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        <TableCell className="w-8 text-muted-foreground">
          {aperto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </TableCell>
        {admin && (
          <TableCell className="w-8" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={selezionato}
              onCheckedChange={(c) => onSeleziona(!!c)}
              aria-label={`Seleziona ${r.titolo}`}
            />
          </TableCell>
        )}
        <TableCell>
          {r.triage ? <BadgeTriage stato={r.triage.stato} /> : <BadgeTriage stato="da_fare" />}
        </TableCell>
        <TableCell className="font-medium">
          <span className="inline-flex flex-wrap items-center gap-2">
            {r.titolo}
            {slug && <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[13px] text-muted-foreground">{slug}</span>}
          </span>
        </TableCell>
        <TableCell className="text-[13px]">{FONTI_RILIEVO_UI[r.fonte].nome}</TableCell>
        <TableCell>
          <BadgeGravita gravita={r.gravita} />
        </TableCell>
        <TableCell className="font-mono text-[13px]">
          {r.ip ?? r.network_name ?? "—"}
          {r.host_count > 1 ? ` · ${r.host_count} host` : ""}
        </TableCell>
        <TableCell>
          <TempoRelativo data={r.visto} />
        </TableCell>
      </TableRow>
      {aperto && (
        <TableRow>
          <TableCell />
          <TableCell colSpan={admin ? 7 : 6}>
            <div className="space-y-3">
              <div className="rounded-lg border bg-card p-3">
                <p className="mb-2 text-[13px] font-bold uppercase tracking-wider text-cian-testo">Triage</p>
                <EditorTriage
                  chiave={r.chiaveTriage}
                  admin={admin}
                  iniziale={r.triage ? { stato: r.triage.stato, nota: r.triage.nota, aggiornato_il: r.triage.aggiornato_il, aggiornato_da: r.triage.aggiornato_da } : undefined}
                  onCambio={onCambio}
                />
              </div>
              <dl className="grid gap-3 sm:grid-cols-2">
                <DatoDettaglio nome="Prova" valore={r.prova} />
                <DatoDettaglio nome="Rimedio" valore={r.rimedio} />
                {r.host_id != null && (
                  <div>
                    <dt className="text-[13px] text-muted-foreground">Host</dt>
                    <dd>
                      <Link href={`/hosts/${r.host_id}`} className="text-cian-testo underline-offset-2 hover:underline">
                        Scheda host
                      </Link>
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}

/** La fascia in testata: quattro numeri che dicono dove guardare e le barre per rete della Dashboard. Si richiude. */
function FasciaIndicatori({
  chiusa,
  onAlterna,
  numeri,
  daRivedere,
  totale,
  reti,
  reteScelta,
  onDaRivedere,
  onSfruttate,
  onAggiornamenti,
  onHost,
  onRete,
}: {
  chiusa: boolean;
  onAlterna: () => void;
  numeri: IndicatoriRilievi | null;
  daRivedere: number;
  totale: number;
  reti: RilievoRete[];
  reteScelta: number | null;
  onDaRivedere: () => void;
  onSfruttate: () => void;
  onAggiornamenti: () => void;
  onHost: (h: NonNullable<IndicatoriRilievi["hostPiuEsposto"]>) => void;
  onRete: (r: RilievoRete) => void;
}) {
  const casella = "rounded-lg border bg-card px-3 py-2 text-left hover:bg-muted disabled:hover:bg-card";
  return (
    <div className="rounded-xl border bg-card">
      <button type="button" onClick={onAlterna} aria-expanded={!chiusa} className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-muted-foreground">
        {chiusa ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        Dove guardare
        {chiusa && numeri && (
          <span className="text-foreground">
            · <strong className="font-mono">{daRivedere}</strong> da rivedere · <strong className="font-mono">{numeri.kev}</strong> sfruttate attivamente
          </span>
        )}
      </button>
      {!chiusa && (
        <div className="grid gap-3 px-3 pb-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={casella} onClick={onDaRivedere}>
              <span className="block text-[13px] text-muted-foreground">Da rivedere</span>
              <span className="block font-mono text-xl font-semibold">{numeri ? daRivedere : "…"}</span>
              <span className="block text-[13px] text-muted-foreground">{totale - daRivedere} di {totale} già decisi</span>
            </button>
            <button type="button" className={casella} onClick={onSfruttate} disabled={!numeri || numeri.kev === 0}>
              <span className="block text-[13px] text-muted-foreground">Sfruttate attivamente</span>
              <span className="block font-mono text-xl font-semibold">{numeri ? numeri.kev : "…"}</span>
              <span className="block text-[13px] text-muted-foreground">{numeri ? `su ${numeri.kevHost} host` : " "}</span>
            </button>
            <button type="button" className={casella} onClick={onAggiornamenti} disabled={!numeri || numeri.aggiornamentiPerMeta === 0}>
              <span className="block text-[13px] text-muted-foreground">Aggiornamenti che pesano</span>
              <span className="block font-mono text-xl font-semibold">{numeri ? numeri.aggiornamentiPerMeta : "…"}</span>
              <span className="block text-[13px] text-muted-foreground">
                {numeri ? `chiudono metà dei ${numeri.criticiConSoftware} critici con un software` : " "}
              </span>
            </button>
            <button type="button" className={casella} onClick={() => numeri?.hostPiuEsposto && onHost(numeri.hostPiuEsposto)} disabled={!numeri?.hostPiuEsposto}>
              <span className="block text-[13px] text-muted-foreground">Host più esposto</span>
              <span className="block truncate font-mono text-xl font-semibold">{numeri?.hostPiuEsposto ? numeri.hostPiuEsposto.nome : numeri ? "nessuno" : "…"}</span>
              <span className="block text-[13px] text-muted-foreground">{numeri?.hostPiuEsposto ? `${numeri.hostPiuEsposto.critici} rilievi critici` : " "}</span>
            </button>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[13px] text-muted-foreground">
              <span>Rilievi per rete (uno per host e CVE), un clic filtra l&apos;elenco</span>
              <LegendaGravita />
            </div>
            {reti.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Nessun rilievo di vulnerabilità sulle reti.</p>
            ) : (
              reti.slice(0, 7).map((r) => (
                <button
                  key={r.network_id}
                  type="button"
                  aria-pressed={reteScelta === r.network_id}
                  onClick={() => onRete(r)}
                  className={`flex w-full items-center gap-3 rounded-md px-1 text-left hover:bg-muted ${reteScelta === r.network_id ? "bg-muted ring-1 ring-foreground" : ""}`}
                >
                  <span className="w-40 shrink-0 truncate text-[13px] font-medium" title={r.network_name}>{r.network_name}</span>
                  {/* A tutta larghezza come in Dashboard: accorciate, i numeri dentro le barre si sovrapponevano. */}
                  <BarraGravita className="flex-1" conteggi={{ Critical: r.critical, High: r.high, Medium: r.medium, Low: r.low }} />
                  <span className="w-14 shrink-0 text-right font-mono text-[13px] tabular-nums">{r.total}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** I rilievi raccolti per software, host o rete: stesse colonne, una riga per gruppo. */
function GruppiRilievi({
  per,
  gruppi,
  admin,
  onPrendi,
  onApri,
}: {
  per: Raggruppamento;
  gruppi: GruppoRilievi[];
  admin: boolean;
  onPrendi: (g: GruppoRilievi) => void;
  onApri: (g: GruppoRilievi) => void;
}) {
  const [aperti, setAperti] = useState<Set<string>>(new Set());
  const daRivedere = gruppi.filter((g) => g.triage.da_fare > 0).length;
  return (
    <>
      <p className="text-[13px] text-muted-foreground">
        <strong className="font-mono text-foreground">{gruppi.length}</strong> gruppi, {daRivedere} con rilievi ancora da rivedere. In cima
        quelli con CVE sfruttate attivamente, poi quelli con più rilievi critici.
      </p>
      <Table fissa>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>{NOME_GRUPPO[per]}</TableHead>
            <TableHead className="w-72">Gravità</TableHead>
            {per !== "host" && <TableHead className="w-24" title="Host distinti toccati dal gruppo">Host</TableHead>}
            <TableHead className="w-40">Rivisti</TableHead>
            <TableHead className="w-44">Azione sul gruppo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {gruppi.map((g) => {
            const aperto = aperti.has(g.chiave);
            const decisi = g.rilievi - g.triage.da_fare;
            return (
              <Fragment key={g.chiave}>
                <TableRow>
                  <TableCell>
                    <button
                      type="button"
                      aria-label={aperto ? `Chiudi ${g.nome}` : `Apri ${g.nome}`}
                      aria-expanded={aperto}
                      onClick={() =>
                        setAperti((prev) => {
                          const n = new Set(prev);
                          if (n.has(g.chiave)) n.delete(g.chiave);
                          else n.add(g.chiave);
                          return n;
                        })
                      }
                    >
                      {aperto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{g.nome}{g.dettaglio && <span className="ml-2 font-mono text-[13px] font-normal text-muted-foreground">{g.dettaglio}</span>}</div>
                    <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                      <span>{g.rilievi} {g.rilievi === 1 ? "rilievo" : "rilievi"}</span>
                      {g.kev > 0 && <Etichetta>▲ {g.kev} {g.kev === 1 ? "sfruttata" : "sfruttate"} attivamente</Etichetta>}
                      {g.edb > 0 && <Etichetta>{g.edb} con exploit pubblico</Etichetta>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {SEVERITIES.filter((s) => (g.gravita[s as keyof typeof g.gravita] ?? 0) > 0).map((s) => (
                        <BadgeGravita key={s} gravita={s} conteggio={g.gravita[s as keyof typeof g.gravita]} />
                      ))}
                    </div>
                  </TableCell>
                  {per !== "host" && <TableCell className="font-mono">{g.host}</TableCell>}
                  <TableCell className="text-[13px]">
                    <span className="font-mono">{decisi}</span> di <span className="font-mono">{g.rilievi}</span>
                    {g.triage.in_corso > 0 && <span className="text-muted-foreground"> · {g.triage.in_corso} in corso</span>}
                  </TableCell>
                  <TableCell>
                    {admin && g.tipo === "software" && g.chiaviDaFare.length > 0 ? (
                      <Button type="button" size="sm" variant="outline" onClick={() => onPrendi(g)}>
                        Prendi in carico
                      </Button>
                    ) : (
                      <Button type="button" size="sm" variant="ghost" onClick={() => onApri(g)} disabled={!g.filtro}>
                        {g.filtro ? "Apri l'elenco" : "Riga per riga"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
                {aperto && (
                  <TableRow>
                    <TableCell />
                    <TableCell colSpan={per === "host" ? 4 : 5} className="bg-muted/40 text-[13px]">
                      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono">
                        {g.anteprima.map((t) => (
                          <span key={t}>{t}</span>
                        ))}
                      </div>
                      {g.rilievi > g.anteprima.length && (
                        <p className="mt-1 text-muted-foreground">e altri {g.rilievi - g.anteprima.length}.</p>
                      )}
                      {g.filtro ? (
                        <Button type="button" size="sm" variant="ghost" className="mt-1" onClick={() => onApri(g)}>
                          Vedi tutti nell&apos;elenco per rilievo ›
                        </Button>
                      ) : (
                        <p className="mt-1 text-muted-foreground">Questi si rivedono dalla vista «Rilievo».</p>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </>
  );
}
