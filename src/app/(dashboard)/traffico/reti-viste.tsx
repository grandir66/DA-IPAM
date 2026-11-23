"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { Pannello, TempoRelativo, Vuoto } from "@/components/shared/console";
import { fetchJson } from "@/lib/fetch-json";
import { formattaByte } from "@/lib/traffico/frasi";
import type { RetiViste as Dati, ReteVista } from "@/lib/traffico/oggetti";

const PERIODI: { giorni: number; testo: string }[] = [
  { giorni: 1, testo: "Oggi" },
  { giorni: 7, testo: "7 giorni" },
  { giorni: 30, testo: "30 giorni" },
];
const PAROLE: Record<string, string> = { esterno: "Fuori dalla rete", diffusione: "A tutti (diffusione)", nessuna: "Rete non censita" };

/** La finestra «Dai un nome»: rete (modificabile), nome, nota. Non crea una subnet. */
function DaiUnNome({ rete, onChiudi, onFatto }: { rete: ReteVista; onChiudi: () => void; onFatto: () => void }) {
  const [chiave, setChiave] = useState(rete.chiave);
  const [nome, setNome] = useState(rete.nome ?? "");
  const [nota, setNota] = useState(rete.nota);
  const [attesa, setAttesa] = useState(false);

  const salva = async (e: FormEvent) => {
    e.preventDefault();
    setAttesa(true);
    const r = await fetchJson<{ oggetto: { chiave: string } }>("/api/traffico/oggetti", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chiave: chiave.trim(), nome: nome.trim(), nota: nota.trim() }),
    });
    // se la rete è stata allargata o ristretta, il nome di prima resterebbe sulla rete vecchia: lo si toglie
    if (r.ok && rete.nome !== null && r.data.oggetto.chiave !== rete.chiave) {
      await fetchJson<{ ok: boolean }>(`/api/traffico/oggetti?chiave=${encodeURIComponent(rete.chiave)}`, { method: "DELETE" });
    }
    setAttesa(false);
    if (!r.ok) { toast.error(r.message); return; }
    toast.success("Nome salvato");
    onFatto();
  };
  const togli = async () => {
    setAttesa(true);
    const r = await fetchJson<{ ok: boolean }>(`/api/traffico/oggetti?chiave=${encodeURIComponent(rete.chiave)}`, { method: "DELETE" });
    setAttesa(false);
    if (!r.ok) { toast.error(r.message); return; }
    toast.success("Nome tolto: torna «Rete non censita»");
    onFatto();
  };

  return (
    <Dialog open onOpenChange={(aperta) => { if (!aperta) onChiudi(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{rete.nome === null ? "Dai un nome" : "Cambia nome"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={salva} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="oggetto-rete">Rete</Label>
            <Input id="oggetto-rete" value={chiave} onChange={(e) => setChiave(e.target.value)} className="font-mono" required />
            <p className="text-[13px] text-muted-foreground">Si può allargare o restringere: /16 per una sede intera, /32 per un indirizzo solo.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="oggetto-nome">Nome</Label>
            <Input id="oggetto-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} required autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="oggetto-nota">Nota (facoltativa)</Label>
            <Input id="oggetto-nota" value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300} />
          </div>
          <p className="rounded-lg border bg-muted px-3 py-2 text-[13px]">Non diventa una subnet: niente scansioni, niente host creati.</p>
          <DialogFooter>
            {rete.nome !== null && <Button type="button" variant="outline" disabled={attesa} onClick={() => void togli()}>Togli il nome</Button>}
            <Button type="button" variant="outline" disabled={attesa} onClick={onChiudi}>Annulla</Button>
            <Button type="submit" disabled={attesa}>Salva</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Gli indirizzi interni visti nel traffico e fuori dalle reti censite, rete per rete, col nome dato da una persona. */
export function RetiViste({ admin, onVediCoppie, onCambio }: { admin: boolean; onVediCoppie: (chiaveRete: string) => void; onCambio: () => void }) {
  const [dati, setDati] = useState<Dati | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [giorni, setGiorni] = useState(7);
  const [aperta, setAperta] = useState<ReteVista | null>(null);

  const carica = useCallback(async () => {
    const r = await fetchJson<Dati>(`/api/traffico/reti-viste?giorni=${giorni}`, { cache: "no-store" });
    if (r.ok) {
      setDati(r.data);
      setErrore(null);
    } else setErrore(r.message);
  }, [giorni]);

  useEffect(() => { void carica(); }, [carica]);

  const nomeDi = (chiave: string): string => dati?.nomi_reti[chiave] ?? PAROLE[chiave] ?? (chiave.startsWith("o:") ? chiave.slice(2) : "Rete tolta dal censimento");
  const senzaNome = dati?.reti.filter((r) => r.nome === null).length ?? 0;

  return (
    <>
      <Pannello
        titolo="Reti viste e non censite"
        conteggio={dati?.reti.length}
        sottotitolo={dati ? `Indirizzi interni che parlano ma non stanno in nessuna subnet censita. ${senzaNome} senza nome.` : "Indirizzi interni che parlano ma non stanno in nessuna subnet censita."}
        corpoClassName="p-0"
        azioni={PERIODI.map((p) => (
          <Button key={p.giorni} size="sm" variant={giorni === p.giorni ? "default" : "outline"} onClick={() => setGiorni(p.giorni)}>{p.testo}</Button>
        ))}
        piede={dati?.troncato ? "Le coppie del periodo sono moltissime: l'elenco è calcolato sulle 50.000 più pesanti." : undefined}
      >
        {errore !== null ? (
          <div className="p-3"><LoadError what="le reti viste" message={errore} onRetry={() => void carica()} /></div>
        ) : dati === null ? (
          <p className="p-3 text-sm text-muted-foreground" role="status">Carico le reti viste…</p>
        ) : dati.reti.length === 0 ? (
          <div className="p-3"><Vuoto titolo="Nessuna rete fuori dal censimento" testo="Tutti gli indirizzi interni visti nel periodo stanno in una subnet censita." /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rete</TableHead>
                <TableHead className="text-right">Host visti</TableHead>
                <TableHead className="text-right">Volume</TableHead>
                <TableHead>Parla con</TableHead>
                <TableHead>Prima volta</TableHead>
                <TableHead>Ultima volta</TableHead>
                <TableHead className="text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dati.reti.map((r) => (
                <TableRow key={r.chiave}>
                  <TableCell className="max-w-sm whitespace-normal">
                    {r.nome !== null ? <span className="block font-semibold">{r.nome}</span> : <span className="block text-muted-foreground">senza nome</span>}
                    <span className="font-mono text-[13px]">{r.chiave}</span>
                    {r.nota && <span className="block text-[13px] text-muted-foreground">{r.nota}</span>}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{r.host}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formattaByte(r.byte)}</TableCell>
                  <TableCell className="max-w-xs whitespace-normal">
                    {r.con.map((c) => (
                      <span key={c.rete} className="block text-[13px]">{nomeDi(c.rete)} <span className="font-mono text-muted-foreground">{formattaByte(c.byte)}</span></span>
                    ))}
                  </TableCell>
                  <TableCell><TempoRelativo data={r.prima_vista} /></TableCell>
                  <TableCell><TempoRelativo data={r.ultima_vista} /></TableCell>
                  <TableCell className="text-right">
                    <span className="flex justify-end gap-1.5">
                      {admin && <Button size="sm" variant={r.nome === null ? "default" : "outline"} onClick={() => setAperta(r)}>{r.nome === null ? "Dai un nome" : "Cambia nome"}</Button>}
                      <Button size="sm" variant="outline" disabled={r.nome === null} title={r.nome === null ? "Con un nome la rete diventa un filtro di «Chi parla con chi»" : undefined} onClick={() => onVediCoppie(`o:${r.chiave}`)}>Vedi le coppie</Button>
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Pannello>
      {aperta && <DaiUnNome rete={aperta} onChiudi={() => setAperta(null)} onFatto={() => { setAperta(null); void carica(); onCambio(); }} />}
    </>
  );
}
