"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Etichetta, Pannello } from "@/components/shared/console";
import { fetchJson } from "@/lib/fetch-json";
import type { ReteProposta } from "@/lib/trunk/reti-proposte";
import { PortaRete } from "../arp-table/trunk/porta-rete";

/** Rete privata (RFC 1918, CGNAT, link-local)? Le altre sono indirizzi pubblici. */
function retePrivata(cidr: string): boolean {
  const [a, b] = cidr.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254);
}

const MASCHERA: Record<ReteProposta["maschera"], string> = {
  dhcp: "maschera dal DHCP",
  config: "maschera scritta a mano",
  dedotta: "maschera dedotta dai /24 vicini",
  incerta: "maschera incerta",
};

/**
 * Reti viste dal sensore trunk o dai collector (25/11) e non ancora in DA-IPAM (Riccardo, 09/11: «proposte da
 * confermare»). Per quelle dei soli collector vedi `PortaRete`; per quelle del trunk la conferma è lo stesso «Porta in DA-IPAM» della pagina «Reti dal trunk»:
 * crea la rete, giro ARP sulla VLAN, host dentro.
 */
export function RetiProposte({ proposte, admin }: { proposte: ReteProposta[]; admin: boolean }) {
  const router = useRouter();
  const [inCorso, setInCorso] = useState<string | null>(null);
  const [fatte, setFatte] = useState<Set<string>>(new Set());
  // Chiuso di serie (Riccardo, 20/11/2026): l'elenco delle reti viste non deve stare sempre sopra le subnet.
  const [aperto, setAperto] = useState(false);
  const [daPortare, setDaPortare] = useState<ReteProposta | null>(null);
  const chiave = (p: ReteProposta) => `${p.sede ?? ""}|${p.vid}|${p.cidr}`;
  // Le reti pubbliche in fondo: di solito sono la WAN, non una rete del cliente.
  const restanti = proposte
    .filter((p) => !fatte.has(p.cidr))
    .sort((x, y) => Number(!retePrivata(x.cidr)) - Number(!retePrivata(y.cidr)));
  if (restanti.length === 0) return null;
  // Un indirizzo solo di solito è una scheda configurata male, non una rete: sta in un gruppo chiuso (25/11).
  const vere = restanti.filter((p) => p.ip > 1);
  const sole = restanti.filter((p) => p.ip <= 1);

  const conferma = async (p: ReteProposta) => {
    setInCorso(p.cidr);
    const attesa = toast.loading(`Rete ${p.cidr}: giro ARP sulla VLAN e host trovati (fino a un minuto e mezzo)…`);
    try {
      const res = await fetchJson<{ id: number; host: { creati: number }; giro: string; servizi: boolean }>("/api/trunk/rete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vid: p.vid, cidr: p.cidr, gateway: p.fonte === "dhcp" ? p.gateway_ip : null }),
      });
      if (!res.ok) {
        toast.error(res.message, { id: attesa });
        return;
      }
      setFatte((s) => new Set(s).add(p.cidr));
      toast.success(
        `Rete ${p.cidr} creata con ${res.data.host.creati} host · ${res.data.giro}` +
          (res.data.servizi ? " · porte comuni e servizi in lettura (Servizi di rete)" : ""),
        { id: attesa },
      );
      router.refresh();
    } finally {
      setInCorso(null);
    }
  };

  const voce = (p: ReteProposta) => (
    <li key={chiave(p)} className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono font-semibold">{p.cidr}</span>
        <Etichetta>{p.vid === 0 ? "senza tag" : `VLAN ${p.vid}`}</Etichetta>
        {!retePrivata(p.cidr) && <Etichetta>▲ indirizzi pubblici</Etichetta>}
        {p.gateway_ip && <span className="font-mono text-[13px] text-muted-foreground">gw {p.gateway_ip}</span>}
        <span className="text-[13px] text-muted-foreground">
          {p.ip === 1 ? "1 indirizzo visto" : `${p.ip} indirizzi visti`} · {p.sede ? "maschera da confermare" : MASCHERA[p.maschera]}
          {p.ultimoGiorno ? ` · attiva il ${p.ultimoGiorno}` : ""}
          {p.viste && p.viste.length > 0 ? ` · ${p.viste.join(" · ")}` : ""}
        </span>
      </div>
      {admin && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => { if (p.sede) setDaPortare(p); else void conferma(p); }}
          disabled={inCorso !== null || p.maschera === "incerta"}
          title={p.maschera === "incerta" ? "La maschera è incerta: correggila in Sicurezza › Rete › VLAN e indirizzi" : undefined}
        >
          Porta {p.cidr} in DA-IPAM
        </Button>
      )}
    </li>
  );

  return (
    <Pannello
      titolo="Reti viste, da confermare"
      conteggio={restanti.length}
      sottotitolo="Sentite dalla sonda trunk o dai collector e non ancora in DA-IPAM: confermandole entrano con i loro host"
      className={aperto ? undefined : "[&>header]:border-b-0"}
      azioni={
        <Button size="sm" variant="outline" aria-expanded={aperto} onClick={() => setAperto((v) => !v)}>
          {aperto ? "Chiudi ▴" : "Apri ▾"}
        </Button>
      }
    >
      {aperto && (
        <>
          <ul className="divide-y">{vere.map(voce)}</ul>
          {vere.length === 0 && <p className="px-3.5 py-2.5 text-sm text-muted-foreground">Nessuna rete con almeno due indirizzi.</p>}
          {sole.length > 0 && (
            <details className="border-t">
              <summary className="cursor-pointer px-3.5 py-2.5 text-[13px] text-muted-foreground">
                {sole.length === 1 ? "Un'altra con un indirizzo solo" : `Altre ${sole.length} con un indirizzo solo`}: di solito schede configurate male, non reti
              </summary>
              <ul className="divide-y border-t">{sole.map(voce)}</ul>
            </details>
          )}
        </>
      )}
      {daPortare?.sede && (
        <PortaRete rete={{ sede: daPortare.sede, vid: daPortare.vid, cidr: daPortare.cidr, ip: daPortare.ip }} onChiudi={() => setDaPortare(null)}
          onFatto={() => { setFatte((x) => new Set(x).add(daPortare.cidr)); setDaPortare(null); router.refresh(); }} />
      )}
    </Pannello>
  );
}
