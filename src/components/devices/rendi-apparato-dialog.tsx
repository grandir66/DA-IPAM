"use client";

/**
 * Finestra unica «Rendi apparato» (tappa 3, 21/10): trasforma uno o più host in apparati gestiti.
 * Sostituisce le quattro finestre di promozione (scheda dell'oggetto, Discovery, pagina della
 * rete, lista per classificazione), ognuna col suo modulo da 10-15 campi.
 *
 * Si chiede poco: 1 Cos'è (classificazione, piattaforma, variante se serve), 2 Come ci arrivo
 * (protocollo, porta), 3 Credenziale (archivio + «Prova», nuova, «Trova in automatico»). Tipo
 * dispositivo, scan target, sottotipo e profilo si deducono (`lib/devices/rendi-apparato.ts`).
 * Più host: i blocchi 1-2 valgono per tutti, il 3 è una tabella con un esito per host.
 *
 * La classificazione scelta si scrive come manuale dalla creazione (`POST /api/devices`, T2).
 * Creare senza credenziale provata è ammesso (Riccardo, 21/10): il piede lo dice con «▲».
 * Più host: un `POST /api/devices` per host (nome e credenziale sono per riga).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogScrollableArea,
  DialogTitle,
  DIALOG_PANEL_WIDE_CLASS,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadError } from "@/components/shared/load-error";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/lib/fetch-json";
import { isMacOsHost } from "@/lib/host-platform-detect";
import { DEVICE_CLASSIFICATIONS_ORDERED, getClassificationLabel, sortClassificationsByDisplayLabel } from "@/lib/device-classifications";
import { PRODUCT_PROFILE_LABELS, variantiPer } from "@/lib/device-product-profiles";
import { getDefaultNetworkDeviceVendorOptions } from "@/lib/network-device-vendor-options";
import { coerceProtocolForVendor } from "@/lib/vendor-device-profile";
import { ETICHETTE_RUOLI, RUOLI_SERVER, type RuoloServer } from "@/lib/classification/canonico";
import {
  portaPerCredenziale,
  proponiApparato,
  riallineaAlProtocollo,
  ruoliDaHost,
  type CredenzialeArchivio,
  type ProtocolloApparato,
} from "@/lib/devices/proposta-apparato";
import {
  corpoCreazione,
  fonteProposta,
  scelteComuniDaProposte,
  portaStandard,
  profiloEffettivo,
  type HostPerRendiApparato,
  type ScelteComuni,
} from "@/lib/devices/rendi-apparato";
import type { HostDetail, NetworkDevice } from "@/types";
import { BadgeAvviso, BadgeNeutro, eMotivoTetto, type EsitoCredenziale } from "./rendi-apparato-esito";
import { RendiApparatoCredenziale, type NuovaCredenziale } from "./rendi-apparato-credenziale";
import { RendiApparatoTabella } from "./rendi-apparato-tabella";
import { esitoVisibile, type AzioniCredenziale, type EscluseHost, type RigaApparato, type TentativoVista } from "./rendi-apparato-tipi";

export interface RendiApparatoProps {
  /** Da 1 a 50 host: uno apre la finestra semplice, più host la tabella. */
  hosts: HostPerRendiApparato[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dopo almeno un apparato creato (per rileggere i dati della pagina). */
  onCreated?: () => void;
}

const PROTOCOLLI: Array<{ value: ProtocolloApparato; label: string }> = [
  { value: "ssh", label: "SSH" },
  { value: "snmp_v2", label: "SNMP v2" },
  { value: "snmp_v3", label: "SNMP v3" },
  { value: "api", label: "API REST" },
  { value: "winrm", label: "WinRM / WMI" },
];

const CLASSIFICAZIONI = sortClassificationsByDisplayLabel(DEVICE_CLASSIFICATIONS_ORDERED.filter((c) => c !== "unknown"));
const PIATTAFORME = getDefaultNetworkDeviceVendorOptions();
const JSON_HEADERS = { "Content-Type": "application/json" };
/** Rifiuti dello stesso account Windows, su host diversi nello stesso giro, oltre i quali non si riprova (decisione 21/10). */
const TETTO_ACCOUNT_GIRO = 3;

/** Titolo: l'IP per un host, «N host» per più host. */
function titolo(hosts: HostPerRendiApparato[]): string {
  return hosts.length === 1 ? `Rendi apparato — ${hosts[0].ip}` : `Rendi apparato — ${hosts.length} host`;
}

export function RendiApparatoDialog({ hosts, open, onOpenChange, onCreated }: RendiApparatoProps) {
  const [archivio, setArchivio] = useState<CredenzialeArchivio[] | null>(null);
  const [completi, setCompleti] = useState<HostPerRendiApparato[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Le pagine passano un array nuovo a ogni render: si rilegge solo se cambiano gli host (per id).
  const hostsRef = useRef(hosts);
  useEffect(() => {
    hostsRef.current = hosts;
  });
  const chiaveHost = hosts.map((h) => h.id).join(",");

  // Un errore si mostra, non diventa una lista vuota (farebbe credere che non ci siano credenziali).
  const carica = useCallback(async () => {
    setLoadError(null);
    setArchivio(null);
    const r = await fetchJson<CredenzialeArchivio[]>("/api/credentials", { cache: "no-store" });
    if (!r.ok) {
      setLoadError(r.message);
      return;
    }
    // Le liste (Discovery, rete) non portano famiglia SO né credenziali validate: si legge la scheda
    // dell'host, come fa la pagina dell'oggetto, perché la proposta sia la stessa ovunque.
    const elenco = hostsRef.current;
    const incompleti = elenco.filter((h) => h.host_credentials === undefined);
    const schede = await Promise.all(incompleti.map((h) => fetchJson<HostDetail>(`/api/hosts/${h.id}`, { cache: "no-store" })));
    const perId = new Map<number, HostPerRendiApparato>();
    let nonLetti = 0;
    schede.forEach((s, i) => {
      if (s.ok) perId.set(incompleti[i].id, s.data as HostPerRendiApparato);
      else nonLetti++;
    });
    if (nonLetti > 0) toast.warning(`Scheda non letta per ${nonLetti} host: la proposta per quegli host è meno precisa`);
    setCompleti(elenco.map((h) => perId.get(h.id) ?? h));
    setArchivio(Array.isArray(r.data) ? r.data : []);
  }, []);

  // Apertura (o altri host) = archivio riletto e proposta ricalcolata (il corpo si rimonta con la chiave)
  useEffect(() => {
    if (open) void carica();
  }, [open, chiaveHost, carica]);

  const multi = hosts.length > 1;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(DIALOG_PANEL_WIDE_CLASS, multi && "sm:max-w-4xl")}>
        <DialogHeader className="shrink-0 border-b border-border/50 px-4 pt-4 pb-3">
          <DialogTitle className="text-lg">{titolo(hosts)}</DialogTitle>
          <DialogDescription className="sr-only">
            Scegli cos&apos;è, come ci si arriva e quale credenziale usare, poi crea l&apos;apparato.
          </DialogDescription>
        </DialogHeader>
        {loadError ? (
          <DialogScrollableArea className="px-4 py-3">
            <LoadError what="le credenziali" message={loadError} onRetry={() => void carica()} />
          </DialogScrollableArea>
        ) : !archivio ? (
          <DialogScrollableArea className="px-4 py-3">
            <p className="py-6 text-center text-sm text-muted-foreground">Caricamento credenziali…</p>
          </DialogScrollableArea>
        ) : (
          <CorpoRendiApparato
            key={chiaveHost}
            hosts={completi}
            archivioIniziale={archivio}
            onClose={() => onOpenChange(false)}
            onCreated={onCreated}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────── corpo ─────────────────────────────

function inizializza(hosts: HostPerRendiApparato[], archivio: CredenzialeArchivio[]) {
  const proposte = hosts.map((h) => proponiApparato(h, archivio));
  // Proposte diverse fra gli host: classificazione, piattaforma e protocollo restano da scegliere (non si indovina per tutti).
  const { comuni: base, daScegliere } = scelteComuniDaProposte(proposte);
  const uguali = !daScegliere.classificazione && !daScegliere.piattaforma && !daScegliere.protocollo;
  const ruoli = RUOLI_SERVER.filter((r) => hosts.some((h) => ruoliDaHost(h).includes(r)));
  const comuni: ScelteComuni = {
    ...base,
    variante: null,
    ruoli: !daScegliere.classificazione && base.classificazione === "server" ? [...ruoli] : [],
  };
  const righe: RigaApparato[] = hosts.map((h, i) => ({
    host: h,
    nome: proposte[i].name,
    credentialId: proposte[i].credentialId,
    snmpCredentialId: proposte[i].snmpCredentialId,
    esito: null,
    tentativi: [],
    creazione: null,
  }));
  return { comuni, righe, uguali, daScegliere, ruoliIniziali: [...ruoli] as RuoloServer[] };
}

function CorpoRendiApparato({
  hosts,
  archivioIniziale,
  onClose,
  onCreated,
}: {
  hosts: HostPerRendiApparato[];
  archivioIniziale: CredenzialeArchivio[];
  onClose: () => void;
  onCreated?: () => void;
}) {
  // Gli host e la proposta si fissano all'apertura: una lista riletta dietro la finestra non deve riscrivere le scelte.
  const [elencoHost] = useState(hosts);
  const [iniziale] = useState(() => inizializza(hosts, archivioIniziale));
  const [archivio, setArchivio] = useState(archivioIniziale);
  const [comuni, setComuni] = useState<ScelteComuni>(iniziale.comuni);
  const [righe, setRighe] = useState<RigaApparato[]>(iniziale.righe);
  // Piattaforma e protocollo: con host dalle proposte diverse restano «Scegli…» finché non li scegli tu.
  const [daScegliere, setDaScegliere] = useState({ piattaforma: iniziale.daScegliere.piattaforma, protocollo: iniziale.daScegliere.protocollo });
  const [escluse, setEscluse] = useState<EscluseHost>({});
  const [erroreEscluse, setErroreEscluse] = useState<string | null>(null);
  const [versioneEscluse, setVersioneEscluse] = useState(0);
  const [inCorso, setInCorso] = useState<ReadonlySet<number>>(new Set());
  const [ricercaAttiva, setRicercaAttiva] = useState(false);
  const [rigaViva, setRigaViva] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [erroreCreazione, setErroreCreazione] = useState<string | null>(null);
  // La ricerca gira host per host dal browser (la riga viva); «Ferma» la interrompe fra un host e l'altro:
  // la richiesta già partita il server la porta a termine e il suo esito si registra comunque.
  const fermaRicerca = useRef(false);

  const multi = elencoHost.length > 1;
  const macTutti = elencoHost.every((h) =>
    isMacOsHost({ os_info: h.os_info, inferred_os_family: h.inferred_os_family, device_manufacturer: h.device_manufacturer, model: h.model, vendor: h.vendor }),
  );
  const ammesse = variantiPer(comuni.piattaforma, comuni.classificazione);
  const profilo = profiloEffettivo(comuni);

  useEffect(() => () => { fermaRicerca.current = true; }, []);

  // Credenziali già rifiutate su ciascun host: servono a dirlo («esclusa») prima di provarle di nuovo.
  const idHost = elencoHost.map((h) => h.id).join(",");
  useEffect(() => {
    if (!(comuni.porta >= 1 && comuni.porta <= 65535)) return;
    const ac = new AbortController();
    const t = setTimeout(async () => {
      try {
        const esiti = await Promise.all(
          idHost.split(",").map(async (id) => {
            const r = await fetchJson<{ candidati: Array<{ credentialId: number; esclusa: { dal: string; errore: string } | null }> }>(
              `/api/hosts/trova-credenziale?host_id=${id}&protocollo=${comuni.protocollo}&porta=${comuni.porta}`,
              { cache: "no-store", signal: ac.signal },
            );
            return [Number(id), r] as const;
          }),
        );
        const nuove: EscluseHost = {};
        let errore: string | null = null;
        for (const [id, r] of esiti) {
          if (!r.ok) {
            errore = r.message;
            continue;
          }
          nuove[id] = {};
          for (const c of r.data.candidati) if (c.esclusa) nuove[id][c.credentialId] = c.esclusa;
        }
        setEscluse(nuove);
        setErroreEscluse(errore);
      } catch {
        /* richiesta annullata: la prossima apertura o modifica la rilegge */
      }
    }, 400);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [idHost, comuni.protocollo, comuni.porta, versioneEscluse]);

  const aggiornaRiga = useCallback((hostId: number, fn: (r: RigaApparato) => RigaApparato) => {
    setRighe((rs) => rs.map((r) => (r.host.id === hostId ? fn(r) : r)));
  }, []);

  const occupaHost = useCallback((hostId: number, si: boolean) => {
    setInCorso((s) => {
      const n = new Set(s);
      if (si) n.add(hostId);
      else n.delete(hostId);
      return n;
    });
  }, []);

  // ───── scelte comuni ─────

  /** Una scelta comune cambia: variante, ruoli, piattaforma e protocollo restano coerenti fra loro e con le credenziali. */
  function cambiaScelte(p: Partial<ScelteComuni>) {
    if (p.piattaforma !== undefined || p.protocollo !== undefined) {
      setDaScegliere((d) => ({
        piattaforma: p.piattaforma !== undefined ? false : d.piattaforma,
        // Scegliere la piattaforma può cambiare il protocollo da sola (coerceProtocolForVendor): resta da confermare a mano.
        protocollo: p.protocollo !== undefined ? false : d.protocollo,
      }));
    }
    const next: ScelteComuni = { ...comuni, ...p };
    if (p.classificazione !== undefined && p.classificazione !== comuni.classificazione) {
      next.variante = null;
      next.ruoli = p.classificazione === "server" ? (next.ruoli.length > 0 ? next.ruoli : iniziale.ruoliIniziali) : [];
      if (macTutti && (p.classificazione === "notebook" || p.classificazione === "workstation")) next.piattaforma = "apple";
    }
    if (next.piattaforma !== comuni.piattaforma) {
      next.variante = null;
      if (p.protocollo === undefined) next.protocollo = coerceProtocolForVendor(next.piattaforma, next.protocollo) as ProtocolloApparato;
    }
    if (next.protocollo !== comuni.protocollo) {
      // Protocollo nuovo: la credenziale di tipo incompatibile si azzera, la porta si ricalcola.
      const q = righe.map((r) =>
        riallineaAlProtocollo(
          {
            name: r.nome, vendor: next.piattaforma, protocol: comuni.protocollo, classification: next.classificazione,
            productProfile: null, scanTarget: null, port: 0, credentialId: r.credentialId, snmpCredentialId: r.snmpCredentialId, useForArpPoll: false,
          },
          next.protocollo,
          archivio,
          r.host,
        ),
      );
      setRighe(righe.map((r, i) => ({ ...r, credentialId: q[i].credentialId, snmpCredentialId: q[i].snmpCredentialId, esito: null, tentativi: [] })));
      if (p.porta === undefined) next.porta = q[0].port;
    }
    setComuni(next);
  }

  function alternaRuolo(r: RuoloServer) {
    cambiaScelte({ ruoli: comuni.ruoli.includes(r) ? comuni.ruoli.filter((x) => x !== r) : [...comuni.ruoli, r] });
  }

  // ───── prova e ricerca ─────

  async function provaCredenziale(hostId: number, ip: string, credentialId: string, porta: number) {
    occupaHost(hostId, true);
    const r = await fetchJson<{ success?: boolean; error?: string; trasporto?: boolean }>(`/api/credentials/${credentialId}/test`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ host: ip, port: porta }),
    });
    occupaHost(hostId, false);
    // Un errore di trasporto non è un rifiuto dell'host: si dice, e l'esito resta com'era.
    if (!r.ok) {
      toast.error(`Prova su ${ip} non eseguita: ${r.message}`);
      return;
    }
    const quando = new Date().toISOString();
    // Host che non risponde: non è un rifiuto della credenziale (e il server non l'ha registrato).
    if (r.data.trasporto && !r.data.success) {
      aggiornaRiga(hostId, (x) => ({ ...x, esito: { stato: "fermata", quando, dettaglio: r.data.error ?? "Host non raggiungibile", credentialId } }));
      return;
    }
    const esito: RigaApparato["esito"] = r.data.success
      ? { stato: "riuscita", quando, credentialId }
      : { stato: "rifiutata", quando, dettaglio: r.data.error ?? "Credenziale rifiutata", credentialId };
    aggiornaRiga(hostId, (x) => ({ ...x, esito }));
    setVersioneEscluse((v) => v + 1);
  }

  async function cercaCredenziale(ids: number[]) {
    if (ricercaAttiva || ids.length === 0) return;
    fermaRicerca.current = false;
    setRicercaAttiva(true);
    // Su Windows un account di dominio rifiutato 3 volte (su host diversi) non si riprova sugli altri host del giro.
    const rifiutiPerAccount = new Map<number, number>();
    for (let i = 0; i < ids.length; i++) {
      if (fermaRicerca.current) break;
      const riga = righe.find((r) => r.host.id === ids[i]);
      if (!riga) continue;
      setRigaViva(`Cerco la credenziale su ${riga.host.ip}${ids.length > 1 ? ` (${i + 1} di ${ids.length})` : ""}…`);
      occupaHost(riga.host.id, true);
      const r = await fetchJson<Array<{ hostId: number; trovata: { credentialId: number; nome: string } | null; tentativi: TentativoVista[] }>>(
        "/api/hosts/trova-credenziale",
        { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({
            host_ids: [riga.host.id],
            protocollo: comuni.protocollo,
            porta: comuni.porta,
            ...(comuni.protocollo === "winrm"
              ? { escludi_credenziali: [...rifiutiPerAccount].filter(([, n]) => n >= TETTO_ACCOUNT_GIRO).map(([id]) => id) }
              : {}),
          }),
        },
      );
      occupaHost(riga.host.id, false);
      if (!r.ok) {
        toast.error(`Ricerca su ${riga.host.ip} non eseguita: ${r.message}`);
        if (r.status === 401 || r.status === 403) break;
        continue;
      }
      const e = r.data[0];
      const tentativi = e?.tentativi ?? [];
      for (const t of tentativi) if (t.esito === "rifiutata") rifiutiPerAccount.set(t.credentialId, (rifiutiPerAccount.get(t.credentialId) ?? 0) + 1);
      if (e?.trovata) {
        const riuscita = [...tentativi].reverse().find((t) => t.esito === "riuscita");
        const cid = String(e.trovata.credentialId);
        aggiornaRiga(riga.host.id, (x) => ({ ...x, credentialId: cid, tentativi, esito: { stato: "riuscita", quando: riuscita?.quando ?? new Date().toISOString(), credentialId: cid } }));
      } else {
        const ferme = tentativi.filter((t) => t.esito === "fermata");
        const fermata = ferme.length > 0;
        // Con la ricerca interrotta (host spento, account già rifiutato) il dettaglio è il motivo vero, non «nessuna ha funzionato».
        const motivo = ferme.find((t) => /non raggiungibile|già rifiutato/i.test(t.motivo ?? ""))?.motivo ?? ferme[0]?.motivo ?? null;
        aggiornaRiga(riga.host.id, (x) => ({
          ...x,
          tentativi,
          esito: {
            stato: fermata ? "fermata" : "rifiutata",
            quando: new Date().toISOString(),
            dettaglio: fermata && motivo ? motivo : "Nessuna credenziale ha funzionato",
            tetto: ferme.some((t) => eMotivoTetto(t.motivo)),
            credentialId: x.credentialId,
          },
        }));
      }
      setVersioneEscluse((v) => v + 1);
    }
    setRigaViva(null);
    setRicercaAttiva(false);
  }

  /** Voce nuova: si salva nell'archivio, si sceglie e si prova. Ritorna il messaggio d'errore, o null. */
  async function creaEProva(nuova: NuovaCredenziale): Promise<string | null> {
    const corpo: Record<string, unknown> = { name: nuova.nome.trim(), credential_type: nuova.tipo, password: nuova.password };
    if (nuova.tipo !== "snmp") corpo.username = nuova.utente.trim();
    const r = await fetchJson<{ id: number; name: string; credential_type: string; port?: number | null }>("/api/credentials", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(corpo),
    });
    if (!r.ok) return r.message;
    const voce = r.data;
    setArchivio((a) => [...a, { id: voce.id, name: voce.name, credential_type: voce.credential_type, port: voce.port ?? null }]);
    toast.success(`Credenziale «${voce.name}» salvata nell'archivio`);
    const riga = righe[0];
    aggiornaRiga(riga.host.id, (x) => ({ ...x, credentialId: String(voce.id), esito: null, tentativi: [] }));
    await provaCredenziale(riga.host.id, riga.host.ip, String(voce.id), comuni.porta);
    return null;
  }

  const azioni: AzioniCredenziale = {
    onScegli: (hostId, credentialId) => {
      aggiornaRiga(hostId, (r) => ({ ...r, credentialId, esito: null, tentativi: [] }));
      // Un host: la porta segue la credenziale (quella validata sull'host, poi la sua, poi lo standard).
      if (!multi && credentialId) {
        const riga = righe.find((r) => r.host.id === hostId);
        const p = portaPerCredenziale(credentialId, comuni.protocollo, archivio, riga?.host);
        if (p !== comuni.porta) setComuni((c) => ({ ...c, porta: p }));
      }
    },
    onScegliSnmp: (hostId, credentialId) => {
      aggiornaRiga(hostId, (r) => ({ ...r, snmpCredentialId: credentialId }));
    },
    onProva: (hostId) => {
      const riga = righe.find((r) => r.host.id === hostId);
      if (riga?.credentialId) void provaCredenziale(hostId, riga.host.ip, riga.credentialId, comuni.porta);
    },
    onNome: (hostId, nome) => aggiornaRiga(hostId, (r) => ({ ...r, nome })),
    onTrova: (ids) => void cercaCredenziale(ids),
    onFermaRicerca: () => {
      fermaRicerca.current = true;
      setRigaViva("Mi fermo dopo questo host…");
    },
  };

  // ───── creazione ─────

  const daCreare = righe.filter((r) => r.creazione?.stato !== "creato");
  const senzaProva = daCreare.filter((r) => esitoVisibile(r, comuni.protocollo, escluse, archivio).stato !== "riuscita").length;
  const manca = !comuni.classificazione || daScegliere.piattaforma || daScegliere.protocollo;
  const nomiOk = daCreare.every((r) => r.nome.trim() !== "");
  const occupato = inCorso.size > 0 || ricercaAttiva || creando;

  async function rendiApparato() {
    if (manca || daCreare.length === 0) return;
    setCreando(true);
    setErroreCreazione(null);
    let creati = 0;
    let falliti = 0;
    for (const riga of daCreare) {
      const corpo = corpoCreazione(comuni, {
        nome: riga.nome,
        ip: riga.host.ip,
        credentialId: riga.credentialId,
        snmpCredentialId: riga.snmpCredentialId,
        scanTargetProposto: riga.host.inferred_scan_target,
      });
      const r = await fetchJson<NetworkDevice & { avvisi?: string[] }>("/api/devices", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(corpo) });
      if (r.ok) {
        creati++;
        for (const a of r.data.avvisi ?? []) toast.warning(a);
        aggiornaRiga(riga.host.id, (x) => ({ ...x, creazione: { stato: "creato" } }));
      } else {
        falliti++;
        aggiornaRiga(riga.host.id, (x) => ({ ...x, creazione: { stato: "errore", messaggio: r.message } }));
        if (!multi) setErroreCreazione(r.message);
      }
    }
    setCreando(false);
    if (creati > 0) onCreated?.();
    if (falliti === 0) {
      toast.success(creati === 1 ? "Apparato creato" : `${creati} apparati creati`);
      onClose();
    } else {
      toast.error(creati > 0 ? `${creati} apparati creati, ${falliti} no: guarda le righe` : multi ? "Nessun apparato creato: guarda le righe" : "Apparato non creato");
    }
  }

  // ───── interfaccia ─────

  const prima = righe[0];
  const esitoPrima: EsitoCredenziale = inCorso.has(prima.host.id) ? { stato: "in_corso" } : esitoVisibile(prima, comuni.protocollo, escluse, archivio);
  const proposta = fonteProposta(prima.host);
  const standard = portaStandard(comuni.protocollo, comuni.porta);

  const campoClassificazione = (
    <Campo etichetta="Classificazione">
      <Select value={comuni.classificazione || null} onValueChange={(v) => v && cambiaScelte({ classificazione: v })}>
        <SelectTrigger className="h-9 w-full text-sm" aria-label="Classificazione">
          <SelectValue placeholder="Scegli…" />
        </SelectTrigger>
        <SelectContent>
          {CLASSIFICAZIONI.map((c) => (
            <SelectItem key={c} value={c}>
              {getClassificationLabel(c)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Campo>
  );
  const campoPiattaforma = (
    <Campo etichetta="Piattaforma">
      <Select value={daScegliere.piattaforma ? null : comuni.piattaforma} onValueChange={(v) => v && cambiaScelte({ piattaforma: v })}>
        <SelectTrigger className="h-9 w-full text-sm" aria-label="Piattaforma">
          <SelectValue placeholder="Scegli…" />
        </SelectTrigger>
        <SelectContent>
          {PIATTAFORME.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Campo>
  );
  // Compare solo quando classificazione e piattaforma lasciano più di un modello possibile.
  const campoVariante =
    ammesse.length > 1 ? (
      <Campo etichetta="Variante">
        <Select value={profilo} onValueChange={(v) => v && cambiaScelte({ variante: v })}>
          <SelectTrigger className="h-9 w-full text-sm" aria-label="Variante">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ammesse.map((id) => (
              <SelectItem key={id} value={id}>
                {PRODUCT_PROFILE_LABELS[id]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Campo>
    ) : null;
  const campoProtocollo = (
    <Campo etichetta="Protocollo">
      <Select value={daScegliere.protocollo ? null : comuni.protocollo} onValueChange={(v) => v && cambiaScelte({ protocollo: v as ProtocolloApparato })}>
        <SelectTrigger className="h-9 w-full text-sm" aria-label="Protocollo">
          <SelectValue placeholder="Scegli…" />
        </SelectTrigger>
        <SelectContent>
          {PROTOCOLLI.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Campo>
  );
  const campoPorta = (
    <Campo etichetta="Porta">
      <Input
        className="h-9"
        type="number"
        min={1}
        max={65535}
        aria-label="Porta"
        value={comuni.porta || ""}
        onChange={(e) => cambiaScelte({ porta: Number(e.target.value) || 0 })}
      />
    </Campo>
  );
  const ruoli =
    comuni.classificazione === "server" ? (
      <fieldset className="space-y-1.5">
        <legend className="text-[13px] font-semibold text-muted-foreground">Ruoli del server</legend>
        <div className="flex flex-wrap gap-2">
          {RUOLI_SERVER.map((r) => {
            const attivo = comuni.ruoli.includes(r);
            return (
              <button
                key={r}
                type="button"
                aria-pressed={attivo}
                onClick={() => alternaRuolo(r)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md border-2 px-2.5 text-[13px] font-semibold transition-colors",
                  attivo ? "border-[#0D2537] bg-[#0D2537] text-white dark:border-[#E6EEF4] dark:bg-[#E6EEF4] dark:text-[#0D2537]" : "border-[#B8C4CC] bg-background text-foreground hover:bg-muted",
                )}
              >
                <span aria-hidden>{attivo ? "✓" : "+"}</span>
                {ETICHETTE_RUOLI[r]}
              </button>
            );
          })}
        </div>
      </fieldset>
    ) : null;

  return (
    <>
      <DialogScrollableArea className="px-4 py-3">
        <div className="space-y-5">
          {!multi && (
            <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
              <Campo etichetta="Nome">
                <Input className="h-9" aria-label="Nome" value={prima.nome} onChange={(e) => azioni.onNome(prima.host.id, e.target.value)} />
              </Campo>
              <p className="pb-2 text-[13px] text-muted-foreground">
                Proposto da:{" "}
                <b className="text-foreground">
                  {proposta.fonte}
                  {proposta.confidenza != null ? ` · ${proposta.confidenza}%` : ""}
                </b>
              </p>
            </div>
          )}

          {multi ? (
            <Sezione numero="1–2" titolo="Valgono per tutti">
              {!iniziale.uguali && (
                <p className="text-[13px] text-muted-foreground">Gli host scelti hanno proposte diverse: scegli tu classificazione, piattaforma e protocollo dove sono vuoti.</p>
              )}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {campoClassificazione}
                {campoPiattaforma}
                {campoProtocollo}
                {campoPorta}
              </div>
              {campoVariante && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{campoVariante}</div>}
              {ruoli}
              <PortaFuoriStandard standard={standard} soloFuori />
            </Sezione>
          ) : (
            <>
              <Sezione numero="1" titolo="Cos'è">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {campoClassificazione}
                  {campoPiattaforma}
                  {campoVariante}
                </div>
                {ruoli}
              </Sezione>
              <Sezione numero="2" titolo="Come ci arrivo">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-44">{campoProtocollo}</div>
                  <div className="w-28">{campoPorta}</div>
                  <PortaFuoriStandard standard={standard} />
                </div>
              </Sezione>
            </>
          )}

          <Sezione numero="3" titolo={multi ? "Credenziale, un esito per host" : "Credenziale"}>
            {erroreEscluse && (
              <p className="text-[13px] text-muted-foreground">Non riesco a leggere le credenziali già escluse ({erroreEscluse}): la ricerca le salterebbe comunque.</p>
            )}
            {multi ? (
              <RendiApparatoTabella
                righe={righe}
                archivio={archivio}
                protocollo={comuni.protocollo}
                escluse={escluse}
                azioni={azioni}
                inCorso={inCorso}
                ricercaAttiva={ricercaAttiva}
                rigaViva={rigaViva}
              />
            ) : (
              <RendiApparatoCredenziale
                riga={prima}
                archivio={archivio}
                protocollo={comuni.protocollo}
                escluse={escluse}
                esito={esitoPrima}
                azioni={azioni}
                occupato={occupato}
                rigaViva={rigaViva}
                onCreaEProva={creaEProva}
              />
            )}
          </Sezione>
        </div>
      </DialogScrollableArea>

      <DialogFooter className="mx-0 mb-0 shrink-0 items-center border-t border-border/50 px-4 py-3">
        <div className="mr-auto flex flex-wrap items-center gap-2">
          {senzaProva > 0 && (
            <BadgeAvviso>{multi ? `${senzaProva} su ${daCreare.length} senza credenziale provata` : "senza credenziale provata"}</BadgeAvviso>
          )}
          {!comuni.classificazione && <BadgeAvviso>scegli la classificazione</BadgeAvviso>}
          {daScegliere.piattaforma && <BadgeAvviso>scegli la piattaforma</BadgeAvviso>}
          {daScegliere.protocollo && <BadgeAvviso>scegli il protocollo</BadgeAvviso>}
          {erroreCreazione && <span className="text-[13px] font-semibold text-[#8E1B20] dark:text-[#E8625A]">✕ {erroreCreazione}</span>}
        </div>
        <Button type="button" variant="outline" onClick={onClose} disabled={creando}>
          Annulla
        </Button>
        <Button type="button" onClick={() => void rendiApparato()} disabled={manca || !nomiOk || occupato || daCreare.length === 0}>
          {creando ? "Creazione…" : multi ? `Rendi apparato (${daCreare.length})` : "Rendi apparato"}
        </Button>
      </DialogFooter>
    </>
  );
}

// ───────────────────────────── pezzi piccoli ─────────────────────────────

function Campo({ etichetta, children }: { etichetta: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label className="text-[13px] font-semibold text-muted-foreground">{etichetta}</Label>
      {children}
    </div>
  );
}

function Sezione({ numero, titolo, children }: { numero: string; titolo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider text-foreground">
        <span className="text-[#006C96] dark:text-[#3FBBF0]">{numero}</span>
        {titolo}
      </h3>
      {children}
    </section>
  );
}

function PortaFuoriStandard({ standard, soloFuori = false }: { standard: boolean; soloFuori?: boolean }) {
  if (standard) return soloFuori ? null : <BadgeNeutro>porta standard</BadgeNeutro>;
  return <BadgeAvviso>porta non standard</BadgeAvviso>;
}
