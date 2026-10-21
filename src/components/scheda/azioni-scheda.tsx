"use client";

/**
 * Azioni dell'intestazione (a destra): per un apparato gestito «Aggiorna» e «Prova credenziali» più il menu ⋯
 * (Modifica, Crea asset NIS2, Togli apparato); per un host non gestito «Rendi apparato». Le azioni rare stanno nel ⋯.
 */
import { KeyRound, MoreHorizontal, PackagePlus, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function AzioniScheda({
  gestito,
  haAsset,
  isAdmin,
  aggiornando,
  provando,
  titoloAggiorna,
  onAggiorna,
  onProva,
  onRendiApparato,
  onModifica,
  onCreaAsset,
  onTogli,
}: {
  gestito: boolean;
  haAsset: boolean;
  isAdmin: boolean;
  aggiornando: boolean;
  provando: boolean;
  titoloAggiorna: string;
  onAggiorna: () => void;
  onProva: () => void;
  onRendiApparato: () => void;
  onModifica: () => void;
  onCreaAsset: () => void;
  onTogli: () => void;
}) {
  const hoVoci = gestito || !haAsset;
  return (
    <>
      {gestito ? (
        <>
          <Button onClick={onAggiorna} disabled={aggiornando || provando} title={titoloAggiorna}>
            <RefreshCw className={`mr-2 h-4 w-4 ${aggiornando ? "animate-spin" : ""}`} />
            {aggiornando ? "Aggiornamento…" : "Aggiorna"}
          </Button>
          <Button variant="outline" onClick={onProva} disabled={provando || aggiornando} title="Prova le credenziali registrate (SSH/SNMP/WinRM/API) con un'autenticazione vera">
            <KeyRound className={`mr-2 h-4 w-4 ${provando ? "animate-pulse" : ""}`} />
            {provando ? "Prova…" : "Prova credenziali"}
          </Button>
        </>
      ) : (
        <Button onClick={onRendiApparato}>
          <PackagePlus className="mr-2 h-4 w-4" />
          Rendi apparato
        </Button>
      )}
      {hoVoci && (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="Altre azioni" title="Altre azioni" />}>
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {gestito && (
              <DropdownMenuItem onClick={onModifica}>
                <Pencil className="h-4 w-4" />
                Modifica
              </DropdownMenuItem>
            )}
            {!haAsset && (
              <DropdownMenuItem onClick={onCreaAsset}>
                <PackagePlus className="h-4 w-4" />
                Crea asset NIS2
              </DropdownMenuItem>
            )}
            {gestito && isAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={onTogli}>
                  <Trash2 className="h-4 w-4" />
                  Togli apparato
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}
