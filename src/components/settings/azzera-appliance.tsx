"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pannello } from "@/components/shared/console";

interface StatoAzzeramento {
  disponibile: boolean;
  motivo: string;
  nome: string | null;
  immagine: string | null;
}

/**
 * «Azzera l'appliance» (Riccardo, 29/10/2026): per preparare in laboratorio una macchina da
 * portare dal cliente. Via cliente, voci, database e password di tutta l'appliance (DA-IPAM, Edge,
 * Greenbone, Zabbix, Wazuh, NetBird); restano sistema e programmi; poi la VM si spegne. Dal
 * cliente il comando di DA-Link («Riusa una macchina già installata») la riconfigura.
 * Si vede solo su un'appliance da immagine.
 */
export function AzzeraAppliance() {
  const [stato, setStato] = useState<StatoAzzeramento | null>(null);
  const [conferma, setConferma] = useState("");
  const [inCorso, setInCorso] = useState(false);
  const [avviato, setAvviato] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch("/api/appliance/azzera")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: StatoAzzeramento | null) => { if (vivo) setStato(d); })
      .catch(() => { if (vivo) setStato(null); });
    return () => { vivo = false; };
  }, []);

  if (!stato || stato.immagine === null) return null;

  async function azzera() {
    setInCorso(true);
    try {
      const r = await fetch("/api/appliance/azzera", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conferma }),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!r.ok) { toast.error(d.error ?? "Azzeramento non avviato"); return; }
      setAvviato(true);
      toast.success(d.message ?? "Azzeramento avviato");
    } catch {
      toast.error("Errore di rete");
    } finally {
      setInCorso(false);
    }
  }

  return (
    <Pannello
      titolo="Azzera l'appliance"
      sottotitolo="Per portarla da un altro cliente: si cancella tutto tranne sistema e programmi, poi si spegne."
      piede="Dal cliente: cambia l'IP del Proxmox, poi DA-Link → Nuova appliance → «Riusa una macchina già installata» → Prepara il comando."
    >
      {avviato ? (
        <p className="text-sm" role="status">▲ Azzeramento in corso: fra qualche minuto l&apos;appliance si spegne e questa pagina non risponde più.</p>
      ) : !stato.disponibile ? (
        <p className="text-sm text-muted-foreground">● Non disponibile: {stato.motivo}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            Si cancellano reti, host, credenziali, utenti, database di DA-IPAM, Edge, Greenbone, Zabbix e Wazuh, le
            password e l&apos;ingresso in NetBird. Non si torna indietro.
          </p>
          <label className="flex flex-col gap-1 text-sm">
            Per confermare scrivi il nome dell&apos;appliance: <span className="font-mono">{stato.nome}</span>
            <Input
              value={conferma}
              onChange={(e) => setConferma(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="max-w-xs font-mono"
              aria-label="Nome dell'appliance"
            />
          </label>
          <div>
            <Button variant="destructive" onClick={azzera} disabled={inCorso || conferma.trim() !== stato.nome}>
              {inCorso ? "Avvio…" : "Azzera e spegni"}
            </Button>
          </div>
        </div>
      )}
    </Pannello>
  );
}
