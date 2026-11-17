"use client";

/**
 * Scheda «DNS» di Active Directory: zone e record degli host letti dal DC, in sola lettura,
 * con le anomalie rispetto al DNS stesso e a quello che DA-IPAM vede in rete.
 * Dove un amministratore le ha accese, le anomalie si correggono sul DC via WinRM: si scelgono,
 * si guarda l'anteprima col prima e il dopo, si conferma (`correzioni-dns.tsx`). Spente, la
 * scheda è in sola lettura. «È voluto» scrive solo in DA-IPAM.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Globe, Loader2, Wrench } from "lucide-react";
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
import { ConfermaCorrezioni, ImpostazioniCorrezioni, RegistroDns, type Anteprima } from "./correzioni-dns";

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
  /** Anomalia → correzione scelta per lei. Niente scelta di serie quando le correzioni possibili sono più d'una. */
  const [scelte, setScelte] = useState<Record<string, string>>({});
  const [anteprima, setAnteprima] = useState<Anteprima | null>(null);
  const [preparo, setPreparo] = useState(false);
  const [giro, setGiro] = useState(0);

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

  function scegli(chiave: string, correzione: string | null) {
    setScelte((prima) => {
      const dopo = { ...prima };
      if (correzione) dopo[chiave] = correzione;
      else delete dopo[chiave];
      return dopo;
    });
  }

  async function apriAnteprima() {
    const ids = Object.values(scelte);
    if (ids.length === 0) return;
    setPreparo(true);
    try {
      const r = await fetch(`/api/ad/${integrationId}/dns/correzioni`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
      const dati = (await r.json()) as Anteprima & { error?: string };
      if (r.ok) setAnteprima(dati);
      else { toast.error(dati.error ?? "Anteprima non disponibile"); if (r.status === 409) { setScelte({}); await carica(); } }
    } catch {
      toast.error("Errore di rete");
    } finally {
      setPreparo(false);
    }
  }

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
  const correggo = amministratore && vista.scrittura.accesa;
  const quanteScelte = Object.keys(scelte).length;
  const colonne = 5 + (amministratore ? 1 : 0) + (correggo ? 1 : 0);

  return (
    <div className="space-y-4">
      <BarraStato
        acceso={!maiLetto && !vista.stato.errore}
        titolo={maiLetto ? "DNS mai letto" : `Letto il ${dataBreve(vista.stato.letto_il)}`}
        dettagli={maiLetto ? [] : [`${zoneForward} zone forward`, `${vista.zone.length - zoneForward} zone reverse`, `${vista.record} record degli host`, vista.scrittura.accesa ? `correzioni accese, con ${vista.scrittura.utenza}` : "sola lettura"]}
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
                {correggo && (
                  <div className="flex flex-wrap items-center gap-3 rounded-md border border-primary/50 bg-primary/5 px-3 py-2 text-sm">
                    <span className="font-semibold tabular-nums">{quanteScelte} {quanteScelte === 1 ? "voce scelta" : "voci scelte"}</span>
                    <Button size="sm" disabled={quanteScelte === 0 || preparo} onClick={() => void apriAnteprima()}>
                      {preparo ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Wrench className="mr-1.5 h-4 w-4" />}
                      Correggi…
                    </Button>
                    {quanteScelte > 0 && <Button variant="ghost" size="sm" onClick={() => setScelte({})}>Togli la scelta</Button>}
                    <span className="text-[13px] text-muted-foreground">Prima di scrivere vedi l&apos;anteprima e confermi. Al massimo 50 per volta.</span>
                  </div>
                )}
                <ScorrimentoTabella className="rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        {correggo && <th className="p-3 text-left font-medium">Correzione</th>}
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
                          {correggo && (
                            <td className="p-3">
                              {a.correzioni.length === 0 ? (
                                <span className="text-[13px] text-muted-foreground">nessuna</span>
                              ) : a.correzioni.length === 1 ? (
                                <label className="flex min-h-8 items-start gap-2">
                                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={scelte[a.chiave] === a.correzioni[0]!.id} onChange={(e) => scegli(a.chiave, e.target.checked ? a.correzioni[0]!.id : null)} />
                                  <span>{a.correzioni[0]!.titolo}</span>
                                </label>
                              ) : (
                                <select aria-label="Correzione da applicare" className="h-9 max-w-64 rounded-md border bg-background px-2 text-sm" value={scelte[a.chiave] ?? ""} onChange={(e) => scegli(a.chiave, e.target.value || null)}>
                                  <option value="">Non correggere</option>
                                  {a.correzioni.map((c) => <option key={c.id} value={c.id}>{c.titolo}</option>)}
                                </select>
                              )}
                            </td>
                          )}
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
                        <tr><td colSpan={colonne} className="p-6 text-center text-muted-foreground">Nessuna anomalia con questo filtro.</td></tr>
                      )}
                    </tbody>
                  </table>
                </ScorrimentoTabella>
                <p className="text-[13px] text-muted-foreground">
                  Segni: ⧉ doppione · ∅ manca qualcosa · ≠ non coincide · ✕ rotto · ○ spento · ? sconosciuto. «Statico» vuol dire che Windows non lo toglierà mai da solo.
                  {vista.scrittura.accesa ? "I record dei controller di dominio non si correggono da qui." : "Le correzioni da DA-IPAM sono spente su questo dominio: le accende un amministratore qui sotto."}
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

          <RegistroDns integrationId={integrationId} amministratore={amministratore} accese={vista.scrittura.accesa} aggiornamento={giro} onCambiato={() => void carica()} />
          {amministratore && <ImpostazioniCorrezioni key={`${vista.impostazioni.dns_scrittura}-${vista.impostazioni.dns_usa_winrm_dc}-${vista.impostazioni.dns_credential_id}`} integrationId={integrationId} vista={vista} onSalvato={() => { setScelte({}); void carica(); }} />}
          <ConfermaCorrezioni
            integrationId={integrationId}
            anteprima={anteprima}
            onChiudi={(fatto) => { setAnteprima(null); if (fatto) { setScelte({}); setGiro((n) => n + 1); void carica(); } }}
          />

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
