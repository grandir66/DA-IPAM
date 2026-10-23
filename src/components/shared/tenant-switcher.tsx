"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Istanza = il tenant su cui si lavora (Riccardo, 23/10: «cliente» diventa «istanza»). Nella
 * barra resta una riga da leggere; la scelta sta in Impostazioni → Istanza. L'hub ricorda
 * l'ultima scelta e all'accesso riparte da lì (lib/accesso/sessione.ts).
 */
interface IstanzaInfo {
  code: string;
  name: string;
  role: string;
}

const VISTA_TUTTE = "__ALL__";

function useIstanze() {
  const { data: session, update } = useSession();
  const u = session?.user as Record<string, unknown> | undefined;
  const istanze = (u?.tenants ?? []) as IstanzaInfo[];
  const corrente = (u?.tenantCode as string | null | undefined) ?? null;
  const isSuperadmin = u?.role === "superadmin";
  const attuale = corrente === VISTA_TUTTE
    ? { code: VISTA_TUTTE, name: "Tutte le istanze", role: "superadmin" }
    : istanze.find((t) => t.code === corrente);
  return { istanze, corrente, attuale, isSuperadmin, update };
}

/** Riga nella barra: dice su quale istanza si sta lavorando; il clic porta alla scelta. */
export function IstanzaCorrente({ compresso = false, onNavigate }: { compresso?: boolean; onNavigate?: () => void }) {
  const { istanze, attuale } = useIstanze();
  if (istanze.length === 0) return null;

  const testo = attuale ? (attuale.code === VISTA_TUTTE ? attuale.name : `${attuale.name} · ${attuale.code}`) : "Nessuna istanza scelta";
  const contenuto = (
    <>
      <Building2 className="h-3.5 w-3.5 shrink-0" />
      <span className={cn("truncate", compresso && "md:hidden")}>{testo}</span>
    </>
  );
  const classi = cn(
    "flex items-center gap-2 px-3 py-1 rounded-md text-[13px] text-sidebar-foreground/60 min-w-0",
    compresso && "md:justify-center md:px-0",
  );
  // Una sola istanza (appliance): niente da scegliere, la riga è solo da leggere.
  if (istanze.length === 1) {
    return <div className={classi} title={compresso ? testo : undefined}>{contenuto}</div>;
  }
  return (
    <Link
      href="/settings?tab=istanza"
      onClick={onNavigate}
      title={compresso ? `Istanza: ${testo}` : "Cambia istanza"}
      className={cn(classi, "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors")}
    >
      {contenuto}
    </Link>
  );
}

/** Scelta dell'istanza, in Impostazioni → Istanza. */
export function SceltaIstanza() {
  const { istanze, corrente, attuale, isSuperadmin, update } = useIstanze();
  const router = useRouter();
  const [cambio, setCambio] = useState(false);

  async function scegli(value: string | null) {
    if (!value || value === corrente) return;
    setCambio(true);
    try {
      const nuova = await update({ tenantCode: value });
      // L'hub rifiuta un'istanza senza accesso e lascia quella di prima: dirlo.
      const ottenuta = (nuova?.user as Record<string, unknown> | undefined)?.tenantCode;
      if (ottenuta !== value) {
        toast.error("Istanza non disponibile per il tuo utente");
        return;
      }
      toast.success("Istanza cambiata");
      router.refresh();
    } finally {
      setCambio(false);
    }
  }

  return (
    <div className="space-y-2 max-w-md">
      <Select value={corrente ?? ""} onValueChange={scegli} disabled={cambio}>
        <SelectTrigger className="w-full h-auto py-2">
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <SelectValue>
              <span className="truncate">
                {attuale ? (attuale.code === VISTA_TUTTE ? attuale.name : `${attuale.name} · ${attuale.code}`) : "Scegli un'istanza"}
              </span>
            </SelectValue>
          </div>
        </SelectTrigger>
        <SelectContent>
          {isSuperadmin && <SelectItem value={VISTA_TUTTE}>Tutte le istanze (vista aggregata)</SelectItem>}
          {istanze.map((t) => (
            <SelectItem key={t.code} value={t.code}>
              {t.name} · {t.code}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[13px] text-muted-foreground">
        Al prossimo accesso riparti da qui.
      </p>
    </div>
  );
}
