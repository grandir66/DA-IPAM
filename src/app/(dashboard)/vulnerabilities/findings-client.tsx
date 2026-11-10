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
  DatoDettaglio,
  IntestazionePagina,
  LegendaGravita,
  Pannello,
  SchedePagina,
  TesseraNumero,
  TempoRelativo,
  Vuoto,
} from "@/components/shared/console";
import { fetchJson } from "@/lib/fetch-json";
import { FONTI_RILIEVO_UI, MOTORI_RILIEVO, MOTORI_RILIEVO_UI, type ElencoRilievi, type MotoreRilievo, type RilievoUnito } from "@/lib/rilievi/tipi";
import { SEVERITIES, type Severity } from "@/lib/severity-style";
import { VulnerabilitiesListClient } from "./vulnerabilities-list-client";

type Scheda = "findings" | "vulnerabilita";

function schedaDaIndirizzo(): Scheda {
  if (typeof window === "undefined") return "findings";
  const hash = window.location.hash.replace(/^#/, "");
  if (hash === "vulnerabilita") return "vulnerabilita";
  if (hash === "findings") return "findings";
  const vista = new URLSearchParams(window.location.search).get("vista");
  if (vista === "host" || vista === "cve") return "vulnerabilita";
  return "findings";
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
      <IntestazionePagina
        titolo="Findings"
        sottotitolo="Rilievi di rete e vulnerabilità. La vista per CVE e per host è la scheda Vulnerabilità."
        azioni={
          <Button variant="default" size="sm" nativeButton={false} render={<Link href="/scans" />}>
            Lancia un giro
          </Button>
        }
      />
      <SchedePagina<Scheda>
        etichetta="Findings"
        scelta={scheda}
        onScegli={scegli}
        voci={[
          { valore: "findings", titolo: "Elenco", descrizione: "CVE, trunk e giri in un elenco solo" },
          { valore: "vulnerabilita", titolo: "Vulnerabilità", descrizione: "Per CVE o per host, con exploit, triage e filtri" },
        ]}
      />
      {!pronta ? null : scheda === "vulnerabilita" ? <VulnerabilitiesListClient embedded /> : <ElencoFindings />}
    </div>
  );
}

function ElencoFindings() {
  const [motore, setMotore] = useState<MotoreRilievo>("tutti");
  const [gravita, setGravita] = useState<Set<Severity>>(new Set());
  const [q, setQ] = useState("");
  const [cerca, setCerca] = useState("");
  const [page, setPage] = useState(1);
  const [dati, setDati] = useState<ElencoRilievi | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [aperti, setAperti] = useState<Set<string>>(new Set());

  const richiesta = useRef(0);

  const load = useCallback(async () => {
    const id = ++richiesta.current;
    const sp = new URLSearchParams();
    if (motore !== "tutti") sp.set("fonte", MOTORI_RILIEVO_UI[motore].fonti.join(","));
    if (gravita.size) sp.set("gravita", [...gravita].join(","));
    if (q.trim()) sp.set("q", q.trim());
    sp.set("page", String(page));
    sp.set("pageSize", String(PER_PAGINA));
    const r = await fetchJson<ElencoRilievi>(`/api/rilievi?${sp}`, { cache: "no-store" });
    if (id !== richiesta.current) return;
    if (r.ok) {
      setDati(r.data);
      setErrore(null);
    } else setErrore(r.message);
  }, [motore, gravita, q, page]);

  useEffect(() => {
    void load();
    return () => { richiesta.current += 1; };
  }, [load]);

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

  const rollup = dati?.rollup ?? { Critical: 0, High: 0, Medium: 0, Low: 0 };
  const perFonte = dati?.perFonte ?? { edge: 0, wazuh: 0, trunk: 0, giro: 0 };
  const totale = dati?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TesseraNumero titolo="Critici" valore={dati ? rollup.Critical : null} nota="CVE Critical" />
        <TesseraNumero titolo="Alti" valore={dati ? rollup.High : null} nota="CVE High, trunk gravi, TLS scaduto" />
        <TesseraNumero titolo="Aperti" valore={dati ? totale : null} nota="Nell’elenco dopo i filtri" />
        <TesseraNumero
          titolo="Fonti"
          valore={dati ? Object.values(perFonte).filter((n) => n > 0).length : null}
          nota={`Edge ${perFonte.edge} · Wazuh ${perFonte.wazuh} · trunk ${perFonte.trunk} · giri ${perFonte.giro}`}
        />
      </div>

      {!!dati?.nonDisponibili.length && (
        <p role="status" className="text-sm">Fonti non disponibili · {dati.nonDisponibili.map((f) => FONTI_RILIEVO_UI[f].nome).join(", ")}</p>
      )}
      {!!dati?.parziali.length && (
        <p role="status" className="text-sm">Risultati e contatori parziali · {dati.parziali.map((f) => FONTI_RILIEVO_UI[f].nome).join(", ")}</p>
      )}
      <Pannello
        titolo="Elenco"
        conteggio={totale}
        sottotitolo="Una riga, clic per prova e rimedio"
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
              <Button key={`f-${s}`} type="button" size="sm" variant={gravita.has(s) ? "default" : "outline"} onClick={() => alternaGravita(s)}>
                {s} {dati ? rollup[s] : ""}
              </Button>
            ))}
          </div>

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
          ) : (
            <>
              {dati.totalPages > 1 && (
                <Pagination inTesta page={page} totalPages={dati.totalPages} onPageChange={setPage} pageSize={PER_PAGINA} total={totale} />
              )}
              <Table fissa>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Rilievo</TableHead>
                    <TableHead>Fonte</TableHead>
                    <TableHead>Gravità</TableHead>
                    <TableHead>Dove</TableHead>
                    <TableHead>Visto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dati.data.map((r) => (
                    <Riga key={r.id} r={r} aperto={aperti.has(r.id)} onToggle={() => toggle(r.id)} />
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

function Riga({ r, aperto, onToggle }: { r: RilievoUnito; aperto: boolean; onToggle: () => void }) {
  return (
    <Fragment>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        <TableCell className="w-8 text-muted-foreground">
          {aperto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </TableCell>
        <TableCell className="font-medium">{r.titolo}</TableCell>
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
          <TableCell colSpan={5}>
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
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}
