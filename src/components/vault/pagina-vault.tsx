"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import { FUSO_UTENTI, parseDbDate } from "@/lib/db-date";
import type { StatoVaultPubblico } from "@/lib/vault/appliance";
import type { RigaRegistro } from "@/lib/vault/mostra";

type Stato = StatoVaultPubblico & { mostraPassword: boolean };

const PER_PAGINA = 50;

const AZIONI: Record<string, string> = {
  mostra: "ha visto la password",
  esporta_keepass: "ha esportato in KeePass",
  keyfile: "ha scaricato il key file",
};

function quando(s: string): string {
  return parseDbDate(s).toLocaleString("it-IT", { timeZone: FUSO_UTENTI });
}

async function scarica(parte: "kdbx" | "keyfile", passphrase: string): Promise<string | null> {
  let r: Response;
  try {
    r = await fetch("/api/vault/keepass", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase, parte }),
    });
  } catch {
    return "Server non raggiungibile";
  }
  if (!r.ok) {
    const corpo = (await r.json().catch(() => null)) as { error?: string } | null;
    return corpo?.error ?? `Errore ${r.status}`;
  }
  const nome = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? (parte === "kdbx" ? "da-ipam.kdbx" : "da-ipam.keyx");
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
  return null;
}

/**
 * Impostazioni › Vault (piano da-vault 2026-10-23): stato degli interruttori e dell'archivio, sblocco con la passphrase
 * del cliente, «Esporta in KeePass», registro di chi ha visto cosa.
 */
export function PaginaVault() {
  const [stato, setStato] = useState<Stato | null>(null);
  const [erroreStato, setErroreStato] = useState<string | null>(null);
  const [registro, setRegistro] = useState<{ totale: number; righe: RigaRegistro[] } | null>(null);
  const [erroreRegistro, setErroreRegistro] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  const [passSblocco, setPassSblocco] = useState("");
  const [passEsporta, setPassEsporta] = useState("");
  const [occupato, setOccupato] = useState(false);

  const caricaStato = useCallback(async () => {
    const r = await fetchJson<Stato>("/api/vault/stato", { cache: "no-store" });
    if (r.ok) {
      setStato(r.data);
      setErroreStato(null);
    } else setErroreStato(r.message);
  }, []);

  const caricaRegistro = useCallback(async (p: number) => {
    const r = await fetchJson<{ totale: number; righe: RigaRegistro[] }>(`/api/vault/registro?pagina=${p}&per_pagina=${PER_PAGINA}`, { cache: "no-store" });
    if (r.ok) {
      setRegistro(r.data);
      setErroreRegistro(null);
    } else setErroreRegistro(r.message);
  }, []);

  useEffect(() => {
    void caricaStato();
  }, [caricaStato]);

  useEffect(() => {
    void caricaRegistro(pagina);
  }, [caricaRegistro, pagina]);

  async function sblocca() {
    setOccupato(true);
    const r = await fetchJson<StatoVaultPubblico>("/api/vault/sblocca", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: passSblocco }),
    });
    setOccupato(false);
    setPassSblocco("");
    if (!r.ok) {
      toast.error(`Errore: ${r.message}`);
      return;
    }
    toast.success("Vault sbloccato: le scansioni riprendono");
    await caricaStato();
  }

  async function esporta(parte: "kdbx" | "keyfile") {
    setOccupato(true);
    const errore = await scarica(parte, passEsporta);
    setOccupato(false);
    if (errore) {
      toast.error(`Errore: ${errore}`);
      return;
    }
    toast.success(parte === "kdbx" ? "Archivio KeePass scaricato" : "Key file scaricato");
    await caricaRegistro(1);
    setPagina(1);
  }

  if (erroreStato) return <LoadError what="lo stato del vault" message={erroreStato} onRetry={() => void caricaStato()} />;
  if (!stato) return <p className="text-sm text-muted-foreground">Caricamento…</p>;

  const locale = stato.locale;
  const spento = !locale.acceso && !stato.openbao.acceso;
  const pagine = registro ? Math.max(1, Math.ceil(registro.totale / PER_PAGINA)) : 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Vault</h1>
        <p className="text-sm text-muted-foreground">Le credenziali dell&apos;appliance, chi le ha viste e l&apos;esportazione in KeePass.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stato</CardTitle>
          {spento && (
            <CardDescription>
              Il vault è spento su questa installazione: le credenziali sono cifrate con la chiave dell&apos;appliance come sempre.
              Si accende sul server, un&apos;appliance alla volta (DA_VAULT_LOCALE nel file dell&apos;appliance).
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Archivio locale:</span>
            {!locale.acceso ? (
              <Badge variant="outline">spento</Badge>
            ) : locale.sbloccato ? (
              <Badge>sbloccato ({locale.sbloccatoDa === "tpm" ? "TPM" : locale.sbloccatoDa === "passphrase" ? "passphrase" : "chiave Domarc"})</Badge>
            ) : (
              <Badge variant="destructive">bloccato</Badge>
            )}
            {locale.motivo && <span className="text-destructive">{locale.motivo}</span>}
          </div>
          {locale.acceso && locale.archivio.slot && (
            <p>
              Slot: cliente {locale.archivio.slot.cliente ? "sì" : "no"} · Domarc {locale.archivio.slot.domarc ? "sì" : "no (escluso dal cliente)"} · TPM{" "}
              {locale.archivio.slot.tpm ? "sì" : "no"}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">OpenBao:</span>
            {!stato.openbao.acceso ? (
              <Badge variant="outline">spento</Badge>
            ) : stato.openbao.pronto ? (
              <Badge>{stato.openbao.motivo ? "con la cache" : "pronto"}</Badge>
            ) : (
              <Badge variant="destructive">non disponibile</Badge>
            )}
            {stato.openbao.motivo && <span className="text-muted-foreground">{stato.openbao.motivo}</span>}
          </div>
          {stato.pausa && <p className="font-medium text-destructive">Scansioni in pausa: {stato.pausa}</p>}
        </CardContent>
      </Card>

      {locale.acceso && !locale.sbloccato && (
        <Card>
          <CardHeader>
            <CardTitle>Sblocca</CardTitle>
            <CardDescription>Senza TPM l&apos;archivio si apre con la passphrase del cliente. Finché è bloccato le scansioni sono in pausa.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void sblocca();
              }}
            >
              <div className="min-w-64 flex-1 space-y-1">
                <Label htmlFor="pass-sblocco">Passphrase del cliente</Label>
                <Input id="pass-sblocco" type="password" autoComplete="off" value={passSblocco} onChange={(e) => setPassSblocco(e.target.value)} />
              </div>
              <Button type="submit" disabled={occupato || !passSblocco}>Sblocca</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {locale.acceso && locale.sbloccato && (
        <Card>
          <CardHeader>
            <CardTitle>Esporta in KeePass</CardTitle>
            <CardDescription>
              Un file KeePass (KDBX 4) con tutte le credenziali, che si apre con la passphrase del cliente più il key file.
              Il key file è sempre lo stesso: scaricalo una volta e tienilo separato dall&apos;archivio.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void esporta("kdbx");
              }}
            >
              <div className="min-w-64 flex-1 space-y-1">
                <Label htmlFor="pass-esporta">Passphrase del cliente</Label>
                <Input id="pass-esporta" type="password" autoComplete="off" value={passEsporta} onChange={(e) => setPassEsporta(e.target.value)} />
              </div>
              <Button type="submit" disabled={occupato || !passEsporta}>Scarica .kdbx</Button>
              <Button type="button" variant="outline" disabled={occupato || !passEsporta} onClick={() => void esporta("keyfile")}>Scarica key file</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Chi ha visto cosa</CardTitle>
          <CardDescription>Ogni password mostrata, ogni esportazione e ogni key file scaricato, con l&apos;utente e l&apos;ora.</CardDescription>
        </CardHeader>
        <CardContent>
          {erroreRegistro ? (
            <LoadError what="il registro del vault" message={erroreRegistro} onRetry={() => void caricaRegistro(pagina)} />
          ) : !registro ? (
            <p className="text-sm text-muted-foreground">Caricamento…</p>
          ) : registro.totale === 0 ? (
            <p className="text-sm text-muted-foreground">Nessuna visualizzazione registrata.</p>
          ) : (
            <div className="space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quando</TableHead>
                    <TableHead>Chi</TableHead>
                    <TableHead>Cosa</TableHead>
                    <TableHead>Credenziale</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {registro.righe.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap tabular-nums">{quando(r.created_at)}</TableCell>
                      <TableCell>{r.utente}</TableCell>
                      <TableCell>{AZIONI[r.azione] ?? r.azione}</TableCell>
                      <TableCell>{r.credenziale ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {pagine > 1 && (
                <div className="flex items-center justify-end gap-2 text-sm">
                  <Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>Precedenti</Button>
                  <span className="tabular-nums">{pagina} / {pagine}</span>
                  <Button variant="outline" size="sm" disabled={pagina >= pagine} onClick={() => setPagina((p) => p + 1)}>Successivi</Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
