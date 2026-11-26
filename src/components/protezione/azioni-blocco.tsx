"use client";

/** I pulsanti di una riga di «Tentativi»: blocca per una durata, sblocca, non bloccare mai (Protezione, tappa 5). */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

async function chiedi(corpo: object): Promise<{ ok: boolean; messaggio: string }> {
  try {
    const r = await fetch("/api/protezione/blocco", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, messaggio: String(d.messaggio ?? d.error ?? (r.ok ? "Fatto" : "Non riuscito")) };
  } catch {
    return { ok: false, messaggio: "L'appliance non risponde da qui." };
  }
}

export function AzioniBlocco({ indirizzo, bloccato, mai, durate }: { indirizzo: string; bloccato: boolean; mai: boolean; durate: string[] }) {
  const router = useRouter();
  const [inCorso, setInCorso] = useState(false);
  const fai = async (corpo: object) => {
    setInCorso(true);
    const r = await chiedi(corpo);
    if (r.ok) toast.success(r.messaggio);
    else toast.error(r.messaggio);
    setInCorso(false);
    router.refresh();
  };
  if (mai) return <Button size="sm" variant="outline" disabled={inCorso} onClick={() => void fai({ azione: "togli_mai", indirizzo })}>Togli da «mai bloccati»</Button>;
  if (bloccato) return <Button size="sm" variant="outline" disabled={inCorso} onClick={() => void fai({ azione: "sblocca", indirizzo })}>Sblocca</Button>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {durate.map((d, i) => (
        <Button key={d} size="sm" variant={i === 0 ? "default" : "outline"} disabled={inCorso} onClick={() => void fai({ azione: "blocca", indirizzo, durata: d })}>
          {i === 0 ? `Blocca ${d}` : d}
        </Button>
      ))}
      <Button size="sm" variant="outline" disabled={inCorso} onClick={() => void fai({ azione: "mai", indirizzo })}>Non bloccare mai</Button>
    </span>
  );
}
