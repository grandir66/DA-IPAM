"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { BadgeSegno, quando, type TipoSegno } from "@/components/assegnatari/segni";
import { fetchJson } from "@/lib/fetch-json";
import type { Anteprima, EsitoImport, MotivoEsclusione, RigaImport } from "@/lib/assegnatari/importa";

const PER_PAGINA = 50;

const MOTIVI: Record<MotivoEsclusione, string> = {
  servizio: "account di servizio",
  amministrativo: "amministrativi",
  disattivato: "disattivati",
  senza_nome: "senza nome e cognome",
  inattivo: "senza accessi nel periodo",
};

function Esito({ r }: { r: RigaImport }) {
  const tipo: Record<EsitoImport, TipoSegno> = { nuovo: "ok", aggiorna: "neutro", controlla: "attenzione", invariato: "neutro" };
  return <BadgeSegno tipo={tipo[r.esito]}>{r.dettaglio}</BadgeSegno>;
}

const selectCls = "h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground";

export default function ImportaDaAdPage() {
  const router = useRouter();
  const [abilitati, setAbilitati] = useState(true);
  const [nomeCognome, setNomeCognome] = useState(true);
  const [giorni, setGiorni] = useState("90");
  const [ou, setOu] = useState("");
  const [pagina, setPagina] = useState(1);
  const [dati, setDati] = useState<Anteprima | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [scelti, setScelti] = useState<Set<string>>(new Set());
  const [importando, setImportando] = useState(false);

  const filtri = useMemo(() => new URLSearchParams({ abilitati: abilitati ? "1" : "0", nomeCognome: nomeCognome ? "1" : "0", giorni, ...(ou ? { ou } : {}) }).toString(), [abilitati, nomeCognome, giorni, ou]);

  // Cambiando i filtri la spunta torna a quella di serie (nuovi e da aggiornare); cambiando pagina resta.
  useEffect(() => {
    setPagina(1);
    setScelti(new Set());
    setDati(null);
  }, [filtri]);

  const carica = useCallback(async () => {
    const r = await fetchJson<Anteprima>(`/api/asset-assignees/import-ad?${filtri}&pagina=${pagina}&perPagina=${PER_PAGINA}`, { cache: "no-store" });
    if (!r.ok) {
      setErrore(r.message);
      return;
    }
    setErrore(null);
    setDati(r.data);
    if (pagina === 1) setScelti((s) => (s.size === 0 ? new Set(r.data.selezionatiDiSerie) : s));
  }, [filtri, pagina]);

  useEffect(() => {
    void carica();
  }, [carica]);

  const conteggio = useMemo(() => {
    let creare = 0;
    let aggiornare = 0;
    for (const k of scelti) {
      const e = dati?.esiti[k];
      if (e === "aggiorna" || e === "invariato") aggiornare++;
      else if (e) creare++;
    }
    return { creare, aggiornare, totale: creare + aggiornare };
  }, [scelti, dati]);

  function cambia(chiave: string, si: boolean) {
    setScelti((s) => {
      const n = new Set(s);
      if (si) n.add(chiave);
      else n.delete(chiave);
      return n;
    });
  }

  async function importa() {
    const chiavi = [...scelti].filter((k) => dati?.esiti[k]);
    if (chiavi.length === 0) return;
    setImportando(true);
    const r = await fetchJson<{ creati: number; aggiornati: number; saltati: number }>("/api/asset-assignees/import-ad", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chiavi }),
    });
    setImportando(false);
    if (!r.ok) {
      toast.error(`Errore: ${r.message}`);
      return;
    }
    toast.success(`Importati: ${r.data.creati} nuovi, ${r.data.aggiornati} aggiornati${r.data.saltati ? `, ${r.data.saltati} non più in AD` : ""}`);
    router.push("/inventory/assignees");
  }

  const integrazione = dati?.integrazioni[0];
  const righePagina = dati?.righe ?? [];
  const tuttiPagina = righePagina.length > 0 && righePagina.every((r) => scelti.has(r.chiave));
  const da = dati && dati.totale > 0 ? (pagina - 1) * PER_PAGINA + 1 : 0;
  const a = dati ? Math.min(pagina * PER_PAGINA, dati.totale) : 0;

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/inventory/assignees">
          <Button variant="ghost" size="icon" aria-label="Torna agli assegnatari"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <h1 className="flex-1 text-2xl font-bold">Importa da Active Directory</h1>
        {integrazione && (
          <span className="text-[13px] text-muted-foreground">
            Dominio {integrazione.dominio}{dati && dati.integrazioni.length > 1 ? ` e altri ${dati.integrazioni.length - 1}` : ""} ·{" "}
            {integrazione.lettoIl ? `utenti letti ${quando(integrazione.lettoIl)}` : "utenti mai letti"}
          </span>
        )}
        <Link href="/active-directory" className="text-sm font-semibold text-[#006C96] underline">Rileggi da AD</Link>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-5 py-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[#00A7E7]" checked={abilitati} onChange={(e) => setAbilitati(e.target.checked)} /> Solo account abilitati</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[#00A7E7]" checked={nomeCognome} onChange={(e) => setNomeCognome(e.target.checked)} /> Con nome e cognome</label>
          <label className="flex items-center gap-2 text-sm">Accesso negli ultimi
            <select className={selectCls} value={giorni} onChange={(e) => setGiorni(e.target.value)}>
              <option value="30">30 giorni</option>
              <option value="90">90 giorni</option>
              <option value="180">180 giorni</option>
              <option value="sempre">sempre</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">Unità organizzativa
            <select className={selectCls} value={ou} onChange={(e) => setOu(e.target.value)}>
              <option value="">Tutte</option>
              {(dati?.ou ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        </CardContent>
      </Card>

      {errore && !dati ? (
        <LoadError what="gli utenti di Active Directory" message={errore} onRetry={() => void carica()} />
      ) : !dati ? (
        <p className="py-8 text-center text-muted-foreground">Caricamento…</p>
      ) : dati.integrazioni.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">
          Nessuna integrazione Active Directory su questo cliente. <Link href="/active-directory" className="font-semibold text-[#006C96] underline">Configurala</Link> e leggi gli utenti, poi torna qui.
        </CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-lg border bg-card px-4 py-3"><div className="text-2xl font-bold">{dati.contatori.nuovo}</div><div className="text-[13px] text-muted-foreground">nuovi, proposti</div></div>
            <div className="rounded-lg border bg-card px-4 py-3"><div className="text-2xl font-bold">{dati.contatori.aggiorna}</div><div className="text-[13px] text-muted-foreground">già presenti, dati da aggiornare</div></div>
            <div className="rounded-lg border-2 border-[#8A6D00] bg-[#FFF6C2] px-4 py-3 text-[#0D2537]"><div className="text-2xl font-bold">▲ {dati.contatori.controlla}</div><div className="text-[13px]">da controllare</div></div>
            <div className="rounded-lg border border-dashed border-[#5B6B77] bg-card px-4 py-3"><div className="text-2xl font-bold text-muted-foreground">{dati.contatori.esclusi}</div><div className="text-[13px] text-muted-foreground">esclusi (servizio, disattivati, senza nome…)</div></div>
          </div>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center gap-3 space-y-0">
              <CardTitle className="flex-1">Utenti proposti</CardTitle>
              <span className="text-[13px] text-muted-foreground">la spunta è già messa sui nuovi e su quelli da aggiornare</span>
            </CardHeader>
            <CardContent>
              {dati.righe.length === 0 ? (
                <p className="py-6 text-center text-muted-foreground">Nessun utente da proporre con questi filtri.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <input type="checkbox" className="size-4 accent-[#00A7E7]" aria-label="Seleziona tutti quelli della pagina" checked={tuttiPagina}
                            onChange={(e) => righePagina.forEach((r) => cambia(r.chiave, e.target.checked))} />
                        </TableHead>
                        <TableHead>Nome</TableHead>
                        <TableHead>Cognome</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead>Mail</TableHead>
                        <TableHead>Reparto</TableHead>
                        <TableHead>Ruolo</TableHead>
                        <TableHead>Ultimo accesso</TableHead>
                        <TableHead>PC dove si collega</TableHead>
                        <TableHead>Esito</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dati.righe.map((r) => (
                        <TableRow key={r.chiave} className={r.esito === "controlla" ? "bg-[#FFFBE6] dark:bg-[#3A3415]" : undefined}>
                          <TableCell>
                            <input type="checkbox" className="size-4 accent-[#00A7E7]" aria-label={`Seleziona ${r.account}`} checked={scelti.has(r.chiave)} onChange={(e) => cambia(r.chiave, e.target.checked)} />
                          </TableCell>
                          <TableCell>{r.nome ?? <span className="font-semibold text-[#8E1B20] dark:text-[#E8625A]">—</span>}</TableCell>
                          <TableCell>{r.cognome ?? <span className="font-semibold text-[#8E1B20] dark:text-[#E8625A]">—</span>}</TableCell>
                          <TableCell>{r.account}</TableCell>
                          <TableCell>{r.email ?? "—"}</TableCell>
                          <TableCell>{r.reparto ?? "—"}</TableCell>
                          <TableCell>{r.ruolo ?? "—"}</TableCell>
                          <TableCell>{quando(r.ultimoAccesso, false)}</TableCell>
                          <TableCell>{r.pc.length > 0 ? r.pc.join(", ") : <span className="text-muted-foreground">nessuno visto</span>}</TableCell>
                          <TableCell><Esito r={r} /></TableCell>
                        </TableRow>
                      ))}
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

          {dati.contatori.esclusi > 0 && (
            <details className="rounded-lg border border-dashed border-[#5B6B77] bg-card px-4 py-3">
              <summary className="cursor-pointer text-[15px] font-semibold">Esclusi ({dati.contatori.esclusi}) — perché non sono proposti</summary>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {dati.esclusi.map((e) => (
                  <li key={e.motivo}>
                    <span className="font-semibold text-foreground">{e.n} {MOTIVI[e.motivo]}</span>: {e.esempi.join(", ")}{e.n > e.esempi.length ? "…" : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3 rounded-lg border bg-card px-4 py-3">
            <span className="flex-1 text-sm">
              Selezionati: <strong className="font-semibold">{conteggio.totale}</strong> — {conteggio.creare} da creare, {conteggio.aggiornare} da aggiornare. Nessun asset viene toccato.
            </span>
            <Link href="/inventory/assignees"><Button variant="outline" className="min-h-11">Annulla</Button></Link>
            <Button className="min-h-11 text-[#0D2537]" disabled={conteggio.totale === 0 || importando} onClick={() => void importa()}>
              {importando ? "Importazione…" : `Importa ${conteggio.totale} ${conteggio.totale === 1 ? "utente" : "utenti"}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
