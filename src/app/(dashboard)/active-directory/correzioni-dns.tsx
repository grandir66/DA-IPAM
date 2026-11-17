"use client";

/**
 * Correzioni al DNS di Active Directory (passo 2): finestra di conferma col prima e il dopo,
 * registro delle modifiche con «Annulla», impostazioni del dominio (interruttore e utenza).
 * Niente parte senza la conferma di una persona: «Applica sul DC» è l'unico punto che scrive.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, ChevronRight, History, Loader2, Minus, Plus, Settings2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DIALOG_PANEL_WIDE_CLASS } from "@/components/ui/dialog";
import { ScorrimentoTabella } from "@/components/ui/table";
import { Pagination } from "@/components/shared/pagination";
import { Etichetta } from "@/components/shared/console";
import type { Correzione, PassoDns } from "@/lib/ad/dns/correzioni";
import type { EsitoGruppo, EsitoDns } from "@/lib/ad/dns/esecuzione";
import type { VistaDnsAd } from "@/lib/ad/dns/vista";
import type { RigaModificaDnsAd } from "@/lib/db-tenant";

export interface Anteprima { correzioni: Correzione[]; scade: number; gettone: string; utenza: string; dc: string }

const PAROLA_ESITO: Record<EsitoDns | "in_corso", { segno: string; testo: string }> = {
  riuscito: { segno: "✓", testo: "riuscito" },
  rifiutato: { segno: "✕", testo: "rifiutato dal DC" },
  cambiato: { segno: "≠", testo: "cambiato, non toccato" },
  non_so: { segno: "?", testo: "esito non noto" },
  saltato: { segno: "–", testo: "non eseguito" },
  in_corso: { segno: "…", testo: "in corso" },
};

function Esito({ esito }: { esito: EsitoDns | "in_corso" }) {
  const p = PAROLA_ESITO[esito];
  return <span className="whitespace-nowrap font-medium"><span aria-hidden className="mr-1 font-mono">{p.segno}</span>{p.testo}</span>;
}

/** Un passo: «aggiunge» o «toglie» si leggono dalla parola e dal segno, non dal colore. */
function RigaPasso({ p }: { p: Pick<PassoDns, "azione" | "zona" | "nome" | "tipo" | "dato"> }) {
  const toglie = p.azione === "togli";
  return (
    <>
      <td className="p-2 whitespace-nowrap">
        <span className={toglie ? "inline-flex items-center gap-1 rounded-md border-2 border-foreground px-1.5 py-0.5 font-semibold" : "inline-flex items-center gap-1 rounded-md border border-dashed px-1.5 py-0.5 font-semibold"}>
          {toglie ? <Minus className="h-3.5 w-3.5" aria-hidden /> : <Plus className="h-3.5 w-3.5" aria-hidden />}
          {toglie ? "TOGLIE" : "aggiunge"}
        </span>
      </td>
      <td className="p-2"><Etichetta>{p.tipo}</Etichetta></td>
      <td className="p-2 font-mono break-all">{p.nome}.{p.zona}</td>
      <td className="p-2 font-mono break-all">{p.dato}</td>
    </>
  );
}

export function ConfermaCorrezioni({ integrationId, anteprima, onChiudi }: { integrationId: number; anteprima: Anteprima | null; onChiudi: (fatto: boolean) => void }) {
  const [applico, setApplico] = useState(false);
  const [esito, setEsito] = useState<EsitoGruppo | null>(null);
  const [scaduta, setScaduta] = useState(false);

  useEffect(() => {
    setEsito(null);
    setScaduta(false);
    if (!anteprima) return;
    const t = setTimeout(() => setScaduta(true), Math.max(0, anteprima.scade - Date.now()));
    return () => clearTimeout(t);
  }, [anteprima]);

  if (!anteprima) return null;
  const passi = anteprima.correzioni.flatMap((c) => c.passi);
  const aggiunti = passi.filter((p) => p.azione === "aggiungi").length;
  const tolti = passi.length - aggiunti;

  async function applica() {
    if (!anteprima) return;
    setApplico(true);
    try {
      const r = await fetch(`/api/ad/${integrationId}/dns/correzioni/applica`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: anteprima.correzioni.map((c) => c.id), gettone: anteprima.gettone, scade: anteprima.scade }),
      });
      const dati = (await r.json()) as EsitoGruppo & { error?: string };
      if (!r.ok) { toast.error(dati.error ?? "Correzioni non applicate"); return; }
      setEsito(dati);
    } catch {
      toast.error("Errore di rete: non so se le correzioni sono partite. Guarda il registro delle modifiche.");
    } finally {
      setApplico(false);
    }
  }

  const riusciti = esito?.esiti.filter((e) => e.esito === "riuscito").length ?? 0;
  return (
    <Dialog open onOpenChange={(aperta) => { if (!aperta && !applico) onChiudi(esito !== null); }}>
      <DialogContent className={DIALOG_PANEL_WIDE_CLASS}>
        <DialogHeader>
          <DialogTitle>{esito ? "Esito delle correzioni" : "Conferma le correzioni al DNS"}</DialogTitle>
          <DialogDescription>
            {esito
              ? `${riusciti} passi riusciti su ${esito.esiti.length}. ${esito.riletto ? "Il DNS è stato riletto." : "Il DNS non è stato riletto: premi «Sincronizza»."}`
              : `Si scrive sul DC ${anteprima.dc} con l'utenza ${anteprima.utenza}. Controlla ogni riga: prima di ogni passo il record viene riletto dal DC, e se è cambiato quel passo si ferma.`}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto">
          {anteprima.correzioni.map((c) => (
            <div key={c.id} className="rounded-lg border">
              <p className="border-b bg-muted/50 px-3 py-2 text-sm font-medium">{c.titolo}</p>
              <table className="w-full text-sm">
                <thead className="sr-only"><tr><th>Azione</th><th>Tipo</th><th>Nome</th><th>Valore</th><th>Esito</th></tr></thead>
                <tbody>
                  {c.passi.map((p, i) => {
                    const e = esito?.esiti.find((x) => x.correzione === c.id && x.passo.azione === p.azione && x.passo.nome === p.nome && x.passo.zona === p.zona && x.passo.dato === p.dato);
                    return (
                      <tr key={i} className="border-t first:border-t-0 align-top">
                        <RigaPasso p={p} />
                        {esito && <td className="p-2">{e ? <><Esito esito={e.esito} />{e.messaggio && <div className="text-[13px] text-muted-foreground">{e.messaggio}</div>}</> : "—"}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        {!esito && (
          <p className="flex items-start gap-2 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              <strong>{aggiunti} record aggiunti, {tolti} tolti.</strong>{" "}
              {tolti > 0 && "Un record tolto si può rimettere dal registro delle modifiche, ma torna statico. "}
              {scaduta && "La conferma è scaduta: chiudi e riapri l'anteprima."}
            </span>
          </p>
        )}

        <DialogFooter>
          {esito ? (
            <Button onClick={() => onChiudi(true)}>Chiudi</Button>
          ) : (
            <>
              <Button variant="outline" disabled={applico} onClick={() => onChiudi(false)}>Annulla</Button>
              <Button variant="destructive" disabled={applico || scaduta} onClick={() => void applica()}>
                {applico && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Applica sul DC
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RegistroDns({ integrationId, amministratore, accese, aggiornamento, onCambiato }: { integrationId: number; amministratore: boolean; accese: boolean; aggiornamento: unknown; onCambiato: () => void }) {
  const [aperto, setAperto] = useState(false);
  const [righe, setRighe] = useState<(RigaModificaDnsAd & { annullata: number })[] | null>(null);
  const [totale, setTotale] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [inCorso, setInCorso] = useState<number | null>(null);

  const carica = useCallback(async () => {
    try {
      const r = await fetch(`/api/ad/${integrationId}/dns/modifiche?page=${pagina}&pageSize=25`, { cache: "no-store" });
      if (!r.ok) return;
      const dati = (await r.json()) as { rows: (RigaModificaDnsAd & { annullata: number })[]; total: number };
      setRighe(dati.rows);
      setTotale(dati.total);
    } catch { /* la scheda resta com'è */ }
  }, [integrationId, pagina]);

  useEffect(() => { void carica(); }, [carica, aggiornamento]);

  async function annulla(m: RigaModificaDnsAd) {
    const cosa = m.azione === "togli" ? `rimettere ${m.tipo} ${m.nome}.${m.zona} → ${m.dato} (tornerà come record statico)` : `togliere ${m.tipo} ${m.nome}.${m.zona} → ${m.dato}`;
    if (!window.confirm(`Annullare questa modifica? Vuol dire ${cosa}. Si scrive sul DC.`)) return;
    setInCorso(m.id);
    try {
      const r = await fetch(`/api/ad/${integrationId}/dns/modifiche/${m.id}/annulla`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conferma: true }) });
      const dati = (await r.json()) as EsitoGruppo & { error?: string };
      if (!r.ok) toast.error(dati.error ?? "Annullamento non riuscito");
      else if (dati.esiti[0]?.esito === "riuscito") toast.success("Modifica annullata");
      else toast.error(`Annullamento: ${PAROLA_ESITO[dati.esiti[0]?.esito ?? "non_so"].testo}${dati.esiti[0]?.messaggio ? ` (${dati.esiti[0].messaggio})` : ""}`);
      await carica();
      onCambiato();
    } catch {
      toast.error("Errore di rete: non so se l'annullamento è partito");
    } finally {
      setInCorso(null);
    }
  }

  if (totale === 0 && !aperto) return null;
  return (
    <div className="rounded-xl border bg-card">
      <button type="button" onClick={() => setAperto((v) => !v)} aria-expanded={aperto} className="flex min-h-10 w-full items-center gap-2 px-4 py-2.5 text-left font-medium">
        {aperto ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
        <History className="h-4 w-4" aria-hidden />
        Registro delle modifiche
        <span className="font-mono font-bold tabular-nums">{totale}</span>
      </button>
      {aperto && righe && (
        <div className="space-y-3 border-t p-4">
          <div className="flex justify-end"><Pagination inTesta page={pagina} totalPages={Math.max(1, Math.ceil(totale / 25))} onPageChange={setPagina} pageSize={25} total={totale} /></div>
          <ScorrimentoTabella className="rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-2 text-left font-medium">Quando</th>
                  <th className="p-2 text-left font-medium">Chi</th>
                  <th className="p-2 text-left font-medium">Azione</th>
                  <th className="p-2 text-left font-medium">Tipo</th>
                  <th className="p-2 text-left font-medium">Nome</th>
                  <th className="p-2 text-left font-medium">Valore</th>
                  <th className="p-2 text-left font-medium">Esito</th>
                  <th className="p-2">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {righe.map((m) => (
                  <tr key={m.id} className="border-t align-top hover:bg-muted/30">
                    <td className="p-2 whitespace-nowrap text-muted-foreground">{new Date(`${m.il.replace(" ", "T")}Z`).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="p-2">{m.da}</td>
                    <RigaPasso p={m} />
                    <td className="p-2">
                      <Esito esito={m.esito} />
                      {m.annulla_di != null && <div className="text-[13px] text-muted-foreground">annulla la n. {m.annulla_di}</div>}
                      {m.annullata === 1 && <div className="text-[13px] text-muted-foreground">poi annullata</div>}
                      {m.messaggio && <div className="max-w-xs text-[13px] text-muted-foreground">{m.messaggio}</div>}
                    </td>
                    <td className="p-2 text-right">
                      {amministratore && accese && m.esito === "riuscito" && m.annullata !== 1 && (
                        <Button variant="outline" size="sm" disabled={inCorso === m.id} onClick={() => void annulla(m)}>
                          <Undo2 className="mr-1 h-3.5 w-3.5" />
                          Annulla
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScorrimentoTabella>
        </div>
      )}
    </div>
  );
}

export function ImpostazioniCorrezioni({ integrationId, vista, onSalvato }: { integrationId: number; vista: VistaDnsAd; onSalvato: () => void }) {
  const [aperto, setAperto] = useState(false);
  const [accese, setAccese] = useState(vista.impostazioni.dns_scrittura);
  const [usaWinrm, setUsaWinrm] = useState(vista.impostazioni.dns_usa_winrm_dc);
  const [voce, setVoce] = useState<number | null>(vista.impostazioni.dns_credential_id);
  const [voci, setVoci] = useState<{ id: number; name: string }[]>([]);
  const [salvo, setSalvo] = useState(false);

  useEffect(() => {
    if (!aperto) return;
    fetch("/api/credentials", { cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as { id: number; name: string; credential_type: string }[]) : []))
      .then((tutte) => setVoci(tutte.filter((c) => c.credential_type === "windows")))
      .catch(() => setVoci([]));
  }, [aperto]);

  async function salva() {
    setSalvo(true);
    try {
      const r = await fetch(`/api/ad/${integrationId}/dns/impostazioni`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dns_scrittura: accese, dns_usa_winrm_dc: usaWinrm, dns_credential_id: voce }),
      });
      if (r.ok) { toast.success("Impostazioni salvate"); onSalvato(); }
      else toast.error(((await r.json()) as { error?: string }).error ?? "Errore");
    } catch {
      toast.error("Errore di rete");
    } finally {
      setSalvo(false);
    }
  }

  return (
    <div className="rounded-xl border bg-card">
      <button type="button" onClick={() => setAperto((v) => !v)} aria-expanded={aperto} className="flex min-h-10 w-full items-center gap-2 px-4 py-2.5 text-left font-medium">
        {aperto ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
        <Settings2 className="h-4 w-4" aria-hidden />
        Correzioni del DNS
        <Etichetta mono={false} tono={vista.scrittura.accesa ? "marca" : "neutro"}>{vista.scrittura.accesa ? "accese" : "spente"}</Etichetta>
      </button>
      {aperto && (
        <div className="space-y-4 border-t p-4 text-sm">
          <label className="flex min-h-8 items-start gap-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={accese} onChange={(e) => setAccese(e.target.checked)} />
            <span><strong>Consenti le correzioni su questo dominio.</strong> Spento, la scheda resta in sola lettura. Acceso, un amministratore può correggere i record degli host, sempre dopo una conferma.</span>
          </label>
          <label className="block space-y-1">
            <span className="font-medium">Utenza dedicata al DNS</span>
            <select className="block h-9 w-full max-w-md rounded-md border bg-background px-2" value={voce ?? ""} onChange={(e) => setVoce(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Nessuna</option>
              {voce != null && !voci.some((v) => v.id === voce) && <option value={voce}>Voce n. {voce}</option>}
              {voci.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <span className="block text-[13px] text-muted-foreground">Una voce di tipo Windows il cui utente sta nei gruppi DnsAdmins e Remote Management Users del dominio. È la scelta consigliata.</span>
          </label>
          <label className="flex min-h-8 items-start gap-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={usaWinrm} disabled={!vista.impostazioni.haVoceWinrmDc} onChange={(e) => setUsaWinrm(e.target.checked)} />
            <span>
              <strong>Senza utenza dedicata, usa la voce WinRM del DC.</strong>{" "}
              {vista.impostazioni.haVoceWinrmDc ? "Di solito è un amministratore di dominio: un errore ha più spazio per fare danni." : "Questa integrazione non ha una voce WinRM."}
            </span>
          </label>
          {!vista.scrittura.accesa && vista.impostazioni.dns_scrittura && <p role="alert" className="font-medium">Accese ma non utilizzabili: {vista.scrittura.motivo}</p>}
          <Button size="sm" disabled={salvo} onClick={() => void salva()}>{salvo && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Salva</Button>
        </div>
      )}
    </div>
  );
}
