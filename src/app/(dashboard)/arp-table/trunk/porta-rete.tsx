"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { fetchJson } from "@/lib/fetch-json";
import { reteDi } from "@/lib/trunk/reti";

const PREFISSI = [20, 21, 22, 23, 24, 25, 26, 27, 28];

export interface DaPortare { sede: string; vid: number; cidr: string; ip: number }

/** «Porta in DA-IPAM» per una rete vista dai collector: rete e host visti, senza credenziali e senza giri. */
export function PortaRete({ rete, onChiudi, onFatto }: { rete: DaPortare; onChiudi: () => void; onFatto: () => void }) {
  const [nome, setNome] = useState(rete.vid === 0 ? rete.sede : `${rete.sede} - VLAN ${rete.vid}`);
  const [prefisso, setPrefisso] = useState(Number(rete.cidr.split("/")[1]) || 24);
  const [attesa, setAttesa] = useState(false);
  const cidr = reteDi(rete.cidr.split("/")[0], prefisso);

  const porta = async (e: FormEvent) => {
    e.preventDefault();
    setAttesa(true);
    const r = await fetchJson<{ host: number }>("/api/traffico/reti-ascolto", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sede: rete.sede, vid: rete.vid, cidr, nome: nome.trim() }),
    });
    setAttesa(false);
    if (!r.ok) { toast.error(r.message); return; }
    toast.success(`Rete ${cidr} in DA-IPAM con ${r.data.host} host`);
    onFatto();
  };
  const riga = "grid grid-cols-[9rem_1fr] items-center gap-3 border-t py-2.5 text-sm";
  const etichetta = "text-[13px] text-muted-foreground";

  return (
    <Dialog open onOpenChange={(aperta) => { if (!aperta) onChiudi(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Porta {cidr} in DA-IPAM</DialogTitle></DialogHeader>
        <form onSubmit={porta}>
          <label className={riga}><span className={etichetta}>Nome</span><Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={100} required /></label>
          <label className={riga}>
            <span className={etichetta}>Maschera</span>
            <select value={prefisso} onChange={(e) => setPrefisso(Number(e.target.value))} className="h-9 w-40 rounded-md border bg-card px-2 font-mono text-sm">
              {PREFISSI.map((p) => <option key={p} value={p}>/{p}{p === 24 ? " (dedotta)" : ""}</option>)}
            </select>
          </label>
          <div className={riga}><span className={etichetta}>Sede e VLAN</span><span>{rete.sede} · {rete.vid === 0 ? "senza tag" : `VLAN ${rete.vid}`}</span></div>
          <div className={riga}><span className={etichetta}>Entrano subito</span><span>{rete.ip === 1 ? "1 indirizzo visto" : `${rete.ip} indirizzi visti`}, con MAC e nome{prefisso !== 24 ? " (quelli dentro questa maschera)" : ""}</span></div>
          <div className={riga}><span className={etichetta}>Credenziali</span><span>nessuna, si aggiungono dopo</span></div>
          <div className={riga}><span className={etichetta}>Giro ARP</span><span>non si può: il collector ascolta soltanto</span></div>
          <DialogFooter className="mt-3">
            <Button type="button" variant="outline" onClick={onChiudi}>Annulla</Button>
            <Button type="submit" disabled={attesa || nome.trim() === ""}>{attesa ? "Porto…" : "Porta in DA-IPAM"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
