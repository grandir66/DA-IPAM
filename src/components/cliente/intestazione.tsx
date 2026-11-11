"use client";

import { signOut } from "next-auth/react";
import { LogOut, Moon, Printer, Sun } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useTema } from "@/components/shared/theme-toggle";

const COMANDO =
  "nascosto-stampa border-white/50 bg-transparent text-white hover:bg-white/10 hover:text-white dark:border-white/50 dark:bg-transparent dark:text-white dark:hover:bg-white/10";

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
  const tema = useTema();

  async function esci() {
    await signOut({ redirect: false });
    window.location.href = "/login";
  }

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 text-white">
      <div className="flex min-w-0 items-center gap-3">
        <img src="/logo-white.png" alt="Domarc" className="h-8 w-auto" />
        <p className="truncate text-base font-semibold">
          La tua rete · <span className="text-[var(--vc-cian)]">{nomeCliente}</span>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-mono text-[13px] text-white/75">dati delle {ora}</p>
        <Button type="button" variant="outline" className={COMANDO} onClick={() => window.print()}>
          <Printer aria-hidden />
          Stampa
        </Button>
        <Button
          type="button"
          variant="outline"
          className={COMANDO}
          onClick={tema.toggle}
          disabled={!tema.mounted}
        >
          {tema.dark ? <Sun aria-hidden /> : <Moon aria-hidden />}
          {tema.etichetta}
        </Button>
        <span className="max-w-40 truncate text-sm">{nomeUtente}</span>
        {amministratore && (
          <Link
            href="/"
            className="nascosto-stampa inline-flex h-8 items-center rounded-lg border border-white/50 bg-transparent px-2.5 text-sm font-medium text-white hover:bg-white/10"
          >
            Torna alla Dashboard
          </Link>
        )}
        <Button type="button" variant="outline" className={COMANDO} onClick={() => void esci()}>
          <LogOut aria-hidden />
          Esci
        </Button>
      </div>
    </header>
  );
}
