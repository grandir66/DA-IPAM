"use client";

import { useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { User as UserIcon, LogOut, KeyRound, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
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

export function UserMenu() {
  const { data: session } = useSession();
  const username = session?.user?.name ?? "";
  const role = (session?.user as { role?: string } | undefined)?.role;
  const initial = username.charAt(0).toUpperCase() || "?";

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
          className="h-9 w-9 rounded-full bg-primary/10 hover:bg-primary/20 text-primary font-semibold text-sm flex items-center justify-center transition-colors"
        >
          {initial}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="flex flex-col gap-0.5">
              <span className="font-medium truncate">{username || "Utente"}</span>
              {roleLabel && (
                <span className="text-xs text-muted-foreground font-normal">{roleLabel}</span>
              )}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setPwOpen(true)}>
            <KeyRound className="h-4 w-4 mr-2" />
            Cambia password
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void signOut({ callbackUrl: "/login" })}>
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
