"use client";

/**
 * «Sicurezza del dominio» con due schede (Riccardo, 08/11/2026, su tutte le installazioni: «i due
 * menù Sicurezza del Dominio e Health Active Directory dovrebbero essere collassati, mantenendo le
 * informazioni»). «Eventi dei DC» è la pagina di prima, tale e quale; «Health AD» è la scheda che
 * stava nella pagina Active Directory. La scheda sta nell'indirizzo (?tab=eventi|health): il vecchio
 * /active-directory?tab=health rimanda qui. Prova: src/lib/menu/__tests__/sicurezza-dominio-unita.test.ts.
 */

import { Suspense, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { IntestazionePagina, SchedePagina, Vuoto } from "@/components/shared/console";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SkeletonTable } from "@/components/shared/skeleton-table";
import { HealthActiveDirectory } from "@/components/ad/health-active-directory";
import { schedaSicurezzaDominio, type SchedaSicurezzaDominio } from "@/lib/menu/sicurezza-dominio";
import { SicurezzaDominioClient } from "./sicurezza-dominio-client";

interface DominioAd {
  id: number;
  name: string;
  domain: string;
  enabled: number;
}

export function SicurezzaDominioSchede({ admin }: { admin: boolean }) {
  return (
    <Suspense fallback={null}>
      <Schede admin={admin} />
    </Suspense>
  );
}

function Schede({ admin }: { admin: boolean }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const scheda = schedaSicurezzaDominio(searchParams.get("tab"));
  const scegli = (v: SchedaSicurezzaDominio) => router.replace(`${pathname}?tab=${v}`, { scroll: false });

  const schede = (
    <SchedePagina<SchedaSicurezzaDominio>
      etichetta="Sicurezza del dominio"
      scelta={scheda}
      onScegli={scegli}
      voci={[
        { valore: "eventi", titolo: "Eventi dei DC", descrizione: "Login, accessi falliti, blocchi, modifiche e attacchi, letti via WinRM" },
        { valore: "health", titolo: "Health AD", descrizione: "Rischio, rilievi, privilegi, permessi e copertura, letti via LDAP" },
      ]}
    />
  );

  if (scheda === "eventi") return <SicurezzaDominioClient admin={admin} schede={schede} />;
  return <SchedaHealth schede={schede} />;
}

function SchedaHealth({ schede }: { schede: ReactNode }) {
  const [domini, setDomini] = useState<DominioAd[] | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [sceltoId, setSceltoId] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/ad")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: DominioAd[]) => {
        setDomini(d);
        setSceltoId((prev) => prev ?? d[0]?.id ?? null);
      })
      .catch((e: unknown) => setErrore(e instanceof Error ? e.message : String(e)));
  }, []);

  const scelto = domini?.find((d) => d.id === sceltoId) ?? null;

  return (
    <div className="space-y-4">
      <IntestazionePagina
        titolo="Sicurezza del dominio"
        sottotitolo="Health di Active Directory: rischio, rilievi da sistemare, privilegi, permessi e copertura della lettura, via LDAP."
        azioni={
          domini && domini.length > 1 ? (
            <Select value={sceltoId != null ? String(sceltoId) : ""} onValueChange={(v) => setSceltoId(Number(v))}>
              <SelectTrigger className="w-64" aria-label="Dominio">
                <SelectValue placeholder="Dominio">{scelto ? `${scelto.name} (${scelto.domain})` : "Dominio"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {domini.map((d) => (
                  <SelectItem key={d.id} value={String(d.id)}>{d.name} ({d.domain})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : scelto ? (
            <span className="text-[13px] text-muted-foreground">{scelto.name} ({scelto.domain})</span>
          ) : null
        }
      />
      {schede}
      {errore ? (
        <Vuoto titolo="Domini Active Directory non letti" testo={`Errore: ${errore}`} />
      ) : !domini ? (
        <SkeletonTable rows={4} />
      ) : domini.length === 0 ? (
        <Vuoto
          titolo="Nessun dominio Active Directory"
          testo="La Health legge il dominio via LDAP: prima si aggiunge l'integrazione."
          azione={<Link href="/active-directory" className="text-[13px] text-cian-testo hover:underline">Active Directory ›</Link>}
        />
      ) : (
        <HealthActiveDirectory integrazione={scelto} />
      )}
    </div>
  );
}
