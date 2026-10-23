"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, Plus, Pencil, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { fetchJson } from "@/lib/fetch-json";
import { LoadError } from "@/components/shared/load-error";
import { BadgeSegno, giornoBreve } from "@/components/assegnatari/segni";
import type { ElencoAssegnatari, RigaElencoAssegnatari } from "@/lib/assegnatari/db";

const PER_PAGINA = 50;
type Origine = "tutte" | "ad" | "manuale";

function StatoAd({ r }: { r: RigaElencoAssegnatari }) {
  if (r.ad_disattivato_il) return <BadgeSegno tipo="attenzione">Disattivato il {giornoBreve(r.ad_disattivato_il)}</BadgeSegno>;
  if (r.origine === "ad") return <BadgeSegno tipo="ok">Attivo</BadgeSegno>;
  return <BadgeSegno tipo="neutro">Non in AD</BadgeSegno>;
}

export default function AssetAssigneesPage() {
  const [dati, setDati] = useState<ElencoAssegnatari | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  const [origine, setOrigine] = useState<Origine>("tutte");
  const [cerca, setCerca] = useState("");
  const [cercaAttiva, setCercaAttiva] = useState("");
  const [soloUsciti, setSoloUsciti] = useState(false);
  const [aperto, setAperto] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RigaElencoAssegnatari | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", note: "" });
  const attesa = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [daAbbinare, setDaAbbinare] = useState(0);

  // Riga ㉕ (piano abbinamenti): quanti PC hanno un utente prevalente senza assegnatario. Un errore qui non disturba.
  useEffect(() => {
    void fetchJson<{ contatori: { proposto: number } }>("/api/assegnatari/abbinamenti?gruppo=proposto&perPagina=10", { cache: "no-store" })
      .then((r) => { if (r.ok) setDaAbbinare(r.data.contatori.proposto); });
  }, []);

  const carica = useCallback(async () => {
    const q = new URLSearchParams({ origine, pagina: String(pagina), perPagina: String(PER_PAGINA), usciti: soloUsciti ? "1" : "0" });
    if (cercaAttiva.trim()) q.set("q", cercaAttiva.trim());
    const r = await fetchJson<ElencoAssegnatari>(`/api/asset-assignees/elenco?${q}`, { cache: "no-store" });
    if (r.ok) {
      setDati(r.data);
      setErrore(null);
    } else {
      setErrore(r.message);
    }
  }, [origine, pagina, cercaAttiva, soloUsciti]);

  useEffect(() => {
    void carica();
  }, [carica]);

  // La ricerca parte mezzo secondo dopo l'ultima lettera.
  useEffect(() => {
    if (attesa.current) clearTimeout(attesa.current);
    attesa.current = setTimeout(() => {
      setCercaAttiva(cerca);
      setPagina(1);
    }, 400);
    return () => {
      if (attesa.current) clearTimeout(attesa.current);
    };
  }, [cerca]);

  function openCreate() {
    setEditing(null);
    setForm({ name: "", email: "", phone: "", note: "" });
    setDialogOpen(true);
  }

  function openEdit(a: RigaElencoAssegnatari) {
    setEditing(a);
    setForm({ name: a.name, email: a.email ?? "", phone: a.phone ?? "", note: a.note ?? "" });
    setDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("Nome richiesto");
      return;
    }
    const r = await fetchJson<unknown>(editing ? `/api/asset-assignees/${editing.id}` : "/api/asset-assignees", {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (r.ok) {
      toast.success(editing ? "Assegnatario aggiornato" : "Assegnatario creato");
      setDialogOpen(false);
      void carica();
    } else {
      toast.error(`Errore: ${r.message}`);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Eliminare questo assegnatario? Gli asset assegnati restano senza assegnatario.")) return;
    const r = await fetchJson<unknown>(`/api/asset-assignees/${id}`, { method: "DELETE" });
    if (r.ok) {
      toast.success("Eliminato");
      void carica();
    } else {
      toast.error(`Errore: ${r.message}`);
    }
  }

  const totale = dati?.totale ?? 0;
  const da = totale === 0 ? 0 : (pagina - 1) * PER_PAGINA + 1;
  const a = Math.min(pagina * PER_PAGINA, totale);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/inventory">
          <Button variant="ghost" size="icon" aria-label="Torna all'inventario"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Assegnatari asset</h1>
          <p className="text-muted-foreground text-sm">Le persone a cui si assegnano gli asset; da Active Directory o inserite a mano</p>
        </div>
        <Link href="/inventory/assignees/import-ad">
          <Button variant="outline" className="min-h-11"><Users className="h-4 w-4 mr-2" />Importa da Active Directory</Button>
        </Link>
        <Button onClick={openCreate} className="min-h-11 text-[#0D2537]">
          <Plus className="h-4 w-4 mr-2" />
          Nuovo assegnatario
        </Button>
      </div>

      {daAbbinare > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-2 text-sm">
          <span className="flex-1">● <strong className="font-semibold">{daAbbinare} PC</strong> {daAbbinare === 1 ? "ha" : "hanno"} un utente prevalente da abbinare</span>
          <Link href="/inventory/abbinamenti" className="font-semibold text-[#006C96] underline">Abbinamenti ›</Link>
        </div>
      )}

      {dati && dati.usciti.assegnatari > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-[#8A6D00] bg-[#FFF6C2] px-4 py-3 text-[#0D2537]">
          <BadgeSegno tipo="attenzione">Attenzione</BadgeSegno>
          <span className="flex-1 text-sm">
            <strong className="font-semibold">
              {dati.usciti.assegnatari === 1 ? "1 assegnatario è disattivato" : `${dati.usciti.assegnatari} assegnatari sono disattivati`} in Active Directory
            </strong>{" "}
            e {dati.usciti.asset === 1 ? "ha ancora 1 asset" : `hanno ancora ${dati.usciti.asset} asset`}: vanno riassegnati.
          </span>
          <Button variant="link" className="font-semibold text-[#006C96]" onClick={() => { setSoloUsciti((x) => !x); setPagina(1); }}>
            {soloUsciti ? "Mostra tutti" : "Mostra solo questi"}
          </Button>
        </div>
      )}

      {errore && !dati ? (
        <LoadError what="gli assegnatari" message={errore} onRetry={() => void carica()} />
      ) : (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center gap-3 space-y-0">
            <CardTitle className="flex-1">Elenco ({totale})</CardTitle>
            <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
              Origine
              <select
                value={origine}
                onChange={(e) => { setOrigine(e.target.value as Origine); setPagina(1); }}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
              >
                <option value="tutte">Tutte</option>
                <option value="ad">Active Directory</option>
                <option value="manuale">Inserito a mano</option>
              </select>
            </label>
            <Input aria-label="Cerca" placeholder="Cerca nome, mail, reparto" value={cerca} onChange={(e) => setCerca(e.target.value)} className="w-60" />
          </CardHeader>
          <CardContent>
            {errore && <p className="mb-3 text-sm text-destructive">Aggiornamento non riuscito: {errore}</p>}
            {!dati ? (
              <p className="text-muted-foreground py-8 text-center">Caricamento…</p>
            ) : dati.righe.length === 0 ? (
              <p className="text-muted-foreground py-8 text-center">
                {cercaAttiva || origine !== "tutte" || soloUsciti
                  ? "Nessun assegnatario con questi filtri."
                  : "Nessun assegnatario. Importali da Active Directory o crea il primo con «Nuovo assegnatario»."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome e cognome</TableHead>
                      <TableHead>Mail</TableHead>
                      <TableHead>Reparto</TableHead>
                      <TableHead>Ruolo</TableHead>
                      <TableHead>Origine</TableHead>
                      <TableHead>Stato in AD</TableHead>
                      <TableHead className="text-right">Asset</TableHead>
                      <TableHead className="w-32"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dati.righe.map((r) => {
                      const uscito = !!r.ad_disattivato_il && r.asset > 0;
                      return (
                        <Fragment key={r.id}>
                          <TableRow className={uscito ? "bg-[#FFFBE6] dark:bg-[#3A3415]" : undefined}>
                            <TableCell className="font-medium">{r.name}</TableCell>
                            <TableCell className="text-muted-foreground">{r.email ?? "—"}</TableCell>
                            <TableCell>{r.reparto ?? "—"}</TableCell>
                            <TableCell>{r.ruolo ?? "—"}</TableCell>
                            <TableCell>{r.origine === "ad" ? "Active Directory" : "Inserito a mano"}</TableCell>
                            <TableCell><StatoAd r={r} /></TableCell>
                            <TableCell className="text-right tabular-nums">{r.asset}</TableCell>
                            <TableCell>
                              <div className="flex items-center justify-end gap-1">
                                {uscito && (
                                  <Button variant="link" className="h-auto p-0 font-semibold text-[#006C96]" onClick={() => setAperto(aperto === r.id ? null : r.id)}>
                                    Riassegna
                                  </Button>
                                )}
                                <Button variant="ghost" size="icon" aria-label={`Modifica ${r.name}`} onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="icon" aria-label={`Elimina ${r.name}`} onClick={() => handleDelete(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                              </div>
                            </TableCell>
                          </TableRow>
                          {aperto === r.id && (
                            <TableRow className="bg-[#FFFBE6] dark:bg-[#3A3415]">
                              <TableCell colSpan={8} className="text-sm">
                                Asset di {r.name} da riassegnare:{" "}
                                {(dati.assetDegliUsciti[r.id] ?? []).map((x, i) => (
                                  <Fragment key={x.id}>
                                    {i > 0 && ", "}
                                    <Link href={`/inventory/${x.id}`} className="font-semibold text-[#006C96] underline">{x.nome}</Link>
                                  </Fragment>
                                ))}
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
            {totale > 0 && (
              <div className="flex items-center gap-3 pt-3 text-[13px] text-muted-foreground">
                <span>{da}–{a} di {totale}</span>
                {pagina > 1 && <Button variant="link" className="h-auto p-0 text-[13px] text-[#006C96]" onClick={() => setPagina((p) => p - 1)}>pagina precedente</Button>}
                {a < totale && <Button variant="link" className="h-auto p-0 text-[13px] text-[#006C96]" onClick={() => setPagina((p) => p + 1)}>pagina successiva</Button>}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Modifica assegnatario" : "Nuovo assegnatario"}</DialogTitle>
          </DialogHeader>
          {editing?.origine === "ad" && (
            <p className="text-sm text-muted-foreground">Importato da Active Directory: nome, mail e telefono si riallineano a ogni lettura di AD.</p>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div><Label>Nome *</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required /></div>
            <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
            <div><Label>Telefono</Label><Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
            <div><Label>Note</Label><Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></div>
            <Button type="submit" className="w-full text-[#0D2537]">{editing ? "Salva" : "Crea"}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
