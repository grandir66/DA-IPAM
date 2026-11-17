"use client";

/**
 * Scheda «DNS» di Active Directory: zone e record degli host letti dal DC, in sola lettura,
 * con le anomalie rispetto al DNS stesso e a quello che DA-IPAM vede in rete.
 * Le correzioni (via WinRM, con conferma) arrivano con il passo 2: qui non c'è nessun comando
 * che scrive sul DC. «È voluto» scrive solo in DA-IPAM.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScorrimentoTabella } from "@/components/ui/table";
import { Pagination } from "@/components/shared/pagination";
import { SkeletonTable } from "@/components/shared/skeleton-table";
import { BarraStato, Etichetta, Pannello, Vuoto } from "@/components/shared/console";
import { cn } from "@/lib/utils";
import { ETICHETTE_ANOMALIA_DNS, TIPI_ANOMALIA_DNS, type AnomaliaDns, type TipoAnomaliaDns } from "@/lib/ad/dns/anomalie";
import type { VistaDnsAd } from "@/lib/ad/dns/vista";
import type { RigaRecordDnsAd } from "@/lib/db-tenant";

const PER_PAGINA = 25;
const TIPI_RECORD = ["A", "AAAA", "CNAME", "PTR"] as const;

/** Segno davanti all'etichetta: il tipo si riconosce anche senza colore (Riccardo è daltonico). */
const SEGNO: Record<TipoAnomaliaDns, string> = {
  ip_piu_nomi: "⧉", nome_piu_ip: "⧉", ip_piu_ptr: "⧉",
  a_senza_ptr: "∅", a_senza_zona_inversa: "∅", ptr_senza_a: "∅", host_senza_nome: "∅",
  ptr_altro_nome: "≠", nome_diverso: "≠", cname_rotto: "✕",
  host_spento: "○", ip_sconosciuto: "?",
};

function dataBreve(sqlite: string | null): string {
  if (!sqlite) return "mai";
  const d = new Date(`${sqlite.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? sqlite : d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function SchedaDnsAd({ integrationId, aggiornamento }: { integrationId: number; aggiornamento?: unknown }) {
  const sessione = useSession();
  const ruolo = (sessione.data?.user as { role?: string } | undefined)?.role;
  const amministratore = ruolo === "admin" || ruolo === "superadmin";

  const [vista, setVista] = useState<VistaDnsAd | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<TipoAnomaliaDns | null>(null);
  const [cercaAnomalie, setCercaAnomalie] = useState("");
  const [inCorso, setInCorso] = useState<string | null>(null);

  const [recordAperti, setRecordAperti] = useState(false);
  const [record, setRecord] = useState<RigaRecordDnsAd[] | null>(null);
  const [totaleRecord, setTotaleRecord] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [cerca, setCerca] = useState("");
  const [tipo, setTipo] = useState<string>("");
  const [zona, setZona] = useState<string>("");

  const carica = useCallback(async (segnale?: AbortSignal) => {
    try {
      const r = await fetch(`/api/ad/${integrationId}/dns`, { cache: "no-store", signal: segnale });
      const dati = (await r.json()) as VistaDnsAd & { error?: string };
      if (!r.ok) { setErrore(dati.error ?? "Errore nella lettura"); return; }
      setErrore(null);
      setVista(dati);
    } catch (e) {
      if ((e as { name?: string }).name !== "AbortError") setErrore("Errore di rete");
    }
  }, [integrationId]);

  useEffect(() => {
    const ac = new AbortController();
    void carica(ac.signal);
    return () => ac.abort();
  }, [carica, aggiornamento]);

  useEffect(() => {
    if (!recordAperti) return;
    const ac = new AbortController();
    const q = new URLSearchParams({ vista: "record", page: String(pagina), pageSize: String(PER_PAGINA) });
    if (cerca.trim()) q.set("cerca", cerca.trim());
    if (tipo) q.set("tipo", tipo);
    if (zona) q.set("zona", zona);
    fetch(`/api/ad/${integrationId}/dns?${q}`, { cache: "no-store", signal: ac.signal })
      .then(async (r) => {
        const dati = (await r.json()) as { rows?: RigaRecordDnsAd[]; total?: number };
        if (r.ok) { setRecord(dati.rows ?? []); setTotaleRecord(dati.total ?? 0); }
      })
      .catch(() => undefined);
    return () => ac.abort();
  }, [recordAperti, integrationId, pagina, cerca, tipo, zona, aggiornamento]);

  const visibili = useMemo(() => {
    const c = cercaAnomalie.trim().toLowerCase();
    return (vista?.anomalie ?? []).filter((a) =>
      (!filtro || a.tipo === filtro) && (!c || (a.ip ?? "").includes(c) || a.nomi.some((n) => n.includes(c)) || a.dettaglio.toLowerCase().includes(c)));
  }, [vista, filtro, cercaAnomalie]);

  async function segnaVoluto(a: AnomaliaDns) {
    const nota = window.prompt(`Perché va bene così? (facoltativo)\n${ETICHETTE_ANOMALIA_DNS[a.tipo]}: ${a.ip ?? a.nomi[0] ?? ""}`, "");
    if (nota === null) return;
    setInCorso(a.chiave);
    try {
      const r = await fetch(`/api/ad/${integrationId}/dns/voluti`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chiave: a.chiave, nota: nota.trim() || undefined }),
      });
      if (r.ok) { toast.success("Segnata come voluta: non comparirà più fra le anomalie"); await carica(); }
      else toast.error(((await r.json()) as { error?: string }).error ?? "Errore");
    } catch {
      toast.error("Errore di rete");
    } finally {
      setInCorso(null);
    }
  }

  async function togliVoluto(chiave: string) {
    setInCorso(chiave);
    try {
      const r = await fetch(`/api/ad/${integrationId}/dns/voluti`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chiave }) });
      if (r.ok) await carica();
      else toast.error(((await r.json()) as { error?: string }).error ?? "Errore");
    } catch {
      toast.error("Errore di rete");
    } finally {
      setInCorso(null);
    }
  }

  if (errore && !vista) return <Vuoto titolo="DNS non leggibile" testo={errore} azione={<Button variant="outline" size="sm" onClick={() => void carica()}>Riprova</Button>} />;
  if (!vista) return <SkeletonTable rows={6} columns={5} />;

  const maiLetto = !vista.stato.letto_il;
  const zoneForward = vista.zone.filter((z) => !z.inversa).length;
  const conCasi = TIPI_ANOMALIA_DNS.filter((t) => vista.conteggi[t] > 0);

  return (
    <div className="space-y-4">
      <BarraStato
        acceso={!maiLetto && !vista.stato.errore}
        titolo={maiLetto ? "DNS mai letto" : `Letto il ${dataBreve(vista.stato.letto_il)}`}
        dettagli={maiLetto ? [] : [`${zoneForward} zone forward`, `${vista.zone.length - zoneForward} zone reverse`, `${vista.record} record degli host`, "sola lettura"]}
      />

      {vista.stato.errore && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
          <div>
            <p className="font-medium">L&apos;ultima lettura del {dataBreve(vista.stato.provato_il)} non è riuscita: {vista.stato.errore}</p>
            <p className="text-muted-foreground">
              {maiLetto ? "Non c'è ancora nessun dato in archivio." : `Qui sotto vedi i dati dell'ultima lettura riuscita, del ${dataBreve(vista.stato.letto_il)}.`}
            </p>
          </div>
        </div>
      )}

      {maiLetto && !vista.stato.errore ? (
        <Vuoto titolo="DNS non ancora letto" testo="Zone e record si leggono dal DC a ogni sincronizzazione di Active Directory: premi «Sincronizza» qui sopra." />
      ) : (
        <>
          <Pannello
            titolo="Anomalie"
            conteggio={vista.anomalie.length}
            sottotitolo="Solo i record degli host (A, AAAA, CNAME, PTR). Premi un tipo per vedere solo quello."
          >
            {vista.anomalie.length === 0 ? (
              <Vuoto titolo="Nessuna anomalia" testo="Nomi e reverse si corrispondono, e coincidono con quello che DA-IPAM vede in rete." />
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setFiltro(null)}
                    aria-pressed={filtro === null}
                    className={cn("min-h-8 rounded-md border px-2.5 py-1 text-sm font-medium", filtro === null ? "border-primary bg-primary/10" : "bg-card hover:bg-muted")}
                  >
                    Tutte <span className="ml-1 font-mono font-bold tabular-nums">{vista.anomalie.length}</span>
                  </button>
                  {conCasi.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setFiltro(filtro === t ? null : t)}
                      aria-pressed={filtro === t}
                      className={cn("min-h-8 rounded-md border px-2.5 py-1 text-sm font-medium", filtro === t ? "border-primary bg-primary/10" : "bg-card hover:bg-muted")}
                    >
                      <span aria-hidden className="mr-1.5 font-mono">{SEGNO[t]}</span>
                      {ETICHETTE_ANOMALIA_DNS[t]}
                      <span className="ml-1.5 font-mono font-bold tabular-nums">{vista.conteggi[t]}</span>
                    </button>
                  ))}
                  <Input
                    placeholder="Cerca per IP o nome…"
                    value={cercaAnomalie}
                    onChange={(e) => setCercaAnomalie(e.target.value)}
                    className="ml-auto h-8 max-w-xs"
                  />
                </div>
                <ScorrimentoTabella className="rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-3 text-left font-medium">Anomalia</th>
                        <th className="p-3 text-left font-medium">IP</th>
                        <th className="p-3 text-left font-medium">Nomi nel DNS</th>
                        <th className="p-3 text-left font-medium">Cosa non torna</th>
                        <th className="p-3 text-left font-medium">Record</th>
                        {amministratore && <th className="p-3 text-right font-medium">&nbsp;</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {visibili.map((a) => (
                        <tr key={a.chiave} className="border-t align-top hover:bg-muted/30">
                          <td className="p-3 whitespace-nowrap">
                            <span aria-hidden className="mr-1.5 font-mono">{SEGNO[a.tipo]}</span>
                            {ETICHETTE_ANOMALIA_DNS[a.tipo]}
                          </td>
                          <td className="p-3 font-mono font-medium whitespace-nowrap">
                            {a.ip && a.hostId ? <Link href={`/hosts/${a.hostId}`} className="underline underline-offset-2">{a.ip}</Link> : (a.ip ?? "—")}
                          </td>
                          <td className="p-3 font-mono">
                            {a.nomi.length === 0 ? "—" : a.nomi.map((n) => <div key={n}>{n}</div>)}
                          </td>
                          <td className="p-3">{a.dettaglio}</td>
                          <td className="p-3 whitespace-nowrap">
                            {a.tipo === "host_senza_nome" ? "—" : <Etichetta mono={false}>{a.tuttoStatico ? "statico" : "dinamico"}</Etichetta>}
                          </td>
                          {amministratore && (
                            <td className="p-3 text-right">
                              <Button variant="outline" size="sm" disabled={inCorso === a.chiave} onClick={() => void segnaVoluto(a)} title="Va bene così: non mostrarla più fra le anomalie. Si scrive solo in DA-IPAM.">
                                <Check className="mr-1 h-3.5 w-3.5" />
                                È voluto
                              </Button>
                            </td>
                          )}
                        </tr>
                      ))}
                      {visibili.length === 0 && (
                        <tr><td colSpan={amministratore ? 6 : 5} className="p-6 text-center text-muted-foreground">Nessuna anomalia con questo filtro.</td></tr>
                      )}
                    </tbody>
                  </table>
                </ScorrimentoTabella>
                <p className="text-[13px] text-muted-foreground">
                  Segni: ⧉ doppione · ∅ manca qualcosa · ≠ non coincide · ✕ rotto · ○ spento · ? sconosciuto. «Statico» vuol dire che Windows non lo toglierà mai da solo.
                  Le correzioni dal DA-IPAM non ci sono ancora: per ora si sistemano dalla console DNS del DC.
                </p>
              </div>
            )}
          </Pannello>

          {vista.voluti.length > 0 && (
            <Pannello titolo="Segnate come volute" conteggio={vista.voluti.length} sottotitolo="Non compaiono fra le anomalie.">
              <ul className="divide-y text-sm">
                {vista.voluti.map((v) => (
                  <li key={v.chiave} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <span className="font-mono">{v.chiave.slice(v.chiave.indexOf(":") + 1)}</span>
                    <span className="text-muted-foreground">{ETICHETTE_ANOMALIA_DNS[v.chiave.slice(0, v.chiave.indexOf(":")) as TipoAnomaliaDns] ?? ""}</span>
                    {v.nota && <span>«{v.nota}»</span>}
                    <span className="text-[13px] text-muted-foreground">{v.da ?? "—"}, {dataBreve(v.il)}</span>
                    {amministratore && (
                      <Button variant="ghost" size="sm" className="ml-auto" disabled={inCorso === v.chiave} onClick={() => void togliVoluto(v.chiave)}>
                        Rimetti fra le anomalie
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Pannello>
          )}

          <div className="rounded-xl border bg-card">
            <button
              type="button"
              onClick={() => setRecordAperti((v) => !v)}
              aria-expanded={recordAperti}
              className="flex min-h-10 w-full items-center gap-2 px-4 py-2.5 text-left font-medium"
            >
              {recordAperti ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
              <Globe className="h-4 w-4" aria-hidden />
              Tutti i record
              <span className="font-mono font-bold tabular-nums">{vista.record}</span>
            </button>
            {recordAperti && (
              <div className="space-y-3 border-t p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Input placeholder="Cerca per nome, IP o destinazione…" value={cerca} onChange={(e) => { setCerca(e.target.value); setPagina(1); }} className="max-w-sm" />
                  <select aria-label="Tipo di record" value={tipo} onChange={(e) => { setTipo(e.target.value); setPagina(1); }} className="h-9 rounded-md border bg-background px-2 text-sm">
                    <option value="">Tutti i tipi</option>
                    {TIPI_RECORD.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <select aria-label="Zona" value={zona} onChange={(e) => { setZona(e.target.value); setPagina(1); }} className="h-9 max-w-xs rounded-md border bg-background px-2 text-sm">
                    <option value="">Tutte le zone</option>
                    {vista.zone.map((z) => <option key={z.nome} value={z.nome}>{z.nome} ({z.record})</option>)}
                  </select>
                  <div className="ml-auto">
                    <Pagination inTesta page={pagina} totalPages={Math.max(1, Math.ceil(totaleRecord / PER_PAGINA))} onPageChange={setPagina} pageSize={PER_PAGINA} total={totaleRecord} />
                  </div>
                </div>
                {record === null ? <SkeletonTable rows={5} columns={5} /> : (
                  <ScorrimentoTabella className="rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="p-3 text-left font-medium">Nome</th>
                          <th className="p-3 text-left font-medium">Tipo</th>
                          <th className="p-3 text-left font-medium">Valore</th>
                          <th className="p-3 text-left font-medium">Zona</th>
                          <th className="p-3 text-left font-medium">Rinnovo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {record.map((r) => (
                          <tr key={r.id} className="border-t hover:bg-muted/30">
                            <td className="p-3 font-mono font-medium">{r.nome}</td>
                            <td className="p-3"><Etichetta>{r.tipo}</Etichetta></td>
                            <td className="p-3 font-mono">{r.dato}</td>
                            <td className="p-3 font-mono text-muted-foreground">{r.zona}</td>
                            <td className="p-3 whitespace-nowrap text-muted-foreground">{r.statica ? "statico" : dataBreve(r.rinnovata_il)}</td>
                          </tr>
                        ))}
                        {record.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Nessun record con questi filtri.</td></tr>}
                      </tbody>
                    </table>
                  </ScorrimentoTabella>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
