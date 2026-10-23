import Link from "next/link";
import { ShieldAlert } from "lucide-react";

/**
 * «Vault bloccato» (piano da-vault 2026-10-23): in testa a ogni pagina quando le scansioni sono in pausa perché il
 * vault non è sbloccato (o OpenBao non risponde oltre la cache). Lo decide il server (`testoBannerVault`): con gli
 * interruttori spenti non c'è.
 */
export function BannerVault({ testo }: { testo: string }) {
  return (
    <div role="alert" className="mb-4 flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
      <div className="flex-1">
        <p className="font-medium text-destructive">{testo}</p>
      </div>
      <Link href="/settings/vault" className="shrink-0 font-medium underline underline-offset-2">
        Vault ›
      </Link>
    </div>
  );
}
