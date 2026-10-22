"use client";

/**
 * Panoramica dei router MikroTik raggiungibili in SSH (artboard MkPanoramica, M1-M7): striscia dei numeri, poi in
 * griglia a tre colonne Risorse · Hardware · Contatori / DNS · Utenti del router · Interfacce per tipo. Un riquadro senza
 * dato non si rende; cosa manca lo dice la riga delle fonti. Porte bridge e bond dall'ultima fotografia della topologia (Task 9);
 * DNS, VLAN lette e utenti dalla lettura «VLAN, DNS e utenti» (Task 11). Gli utenti SOLO per l'admin: da viewer il riquadro
 * non c'è e la richiesta non parte (il suo posto lo prende Interfacce per tipo). Deve stare in 1440×900.
 */
import type { ReactNode } from "react";
import { LoadError } from "@/components/shared/load-error";
import {
  accesoDaMk, accessoMk, cacheDnsMk, caselleMikrotik, contatoriMikrotik, fonteLetturaScheda, gruppoInterfaccia, perTipo, usoPercento, type ContatoriMikrotik,
} from "@/lib/scheda/mikrotik";
import type { RigaDnsMk, RigaUtenteMk } from "@/lib/devices/mikrotik-scheda";
import type { TabId } from "@/lib/scheda/tipo-scheda";
import { parseUtcDate } from "../../../blocchi";
import { BarraUso } from "../../../barra-uso";
import { Riquadro } from "../../../riquadro";
import { RigaFontiScheda, type Fonte } from "../../../riga-fonti";
import { StrisciaNumeri } from "../../../striscia-numeri";
import type { ContestoScheda } from "../../../contesto";
import { rotteDi, useUsoPool } from "../dati-router";
import { hardwareDi, risorseDi, useInterfacceMikrotik, useSchedaMikrotik, useUtentiMikrotik } from "./dati-mikrotik";

const ora = (iso: string): string =>
  parseUtcDate(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });

const lnk = "text-[13px] font-semibold text-[#006C96] hover:underline dark:text-sky-300";

/** Riga «etichetta · valore» dei riquadri Hardware e Risorse. */
function Riga({ etichetta, children }: { etichetta: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-x-3 text-sm">
      <span className="text-[13px] font-semibold text-muted-foreground">{etichetta}</span>
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

/** I contatori in ordine di tavola, ognuno con la tab che apre: VLAN, porte e bond vanno nelle loro tab se il router ha un bridge. */
const contatoriVisti = (haBridge: boolean): { chiave: keyof ContatoriMikrotik; etichetta: string; tab: TabId }[] => [
  { chiave: "indirizzi", etichetta: "Indirizzi IP", tab: "interfacce" },
  { chiave: "vlan", etichetta: "VLAN", tab: haBridge ? "vlan" : "interfacce" },
  { chiave: "porteBridge", etichetta: "Porte bridge", tab: haBridge ? "bridge" : "interfacce" },
  { chiave: "bond", etichetta: "Bond", tab: haBridge ? "bridge" : "interfacce" },
  { chiave: "rotte", etichetta: "Rotte", tab: "routing" },
  { chiave: "utenti", etichetta: "Utenti", tab: "configurazione" },
];

/**
 * Server mostrati: la colonna è stretta (due badge per riga a 1440), con otto la Panoramica scorreva (999 px, prova del
 * 22/10). Quattro = due righe; gli altri in «+N altri», col loro elenco nel title.
 */
const MAX_SERVER = 4;
const badgeServer = "inline-flex h-6 items-center rounded border border-[#B8C4CC] bg-muted px-1.5 font-mono text-[13px] font-semibold";

/** Riquadro DNS (M4): server statici (bordo pieno) e dinamici (bordo tratteggiato: forma, non colore), richieste remote, cache, max query. */
function RiquadroDns({ dns }: { dns: RigaDnsMk }) {
  const cache = cacheDnsMk(dns.cache_used, dns.cache_size);
  const server = [...dns.servers.map((x) => ({ x, din: false })), ...dns.dynamic_servers.map((x) => ({ x, din: true }))];
  return (
    <Riquadro titolo="DNS">
      <div className="space-y-2">
        <Riga etichetta="Server">
          {server.length === 0 ? <span className="text-muted-foreground">nessuno</span> : (
            <span className="flex flex-wrap gap-1.5">
              {server.slice(0, MAX_SERVER).map(({ x, din }) => (
                <span key={`${din}:${x}`} className={`${badgeServer} ${din ? "border-dashed" : ""}`} title={din ? "server dinamico (da DHCP o PPP)" : undefined}>{x}{din && <span className="sr-only"> (dinamico)</span>}</span>
              ))}
              {server.length > MAX_SERVER && (
                <span className={`${badgeServer} font-sans`} title={server.slice(MAX_SERVER).map((v) => v.x).join(", ")}>+{server.length - MAX_SERVER} altri</span>
              )}
            </span>
          )}
        </Riga>
        {dns.allow_remote_requests !== null && (
          <Riga etichetta="Richieste remote">
            {dns.allow_remote_requests ? <span className="font-semibold">● accese</span> : <span className="text-muted-foreground">○ spente</span>}
          </Riga>
        )}
        {cache && <Riga etichetta="Cache">{cache}</Riga>}
        {dns.max_concurrent_queries != null && <Riga etichetta="Max query">{dns.max_concurrent_queries}</Riga>}
      </div>
    </Riquadro>
  );
}

/** Gruppo dell'utente: full pieno scuro, write pieno medio, read chiaro col bordo, gli altri gruppi chiari tratteggiati. */
function Gruppo({ g }: { g: string | null }) {
  if (!g) return <span className="text-muted-foreground">—</span>;
  const k = g.toLowerCase();
  const stile = k === "full" ? "border-[#0D2537] bg-[#0D2537] text-white dark:border-sky-100 dark:bg-sky-100 dark:text-[#0D2537]"
    : k === "write" ? "border-[#3D4A53] bg-[#5B6B77] text-white"
      : k === "read" ? "border-[#8696A0] bg-white text-[#0D2537] dark:bg-transparent dark:text-foreground"
        : "border-dashed border-[#8696A0] bg-white text-[#4A6070] dark:bg-transparent dark:text-muted-foreground";
  return <span className={`inline-flex h-[22px] items-center rounded-md border-2 px-2 text-[13px] font-semibold ${stile}`}>{g}</span>;
}

/** Riquadro «Utenti del router» (M5), solo admin: nome, gruppo, ultimo accesso (orologio del router) o «mai». Scorre dentro. */
function RiquadroUtenti({ utenti }: { utenti: RigaUtenteMk[] }) {
  return (
    <Riquadro titolo="Utenti del router" azione={<span className="inline-flex h-[22px] items-center rounded-md bg-[#0D2537] px-2 text-[13px] font-semibold normal-case tracking-normal text-white dark:bg-sky-100 dark:text-[#0D2537]">solo admin</span>}>
      <div className="-m-4 max-h-[172px] overflow-y-auto">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 border-b bg-card">
            <tr>
              <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">Nome</th>
              <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">Gruppo</th>
              <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">Ultimo accesso</th>
            </tr>
          </thead>
          <tbody>
            {utenti.map((u) => {
              const quando = accessoMk(u.last_logged_in);
              return (
                <tr key={u.name} className={`border-b last:border-b-0 ${u.disabled ? "bg-muted/30 text-muted-foreground" : ""}`}>
                  <td className="truncate px-3 py-1 font-semibold" title={u.comment ?? undefined}>
                    {u.name}{u.disabled && <span className="ml-1.5 font-normal text-[#8E1B20] dark:text-[#E8625A]">✕ disabilitato</span>}
                  </td>
                  <td className="px-3 py-1"><Gruppo g={u.group} /></td>
                  <td className={`whitespace-nowrap px-3 py-1 ${quando === "mai" ? "text-muted-foreground" : ""}`}>{quando}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Riquadro>
  );
}

export function PanoramicaMikrotik({ ctx }: { ctx: ContestoScheda }) {
  const { device, apriTab, isAdmin } = ctx;
  const di = device?.device_info ?? null;
  const risorse = risorseDi(ctx);
  const hardware = hardwareDi(ctx);
  const rotte = rotteDi(ctx);
  const { stato: ifc, riprova } = useInterfacceMikrotik(device?.id);
  const interfacce = ifc.fase === "ok" ? ifc.dati.interfacce : null;
  // Bridge, porte e bond: solo dall'ultima fotografia della topologia (mai letta → i contatori non si mostrano).
  const { stato: sc } = useSchedaMikrotik(device?.id);
  const scheda = sc.fase === "ok" ? sc.dati : null;
  const foto = scheda?.letto_il ? scheda : null;
  const haBridge = (device?.mikrotik?.bridge ?? 0) > 0;
  const nVlanIfc = interfacce ? interfacce.filter((x) => gruppoInterfaccia(x.tipo) === "vlan").length : null;
  // Utenti: la richiesta parte solo da admin (null da viewer).
  const ut = useUtentiMikrotik(device?.id, isAdmin);
  const utenti = ut?.fase === "ok" ? ut.dati.utenti : null;

  // Pool DHCP: solo l'ultima lettura fatta aprendo la tab DHCP in questa sessione del browser, mai SSH dalla Panoramica.
  const pool = useUsoPool(ctx, true, false).stato;
  const caselle = caselleMikrotik({
    pool: pool.fase === "ok" && pool.dati.length > 0 ? pool.dati : null,
    risorse, hardware, scansione: di?.scanned_at ?? null, interfacce,
    vlan: foto && nVlanIfc != null ? { numero: nVlanIfc, bridge: foto.bridge.length } : null,
    vlanLette: scheda?.vlan ?? null,
  });
  const contatori = contatoriMikrotik({
    interfacce, rotte: rotte.length, porteBridge: foto ? foto.porte.length || null : null, bond: foto ? foto.bond.length || null : null,
    vlanLette: scheda?.vlan ?? null, utenti: utenti?.length ?? null, admin: isAdmin,
  });
  const visibiliContatori = contatoriVisti(haBridge).filter((c) => contatori[c.chiave] != null);
  const tipi = interfacce ? perTipo(interfacce) : [];

  const cpu = risorse?.cpu_carico ?? null;
  const mem = risorse ? usoPercento(risorse.memoria_totale_b, risorse.memoria_libera_b) : null;
  const disco = risorse ? usoPercento(risorse.disco_totale_b, risorse.disco_libero_b) : null;
  const processore = risorse?.cpu_core != null ? `${risorse.cpu_core} core${risorse.cpu_mhz != null ? ` · ${risorse.cpu_mhz} MHz` : ""}` : null;
  const acceso = accesoDaMk(risorse, di?.scanned_at ?? null);
  const architettura = [risorse?.architettura, risorse?.cpu].filter(Boolean).join(" · ");
  const aggiornabile = hardware?.firmware_aggiornabile && hardware.firmware_aggiornabile !== hardware.firmware_corrente ? hardware.firmware_aggiornabile : null;
  const haRisorse = acceso != null || cpu != null || mem != null || disco != null || processore != null || architettura !== "";
  const haHardware = !!hardware && !!(hardware.modello || hardware.seriale || hardware.firmware_corrente || hardware.firmware_factory);

  const fonti: Fonte[] = [];
  fonti.push(di?.scanned_at ? { nome: "SSH", esito: "ok", quando: ora(di.scanned_at) } : { nome: "SSH", esito: "assente", nota: "mai eseguita" });
  if (ifc.fase === "ok") {
    fonti.push(!ifc.dati.collegato
      ? { nome: "Interfacce", esito: "assente", nota: "apparato non ancora abbinato a un apparato fisico" }
      : ifc.dati.interfacce.length === 0
        ? { nome: "Interfacce", esito: "assente", nota: "nessuna letta" }
        : { nome: "Interfacce", esito: "ok", ...(ifc.dati.aggiornato ? { quando: ora(ifc.dati.aggiornato) } : {}) });
  }
  if (scheda) {
    fonti.push(!scheda.letture.topologia.acceso
      ? { nome: "Bridge e porte", esito: "assente", nota: "lettura «Spanning tree, bridge e fasci» spenta" }
      : scheda.letto_il ? { nome: "Topologia", esito: "ok", quando: ora(scheda.letto_il) } : { nome: "Bridge e porte", esito: "assente", nota: "mai lette" });
  }
  // Una data per sezione: il DNS la sua, gli utenti (solo admin) quella della loro rotta.
  if (scheda) fonti.push(fonteLetturaScheda("DNS", scheda.letture.scheda, scheda.letture.scheda.dns_il));
  if (scheda && ut?.fase === "ok") fonti.push(fonteLetturaScheda("Utenti", scheda.letture.scheda, ut.dati.letto_il));
  if (di?.scanned_at && !risorse && !hardware) fonti.push({ nome: "Risorse e hardware", esito: "assente", nota: "si leggono con «Aggiorna»" });

  return (
    <div className="space-y-4">
      <StrisciaNumeri caselle={caselle} onApriTab={apriTab} />

      {ifc.fase === "errore" && <LoadError what="le interfacce" message={ifc.messaggio} onRetry={riprova} />}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Riquadro titolo="Risorse" vuoto={!haRisorse}>
          <div className="space-y-2">
            {cpu != null && <Riga etichetta="CPU"><BarraUso percento={cpu} etichetta={`${cpu}%`} /></Riga>}
            {mem != null && <Riga etichetta="Memoria"><BarraUso percento={mem} etichetta={`${mem}%`} /></Riga>}
            {disco != null && <Riga etichetta="Storage"><BarraUso percento={disco} etichetta={`${disco}%`} /></Riga>}
            {acceso && <Riga etichetta="Acceso da">{acceso.valore}{acceso.sotto && <span className="text-muted-foreground"> · {acceso.sotto}</span>}</Riga>}
            {processore && <Riga etichetta="Processore">{processore}</Riga>}
            {architettura !== "" && <Riga etichetta="Architettura">{architettura}</Riga>}
          </div>
        </Riquadro>

        <Riquadro titolo="Hardware" vuoto={!haHardware}>
          <div className="space-y-2">
            {hardware?.modello && <Riga etichetta="Modello"><span className="font-semibold">{hardware.modello}</span></Riga>}
            {hardware?.seriale && <Riga etichetta="Seriale"><span className="font-mono text-[13px]">{hardware.seriale}</span></Riga>}
            {hardware?.firmware_corrente && <Riga etichetta="Firmware">{hardware.firmware_corrente}</Riga>}
            {aggiornabile && <Riga etichetta="Aggiornabile"><span className="font-semibold text-[#6B4F00] dark:text-[#FFD400]"><span aria-hidden>▲ </span>{aggiornabile}</span></Riga>}
            {hardware?.firmware_factory && <Riga etichetta="Factory">{hardware.firmware_factory}</Riga>}
          </div>
        </Riquadro>

        <Riquadro titolo="Contatori" vuoto={visibiliContatori.length === 0}>
          <div className="grid grid-cols-3 gap-2">
            {visibiliContatori.map((c) => (
              <button
                key={c.chiave}
                type="button"
                onClick={() => apriTab(c.tab)}
                className="flex min-w-0 flex-col rounded-lg border px-3 py-1.5 text-left transition-colors hover:bg-muted/50"
              >
                <span className="text-xl font-bold leading-tight text-[#0D2537] dark:text-foreground">{contatori[c.chiave]}</span>
                <span className="truncate text-[13px] text-muted-foreground">{c.etichetta} ›</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[13px] text-muted-foreground">Contati sull&apos;ultima lettura; ognuno apre la sua tab.</p>
        </Riquadro>

        {scheda?.dns && <RiquadroDns dns={scheda.dns} />}
        {ut?.fase === "errore" && <Riquadro titolo="Utenti del router"><p className="text-sm text-muted-foreground">Non caricati: {ut.messaggio}</p></Riquadro>}
        {utenti && utenti.length > 0 && <RiquadroUtenti utenti={utenti} />}

        <Riquadro
          titolo="Interfacce per tipo"
          vuoto={tipi.length === 0}
          azione={<button type="button" onClick={() => apriTab("interfacce")} className={lnk}>tutte ({interfacce?.length ?? 0}) ›</button>}
        >
          <ul className="flex flex-wrap gap-2">
            {tipi.map((t) => (
              <li key={t.tipo} className="inline-flex h-7 items-center gap-1.5 rounded-full border py-0 pl-1 pr-2.5 text-[13px] font-semibold">
                <b className="inline-flex h-5 min-w-[22px] items-center justify-center rounded-full bg-[#0D2537] px-1 text-[13px] text-white dark:bg-[#E6EEF4] dark:text-[#0D2537]">{t.numero}</b>
                {t.tipo}
              </li>
            ))}
          </ul>
        </Riquadro>
      </div>

      <RigaFontiScheda ctx={ctx} fonti={fonti} />
    </div>
  );
}
