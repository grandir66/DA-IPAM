"use client";

/**
 * /hosts/[id] — thin wrapper di redirect verso /objects/[id].
 *
 * Da v0.2.601 la scheda dettaglio è una sola (`/objects/[id]`, scheda asset con
 * tab unificati). Questa route esiste solo per:
 *   - retrocompat link esterni e bookmark esistenti
 *   - deep-link query param (?promote=1, ?edit=1) preservati al redirect
 *
 * Tutta la logica precedente (modale promozione, edit form, fetch host, ecc.)
 * è stata spostata su `/objects/[id]` (PromoteHostDialog, EditDeviceDialog,
 * card Inventario base, ecc.).
 */

import { useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

export default function HostsRedirectPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const id = params.id;
    if (!id || typeof id !== "string" || !/^\d+$/.test(id)) {
      router.replace("/discovery");
      return;
    }
    const qs = searchParams?.toString() ?? "";
    router.replace(`/objects/${id}${qs ? `?${qs}` : ""}`);
  }, [params.id, router, searchParams]);

  return (
    <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
      Apertura scheda asset…
    </div>
  );
}
