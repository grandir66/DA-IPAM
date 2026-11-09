"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Etichetta, Pannello } from "@/components/shared/console";
import { fetchJson } from "@/lib/fetch-json";
import type { ReteProposta } from "@/lib/trunk/reti-proposte";

const MASCHERA: Record<ReteProposta["maschera"], string> = {
  dhcp: "maschera dal DHCP",
  config: "maschera scritta a mano",
  dedotta: "maschera dedotta dai /24 vicini",
  incerta: "maschera incerta",
};

/**
 * Reti viste dal sensore trunk e non ancora in DA-IPAM (Riccardo, 09/11: «proposte da
 * confermare»). La conferma è lo stesso «Porta in DA-IPAM» della pagina «Reti dal trunk»:
 * crea la rete, giro ARP sulla VLAN, host dentro.
 */
export function RetiProposte({ proposte, admin }: { proposte: ReteProposta[]; admin: boolean }) {
  const router = useRouter();
  const [inCorso, setInCorso] = useState<string | null>(null);
  const [fatte, setFatte] = useState<Set<string>>(new Set());
  const restanti = proposte.filter((p) => !fatte.has(p.cidr));
  if (restanti.length === 0) return null;

  const conferma = async (p: ReteProposta) => {
    setInCorso(p.cidr);
    const attesa = toast.loading(`Rete ${p.cidr}: giro ARP sulla VLAN e host trovati (fino a un minuto e mezzo)…`);
    try {
      const res = await fetchJson<{ id: number; host: { creati: number }; giro: string }>("/api/trunk/rete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vid: p.vid, cidr: p.cidr, gateway: p.fonte === "dhcp" ? p.gateway_ip : null }),
      });
      if (!res.ok) {
        toast.error(res.message, { id: attesa });
        return;
      }
      setFatte((s) => new Set(s).add(p.cidr));
      toast.success(`Rete ${p.cidr} creata con ${res.data.host.creati} host · ${res.data.giro}`, { id: attesa });
      router.refresh();
    } finally {
      setInCorso(null);
    }
  };

  return (
    <Pannello
      titolo="Reti viste, da confermare"
      conteggio={restanti.length}
      sottotitolo="Sentite dal sensore trunk e non ancora in DA-IPAM: confermandole entrano con i loro host"
    >
      <ul className="divide-y">
        {restanti.map((p) => (
          <li key={`${p.vid}-${p.cidr}`} className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono font-semibold">{p.cidr}</span>
              <Etichetta>{p.vid === 0 ? "senza tag" : `VLAN ${p.vid}`}</Etichetta>
              {p.gateway_ip && <span className="font-mono text-[13px] text-muted-foreground">gw {p.gateway_ip}</span>}
              <span className="text-[13px] text-muted-foreground">
                {p.ip} indirizzi visti · {MASCHERA[p.maschera]}
                {p.ultimoGiorno ? ` · attiva il ${p.ultimoGiorno}` : ""}
              </span>
            </div>
            {admin && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void conferma(p)}
                disabled={inCorso !== null || p.maschera === "incerta"}
                title={p.maschera === "incerta" ? "La maschera è incerta: correggila in «Reti dal trunk»" : undefined}
              >
                Porta {p.cidr} in DA-IPAM
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Pannello>
  );
}
