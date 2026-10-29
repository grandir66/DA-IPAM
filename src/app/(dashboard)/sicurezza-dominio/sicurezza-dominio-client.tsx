"use client";

/**
 * Sicurezza del dominio (Riccardo, 29/10/2026): login, logout, accessi falliti, account bloccati e
 * modifiche ad account, gruppi e diritti, letti dal registro Sicurezza dei domain controller via
 * WinRM. Pagina propria, non quella degli allarmi di Wazuh: funziona dove Wazuh non c'è.
 *
 * Stile: docs/STILE-UI.md (intestazione, barra di stato, quattro numeri, grafico e DC, poi l'elenco
 * completo degli eventi a tutta larghezza, paginato dal server).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { SkeletonTable } from "@/components/shared/skeleton-table";
import { Pagination } from "@/components/shared/pagination";
import { BarraStato, Etichetta, IntestazionePagina, Pannello, TesseraNumero, Vuoto } from "@/components/shared/console";
import { STILE_STATO, type ToniStato } from "@/components/shared/stile-stato-modulo";
import { fetchJson } from "@/lib/fetch-json";
import { parseDbDate } from "@/lib/db-date";
import type { AlertStats } from "@/lib/integrations/wazuh-alerts-stats";
import { AlertsOverTime } from "../security-alerts/alert-charts";

interface LetturaDto {
  dc: string;
  lettoIl: string | null;
  esito: "ok" | "errore" | null;
  errore: string | null;
  eventiUltimoGiro: number;
  persiIl: string | null;
  persi: number;
}

interface EventoDto {
  id: number;
  dc: string;
  quando: string;
  event_id: number;
  categoria: string;
  livello: number;
  descrizione: string;
  account: string | null;
  ip: string | null;
  postazione: string | null;
  motivo: string | null;
  autore: string | null;
}

interface Risposta {
  lettura: {
    modo: "auto" | "sempre" | "mai";
    motivo: string | null;
    dcConfigurati: number;
    ultimoGiro: { il: string; ok: boolean; testo: string } | null;
    letture: LetturaDto[];
  };
  window: string;
  windows: { id: string; labelIt: string }[];
  interval: string;
  tipi: { id: string; etichetta: string }[];
  numeri: Record<string, number>;
  stats: AlertStats;
  eventi: EventoDto[];
  totale: number;
  pagina: number;
  perPagina: number;
}

const MODO: Record<string, string> = { auto: "dove Wazuh non legge", sempre: "sempre", mai: "mai" };
const TUTTI = "tutti";

function data(iso: string | null): string {
  if (!iso) return "—";
  const d = parseDbDate(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const numero = (n: number | undefined) => (n == null ? null : n.toLocaleString("it-IT"));

/** Il tono della riga: un login è normale, un blocco o un'aggiunta a Domain Admins no. */
function tonoEvento(e: EventoDto): { tono: ToniStato; parola: string } {
  if (e.categoria === "accesso" || e.categoria === "uscita") return { tono: "grigio", parola: e.categoria === "accesso" ? "login" : "logout" };
  if (e.livello >= 12) return { tono: "guasto", parola: "grave" };
  if (e.livello >= 8) return { tono: "attenzione", parola: e.event_id === 4740 ? "blocco" : "modifica" };
  return { tono: "da_verificare", parola: "fallito" };
}

export function SicurezzaDominioClient({ admin }: { admin: boolean }) {
  const [dati, setDati] = useState<Risposta | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [caricando, setCaricando] = useState(true);
  const [leggendo, setLeggendo] = useState(false);
  const [finestra, setFinestra] = useState("24h");
  const [tipo, setTipo] = useState<string>(TUTTI);
  const [cerca, setCerca] = useState("");
  const [cercaAttiva, setCercaAttiva] = useState("");
  const [pagina, setPagina] = useState(1);
  const abortRef = useRef<AbortController | null>(null);

  const carica = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setCaricando(true);
    const qs = new URLSearchParams({ window: finestra, pagina: String(pagina) });
    if (tipo !== TUTTI) qs.set("tipo", tipo);
    if (cercaAttiva) qs.set("cerca", cercaAttiva);
    try {
      const r = await fetchJson<Risposta>(`/api/security/dominio?${qs}`, { signal: ac.signal });
      if (r.ok) {
        setDati(r.data);
        setErrore(null);
      } else {
        setErrore(r.message);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErrore((e as Error).message);
    } finally {
      if (!ac.signal.aborted) setCaricando(false);
    }
  }, [finestra, tipo, cercaAttiva, pagina]);

  useEffect(() => {
    void carica();
    return () => abortRef.current?.abort();
  }, [carica]);

  async function leggiAdesso() {
    setLeggendo(true);
    try {
      const r = await fetchJson<{ ok: boolean; testo: string }>("/api/security/dominio", { method: "POST" });
      if (r.ok) toast.success(r.data.testo);
      else toast.error(r.message);
      await carica();
    } finally {
      setLeggendo(false);
    }
  }

  const l = dati?.lettura;
  const acceso = l ? l.motivo === null : false;
  const ultima = l?.letture.map((x) => x.lettoIl).filter((x): x is string => !!x).sort().at(-1) ?? null;
  const finestraNome = dati?.windows.find((w) => w.id === finestra)?.labelIt.toLowerCase() ?? "";
  const n = dati?.numeri;
  const pagine = dati ? Math.max(1, Math.ceil(dati.totale / dati.perPagina)) : 1;

  return (
    <div className="space-y-4">
      <IntestazionePagina
        titolo="Sicurezza del dominio"
        sottotitolo="Login, logout, accessi falliti, account bloccati e modifiche ad account, gruppi e diritti, letti dai domain controller via WinRM, senza Wazuh."
        azioni={
          <>
            {(dati?.windows ?? []).map((w) => (
              <Button key={w.id} size="sm" variant={finestra === w.id ? "default" : "outline"} onClick={() => { setFinestra(w.id); setPagina(1); }}>
                {w.labelIt}
              </Button>
            ))}
          </>
        }
      />

      {l && (
        <BarraStato
          acceso={acceso}
          titolo="Lettura dei domain controller"
          dettagli={[
            `${l.letture.length || l.dcConfigurati} DC`,
            ultima ? `letti ${data(ultima)}` : "mai letti",
            `ogni 5 minuti`,
            `modo: ${MODO[l.modo] ?? l.modo}`,
            ...(l.motivo ? [`non legge: ${l.motivo}`] : []),
          ]}
          azioni={
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void leggiAdesso()}
                disabled={!admin || !acceso || leggendo}
                title={!admin ? "Solo un amministratore" : !acceso ? `Non legge: ${l.motivo}` : "Legge subito il registro Sicurezza di tutti i DC"}
              >
                <RefreshCw className={`mr-1.5 h-4 w-4 ${leggendo ? "animate-spin" : ""}`} />
                {leggendo ? "Lettura…" : "Leggi i DC adesso"}
              </Button>
              <Link href="/settings/opzioni#automatismo.eventi_dc" className="text-[13px] text-cian-testo hover:underline">
                Opzioni ›
              </Link>
            </>
          }
        />
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TesseraNumero titolo="Login" valore={numero(n?.accessi)} nota={`accessi al dominio, ${finestraNome}`} />
        <TesseraNumero
          titolo="Accessi falliti"
          valore={numero(n?.falliti)}
          qualifica={n?.nostre ? `${numero(n.nostre)} nostri esclusi` : undefined}
          nota="password errate, utenti inesistenti, account scaduti"
        />
        <TesseraNumero titolo="Account bloccati" valore={numero(n?.bloccati)} nota="dopo troppi tentativi" />
        <TesseraNumero
          titolo="Account, gruppi e diritti"
          valore={numero(n?.modifiche)}
          qualifica={n?.registro ? `${numero(n.registro)} registri cancellati` : undefined}
          nota="utenti creati, abilitati, aggiunti a gruppi"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Pannello className="lg:col-span-8" titolo="Allarmi nel tempo" sottotitolo={`Accessi falliti, blocchi e modifiche, ${finestraNome}`}>
          {dati ? (
            <AlertsOverTime
              series={dati.stats.series}
              categories={dati.stats.byCategory.filter((c) => !c.diagnostic)}
              interval={dati.interval}
              altezza={240}
              emptyNote="Nessun allarme dai domain controller in questo periodo."
            />
          ) : (
            <SkeletonTable rows={4} columns={3} />
          )}
        </Pannello>
        <Pannello
          className="lg:col-span-4"
          titolo="Domain controller"
          conteggio={l?.letture.length}
          sottotitolo="Ognuno registra solo i suoi accessi: si leggono tutti"
          piede="Servono il gruppo «Event Log Readers» per l'account WinRM e il profilo di audit nella GPO dei DC."
        >
          {l && l.letture.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              {l.dcConfigurati === 0
                ? "Nessuna integrazione Active Directory con la credenziale WinRM del DC."
                : `${l.dcConfigurati} DC da leggere, nessuna lettura ancora.`}
            </p>
          ) : (
            <ul className="space-y-2">
              {(l?.letture ?? []).map((x) => {
                const tono: ToniStato = x.esito === "errore" ? "guasto" : x.persi > 0 ? "attenzione" : "ok";
                const st = STILE_STATO[tono];
                return (
                  <li key={x.dc} className="rounded-lg border p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-sm font-semibold">{x.dc}</span>
                      <span className={`shrink-0 rounded-md border px-1.5 text-[13px] ${st.classi}`}>
                        {st.segno} {x.esito === "errore" ? "non letto" : x.persi > 0 ? "eventi persi" : "letto"}
                      </span>
                    </div>
                    <div className="mt-1 text-[13px] text-muted-foreground">
                      {x.esito === "errore"
                        ? x.errore
                        : x.persi > 0
                          ? `circa ${x.persi} record persi il ${data(x.persiIl)}: il registro Sicurezza va ingrandito`
                          : `${data(x.lettoIl)} · ${x.eventiUltimoGiro} eventi all'ultimo giro`}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Pannello>
      </div>

      <Pannello
        titolo="Eventi"
        conteggio={dati ? numero(dati.totale) ?? undefined : undefined}
        sottotitolo={`I più recenti prima, ${finestraNome}; le nostre sonde sono escluse`}
        corpoClassName="p-0"
        azioni={
          <>
            <Select value={tipo} onValueChange={(v) => { setTipo(String(v ?? TUTTI)); setPagina(1); }}>
              <SelectTrigger className="w-56 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TUTTI}>Tutti gli eventi</SelectItem>
                {(dati?.tipi ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.etichetta}
                    {n?.[t.id] ? ` (${numero(n[t.id])})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <form
              className="relative"
              onSubmit={(e) => {
                e.preventDefault();
                setCercaAttiva(cerca.trim());
                setPagina(1);
              }}
            >
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Cerca account, IP, postazione, DC" className="w-56 pl-8 sm:w-64" />
            </form>
            <Pagination inTesta page={pagina} totalPages={pagine} onPageChange={setPagina} />
          </>
        }
      >
        {errore && !dati ? (
          <div className="p-3">
            <LoadError what="gli eventi dei domain controller" message={errore} onRetry={() => void carica()} />
          </div>
        ) : caricando && !dati ? (
          <div className="p-3">
            <SkeletonTable rows={8} columns={6} />
          </div>
        ) : dati && dati.eventi.length === 0 ? (
          <div className="p-3">
            <Vuoto
              titolo={cercaAttiva || tipo !== TUTTI ? "Nessun evento con questi filtri" : "Nessun evento dai domain controller in questo periodo"}
              testo={
                !acceso
                  ? `La lettura non è attiva: ${l?.motivo ?? ""}. Si cambia in Opzioni.`
                  : "Se i DC sono letti ma qui non arriva niente, controlla che la GPO dei DC abbia il profilo di audit (accessi, gestione degli account) acceso."
              }
            />
          </div>
        ) : (
          <Table fissa riserva={16}>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Evento</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Da dove</TableHead>
                <TableHead>Motivo o autore</TableHead>
                <TableHead>DC</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(dati?.eventi ?? []).map((e) => {
                const t = tonoEvento(e);
                const st = STILE_STATO[t.tono];
                return (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap font-mono text-[13px]">{data(e.quando)}</TableCell>
                    <TableCell className="max-w-md whitespace-normal">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-md border px-1.5 text-[13px] ${st.classi}`}>
                          {st.segno} {t.parola}
                        </span>
                        <span className="font-medium">{e.descrizione}</span>
                        <Etichetta>{String(e.event_id)}</Etichetta>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm font-semibold">{e.account ?? "—"}</TableCell>
                    <TableCell className="font-mono text-[13px]">
                      {e.ip || e.postazione ? (
                        <>
                          {e.ip && <div>{e.ip}</div>}
                          {e.postazione && <div className="text-muted-foreground">{e.postazione}</div>}
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-[13px]">{e.motivo ?? (e.autore ? `da ${e.autore}` : "—")}</TableCell>
                    <TableCell className="font-mono text-[13px]">{e.dc}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Pannello>
    </div>
  );
}
