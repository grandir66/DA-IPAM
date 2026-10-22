"use client";

/**
 * Nome di un vicino LLDP/CDP/MNDP con l'esito dell'abbinamento a IPAM: link all'host se c'è, «· non in IPAM» se ha un
 * IP o un MAC e nessun host. Finché la mappa non è arrivata (o se la richiesta fallisce) il nome resta com'è: un
 * «non in IPAM» detto senza aver guardato sarebbe falso.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { abbinaVicino, type MappaViciniIpam } from "@/lib/scheda/vicini-ipam";

export function useViciniIpam(deviceId: number | undefined): MappaViciniIpam | null {
  const [mappa, setMappa] = useState<MappaViciniIpam | null>(null);
  useEffect(() => {
    if (!deviceId) return;
    let vivo = true;
    setMappa(null);
    fetchJson<MappaViciniIpam>(`/api/devices/${deviceId}/vicini-ipam`)
      .then((r) => { if (vivo && r.ok) setMappa(r.data); })
      .catch(() => { /* resta il nome senza esito */ });
    return () => { vivo = false; };
  }, [deviceId]);
  return mappa;
}

export function NomeVicino({ nome, ip, mac, mappa }: { nome: string; ip?: string | null; mac?: string | null; mappa: MappaViciniIpam | null }) {
  const esito = mappa ? abbinaVicino({ ip, mac }, mappa) : null;
  if (esito === null) return <>{nome}</>;
  if (esito === "assente") {
    return <>{nome} <span className="whitespace-nowrap text-[13px] font-normal text-muted-foreground">· non in IPAM</span></>;
  }
  return <Link href={`/objects/${esito.hostId}`} className="font-semibold text-[#006C96] underline-offset-2 hover:underline dark:text-sky-300">{nome}</Link>;
}
