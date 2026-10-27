"use client";

/**
 * «Apparati e lettura dei dati» nella pagina del modulo LibreNMS (piano 2026-10-22 LibreNMS, task 8, tavola L5): la lettura
 * per parte, gli apparati mai interrogati (senza pulsante per toglierli: spec §3.A), i rifiuti col motivo e i vicini da
 * aggiungere. Dati da GET /api/integrations/librenms/candidati; «Riprova» e «Aggiungi ora» (admin) sono il POST della stessa rotta.
 * Dal 23/10 (tavola `docs/proposte/2026-10-23-librenms-esclusione-e-blocco.html`, oggetti 6-7) anche gli oggetti con l'SNMP
 * verificato che il giro aggiungerà e gli esclusi a mano; «Escludi» e «Togli» sono la rotta dell'esclusione dell'host.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import { oraBreve } from "@/components/scheda/librenms-pezzi";
import type { CandidatiLibrenms, LetturaParte, Parte } from "@/lib/integrations/librenms-fonte";
import { ETICHETTA_PARTE, ORDINE_PARTI, motivoRifiuto, statoParte, visibili, type TonoParte } from "@/lib/scheda/librenms-modulo";

interface Risposta extends CandidatiLibrenms {
  letture: Record<Parte, LetturaParte>;
  ultimo_giro: { il?: unknown; ms?: unknown; candidati?: { provati?: unknown; aggiunti?: unknown; senza_esclusioni?: unknown } } | null;
  interruttore: { acceso: boolean; da: string | null; il: string | null };
}

const th = "px-2 py-1.5 text-left text-[13px] font-semibold text-muted-foreground whitespace-nowrap";
const td = "px-2 py-1.5 align-top";

const TONO: Record<TonoParte, string> = {
  ok: "bg-[#1F7A4D] text-white dark:bg-[#5ED3A0] dark:text-[#0D2537]",
  att: "bg-[repeating-linear-gradient(135deg,#E69F00_0_6px,#F3C25A_6px_10px)] text-[#0D2537]",
  nd: "bg-[#D0D8DC] text-[#0D2537] dark:bg-[#4A6070] dark:text-white",
};

function Pastiglia({ tono, segno, children }: { tono: TonoParte; segno: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-px text-[13px] font-semibold ${TONO[tono]}`}><span aria-hidden>{segno}</span>{children}</span>;
}

function NomeOggetto({ hostId, nome, ip }: { hostId: number | null; nome: string; ip: string }) {
  return (
    <>
      {hostId ? <Link href={`/objects/${hostId}`} className="font-medium text-[#006C96] underline-offset-2 hover:underline dark:text-sky-300">{nome}</Link> : <span className="font-medium">{nome}</span>}
      {ip && ip !== nome && <><br /><span className="font-mono text-[13px] text-muted-foreground">{ip}</span></>}
    </>
  );
}

function Altre({ n, tutte, onToggle }: { n: number; tutte: boolean; onToggle: () => void }) {
  if (n === 0 && !tutte) return null;
  return (
    <button type="button" onClick={onToggle} className="mt-2 text-[13px] font-semibold text-[#006C96] underline-offset-2 hover:underline dark:text-sky-300">
      {tutte ? "Mostra le prime 10" : `Mostra tutti (+${n})`}
    </button>
  );
}

export function ApparatiLibrenmsCard({ isAdmin }: { isAdmin: boolean }) {
  const [dati, setDati] = useState<Risposta | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [occupato, setOccupato] = useState<number | null>(null);
  const [tutti, setTutti] = useState<Record<string, boolean>>({});

  const carica = useCallback(async () => {
    const r = await fetchJson<Risposta>("/api/integrations/librenms/candidati", { cache: "no-store" });
    if (!r.ok) {
      setErrore(r.message);
      return;
    }
    setErrore(null);
    setDati(r.data);
  }, []);

  useEffect(() => {
    void carica();
  }, [carica]);

  async function esclusione(hostId: number, escludi: boolean) {
    setOccupato(hostId);
    const r = await fetchJson<unknown>(`/api/hosts/${hostId}/librenms/esclusione`, { method: escludi ? "POST" : "DELETE" });
    setOccupato(null);
    if (r.ok) toast.success(escludi ? "Escluso dall'aggiunta automatica" : "Esclusione tolta: torna in coda");
    else toast.error(r.message);
    await carica();
  }

  async function aggiungi(hostId: number) {
    setOccupato(hostId);
    const r = await fetchJson<{ added: boolean }>("/api/integrations/librenms/candidati", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host_id: hostId }),
    });
    setOccupato(null);
    if (r.ok) toast.success("Aggiunto a LibreNMS");
    else toast.error(r.message);
    await carica();
  }

  if (errore) return <LoadError what="i dati di LibreNMS" message={errore} onRetry={() => void carica()} />;
  if (!dati) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Lettura dei dati di LibreNMS…</p>;

  const { interruttore: sw, letture, ultimo_giro: giro } = dati;
  const ms = typeof giro?.ms === "number" ? giro.ms : null;
  const il = typeof giro?.il === "string" ? giro.il : null;
  const mai = visibili(dati.non_interrogati, tutti.mai === true);
  const rif = visibili(dati.rifiutati, tutti.rif === true);
  const vic = visibili(dati.dai_vicini, tutti.vic === true);
  const snmp = visibili(dati.snmp_verificati ?? [], tutti.snmp === true);
  const escl = visibili(dati.esclusi ?? [], tutti.escl === true);
  const cand = giro?.candidati;
  const provati = typeof cand?.provati === "number" ? cand.provati : null;
  const aggiunti = typeof cand?.aggiunti === "number" ? cand.aggiunti : null;
  const alterna = (k: string) => setTutti((t) => ({ ...t, [k]: !t[k] }));

  return (
    <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm" aria-label="Apparati e lettura dei dati">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">Apparati e lettura dei dati</h3>
        <span className="text-[13px] text-muted-foreground">
          Lettura «LibreNMS (dati degli apparati)»:{" "}
          {sw.acceso ? `accesa${sw.da ? ` da ${sw.da}` : ""}${sw.il ? ` il ${oraBreve(sw.il)}` : ""}` : "spenta"} · si cambia da «Dati della mappa»
        </span>
      </header>

      {!sw.acceso && <p className="rounded-md border border-[#E69F00] px-3 py-2 text-[13px] font-semibold"><span aria-hidden>▲ </span>La lettura è spenta: le schede degli oggetti non mostrano i dati di LibreNMS e le righe qui sotto possono essere vecchie.</p>}

      <div>
        <h4 className="mb-1 text-sm font-semibold">Lettura per parte{il ? <span className="ml-2 font-normal text-[13px] text-muted-foreground">ultimo giro alle {oraBreve(il)}{ms !== null ? `, ${(ms / 1000).toFixed(1).replace(".", ",")} s` : ""}{provati !== null && aggiunti !== null ? ` · candidati ${aggiunti} aggiunti su ${provati}` : ""}{cand?.senza_esclusioni === true ? " · oggetti SNMP non aggiunti: esclusioni non disponibili" : ""}</span> : null}</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b-2 bg-muted/40"><tr><th className={th}>Parte</th><th className={th}>Esito</th><th className={th}>Righe</th><th className={th}>Letta il</th><th className={th}>Tentata il</th></tr></thead>
            <tbody>
              {ORDINE_PARTI.map((p) => {
                const l = letture[p];
                const s = statoParte(l);
                return (
                  <tr key={p} className="border-b">
                    <td className={td}>{ETICHETTA_PARTE[p]}</td>
                    <td className={td}><Pastiglia tono={s.tono} segno={s.segno}>{s.testo}</Pastiglia></td>
                    <td className={`${td} text-right font-mono tabular-nums`}>{l.righe === null ? "—" : l.righe.toLocaleString("it-IT")}</td>
                    <td className={`${td} whitespace-nowrap`}>{oraBreve(l.letto_il)}</td>
                    <td className={`${td} whitespace-nowrap`}>{oraBreve(l.tentato_il)}</td>
                  </tr>
                );
              })}
              <tr className="border-b">
                <td className={td}>VLAN per porta</td>
                <td className={td}><Pastiglia tono="nd" segno="–">non disponibile nell&apos;API di LibreNMS</Pastiglia></td>
                <td className={`${td} text-right`}>—</td><td className={td}>—</td><td className={td}>—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 min-[1500px]:grid-cols-3">
        <div className="min-w-0 rounded-md border p-3">
          <h4 className="mb-2 text-sm font-semibold">Mai interrogati <span className="font-normal text-[13px] text-muted-foreground">{dati.non_interrogati.length} · in LibreNMS senza alcuna lettura</span></h4>
          {dati.non_interrogati.length === 0 ? <p className="text-[13px] text-muted-foreground">Nessuno.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-b-2 bg-muted/40"><tr><th className={th}>Oggetto</th><th className={th}>Dal</th></tr></thead>
                <tbody>
                  {mai.mostrate.map((r) => (
                    <tr key={`${r.ip}-${r.nome}`} className="border-b"><td className={td}><NomeOggetto hostId={r.host_id} nome={r.nome} ip={r.ip} /></td><td className={`${td} whitespace-nowrap`}>{oraBreve(r.dal)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Altre n={mai.altre} tutte={tutti.mai === true} onToggle={() => alterna("mai")} />
          {dati.non_interrogati.length > 0 && <p className="mt-2 text-[13px] text-muted-foreground"><Pastiglia tono="nd" segno="●">SNMP non risponde</Pastiglia> Entrati con l&apos;aggiunta forzata di prima. Si propone di toglierli da LibreNMS: qui non c&apos;è il pulsante, non si tolgono da soli.</p>}
        </div>

        <div className="min-w-0 rounded-md border p-3">
          <h4 className="mb-2 text-sm font-semibold">Rifiutati da LibreNMS <span className="font-normal text-[13px] text-muted-foreground">{dati.rifiutati.length} · ultima prova</span></h4>
          {dati.rifiutati.length === 0 ? <p className="text-[13px] text-muted-foreground">Nessuno.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-b-2 bg-muted/40"><tr><th className={th}>Oggetto</th><th className={th}>Motivo</th><th className={th}>Il</th>{isAdmin && <th className={th} />}</tr></thead>
                <tbody>
                  {rif.mostrate.map((r) => (
                    <tr key={r.ip} className="border-b">
                      <td className={td}><NomeOggetto hostId={r.host_id} nome={r.nome} ip={r.ip} /></td>
                      <td className={td}><Pastiglia tono="att" segno="▲">{motivoRifiuto(r.codice)}</Pastiglia><br /><span className="text-[13px] text-muted-foreground break-words">{r.motivo}</span></td>
                      <td className={`${td} whitespace-nowrap`}>{oraBreve(r.il)}</td>
                      {isAdmin && <td className={td}>{r.host_id ? <Button size="sm" variant="outline" disabled={occupato === r.host_id} onClick={() => void aggiungi(r.host_id as number)}>{occupato === r.host_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Riprova"}</Button> : null}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Altre n={rif.altre} tutte={tutti.rif === true} onToggle={() => alterna("rif")} />
        </div>

        <div className="min-w-0 rounded-md border p-3">
          <h4 className="mb-2 text-sm font-semibold">Visti come vicini <span className="font-normal text-[13px] text-muted-foreground">{dati.dai_vicini.length} · si aggiungono da soli, 5 per giro, se l&apos;SNMP risponde</span></h4>
          {dati.dai_vicini.length === 0 ? <p className="text-[13px] text-muted-foreground">Nessuno.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-b-2 bg-muted/40"><tr><th className={th}>Oggetto</th><th className={th}>Visto da</th><th className={th}>Porta</th>{isAdmin && <th className={th} />}</tr></thead>
                <tbody>
                  {vic.mostrate.map((r) => (
                    <tr key={r.host_id} className="border-b">
                      <td className={td}><NomeOggetto hostId={r.host_id} nome={r.nome} ip={r.ip} /></td>
                      <td className={td}>{r.visto_da}</td>
                      <td className={td}>{r.porta}</td>
                      {isAdmin && <td className={td}><Button size="sm" disabled={occupato === r.host_id} onClick={() => void aggiungi(r.host_id)}>{occupato === r.host_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Aggiungi ora"}</Button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Altre n={vic.altre} tutte={tutti.vic === true} onToggle={() => alterna("vic")} />
        </div>
      </div>

      <div className="grid gap-4 min-[1500px]:grid-cols-3">
        <div className="min-w-0 rounded-md border p-3 min-[1500px]:col-span-2">
          <h4 className="mb-2 text-sm font-semibold">Con SNMP verificato <span className="font-normal text-[13px] text-muted-foreground">{(dati.snmp_verificati ?? []).length} · si aggiungono da soli, 5 per giro</span></h4>
          {snmp.mostrate.length === 0 ? <p className="text-[13px] text-muted-foreground">Nessuno.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-b-2 bg-muted/40"><tr><th className={th}>Oggetto</th><th className={th}>Tipo</th><th className={th}>Stato</th>{isAdmin && <th className={th} />}</tr></thead>
                <tbody>
                  {snmp.mostrate.map((r) => (
                    <tr key={r.ip} className="border-b">
                      <td className={td}><NomeOggetto hostId={r.host_id} nome={r.nome} ip={r.ip} /></td>
                      <td className={td}>{r.tipo === "apparato" ? "Apparato" : "Host"}</td>
                      <td className={td}>{r.rifiutato_il ? <Pastiglia tono="att" segno="▲">rifiutato {oraBreve(r.rifiutato_il)}</Pastiglia> : <Pastiglia tono="nd" segno="◷">in coda</Pastiglia>}</td>
                      {isAdmin && <td className={td}>{r.host_id ? <Button size="sm" variant="outline" disabled={occupato === r.host_id} onClick={() => void esclusione(r.host_id as number, true)}>{occupato === r.host_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Escludi"}</Button> : null}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Altre n={snmp.altre} tutte={tutti.snmp === true} onToggle={() => alterna("snmp")} />
        </div>

        <div className="min-w-0 rounded-md border p-3">
          <h4 className="mb-2 text-sm font-semibold">Esclusi <span className="font-normal text-[13px] text-muted-foreground">{(dati.esclusi ?? []).length} · il giro non li aggiunge</span></h4>
          {escl.mostrate.length === 0 ? <p className="text-[13px] text-muted-foreground">Nessuno.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-b-2 bg-muted/40"><tr><th className={th}>Oggetto</th><th className={th}>Dal</th>{isAdmin && <th className={th} />}</tr></thead>
                <tbody>
                  {escl.mostrate.map((r) => (
                    <tr key={r.ip} className="border-b">
                      <td className={td}><NomeOggetto hostId={r.host_id} nome={r.nome} ip={r.ip} /></td>
                      <td className={`${td} whitespace-nowrap`}>{oraBreve(r.il)}</td>
                      {isAdmin && <td className={td}>{r.host_id ? <Button size="sm" variant="outline" disabled={occupato === r.host_id} onClick={() => void esclusione(r.host_id as number, false)}>{occupato === r.host_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Togli"}</Button> : null}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Altre n={escl.altre} tutte={tutti.escl === true} onToggle={() => alterna("escl")} />
        </div>
      </div>
    </section>
  );
}
