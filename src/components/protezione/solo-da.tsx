"use client";

/** «Solo da questi indirizzi» di un utente: si vede, e si cambia con «Cambia» → «Salva» (Protezione › Utenti). */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SoloDa({ utenteId, nome, indirizzi }: { utenteId: number; nome: string; indirizzi: string[] }) {
  const router = useRouter();
  const [aperto, setAperto] = useState(false);
  const [testo, setTesto] = useState(indirizzi.join(", "));
  const [inCorso, setInCorso] = useState(false);

  const salva = async () => {
    setInCorso(true);
    try {
      const r = await fetch("/api/protezione/utenti", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utenteId, indirizzi: testo.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return void toast.error(String(d.error ?? "Elenco non salvato"));
      toast.success(d.indirizzi.length === 0 ? `${nome} entra da ovunque.` : `${nome} entra solo dagli indirizzi scritti (e da NetBird).`);
      setAperto(false);
      router.refresh();
    } finally {
      setInCorso(false);
    }
  };

  if (!aperto) {
    return (
      <span className="inline-flex items-center gap-2">
        {indirizzi.length === 0 ? <span className="text-muted-foreground">ovunque</span> : <span className="font-mono text-[13px]">{indirizzi.join("  ")}</span>}
        <Button size="sm" variant="outline" onClick={() => setAperto(true)}>Cambia</Button>
      </span>
    );
  }
  return (
    <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void salva(); }}>
      <Input value={testo} onChange={(e) => setTesto(e.target.value)} placeholder="vuoto = ovunque; 192.0.2.10, 192.0.2.0/24" className="w-80 font-mono" aria-label={`Indirizzi da cui può entrare ${nome}`} disabled={inCorso} />
      <Button type="submit" size="sm" disabled={inCorso}>Salva</Button>
      <Button type="button" size="sm" variant="outline" disabled={inCorso} onClick={() => { setTesto(indirizzi.join(", ")); setAperto(false); }}>Annulla</Button>
    </form>
  );
}
