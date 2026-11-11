"use client";

import { signOut } from "next-auth/react";
import { LogOut, Printer } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Intestazione della vista cliente. Niente menu laterale.
 * «Stampa» ed «Esci» sono azioni; «Torna alla Dashboard» solo per l'amministratore.
 */
export function Intestazione({
  nomeCliente,
  ora,
  nomeUtente,
  amministratore,
}: {
  nomeCliente: string;
  /** Già in ora italiana, HH:MM. */
  ora: string;
  nomeUtente: string;
  amministratore: boolean;
}) {
  async function esci() {
    await signOut({ redirect: false });
    window.location.href = "/login";
  }

  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <img src="/logo-color.png" alt="Domarc" className="h-8 w-auto" />
        <p className="truncate text-base font-semibold">
          La tua rete · {nomeCliente}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-mono text-[13px] text-muted-foreground">dati delle {ora}</p>
        <Button type="button" variant="outline" className="nascosto-stampa" onClick={() => window.print()}>
          <Printer aria-hidden />
          Stampa
        </Button>
        <span className="max-w-40 truncate text-sm">{nomeUtente}</span>
        {amministratore && (
          <Link href="/" className="nascosto-stampa text-sm font-medium text-cian-testo hover:underline">
            Torna alla Dashboard
          </Link>
        )}
        <Button type="button" variant="outline" className="nascosto-stampa" onClick={() => void esci()}>
          <LogOut aria-hidden />
          Esci
        </Button>
      </div>
    </header>
  );
}
