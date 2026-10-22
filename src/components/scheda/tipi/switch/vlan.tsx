"use client";

/**
 * Tab «VLAN» degli switch (piano 2026-10-22 accorpamento, Task 11; artboard SwitchVlan V1-V7): striscia VLAN · trunk ·
 * access · senza VLAN, poi la matrice porte × VLAN condivisa coi MikroTik. Dati: GET /api/devices/[id]/vlan-switch (solo DB,
 * aprire la tab non manda niente allo switch). Senza la lettura «VLAN degli switch via SNMP» la matrice è quella dei PVID.
 */
import { useCallback, useEffect, useState } from "react";
import { LoadError } from "@/components/shared/load-error";
import { BadgeAvviso } from "@/components/devices/rendi-apparato-esito";
import { fetchJson } from "@/lib/fetch-json";
import { fonteVlanSwitch, sezioniMatriceSwitch, type RigaMatriceSwitch } from "@/lib/scheda/vlan-switch";
import type { RispostaVlanSwitch } from "@/lib/devices/vlan-switch-rotta";
import { Riquadro } from "../../riquadro";
import { RigaFonti } from "../../riga-fonti";
import { StrisciaNumeri } from "../../striscia-numeri";
import { TabellaMatriceVlan, type BloccoMatrice } from "../../matrice-vlan";
import type { ContestoScheda } from "../../contesto";
import type { Caricamento } from "../router/dati-router";

function useVlanSwitch(deviceId: number | undefined): { stato: Caricamento<RispostaVlanSwitch>; riprova: () => void } {
  const [stato, setStato] = useState<Caricamento<RispostaVlanSwitch>>({ fase: "carico" });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!deviceId) return;
    let vivo = true;
    fetchJson<RispostaVlanSwitch>(`/api/devices/${deviceId}/vlan-switch`)
      .then((r) => { if (vivo) setStato(r.ok ? { fase: "ok", dati: r.data } : { fase: "errore", messaggio: r.message }); })
      .catch(() => { if (vivo) setStato({ fase: "errore", messaggio: "Richiesta annullata" }); });
    return () => { vivo = false; };
  }, [deviceId, n]);
  const riprova = useCallback(() => { setStato({ fase: "carico" }); setN((x) => x + 1); }, []);
  return { stato, riprova };
}

const link = "text-[13px] font-semibold text-[#006C96] hover:underline dark:text-sky-300";

/** «+6 porte senza VLAN · 43, 44, 45 · non attive · mostra ›» (artboard V4). */
function RigaChiusa({ righe, cosa, aperte, onCambia }: { righe: RigaMatriceSwitch[]; cosa: string; aperte: boolean; onCambia: () => void }) {
  const attive = righe.filter((r) => r.stato === "attiva").length;
  // Prese col solo numero; SFP+ col prefisso (la «1» della SFP+ 1 non è la Porta 1); aggregati «LAG n».
  const numeri = righe.map((r) => r.gruppo === "porta" ? r.porta.replace(/^Porta /, "")
    : r.gruppo === "aggregato" ? `LAG ${r.porta.match(/(\d+)\s*$/)?.[1] ?? r.porta}` : r.porta).join(", ");
  return (
    <span className="flex flex-wrap items-center gap-x-2 text-[13px]">
      <b>+{righe.length} {cosa}</b>
      <span className="text-muted-foreground">· {numeri} · {attive === 0 ? "nessuna attiva" : `${attive} attive`}</span>
      <button type="button" onClick={onCambia} className={link}>{aperte ? "nascondi ‹" : "mostra ›"}</button>
    </span>
  );
}

export function VlanSwitch({ ctx }: { ctx: ContestoScheda }) {
  const { stato, riprova } = useVlanSwitch(ctx.device?.id);
  const [senzaAperte, setSenzaAperte] = useState(false);
  const [lagAperti, setLagAperti] = useState(false);
  if (stato.fase === "carico") return <Riquadro titolo="VLAN"><p className="text-sm text-muted-foreground">Caricamento…</p></Riquadro>;
  if (stato.fase === "errore") return <LoadError what="le VLAN dello switch" message={stato.messaggio} onRetry={riprova} />;
  const { matrice: m, lettura } = stato.dati;
  const s = sezioniMatriceSwitch(m);

  const blocchi: BloccoMatrice[] = [{ chiave: "porte", righe: s.porte }];
  if (s.senza.length > 0) {
    blocchi.push({ chiave: "senza", riga: <RigaChiusa righe={s.senza} cosa={s.senza.length === 1 ? "porta senza VLAN" : "porte senza VLAN"} aperte={senzaAperte} onCambia={() => setSenzaAperte((x) => !x)} /> });
    if (senzaAperte) blocchi.push({ chiave: "senza-righe", righe: s.senza });
  }
  if (s.sfp.length > 0) blocchi.push({ chiave: "sfp", titolo: "Porte SFP+", righe: s.sfp });
  if (s.aggregati.length + s.aggregatiSpenti.length > 0) {
    blocchi.push({ chiave: "lag", titolo: "Aggregati (LAG)", righe: s.aggregati });
    if (s.aggregatiSpenti.length > 0) {
      blocchi.push({ chiave: "lag-spenti", riga: <RigaChiusa righe={s.aggregatiSpenti} cosa="aggregati spenti o senza VLAN" aperte={lagAperti} onCambia={() => setLagAperti((x) => !x)} /> });
      if (lagAperti) blocchi.push({ chiave: "lag-spenti-righe", righe: s.aggregatiSpenti });
    }
  }

  const avviso = m.qualita === "dedotta" ? (
    <p className="mt-1 text-[13px] font-semibold text-foreground">Lo switch non dichiara le porte untagged: U dedotta dal PVID.</p>
  ) : m.qualita === "solo_pvid" ? (
    <p className="mt-1 text-[13px] font-semibold text-foreground">
      Tagged e nomi: serve la lettura «VLAN degli switch via SNMP», {lettura.acceso ? "mai fatta" : "spenta"}. Qui solo le VLAN dei PVID.
    </p>
  ) : null;

  return (
    <div className="space-y-4">
      {/* Senza nessuna VLAN la striscia direbbe solo «0 · 0 · 0 · tutte»: non si rende, lo dice il riquadro. */}
      {m.colonne.length > 0 && (
        <StrisciaNumeri
          onApriTab={ctx.apriTab}
          caselle={[
            { etichetta: "VLAN", valore: String(m.striscia.vlan) },
            { etichetta: "Porte trunk", valore: String(m.striscia.trunk) },
            { etichetta: "Porte access", valore: String(m.striscia.access) },
            { etichetta: "Porte senza VLAN", valore: String(m.striscia.senza_vlan) },
          ]}
        />
      )}
      <Riquadro titolo="Matrice porte × VLAN" azione={m.qualita === "dedotta" ? <BadgeAvviso>dedotta: U dal PVID</BadgeAvviso> : undefined}>
        {m.righe.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessuna porta letta per questo switch.</p>
        ) : m.colonne.length === 0 ? (
          <>
            <p className="text-sm text-muted-foreground">Lo switch non dichiara la VLAN delle porte.</p>
            {avviso}
          </>
        ) : (
          <TabellaMatriceVlan m={m} prima="Porta" blocchi={blocchi} avviso={avviso} />
        )}
      </Riquadro>
      <RigaFonti fonti={[fonteVlanSwitch(lettura)]} />
    </div>
  );
}
