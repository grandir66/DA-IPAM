"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Monitor, MonitorSmartphone } from "lucide-react";

interface MeshStatus {
  present: boolean;
  online?: boolean;
}

/** Pulsanti RDP/VNC senza agente (senza-agente.ts), decisi dal server. */
interface SenzaAgente {
  rdp: boolean;
  vnc: boolean;
}

/**
 * Card MeshCentral nella scheda host: apre la sessione di controllo remoto.
 * Auto-carica lo stato Mesh dell'host (GET host/[hostId]) e mostra il bottone solo
 * se esiste un nodo associato.
 *
 * La sessione si apre DENTRO DA-IPAM (`/rmm/[hostId]`), non in una scheda esterna:
 * di conseguenza qui non c'è più nessuna gestione del popup blocker, che era la
 * parte fragile (window.open con `noopener` restituisce null per specifica, quindi
 * la scheda restava vuota e non veniva mai navigata). Il login-token lo conia — e
 * consuma — solo la pagina di sessione: è monouso, e passarlo di mano rischiava di
 * bruciarlo per strada. Da `/rmm/[hostId]` resta possibile staccare la sessione in
 * una finestra separata.
 *
 * Senza agente: se l'host non ha un nodo MeshCentral ma la scansione ha trovato
 * aperte le porte RDP o VNC, la card offre «Desktop remoto (RDP)» / «VNC», che
 * aprono `/rmm/[hostId]/senza-agente` (sessione aperta dal server MeshCentral,
 * nessuna installazione sulla postazione). Il server li manda solo a flag acceso.
 */
export function HostMeshcentralCard({ hostId }: { hostId: number }) {
  const router = useRouter();
  const [status, setStatus] = useState<MeshStatus | null>(null);
  const [senzaAgente, setSenzaAgente] = useState<SenzaAgente>({ rdp: false, vnc: false });

  useEffect(() => {
    let active = true;
    fetch(`/api/integrations/meshcentral/host/${hostId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { mesh?: MeshStatus; senzaAgente?: SenzaAgente } | null) => {
        if (!active) return;
        setStatus(d?.mesh ?? { present: false });
        if (d?.senzaAgente) setSenzaAgente(d.senzaAgente);
      })
      .catch(() => {
        if (active) setStatus({ present: false });
      });
    return () => {
      active = false;
    };
  }, [hostId]);

  // Modulo non configurato / nessuno stato: non mostrare nulla finché non si sa.
  if (status === null) return null;
  if (!status.present) {
    // Nessun nodo MeshCentral e niente RDP/VNC: card assente (no rumore nella scheda host).
    if (!senzaAgente.rdp && !senzaAgente.vnc) return null;
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Monitor className="h-4 w-4" />
            Controllo remoto
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Senza agente: la sessione la apre l&apos;appliance, le credenziali si inseriscono nella sessione.
          </p>
          <div className="flex flex-wrap gap-2">
            {senzaAgente.rdp ? (
              <Button onClick={() => router.push(`/rmm/${hostId}/senza-agente?p=rdp`)}>
                <Monitor className="mr-2 h-4 w-4" />
                Desktop remoto (RDP)
              </Button>
            ) : null}
            {senzaAgente.vnc ? (
              <Button variant="outline" onClick={() => router.push(`/rmm/${hostId}/senza-agente?p=vnc`)}>
                <Monitor className="mr-2 h-4 w-4" />
                VNC
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MonitorSmartphone className="h-4 w-4" />
          Controllo remoto
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {status.online === false && (
          <p className="text-sm text-amber-600">
            Il nodo risulta offline: la sessione potrebbe non aprirsi.
          </p>
        )}
        <Button onClick={() => router.push(`/rmm/${hostId}`)}>
          <MonitorSmartphone className="mr-2 h-4 w-4" />
          Controllo remoto
        </Button>
      </CardContent>
    </Card>
  );
}
