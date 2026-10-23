"use client";

import { useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { User as UserIcon, KeyRound, Loader2, LogOut, MoreHorizontal, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTema } from "./theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

/**
 * Utente in cima al menu a sinistra (Riccardo, 23/10: in basso restava un blocco enorme):
 * iniziale, nome e ruolo; il clic apre «Cambia password», il tema ed «Esci» (Riccardo, 23/10).
 */
export function UserMenu({ compresso = false }: { compresso?: boolean }) {
  const { data: session } = useSession();
  const username = session?.user?.name ?? "";
  const role = (session?.user as { role?: string } | undefined)?.role;
  const initial = username.charAt(0).toUpperCase() || "?";

  const tema = useTema();

  // Il ritorno lo decide il browser: Auth.js costruisce l'indirizzo dal nome su cui ascolta il
  // server, e sull'hub rispondeva https://0.0.0.0/login (pagina vuota, segnalato il 23/10).
  async function esci() {
    await signOut({ redirect: false });
    window.location.href = "/login";
  }
  const [pwOpen, setPwOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("Le password non corrispondono");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("La nuova password deve avere almeno 8 caratteri");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      if (res.ok) {
        toast.success("Password modificata con successo");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setPwOpen(false);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Errore nel cambio password");
      }
    } catch {
      toast.error("Errore di rete");
    } finally {
      setSaving(false);
    }
  }

  const roleLabel =
    role === "superadmin" ? "Super Admin" : role === "admin" ? "Amministratore" : role === "viewer" ? "Solo lettura" : null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Menu utente"
          title={compresso ? `${username || "Utente"}${roleLabel ? ` · ${roleLabel}` : ""}` : undefined}
          className={cn(
            "flex items-center gap-3 px-2 py-2 rounded-lg w-full text-left hover:bg-sidebar-accent transition-colors",
            compresso && "md:justify-center md:px-0",
          )}
        >
          <span className="h-8 w-8 shrink-0 rounded-full bg-sidebar-accent text-sidebar-accent-foreground font-semibold text-sm flex items-center justify-center">
            {initial}
          </span>
          <span className={cn("min-w-0 flex-1 leading-tight", compresso && "md:hidden")}>
            <span className="block truncate text-sm font-medium text-sidebar-foreground">{username || "Utente"}</span>
            {roleLabel && <span className="block truncate text-[13px] text-sidebar-foreground/60">{roleLabel}</span>}
          </span>
          <MoreHorizontal className={cn("h-4 w-4 shrink-0 text-sidebar-foreground/60", compresso && "md:hidden")} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-56">
          {/* Base UI vuole l'etichetta dentro un gruppo: senza, il clic faceva cadere la pagina. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium truncate">{username || "Utente"}</span>
                {roleLabel && (
                  <span className="text-[13px] text-muted-foreground font-normal">{roleLabel}</span>
                )}
              </div>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          {/* Base UI risponde a onClick: con onSelect (Radix) il clic chiudeva il menu e la
              finestra non si apriva mai (segnalato il 23/10: «il cambio password non funziona»). */}
          <DropdownMenuItem onClick={() => setPwOpen(true)}>
            <KeyRound className="h-4 w-4 mr-2" />
            Cambia password
          </DropdownMenuItem>
          <DropdownMenuItem onClick={tema.toggle} disabled={!tema.mounted}>
            {tema.dark ? <Sun className="h-4 w-4 mr-2" /> : <Moon className="h-4 w-4 mr-2" />}
            {tema.etichetta}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void esci()}>
            <LogOut className="h-4 w-4 mr-2" />
            Esci
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={pwOpen} onOpenChange={setPwOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserIcon className="h-5 w-5" />
              Cambia password
            </DialogTitle>
            <DialogDescription>
              Modifica la password del tuo account ({username}).
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="user-menu-current-password">Password corrente</Label>
              <Input
                id="user-menu-current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-menu-new-password">Nuova password</Label>
              <Input
                id="user-menu-new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-menu-confirm-password">Conferma nuova password</Label>
              <Input
                id="user-menu-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPwOpen(false)} disabled={saving}>
                Annulla
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Salva
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
