"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MonitorSmartphone } from "lucide-react";

interface MeshStatus {
  present: boolean;
  online?: boolean;
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
 */
export function HostMeshcentralCard({ hostId }: { hostId: number }) {
  const router = useRouter();
  const [status, setStatus] = useState<MeshStatus | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/integrations/meshcentral/host/${hostId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { mesh?: MeshStatus } | null) => {
        if (active) setStatus(d?.mesh ?? { present: false });
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
  // Nessun nodo MeshCentral: card assente (no rumore nella scheda host).
  if (!status.present) return null;

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
