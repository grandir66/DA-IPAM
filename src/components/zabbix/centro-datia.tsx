"use client";

/**
 * «Centro e proxy» di DatIA Mon (26/11/2026, tappa 2 del punto d'ingresso): a quale centro Zabbix si legge, con
 * quale chiave si scrive, e lo stato del proxy. Sola lettura: i cambi si fanno nella configurazione del modulo,
 * raggiungibile da qui. Nessun segreto: delle chiavi si vede solo l'identificativo.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BarraStato, DatoDettaglio, Pannello, Vuoto } from "@/components/shared/console";
import { LoadError } from "@/components/shared/load-error";
import { parseDbDate } from "@/lib/db-date";
import { fetchJson } from "@/lib/fetch-json";
import type { ConfigLettura, ConfigScrittura } from "@/lib/zabbix-lettura/config";
import type { ProxyLocale } from "@/lib/zabbix-lettura/pannello";

interface Lettura { acquistato: boolean; config: ConfigLettura | null; proxyLocale: ProxyLocale }
interface Centro { letto: boolean; motivo?: string; vecchio?: boolean; proxy?: Array<{ nome: string; inLinea: boolean }>; scrittura?: { possibile: boolean; motivo?: string } }

const quando = (v: string | null | undefined): string | null =>
  v ? parseDbDate(v).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : null;
const TESTO_PROXY: Record<ProxyLocale["stato"], string> = { gira: "● gira", fermo: "✕ installato ma fermo", assente: "– non installato", non_so: "● non so" };

export function CentroDatia() {
  const [lettura, setLettura] = useState<Lettura | null>(null);
  const [scrittura, setScrittura] = useState<ConfigScrittura | null>(null);
  const [centro, setCentro] = useState<Centro | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const carica = useCallback(async () => {
    const [l, s, c] = await Promise.all([
      fetchJson<Lettura>("/api/zabbix/config", { cache: "no-store" }),
      fetchJson<{ config: ConfigScrittura | null }>("/api/zabbix/scrittura", { cache: "no-store" }),
      fetchJson<Centro>("/api/zabbix/apparati", { cache: "no-store" }),
    ]);
    if (!l.ok) return setErrore(l.message);
    if (!s.ok) return setErrore(s.message);
    setLettura(l.data);
    setScrittura(s.data.config);
    // L'elenco degli apparati serve solo per lo stato del centro e dei proxy: se non arriva lo si dice, non si finge.
    setCentro(c.ok ? c.data : { letto: false, motivo: c.message });
    setErrore(null);
  }, []);
  useEffect(() => { void carica(); }, [carica]);

  if (errore) return <LoadError what="la configurazione di Zabbix" message={errore} onRetry={() => void carica()} />;
  if (!lettura || !centro) return <p className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" /> Carico…</p>;
  const configura = <Button size="sm" nativeButton={false} render={<Link href="/settings/moduli/zabbix" />}>Apri la configurazione</Button>;
  if (!lettura.config) return <Vuoto titolo="Il centro Zabbix non è configurato" testo={lettura.acquistato ? undefined : "Il modulo Zabbix non è compreso in questa installazione."} azione={configura} />;
  const c = lettura.config;
  const scrive = centro.scrittura?.possibile === true;
  return (
    <div className="space-y-3">
      <BarraStato
        acceso={centro.letto}
        titolo="Centro Zabbix"
        stato={!c.enabled ? "lettura spenta" : centro.letto ? (centro.vecchio ? "si legge, dati vecchi" : "si legge") : "non si legge"}
        dettagli={[...(centro.letto ? [] : [centro.motivo ?? ""].filter(Boolean)), scrive ? "si scrive" : "sola lettura"]}
        azioni={configura}
      />
      <div className="grid gap-3 xl:grid-cols-3">
        <Pannello titolo="Lettura">
          <dl className="space-y-2.5 text-sm">
            <DatoDettaglio nome="Indirizzo del centro" valore={c.baseUrl} mono />
            <DatoDettaglio nome="Codice cliente" valore={c.codcli} mono />
            <DatoDettaglio nome="Chiave di lettura (identificativo)" valore={c.chiaveId} mono />
            <DatoDettaglio nome="Certificato fissato" valore={c.impronta ? "● sì" : "▲ no"} />
            <DatoDettaglio nome="Ultima lettura riuscita" valore={quando(c.ultimaLetturaOk)} />
            {c.ultimoErrore && <DatoDettaglio nome={`Ultimo errore · ${c.fallimenti} di fila`} valore={c.ultimoErrore} />}
          </dl>
        </Pannello>
        <Pannello titolo="Scrittura">
          <dl className="space-y-2.5 text-sm">
            <DatoDettaglio nome="Chiave di scrittura (identificativo)" valore={scrittura ? scrittura.chiaveId : "▲ manca"} mono={!!scrittura} />
            {scrittura && <DatoDettaglio nome="Inserita" valore={[quando(scrittura.aggiornatoIl), scrittura.aggiornatoDa].filter(Boolean).join(" · ")} />}
            <DatoDettaglio nome="Si può scrivere" valore={scrive ? "● sì" : `▲ no: ${centro.scrittura?.motivo ?? "il centro non si legge"}`} />
            <DatoDettaglio nome="Tetti del centro" valore="10 scritture al minuto, 100 apparati aggiunti al giorno" />
          </dl>
        </Pannello>
        <Pannello titolo="Proxy" conteggio={centro.proxy?.length}>
          <dl className="space-y-2.5 text-sm">
            <DatoDettaglio nome="Su questa macchina" valore={<>{TESTO_PROXY[lettura.proxyLocale.stato]}{lettura.proxyLocale.nome && <span className="ml-2 font-mono font-normal">{lettura.proxyLocale.nome}</span>}</>} />
            {(centro.proxy ?? []).map((p) => (
              <DatoDettaglio key={p.nome} nome={`Visto dal centro: ${p.nome}`} valore={p.inLinea ? "● in linea" : "✕ non in linea"} />
            ))}
            {centro.letto && (centro.proxy ?? []).length === 0 && <DatoDettaglio nome="Visti dal centro" valore="nessuno per questo cliente" />}
          </dl>
        </Pannello>
      </div>
      <p className="text-[13px] text-muted-foreground">Creare o spostare un proxy, registrare il cliente e le sue reti restano in DA-Link e DA-Zabbix.</p>
    </div>
  );
}
