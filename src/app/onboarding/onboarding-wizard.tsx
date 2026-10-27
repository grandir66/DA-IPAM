"use client";

/**
 * Wizard di prima configurazione (tappa 4 credenziali, proposta approvata il 15/10).
 *
 * Prima: il router chiedeva utente, password e community in linea (binding
 * sull'apparato, fuori archivio), il passo «Credenziali» richiedeva SNMP, SSH,
 * Windows e Linux in quattro blocchi fissi e la subnet sceglieva fra quei
 * quattro; «Indietro» ignorava ciò che era già creato ed «Esci» dimenticava il
 * punto raggiunto. Ora:
 * 1. l'archivio delle credenziali per primo, con lo stesso modulo della pagina
 *    Credenziali (più voci per tipo, modifica ed eliminazione);
 * 2. il router sceglie le voci dell'archivio (regola tipo ↔ protocollo di
 *    `credentials/tipi.ts`); già creato, si modifica coi soli campi toccati
 *    (`/api/onboarding/router`, che allinea anche porta e binding);
 * 3. DNS, 4. Active Directory (la WinRM dall'archivio), 5. la prima subnet con
 *    le voci da provare in ordine.
 * Il punto raggiunto e gli oggetti creati si salvano a ogni passo
 * (`/api/onboarding/progresso`): riaprendo da Impostazioni si riparte da lì.
 *
 * Dal 24/10 (Riccardo): i passi sono schede in testa, si salta avanti e
 * indietro anche senza «Avanti»/«Indietro»; lasciando un passo i suoi dati si
 * salvano, e «Crea rete» salva comunque router, DNS e AD prima di creare la
 * rete (una scheda saltata non li perde). La rete su cui è installata
 * l'appliance (CIDR, gateway, DNS, dominio) arriva con il punto raggiunto e
 * riempie i campi vuoti; il gateway si offre per il router con un pulsante.
 * La logica non visiva sta in `src/lib/onboarding/` con le prove.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  CircleX,
  Info,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { LoadError } from "@/components/shared/load-error";
import { CredentialFormDialog, caricaStatoModifica } from "@/components/credentials/credential-form-dialog";
import { fetchJson } from "@/lib/fetch-json";
import { nomeVoceAd } from "@/lib/ad/account-ldap";
import { CRED_TYPE_OPTIONS } from "@/lib/credential-protocol-map";
import { statoNuovo, type StatoModulo, type VoceArchivio } from "@/lib/credentials/modulo";
import { PASSI_WIZARD, PASSO } from "@/lib/onboarding/passi";
import type { ProgressoWizard } from "@/lib/onboarding/progresso";
import type { ReteDelWizard, RiepilogoWizard, RouterDelWizard } from "@/lib/onboarding/progresso-store";
import { baseDnDaDominio, campiReteProposti, type ReteAppliance } from "@/lib/onboarding/rete-appliance";
import {
  etichettaPorta,
  etichettaVoce,
  idsDaProvare,
  riconciliaSceltaRete,
  spostaScelta,
  tipiDelModulo,
  vociPerProtocollo,
  vociSnmp,
  vociWindows,
  winrmPredefinita,
  type SceltaRete,
} from "@/lib/onboarding/credenziali-wizard";
import {
  ACCESSI_ROUTER,
  MARCHE_ROUTER,
  ROUTER_VUOTO,
  apparatoConStessoHost,
  corpoCreaRete,
  corpoCreaRouter,
  corpoModificaRouter,
  corpoProvaRouter,
  credenzialeValidaPer,
  erroreRete,
  erroreRouter,
  livelloV3PerNuovaVoce,
  moduloDaRouter,
  tipoPerNuovaVoce,
  usaSnmpSeparato,
  type ModuloRouter,
} from "@/lib/onboarding/corpi";

/** Tipi offerti dal modulo nel wizard: quelli che l'archivio accetta, con le etichette di tipi.ts. */
const OPZIONI_TIPO = tipiDelModulo(CRED_TYPE_OPTIONS.map((o) => o.value));

const JSON_HEADERS = { "Content-Type": "application/json" };

type Caricamento = { fase: "caricamento" } | { fase: "pronto" } | { fase: "errore"; messaggio: string };

/**
 * Con l'archivio non caricato le tendine sono vuote: andare avanti creerebbe
 * router, AD o rete senza credenziali come se l'archivio fosse vuoto
 * (revisione del 15/10). Si ferma e lo si dice.
 */
const ARCHIVIO_NON_PRONTO = "L'archivio delle credenziali non è caricato: premi «Riprova» nel riquadro rosso e poi continua.";

/** Dove va la voce creata dal modulo: solo nell'archivio, o anche scelta in una tendina. */
type Destinazione = "archivio" | "router" | "router_snmp" | "ad";

interface Finestra {
  aperta: boolean;
  stato: StatoModulo;
  destinazione: Destinazione;
}

const AD_VUOTO = {
  name: "Dominio principale",
  dc_host: "",
  domain: "",
  base_dn: "",
  username: "",
  password: "",
  use_ssl: true,
  port: 636,
};

async function putSetting(key: string, value: string): Promise<void> {
  const esito = await fetchJson<unknown>("/api/settings", {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({ key, value }),
  });
  if (!esito.ok) throw new Error(esito.message);
}

export function OnboardingWizard() {
  const [avvio, setAvvio] = useState<Caricamento>({ fase: "caricamento" });
  const [step, setStep] = useState<number>(PASSO.credenziali);
  const [busy, setBusy] = useState(false);

  // Archivio delle credenziali, condiviso da tutti i passi.
  const [voci, setVoci] = useState<VoceArchivio[]>([]);
  const [statoVoci, setStatoVoci] = useState<Caricamento>({ fase: "caricamento" });
  const [finestra, setFinestra] = useState<Finestra>({ aperta: false, stato: statoNuovo(), destinazione: "archivio" });

  // Router: `routerSalvato` è ciò che sta nel database, per mandare solo i campi toccati.
  const [routerDeviceId, setRouterDeviceId] = useState<number | null>(null);
  const [routerSalvato, setRouterSalvato] = useState<ModuloRouter | null>(null);
  const [router, setRouter] = useState<ModuloRouter>(ROUTER_VUOTO);
  const [prova, setProva] = useState<{ ok: boolean; messaggio: string } | null>(null);
  const [provando, setProvando] = useState(false);

  const [defaultDns, setDefaultDns] = useState("");
  /** Il DNS già salvato nell'hub: svuotare il campo lo cancella, invece di essere ignorato. */
  const [dnsSalvato, setDnsSalvato] = useState("");

  const [adEnabled, setAdEnabled] = useState(false);
  const [adCreata, setAdCreata] = useState<{ id: number; name: string } | null>(null);
  const [adForm, setAdForm] = useState(AD_VUOTO);
  /** undefined = non toccata: vale la proposta (la voce Windows, se è una sola). */
  const [adWinrm, setAdWinrm] = useState<number | null | undefined>(undefined);
  /** La WinRM salvata sull'integrazione già creata: cambiandola si aggiorna con «Avanti». */
  const [adWinrmSalvata, setAdWinrmSalvata] = useState<number | null>(null);

  const [netName, setNetName] = useState("LAN principale");
  // Vuoto: «192.168.1.0/24» resta solo come suggerimento grigio (tappa 1). Un
  // valore precompilato veniva salvato così com'era da chi non lo cambiava.
  const [netCidr, setNetCidr] = useState("");
  const [netGateway, setNetGateway] = useState("");
  const [netDns, setNetDns] = useState("");
  // Rete già creata: un nuovo tentativo dopo un completamento fallito, o una
  // riapertura, non la ricrea (sarebbe rifiutata per sovrapposizione).
  const [reteCreata, setReteCreata] = useState<ReteDelWizard | null>(null);
  /** null = non ancora toccata: tutte le voci, spuntate, nell'ordine predefinito. */
  const [sceltaRete, setSceltaRete] = useState<SceltaRete[] | null>(null);
  /** La rete su cui è installata l'appliance: proposta, non scritta finché non si crea la rete. */
  const [reteAppliance, setReteAppliance] = useState<ReteAppliance | null>(null);

  const caricaVoci = useCallback(async (mostraCaricamento: boolean) => {
    if (mostraCaricamento) setStatoVoci({ fase: "caricamento" });
    // no-store: la GET delle credenziali ha una cache di 60 s, e dopo una
    // modifica o un'eliminazione l'elenco tornerebbe com'era.
    const esito = await fetchJson<VoceArchivio[]>("/api/credentials", { cache: "no-store" });
    if (esito.ok) {
      setVoci(esito.data);
      setStatoVoci({ fase: "pronto" });
    } else {
      setStatoVoci({ fase: "errore", messaggio: esito.message });
    }
  }, []);

  const caricaAvvio = useCallback(async (mostraCaricamento: boolean) => {
    if (mostraCaricamento) setAvvio({ fase: "caricamento" });
    const esito = await fetchJson<RiepilogoWizard>("/api/onboarding/progresso", { cache: "no-store" });
    if (!esito.ok) {
      setAvvio({ fase: "errore", messaggio: esito.message });
      return;
    }
    const r = esito.data;
    if (r.avviso) toast.warning(r.avviso, { duration: 12000 });
    if (r.router) {
      const m = moduloDaRouter(r.router);
      setRouter(m);
      setRouterSalvato(m);
      setRouterDeviceId(r.router.id);
    }
    if (r.rete) {
      setReteCreata(r.rete);
      setNetName(r.rete.name);
      setNetCidr(r.rete.cidr);
      setNetGateway(r.rete.gateway ?? "");
      setNetDns(r.rete.dns_server ?? "");
    }
    if (r.ad) {
      setAdCreata({ id: r.ad.id, name: r.ad.name });
      setAdEnabled(true);
      setAdWinrm(r.ad.winrm_credential_id);
      setAdWinrmSalvata(r.ad.winrm_credential_id);
    }
    if (r.dns_predefinito) {
      setDefaultDns(r.dns_predefinito);
      setDnsSalvato(r.dns_predefinito);
    }
    // La rete dell'appliance riempie solo ciò che è ancora vuoto: una rete già
    // creata o un DNS già salvato restano come sono.
    const proposta = r.rete_appliance ?? null;
    setReteAppliance(proposta);
    if (proposta) {
      const campi = campiReteProposti(proposta);
      if (!r.rete) {
        setNetCidr(campi.cidr);
        setNetGateway(campi.gateway);
      }
      if (!r.dns_predefinito && campi.dns) setDefaultDns(campi.dns);
      if (!r.ad && proposta.dominio) {
        const dominio = proposta.dominio;
        setAdForm((f) => ({ ...f, domain: f.domain || dominio, base_dn: f.base_dn || baseDnDaDominio(dominio) }));
      }
    }
    if (r.progresso) setStep(r.progresso.passo);
    setAvvio({ fase: "pronto" });
  }, []);

  useEffect(() => {
    void caricaVoci(false);
    void caricaAvvio(false);
  }, [caricaVoci, caricaAvvio]);

  // A 390 px le schede scorrono: quella del passo aperto resta in vista.
  const schede = useRef<HTMLDivElement>(null);
  useEffect(() => {
    schede.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [step, avvio.fase]);

  /** Il punto da salvare, con gli oggetti creati finora (sovrascrivibili da chi li ha appena creati). */
  const punto = (passo: number, oggetti: Partial<ProgressoWizard> = {}): ProgressoWizard => ({
    passo,
    router_device_id: routerDeviceId,
    network_id: reteCreata?.id ?? null,
    ad_integration_id: adCreata?.id ?? null,
    ...oggetti,
  });

  const salvaPunto = async (p: ProgressoWizard): Promise<boolean> => {
    const esito = await fetchJson<unknown>("/api/onboarding/progresso", {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify(p),
    });
    if (!esito.ok) {
      toast.error(`Punto raggiunto non salvato: ${esito.message}. Riaprendo il wizard si ripartirebbe da un passo precedente.`);
    }
    return esito.ok;
  };

  // ---------- archivio ----------

  const apriNuova = (destinazione: Destinazione, tipo?: string, livelloV3: "" | "authPriv" = "") => {
    const stato = statoNuovo(tipo);
    stato.form.security_level = livelloV3;
    setFinestra({ aperta: true, stato, destinazione });
  };

  const apriModifica = async (v: VoceArchivio) => {
    const stato = await caricaStatoModifica(v);
    setFinestra({ aperta: true, stato, destinazione: "archivio" });
  };

  const aggiornaRouter = (campi: Partial<ModuloRouter>) => {
    setRouter((r) => {
      const n = { ...r, ...campi };
      // Cambiando accesso, una voce che non vale più si toglie invece di restare nascosta
      // (solo ad archivio caricato: prima di allora ogni voce sembrerebbe non valere).
      if (campi.protocol !== undefined && statoVoci.fase === "pronto" && !credenzialeValidaPer(n.credentialId, voci, n.protocol)) {
        n.credentialId = null;
      }
      return n;
    });
    setProva(null);
  };

  const voceSalvata = (voce: VoceArchivio) => {
    setVoci((prev) => [...prev.filter((x) => x.id !== voce.id), voce]);
    void caricaVoci(false);
    if (finestra.stato.editingId != null) return;
    const nuova = [voce];
    if (finestra.destinazione === "router") {
      if (credenzialeValidaPer(voce.id, nuova, router.protocol)) aggiornaRouter({ credentialId: voce.id });
      else toast.warning(`«${voce.name}» è nell'archivio, ma non vale per l'accesso scelto: non è stata selezionata`);
    } else if (finestra.destinazione === "router_snmp") {
      if (vociSnmp(nuova).length) aggiornaRouter({ snmpCredentialId: voce.id });
      else toast.warning(`«${voce.name}» è nell'archivio, ma non è SNMP: non è stata selezionata`);
    } else if (finestra.destinazione === "ad") {
      if (vociWindows(nuova).length) setAdWinrm(voce.id);
      else toast.warning(`«${voce.name}» è nell'archivio, ma non è Windows: non è stata selezionata`);
    }
  };

  const eliminaVoce = async (v: VoceArchivio) => {
    if (!confirm(`Eliminare la credenziale «${v.name}» dall'archivio?`)) return;
    const esito = await fetchJson<unknown>(`/api/credentials/${v.id}`, { method: "DELETE" });
    if (!esito.ok) {
      toast.error(`Credenziale non eliminata: ${esito.message}`);
      return;
    }
    toast.success("Credenziale eliminata");
    setVoci((prev) => prev.filter((x) => x.id !== v.id));
    void caricaVoci(false);
  };

  // ---------- router ----------

  /**
   * Router già registrato: colonne, porta e binding insieme. Il PUT
   * dell'apparato scriveva solo le colonne, e il sistema continuava con la
   * voce e la porta di prima mentre qui si leggeva «aggiornato» (revisione).
   */
  const modificaRouter = async (id: number, salvato: ModuloRouter, messaggio: string, avvisaSempre = false): Promise<number> => {
    const corpo = corpoModificaRouter(salvato, router);
    const daSalvare = Object.keys(corpo).length > 0;
    if (daSalvare) {
      const esito = await fetchJson<RouterDelWizard>("/api/onboarding/router", {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ device_id: id, ...corpo }),
      });
      if (!esito.ok) throw new Error(`Router non aggiornato: ${esito.message}`);
      salvato = moduloDaRouter(esito.data);
    }
    if (daSalvare || avvisaSempre) toast.success(messaggio);
    setRouterDeviceId(id);
    setRouterSalvato(salvato);
    return id;
  };

  const salvaRouter = async (): Promise<number | null> => {
    if (router.host.trim() && statoVoci.fase !== "pronto") throw new Error(ARCHIVIO_NON_PRONTO);
    const errore = erroreRouter(router, routerDeviceId != null, voci);
    if (errore) throw new Error(errore);
    if (!router.host.trim()) return null; // passo saltato
    if (routerDeviceId == null) {
      // Il wizard sa del router solo dal punto salvato: se manca (vecchio wizard,
      // punto non salvato) un apparato con lo stesso indirizzo c'è già e non se
      // ne crea un secondo.
      const elenco = await fetchJson<RouterDelWizard[]>("/api/devices", { cache: "no-store" });
      if (!elenco.ok) throw new Error(`Impossibile controllare se il router è già registrato: ${elenco.message}`);
      const esistente = apparatoConStessoHost(elenco.data, router.host);
      if (esistente) {
        const usa = confirm(
          `L'indirizzo ${esistente.host} è già registrato come «${esistente.name}». Usarlo come router del wizard, con le credenziali scelte qui, invece di crearne un secondo?`,
        );
        if (!usa) {
          throw new Error(`Router non registrato: ${esistente.host} è già «${esistente.name}». Cambia l'indirizzo, oppure scegli di usare quello.`);
        }
        return modificaRouter(esistente.id, moduloDaRouter(esistente), `«${esistente.name}» è ora il router del wizard.`, true);
      }
      const esito = await fetchJson<{ id: number }>("/api/devices", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(corpoCreaRouter(router)),
      });
      if (!esito.ok) throw new Error(`Router non registrato: ${esito.message}`);
      setRouterDeviceId(esito.data.id);
      setRouterSalvato(router);
      toast.success("Router registrato.");
      return esito.data.id;
    }
    return modificaRouter(routerDeviceId, routerSalvato ?? router, "Router aggiornato: credenziali e porta comprese.");
  };

  const provaConnessione = async () => {
    setProvando(true);
    setProva(null);
    try {
      const esito = await fetchJson<{ success: boolean; message?: string; error?: string }>("/api/devices/test-provisional", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(corpoProvaRouter(router, voci)),
      });
      if (!esito.ok) {
        setProva({ ok: false, messaggio: esito.message });
      } else if (esito.data.success) {
        setProva({ ok: true, messaggio: esito.data.message || "Connessione riuscita" });
      } else {
        setProva({ ok: false, messaggio: esito.data.error || "Connessione non riuscita" });
      }
    } finally {
      setProvando(false);
    }
  };

  // ---------- Active Directory ----------

  const winrmScelta = adWinrm === undefined ? winrmPredefinita(voci) : adWinrm;
  const winrmValida = winrmScelta != null && vociWindows(voci).some((v) => v.id === winrmScelta) ? winrmScelta : null;

  const salvaAd = async (): Promise<number | null> => {
    if (adCreata) {
      // L'account si cambia dalla pagina Active Directory; la WinRM collegata
      // viene dall'archivio e si cambia anche da qui.
      if (adWinrm !== undefined && adWinrm !== adWinrmSalvata) {
        if (statoVoci.fase !== "pronto") throw new Error(ARCHIVIO_NON_PRONTO);
        const esito = await fetchJson<unknown>(`/api/ad/${adCreata.id}`, {
          method: "PUT",
          headers: JSON_HEADERS,
          body: JSON.stringify({ winrm_credential_id: winrmValida }),
        });
        if (!esito.ok) throw new Error(`Credenziale WinRM non aggiornata: ${esito.message}`);
        setAdWinrm(winrmValida);
        setAdWinrmSalvata(winrmValida);
        toast.success("Credenziale WinRM dell'integrazione aggiornata.");
      }
      return adCreata.id;
    }
    if (!adEnabled) return null;
    if (statoVoci.fase !== "pronto") throw new Error(ARCHIVIO_NON_PRONTO);
    // L'account scritto qui diventa la voce «AD · <nome>» dell'archivio (tappa
    // 2f, T24): la crea il server nella stessa transazione dell'integrazione,
    // così una voce non resta orfana se l'integrazione non si crea.
    if (!adForm.dc_host.trim() || !adForm.domain.trim() || !adForm.base_dn.trim() || !adForm.username.trim() || !adForm.password) {
      throw new Error("Compila tutti i campi obbligatori per Active Directory.");
    }
    const esito = await fetchJson<{ id: number; name: string }>("/api/ad", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        name: adForm.name.trim() || "Active Directory",
        dc_host: adForm.dc_host.trim(),
        domain: adForm.domain.trim(),
        base_dn: adForm.base_dn.trim(),
        username: adForm.username.trim(),
        password: adForm.password,
        use_ssl: adForm.use_ssl,
        port: adForm.port,
        enabled: true,
        winrm_credential_id: winrmValida,
      }),
    });
    if (!esito.ok) throw new Error(`Integrazione Active Directory non creata: ${esito.message}`);
    setAdCreata({ id: esito.data.id, name: esito.data.name });
    toast.success("Integrazione Active Directory creata. I lease DHCP Microsoft saranno disponibili dopo la sincronizzazione dalla pagina Active Directory.");
    return esito.data.id;
  };

  // ---------- navigazione ----------

  /** Salva ciò che il passo crea o modifica; restituisce gli id per il punto raggiunto. */
  const salvaPasso = async (p: number): Promise<Pick<ProgressoWizard, "router_device_id" | "ad_integration_id">> => {
    let idRouter = routerDeviceId;
    let idAd = adCreata?.id ?? null;
    if (p === PASSO.router) idRouter = await salvaRouter();
    if (p === PASSO.dns) await salvaDns();
    if (p === PASSO.ad) idAd = await salvaAd();
    return { router_device_id: idRouter, ad_integration_id: idAd };
  };

  /**
   * Cambio di passo, da «Avanti»/«Indietro» o da una scheda. Lasciando un passo
   * se ne salvano i dati: andando avanti un errore ferma (come prima), andando
   * indietro si va comunque e lo si dice, perché i dati restano nel modulo.
   * Si attende il salvataggio del punto: un altro clic subito dopo non deve superarlo.
   */
  const vaiA = async (destinazione: number) => {
    if (destinazione === step || destinazione < 0 || destinazione >= PASSI_WIZARD.length) return;
    setBusy(true);
    try {
      let oggetti: Partial<ProgressoWizard> = {};
      try {
        oggetti = await salvaPasso(step);
      } catch (e) {
        if (destinazione > step) throw e;
        const messaggio = e instanceof Error ? e.message : "Errore";
        toast.warning(`${messaggio}. I dati restano nel modulo e si salvano quando torni su «${PASSI_WIZARD[step].breve}» e vai avanti.`);
      }
      await salvaPunto(punto(destinazione, oggetti));
      setStep(destinazione);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    } finally {
      setBusy(false);
    }
  };

  const goNext = () => vaiA(Math.min(step + 1, PASSI_WIZARD.length - 1));

  /**
   * Svuotare un DNS già salvato lo cancella: prima il campo vuoto si saltava e
   * il valore vecchio ricompariva alla riapertura (revisione del 15/10).
   */
  const salvaDns = async () => {
    const dns = defaultDns.trim();
    if (dns === dnsSalvato) return;
    await putSetting("default_network_dns", dns);
    setDnsSalvato(dns);
  };

  const goBack = () => vaiA(Math.max(0, step - 1));

  /** «Esci» e «Salta creazione rete»: il wizard risulta completato, ma il punto resta per la riapertura. */
  const esci = async () => {
    setBusy(true);
    try {
      const salvato = await salvaPunto(punto(step));
      if (!salvato && !confirm("Il punto raggiunto non è stato salvato: riaprendo il wizard si ripartirà da un passo precedente. Uscire comunque?")) {
        return;
      }
      // fetch non lancia su HTTP 4xx/5xx: senza questo controllo l'app rimanderebbe
      // al wizard senza dire perché.
      const fine = await fetchJson<unknown>("/api/onboarding/complete", { method: "POST" });
      if (!fine.ok) throw new Error(`Completamento della configurazione non riuscito: ${fine.message}`);
      window.location.assign("/");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    } finally {
      setBusy(false);
    }
  };

  const listaRete = riconciliaSceltaRete(sceltaRete, voci);

  const onSubmitLast = async () => {
    setBusy(true);
    try {
      // Con le schede si arriva qui anche senza essere passati da router, DNS e
      // AD con «Avanti»: si salvano ora (senza modifiche non fanno niente).
      // L'id del router si usa da qui, non dallo stato, che si aggiorna dopo.
      const idRouter = await salvaRouter();
      await salvaDns();
      const idAd = await salvaAd();
      await salvaPunto(punto(PASSO.subnet, { router_device_id: idRouter, ad_integration_id: idAd }));
      let rete = reteCreata;
      let appenaCreata = false;
      if (!rete) {
        if (statoVoci.fase !== "pronto") throw new Error(ARCHIVIO_NON_PRONTO);
        const errore = erroreRete({ name: netName, cidr: netCidr });
        if (errore) throw new Error(errore);
        const esito = await fetchJson<ReteDelWizard>("/api/networks", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify(
            corpoCreaRete({
              name: netName,
              cidr: netCidr,
              gateway: netGateway,
              dns: netDns,
              dnsPredefinito: defaultDns,
              routerId: idRouter,
              credentialIds: idsDaProvare(listaRete),
            }),
          ),
        });
        if (!esito.ok) throw new Error(`Rete non creata: ${esito.message}`);
        rete = {
          id: esito.data.id,
          name: esito.data.name,
          cidr: esito.data.cidr,
          gateway: esito.data.gateway ?? null,
          dns_server: esito.data.dns_server ?? null,
          router_id: idRouter,
        };
        setReteCreata(rete);
        appenaCreata = true;
        toast.success("Rete creata.");
        await salvaPunto(punto(PASSO.subnet, { network_id: rete.id, router_device_id: idRouter, ad_integration_id: idAd }));
      } else if (idRouter != null && rete.router_id == null) {
        // Rete creata a un giro precedente, router registrato dopo: il
        // collegamento si faceva solo alla creazione della rete (revisione).
        const collega = await fetchJson<unknown>(`/api/networks/${rete.id}`, {
          method: "PUT",
          headers: JSON_HEADERS,
          body: JSON.stringify({ router_id: idRouter }),
        });
        if (!collega.ok) throw new Error(`Router non collegato alla rete: ${collega.message}`);
        rete = { ...rete, router_id: idRouter };
        setReteCreata(rete);
        toast.success("Router collegato alla rete.");
      }
      const fine = await fetchJson<unknown>("/api/onboarding/complete", { method: "POST" });
      if (!fine.ok) {
        throw new Error(
          appenaCreata
            ? `Rete creata, ma il completamento della configurazione non è riuscito: ${fine.message}`
            : `Completamento della configurazione non riuscito: ${fine.message}`,
        );
      }
      window.location.assign(`/networks/${rete.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    } finally {
      setBusy(false);
    }
  };

  const ultimo = step === PASSI_WIZARD.length - 1;
  const passo = PASSI_WIZARD[step];

  /** Il segno di spunta sulle schede: ciò che è già salvato, non ciò che si è visitato. */
  const passoCompleto: Record<number, boolean> = {
    [PASSO.credenziali]: statoVoci.fase === "pronto" && voci.length > 0,
    [PASSO.router]: routerDeviceId != null,
    [PASSO.dns]: dnsSalvato !== "",
    [PASSO.ad]: adCreata != null,
    [PASSO.subnet]: reteCreata != null,
  };

  const campiAppliance = reteAppliance ? campiReteProposti(reteAppliance) : null;
  /** La subnet scritta è diversa da quella dell'appliance: si offre di rimetterla. */
  const reteDiversaDallAppliance =
    campiAppliance != null &&
    (netCidr.trim() !== campiAppliance.cidr || netGateway.trim() !== campiAppliance.gateway || (netDns || defaultDns).trim() !== campiAppliance.dns);

  const usaReteAppliance = () => {
    if (!campiAppliance) return;
    setNetCidr(campiAppliance.cidr);
    setNetGateway(campiAppliance.gateway);
    setNetDns(campiAppliance.dns);
  };

  /** Rete già creata: cosa farà «Completa», compreso il router da collegare (revisione del 15/10). */
  const notaReteCreata = (rete: ReteDelWizard): string => {
    const base = `Rete già creata: «${rete.name}» (${rete.cidr}).`;
    if (routerDeviceId != null && rete.router_id == null) {
      return `${base} «Completa e apri la rete» collega alla rete il router «${router.name.trim() || "Router"}» (${router.host.trim()}) e chiude la configurazione; le credenziali della rete si cambiano dalla sua pagina.`;
    }
    if (rete.router_id != null && rete.router_id !== routerDeviceId) {
      return `${base} Ha già un altro router collegato: router e credenziali della rete si cambiano dalla sua pagina. «Completa e apri la rete» chiude la configurazione.`;
    }
    return `${base} «Completa e apri la rete» chiude la configurazione; le credenziali della rete si cambiano dalla sua pagina.`;
  };

  /** La WinRM dell'integrazione AD, scelta fra le voci Windows: per l'integrazione nuova e per quella già creata. */
  const tendinaWinrm = (
    <>
      <TendinaVoci
        id="adwinrm"
        label="Credenziale WinRM collegata"
        stato={statoVoci}
        voci={vociWindows(voci)}
        valore={winrmValida}
        nessuna="Nessuna"
        nota="Una voce Windows dell'archivio, per i comandi WinRM verso i controller di dominio."
        onCambia={(id) => setAdWinrm(id)}
        onNuova={() => apriNuova("ad", "windows")}
        disabled={busy}
      />
      <ErroreArchivio stato={statoVoci} onRiprova={() => void caricaVoci(true)} />
    </>
  );

  return (
    <Card className="w-full max-w-2xl border-border/80 shadow-lg">
      <CardHeader className="text-center space-y-3 pb-2">
        <div className="flex justify-center rounded-md bg-[#0D2537] px-6 py-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- logo statico, come prima */}
          <img src="/logo-white.png" alt="DA-IPAM" className="h-12 w-auto max-w-[260px] object-contain" />
        </div>
        <CardTitle className="text-xl">Configurazione iniziale</CardTitle>
        <CardDescription>
          Passo {step + 1} di {PASSI_WIZARD.length}: {passo.titolo}
        </CardDescription>
        <p className="text-[13px] text-muted-foreground">{passo.descrizione}</p>
        {/* Schede dei passi (24/10): si salta a qualunque passo, avanti e indietro. */}
        <div ref={schede} role="tablist" aria-label="Passi della configurazione" className="-mx-1 flex gap-1 overflow-x-auto border-b px-1 pt-1">
          {PASSI_WIZARD.map((p, i) => {
            const attiva = i === step;
            const completo = passoCompleto[i];
            return (
              <button
                key={p.titolo}
                type="button"
                role="tab"
                aria-selected={attiva}
                aria-label={`Passo ${i + 1}: ${p.titolo}${completo ? " (fatto)" : ""}`}
                onClick={() => void vaiA(i)}
                disabled={busy || avvio.fase !== "pronto"}
                className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-2 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  attiva ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <span
                  aria-hidden
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] tabular-nums ${
                    completo ? "bg-primary text-primary-foreground" : attiva ? "border border-primary text-primary" : "border border-muted-foreground/40"
                  }`}
                >
                  {completo ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                {p.breve}
              </button>
            );
          })}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {avvio.fase === "caricamento" ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Caricamento della configurazione…
          </p>
        ) : avvio.fase === "errore" ? (
          <LoadError what="il punto raggiunto nel wizard" message={avvio.messaggio} onRetry={() => void caricaAvvio(true)} />
        ) : (
          <>
            {step === PASSO.credenziali && (
              <div className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  Le credenziali stanno in un archivio unico: router, Active Directory e prima subnet le scelgono da qui, senza
                  chiederle di nuovo. Puoi inserirne più di una per tipo, oppure andare avanti anche con l&apos;archivio vuoto.
                </p>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {statoVoci.fase === "pronto" ? `${voci.length} ${voci.length === 1 ? "voce" : "voci"} nell'archivio` : "Archivio"}
                  </span>
                  <Button type="button" size="sm" onClick={() => apriNuova("archivio")} disabled={busy}>
                    <Plus className="h-4 w-4" />
                    Aggiungi
                  </Button>
                </div>
                <ArchivioVoci
                  stato={statoVoci}
                  voci={voci}
                  onModifica={(v) => void apriModifica(v)}
                  onElimina={(v) => void eliminaVoce(v)}
                  onRiprova={() => void caricaVoci(true)}
                />
              </div>
            )}

            {step === PASSO.router && (
              <div className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  Il router serve per la cache ARP e, se la marca è supportata, per importare i lease DHCP. Sarà collegato alla
                  subnet all&apos;ultimo passo. Lascia vuoto l&apos;IP per saltare.
                </p>
                {routerDeviceId != null && (
                  <Nota>Router già registrato: le modifiche, credenziali e porta comprese, si salvano con «Avanti».</Nota>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="rname">Nome</Label>
                    <Input id="rname" value={router.name} onChange={(e) => aggiornaRouter({ name: e.target.value })} placeholder="Router principale" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rhost">IP o hostname</Label>
                    <Input
                      id="rhost"
                      value={router.host}
                      onChange={(e) => aggiornaRouter({ host: e.target.value })}
                      placeholder="192.168.1.1 — vuoto per saltare"
                    />
                  </div>
                </div>
                {!router.host.trim() && reteAppliance?.gateway ? (
                  <Nota>
                    Il gateway della rete dell&apos;appliance è <span className="font-mono">{reteAppliance.gateway}</span>: di solito è il
                    router.{" "}
                    <Button
                      type="button"
                      variant="link"
                      size="xs"
                      className="h-auto p-0 text-[13px]"
                      onClick={() => aggiornaRouter({ host: reteAppliance.gateway ?? "" })}
                    >
                      Usalo come router
                    </Button>
                  </Nota>
                ) : null}
                {router.host.trim() ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Marca</Label>
                        <Select value={router.vendor} onValueChange={(v) => v && aggiornaRouter({ vendor: String(v) })}>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {MARCHE_ROUTER.map((m) => (
                              <SelectItem key={m.value} value={m.value}>
                                {m.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Accesso</Label>
                        <Select value={router.protocol} onValueChange={(v) => v && aggiornaRouter({ protocol: String(v) })}>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ACCESSI_ROUTER.map((a) => (
                              <SelectItem key={a.value} value={a.value}>
                                {a.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <TendinaVoci
                      id="rcred"
                      label="Credenziale"
                      stato={statoVoci}
                      voci={vociPerProtocollo(voci, router.protocol)}
                      valore={credenzialeValidaPer(router.credentialId, voci, router.protocol) ? router.credentialId : null}
                      segnaposto="Scegli una voce dell'archivio"
                      vuota="Nessuna voce adatta a questo accesso nell'archivio: creane una."
                      onCambia={(id) => aggiornaRouter({ credentialId: id })}
                      onNuova={() => apriNuova("router", tipoPerNuovaVoce(router.protocol), livelloV3PerNuovaVoce(router.protocol))}
                      disabled={busy}
                    />
                    {usaSnmpSeparato(router.protocol) && (
                      <TendinaVoci
                        id="rsnmp"
                        label="SNMP per porte/LLDP"
                        stato={statoVoci}
                        voci={vociSnmp(voci)}
                        valore={router.snmpCredentialId != null && vociSnmp(voci).some((v) => v.id === router.snmpCredentialId) ? router.snmpCredentialId : null}
                        nessuna="Nessuna"
                        nota="Serve per porte, LLDP/CDP, spanning tree e dati della marca via SNMP."
                        onCambia={(id) => aggiornaRouter({ snmpCredentialId: id })}
                        onNuova={() => apriNuova("router_snmp", "snmp")}
                        disabled={busy}
                      />
                    )}
                    <ErroreArchivio stato={statoVoci} onRiprova={() => void caricaVoci(true)} />
                    <div className="space-y-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void provaConnessione()}
                        disabled={provando || busy || !credenzialeValidaPer(router.credentialId, voci, router.protocol)}
                      >
                        {provando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Prova connessione
                      </Button>
                      {prova && <EsitoProva ok={prova.ok} messaggio={prova.messaggio} />}
                    </div>
                  </>
                ) : null}
              </div>
            )}

            {step === PASSO.dns && (
              <div className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  DNS usato per le query dalla subnet (risoluzione forward/reverse durante le scansioni). Sarà proposto come
                  predefinito per la prima rete.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="dns">Server DNS (solo IP)</Label>
                  <Input id="dns" value={defaultDns} onChange={(e) => setDefaultDns(e.target.value)} placeholder="es. 192.168.1.1 o DNS interno" />
                </div>
                {reteAppliance && reteAppliance.dns.length > 0 ? (
                  <p className="text-[13px] text-muted-foreground">
                    DNS usati dall&apos;appliance: <span className="font-mono">{reteAppliance.dns.join(", ")}</span>
                    {!dnsSalvato && defaultDns.trim() === reteAppliance.dns[0] ? " (proposto qui sopra)." : "."}
                  </p>
                ) : null}
              </div>
            )}

            {step === PASSO.ad && (
              <div className="space-y-3 text-sm">
                {adCreata ? (
                  <>
                    <Nota>
                      Dominio già collegato: «{adCreata.name}». L&apos;account si cambia dalla pagina Active Directory; la
                      credenziale WinRM qui sotto si salva con «Avanti».
                    </Nota>
                    {tendinaWinrm}
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <Checkbox id="aden" checked={adEnabled} onCheckedChange={(c) => setAdEnabled(!!c)} />
                      <Label htmlFor="aden">Collega un dominio Active Directory</Label>
                    </div>
                    {adEnabled ? (
                      <div className="space-y-2">
                        <Input placeholder="Nome integrazione" value={adForm.name} onChange={(e) => setAdForm((f) => ({ ...f, name: e.target.value }))} />
                        <Input placeholder="Host DC (es. dc.corp.local)" value={adForm.dc_host} onChange={(e) => setAdForm((f) => ({ ...f, dc_host: e.target.value }))} />
                        <Input placeholder="Dominio (es. corp.local)" value={adForm.domain} onChange={(e) => setAdForm((f) => ({ ...f, domain: e.target.value }))} />
                        <Input placeholder="Base DN (es. DC=corp,DC=local)" value={adForm.base_dn} onChange={(e) => setAdForm((f) => ({ ...f, base_dn: e.target.value }))} />
                        <Input placeholder="Utente LDAP" value={adForm.username} onChange={(e) => setAdForm((f) => ({ ...f, username: e.target.value }))} />
                        <Input
                          type="password"
                          placeholder="Password"
                          value={adForm.password}
                          onChange={(e) => setAdForm((f) => ({ ...f, password: e.target.value }))}
                        />
                        <p className="text-[13px] text-muted-foreground">
                          L&apos;account si salva nell&apos;archivio come «{nomeVoceAd(adForm.name.trim() || "Active Directory")}».
                        </p>
                        <div className="flex items-center gap-2">
                          <Checkbox id="adssl" checked={adForm.use_ssl} onCheckedChange={(c) => setAdForm((f) => ({ ...f, use_ssl: !!c, port: c ? 636 : 389 }))} />
                          <Label htmlFor="adssl">LDAPS (consigliato)</Label>
                        </div>
                        {tendinaWinrm}
                        <p className="text-[13px] text-muted-foreground">
                          Dopo la configurazione, dalla pagina Active Directory potrai sincronizzare computer, utenti e — se usi DHCP
                          Microsoft — anche i lease.
                        </p>
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-[13px]">Puoi aggiungere Active Directory in seguito dal menu dedicato.</p>
                    )}
                  </>
                )}
              </div>
            )}

            {step === PASSO.subnet && (
              <div className="space-y-3 text-sm">
                {reteCreata ? (
                  <Nota>{notaReteCreata(reteCreata)}</Nota>
                ) : (
                  <>
                    <p className="text-muted-foreground">
                      Crea la prima subnet da analizzare con il router, il DNS e le credenziali già impostati. Potrai avviare le
                      scansioni dalla scheda della rete.
                    </p>
                    {reteAppliance ? (
                      <Nota>
                        Proposta la rete su cui è installata l&apos;appliance: <span className="font-mono">{reteAppliance.cidr}</span>{" "}
                        (interfaccia {reteAppliance.interfaccia}, IP <span className="font-mono">{reteAppliance.ip}</span>
                        {reteAppliance.gateway ? <>, gateway <span className="font-mono">{reteAppliance.gateway}</span></> : null}). Controlla
                        i campi prima di creare la rete.
                        {reteDiversaDallAppliance ? (
                          <>
                            {" "}
                            <Button type="button" variant="link" size="xs" className="h-auto p-0 text-[13px]" onClick={usaReteAppliance}>
                              <RotateCcw className="h-3 w-3" />
                              Rimetti i dati dell&apos;appliance
                            </Button>
                          </>
                        ) : null}
                      </Nota>
                    ) : null}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="nname">Nome</Label>
                        <Input id="nname" value={netName} onChange={(e) => setNetName(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="ncidr">CIDR</Label>
                        <Input id="ncidr" value={netCidr} onChange={(e) => setNetCidr(e.target.value)} placeholder="192.168.1.0/24" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="ngw">Gateway (opz.)</Label>
                        <Input id="ngw" value={netGateway} onChange={(e) => setNetGateway(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="ndns">DNS per questa subnet</Label>
                        <Input
                          id="ndns"
                          value={netDns || defaultDns}
                          onChange={(e) => setNetDns(e.target.value)}
                          placeholder={defaultDns || "es. 192.168.1.1"}
                        />
                      </div>
                    </div>
                    <p className="text-[13px] text-muted-foreground">
                      {routerDeviceId != null
                        ? `Router collegato: «${router.name.trim() || "Router"}» (${router.host.trim()}).`
                        : "Nessun router: potrai collegarlo modificando la rete."}
                    </p>
                    <VociDellaRete
                      lista={listaRete}
                      voci={voci}
                      stato={statoVoci}
                      onCambia={setSceltaRete}
                      onRiprova={() => void caricaVoci(true)}
                    />
                  </>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2 pt-2">
              {!ultimo ? (
                <div className="flex gap-2 justify-between">
                  <Button type="button" variant="outline" size="sm" onClick={() => void goBack()} disabled={step === 0 || busy}>
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Indietro
                  </Button>
                  <Button type="button" size="sm" onClick={() => void goNext()} disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Avanti
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    onClick={() => void onSubmitLast()}
                    disabled={busy || (!reteCreata && statoVoci.fase !== "pronto")}
                    className="w-full"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    {reteCreata ? "Completa e apri la rete" : "Crea rete e apri analisi"}
                  </Button>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row">
                    <Button type="button" variant="outline" onClick={() => void goBack()} disabled={busy}>
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Indietro
                    </Button>
                    <Button type="button" variant="secondary" className="h-auto min-h-8 whitespace-normal py-1.5 sm:flex-1" onClick={() => void esci()} disabled={busy}>
                      {reteCreata ? "Vai alla dashboard" : "Salta creazione rete e vai alla dashboard"}
                    </Button>
                  </div>
                </div>
              )}
              <Button
                type="button"
                variant="ghost"
                className="h-auto min-h-8 whitespace-normal py-1.5 text-[13px] text-muted-foreground"
                onClick={() => void esci()}
                disabled={busy}
              >
                Esci dalla configurazione guidata (riprendi più tardi da Impostazioni)
              </Button>
            </div>
          </>
        )}
      </CardContent>
      <CredentialFormDialog
        open={finestra.aperta}
        onOpenChange={(aperta) => setFinestra((f) => ({ ...f, aperta }))}
        stato={finestra.stato}
        opzioniTipo={OPZIONI_TIPO}
        onSaved={voceSalvata}
      />
    </Card>
  );
}

/** Riquadro informativo: fondo e bordo, con l'icona. */
function Nota({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-md border border-primary/50 bg-primary/5 px-3 py-2 text-[13px]">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

function EsitoProva({ ok, messaggio }: { ok: boolean; messaggio: string }) {
  return (
    <p
      role="status"
      className={`flex items-start gap-2 rounded-md border px-3 py-2 text-[13px] ${ok ? "border-success bg-success/10" : "border-destructive bg-destructive/10"}`}
    >
      {ok ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <CircleX className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
      <span>
        <strong>{ok ? "Riuscita" : "Non riuscita"}:</strong> {messaggio}
      </span>
    </p>
  );
}

/** Le tendine dei passi 2-5 dipendono dall'archivio: se non si è caricato lo si dice, non si mostra una lista vuota. */
function ErroreArchivio({ stato, onRiprova }: { stato: Caricamento; onRiprova: () => void }) {
  if (stato.fase !== "errore") return null;
  return (
    <p className="flex flex-wrap items-center gap-2 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-[13px]">
      <CircleX className="h-4 w-4 shrink-0" aria-hidden />
      <span className="flex-1">Archivio delle credenziali non caricato: {stato.messaggio}</span>
      <Button type="button" variant="outline" size="xs" className="text-[13px]" onClick={onRiprova}>
        Riprova
      </Button>
    </p>
  );
}

function TendinaVoci({
  id,
  label,
  stato,
  voci,
  valore,
  onCambia,
  onNuova,
  nessuna,
  segnaposto,
  vuota,
  nota,
  disabled,
}: {
  id: string;
  label: string;
  /** Stato dell'archivio: finché non è caricato non si dice «nessuna voce» (sarebbe una lista vuota al posto dell'errore). */
  stato: Caricamento;
  voci: readonly VoceArchivio[];
  valore: number | null;
  onCambia: (id: number | null) => void;
  onNuova: () => void;
  /** Etichetta della scelta «nessuna voce»; assente = la scelta non c'è. */
  nessuna?: string;
  segnaposto?: string;
  /** Testo quando non ci sono voci adatte. */
  vuota?: string;
  nota?: string;
  disabled?: boolean;
}) {
  const pronto = stato.fase === "pronto";
  // Finché l'archivio non c'è, la voce già scelta non si mostra «deselezionata» né «Nessuna».
  const valoreSelect = !pronto ? null : valore != null ? String(valore) : nessuna ? "none" : null;
  const segnapostoAttuale =
    stato.fase === "caricamento" ? "Caricamento dell'archivio…" : stato.fase === "errore" ? "Archivio non caricato" : (segnaposto ?? "Scegli");
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <Button type="button" variant="outline" size="xs" className="text-[13px]" onClick={onNuova} disabled={disabled}>
          <Plus className="h-3 w-3" />
          nuova nell&apos;archivio
        </Button>
      </div>
      <Select
        value={valoreSelect}
        onValueChange={(v) => onCambia(v == null || v === "none" ? null : Number(v))}
        disabled={disabled || !pronto || (voci.length === 0 && !nessuna)}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={segnapostoAttuale} />
        </SelectTrigger>
        <SelectContent>
          {nessuna ? <SelectItem value="none">{nessuna}</SelectItem> : null}
          {voci.map((v) => (
            <SelectItem key={v.id} value={String(v.id)}>
              {v.name} · {etichettaVoce(v)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {pronto && voci.length === 0 && vuota ? <p className="text-[13px] text-muted-foreground">{vuota}</p> : null}
      {nota ? <p className="text-[13px] text-muted-foreground">{nota}</p> : null}
    </div>
  );
}

function AzioniVoce({ voce, onModifica, onElimina }: { voce: VoceArchivio; onModifica: () => void; onElimina: () => void }) {
  return (
    <div className="flex shrink-0 justify-end gap-1">
      <Button type="button" variant="ghost" size="icon-sm" onClick={onModifica} aria-label={`Modifica «${voce.name}»`} title="Modifica">
        <Pencil className="h-4 w-4" />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" onClick={onElimina} aria-label={`Elimina «${voce.name}»`} title="Elimina">
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}

/** Tabella dell'archivio; sotto i 640 px un elenco a schede. */
function ArchivioVoci({
  stato,
  voci,
  onModifica,
  onElimina,
  onRiprova,
}: {
  stato: Caricamento;
  voci: readonly VoceArchivio[];
  onModifica: (v: VoceArchivio) => void;
  onElimina: (v: VoceArchivio) => void;
  onRiprova: () => void;
}) {
  if (stato.fase === "caricamento") return <p className="text-muted-foreground">Caricamento dell&apos;archivio…</p>;
  if (stato.fase === "errore") return <LoadError what="le credenziali dell'archivio" message={stato.messaggio} onRetry={onRiprova} />;
  if (voci.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-6 text-center text-muted-foreground">
        L&apos;archivio è vuoto. Aggiungi le voci che servono (SNMP per gli apparati, SSH per il router, Windows per i server…)
        oppure vai avanti: potrai inserirle anche dopo.
      </p>
    );
  }
  return (
    <>
      <div className="hidden rounded-lg border sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Utente</TableHead>
              <TableHead>Porta</TableHead>
              <TableHead className="w-[84px] text-right">Azioni</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {voci.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="max-w-[200px] truncate font-medium" title={v.name}>
                  {v.name}
                </TableCell>
                <TableCell>{etichettaVoce(v)}</TableCell>
                <TableCell className="text-muted-foreground">{v.ha_username ? "●●●●●●●●" : "—"}</TableCell>
                <TableCell className={v.port != null ? "font-mono" : "text-muted-foreground"}>{etichettaPorta(v.port)}</TableCell>
                <TableCell className="text-right">
                  <AzioniVoce voce={v} onModifica={() => onModifica(v)} onElimina={() => onElimina(v)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="space-y-2 sm:hidden">
        {voci.map((v) => (
          <li key={v.id} className="rounded-lg border p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="break-words font-medium">{v.name}</p>
                <p className="text-muted-foreground">{etichettaVoce(v)}</p>
              </div>
              <AzioniVoce voce={v} onModifica={() => onModifica(v)} onElimina={() => onElimina(v)} />
            </div>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
              <dt className="text-muted-foreground">Utente</dt>
              <dd>{v.ha_username ? "●●●●●●●●" : "—"}</dd>
              <dt className="text-muted-foreground">Porta</dt>
              <dd className={v.port != null ? "font-mono" : undefined}>{etichettaPorta(v.port)}</dd>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Le voci da provare sulla prima subnet: casella e frecce per l'ordine. */
function VociDellaRete({
  lista,
  voci,
  stato,
  onCambia,
  onRiprova,
}: {
  lista: SceltaRete[];
  voci: readonly VoceArchivio[];
  stato: Caricamento;
  onCambia: (lista: SceltaRete[]) => void;
  onRiprova: () => void;
}) {
  const perId = new Map(voci.map((v) => [v.id, v]));
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-[13px] font-medium">Credenziali da provare su questa rete (in ordine)</p>
      {stato.fase === "errore" ? (
        <ErroreArchivio stato={stato} onRiprova={onRiprova} />
      ) : stato.fase === "caricamento" ? (
        <p className="text-[13px] text-muted-foreground">Caricamento dell&apos;archivio…</p>
      ) : lista.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">L&apos;archivio è vuoto: potrai assegnarle dalla pagina della rete.</p>
      ) : (
        <ol className="space-y-1">
          {lista.map((s, i) => {
            const v = perId.get(s.id);
            if (!v) return null;
            const idCasella = `rete-voce-${s.id}`;
            return (
              <li key={s.id} className="flex items-center gap-2">
                <Checkbox
                  id={idCasella}
                  checked={s.attiva}
                  onCheckedChange={(c) => onCambia(lista.map((x) => (x.id === s.id ? { ...x, attiva: !!c } : x)))}
                />
                <span className="w-5 shrink-0 text-right text-[13px] tabular-nums text-muted-foreground">{i + 1}.</span>
                {/* Nome sopra e tipo sotto: a 390 px, accanto, il tipo si mangiava il nome
                    e tre voci SSH diventavano «A… SSH» tre volte (revisione del 15/10). */}
                <Label htmlFor={idCasella} className="min-w-0 flex-1 flex-col items-start gap-0.5 font-normal">
                  <span className="w-full truncate leading-snug" title={v.name}>
                    {v.name}
                  </span>
                  <span className="text-[13px] leading-snug text-muted-foreground">{etichettaVoce(v)}</span>
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onCambia(spostaScelta(lista, i, -1))}
                  disabled={i === 0}
                  aria-label={`Sposta «${v.name}» più in alto`}
                  title="Più in alto"
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onCambia(spostaScelta(lista, i, 1))}
                  disabled={i === lista.length - 1}
                  aria-label={`Sposta «${v.name}» più in basso`}
                  title="Più in basso"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
