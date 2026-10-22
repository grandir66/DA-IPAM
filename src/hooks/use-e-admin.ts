"use client";

import { useSession } from "next-auth/react";
import { eAdmin } from "@/lib/permessi/ruolo";

/**
 * L'utente della sessione può usare le azioni riservate agli amministratori?
 * Finché la sessione non è caricata risponde no: un pulsante che compare dopo
 * è meglio di uno che sparisce dopo il clic (analisi del 19/10, F07).
 */
export function useEAdmin(): boolean {
  const { data } = useSession();
  return eAdmin((data?.user as { role?: string } | undefined)?.role);
}
