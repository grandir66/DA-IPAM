"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MonitorSmartphone, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface RemoteSessionResponse {
  url?: string;
  error?: unknown;
}

interface MeshStatus {
  present: boolean;
  online?: boolean;
}

/**
 * Card MeshCentral nella scheda host: avvio sessione di controllo remoto (launch-out SSO).
 * Auto-carica lo stato Mesh dell'host (GET host/[hostId]) e mostra il bottone solo
 * se esiste un nodo associato.
 *
 * Popup-safe (§10): apriamo la tab in modo SINCRONO nel gesture del click,
 * poi impostiamo l'URL dopo la POST. Niente window.open(url) DOPO l'await
 * (verrebbe bloccato dal popup blocker).
 */
export function HostMeshcentralCard({ hostId }: { hostId: number }) {
  const [status, setStatus] = useState<MeshStatus | null>(null);
  const [loading, setLoading] = useState(false);

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

  async function startRemoteSession() {
    if (loading) return;
    setLoading(true);

    // Apertura sincrona nel gesture utente: indispensabile per evitare il blocco popup.
    const win = window.open("", "_blank", "noopener,noreferrer");
    try {
      const res = await fetch(
        `/api/integrations/meshcentral/host/${hostId}/remote-session`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ viewmode: 11 }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as RemoteSessionResponse;

      if (!res.ok || !data.url) {
        if (win) win.close();
        toast.error("Avvio sessione remota fallito");
        return;
      }

      if (win) {
        win.opener = null; // hardening: nessun riferimento all'app sorgente
        win.location.href = data.url;
      } else {
        toast("Popup bloccato — apri la sessione manualmente", {
          action: {
            label: "Apri",
            onClick: () => window.open(data.url, "_blank", "noopener,noreferrer"),
          },
        });
      }
    } catch {
      if (win) win.close();
      toast.error("Errore di rete durante l'avvio della sessione remota");
    } finally {
      setLoading(false);
    }
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
        <Button onClick={startRemoteSession} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Controllo remoto
        </Button>
      </CardContent>
    </Card>
  );
}
