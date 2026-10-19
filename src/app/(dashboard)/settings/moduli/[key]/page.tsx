"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ModulesTab } from "@/components/settings/modules-tab";
import { useEAdmin } from "@/hooks/use-e-admin";
import { MODULI_CON_PAGINA } from "@/lib/modules/elenco-righe";

/**
 * La pagina di un modulo (analisi del 19/10, F10): configurazione, salute e verifica
 * di quel modulo soltanto. Riusa le sezioni di `ModulesTab` con `solo`.
 */
export default function PaginaModulo() {
  const { key } = useParams<{ key: string }>();
  const admin = useEAdmin();
  if (!MODULI_CON_PAGINA.has(key)) {
    return (
      <div className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">Modulo sconosciuto</h1>
        <p className="text-muted-foreground">
          «{key}» non è un modulo con una sua pagina. <Link href="/settings?tab=moduli" className="underline">Tutti i moduli</Link>
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-6 max-w-5xl">
      <h1 className="text-3xl font-bold tracking-tight">Moduli</h1>
      <ModulesTab isAdmin={admin} solo={key} />
    </div>
  );
}
