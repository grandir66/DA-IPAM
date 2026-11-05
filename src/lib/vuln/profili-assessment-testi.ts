/**
 * Cosa fa ogni profilo assessment, in italiano, per chi sceglie dalla pagina.
 *
 * L'edge espone solo `id`, `label` e i nomi dei moduli (`GET /api/v1/profiles`,
 * `services/profile_runner.py::list_profiles`): nel catalogo non c'è una riga che
 * spieghi a cosa serve un profilo, e in pagina restavano quattro nomi muti
 * («Smoke interno», «Validation plus»). Le descrizioni stanno qui, lette dal
 * codice dei moduli della sonda, così si correggono con un rilascio di DA-IPAM
 * senza toccare le appliance.
 *
 * Nessun ripiego muto: un modulo o un profilo che l'edge aggiunge e qui non c'è
 * si vede lo stesso, col suo id e detto che non è ancora descritto.
 *
 * Modulo puro (niente rete né database): lo importano anche i componenti client.
 */

import type { EdgeAssessmentProfile } from "./edge-profiles";

export interface DescrizioneModulo {
  /** Nome in italiano, per chi legge la pagina. */
  nome: string;
  /** Una riga su cosa fa davvero, compreso lo strumento che usa. */
  cosaFa: string;
  /** false quando il testo è un ripiego sull'id, non una descrizione vera. */
  descritto: boolean;
}

export interface DescrizioneProfilo {
  aCosaServe: string;
  /** Quando conviene sceglierlo; null se il profilo non è descritto qui. */
  quando: string | null;
  descritto: boolean;
}

/** Moduli del catalogo della sonda (DA-Vul-can, `scanner_edge/modules/*`). */
const MODULI: Record<string, { nome: string; cosaFa: string }> = {
  "service-fp": {
    nome: "Impronta dei servizi",
    cosaFa:
      "nmap con gli script di RDP, SSH, WinRM e SMB: versione, cifrature e come si presenta ogni servizio.",
  },
  "cis-check": {
    nome: "Postura",
    cosaFa:
      "nmap con gli script di configurazione su 22, 80, 443 e 445: cifrature deboli, intestazioni mancanti, firma SMB.",
  },
  "ldap-enum": {
    nome: "LDAP anonimo",
    cosaFa: "Bind senza credenziali e lettura del rootDSE: quanto si legge del dominio senza essere nessuno.",
  },
  "enum4linux-ng": {
    nome: "SMB anonimo",
    cosaFa: "Enumerazione in sola lettura di condivisioni, utenti e politiche visibili senza accesso.",
  },
  "snmp-enum": {
    nome: "SNMP con community di serie",
    cosaFa: "onesixtyone e snmpwalk con «public»: gli apparati che rispondono a chiunque li interroghi.",
  },
  "smtp-enum": {
    nome: "Posta",
    cosaFa: "Script nmap su 25, 587 e 465: inoltro aperto, comandi e utenti enumerabili.",
  },
  "tls-deep": {
    nome: "TLS a fondo",
    cosaFa: "testssl.sh da gravità media in su: protocolli e cifrature vecchie, certificati, rinegoziazione.",
  },
  "dns-enum": {
    nome: "DNS",
    cosaFa: "dig sui nameserver del dominio e tentativo di trasferimento di zona (AXFR).",
  },
  amass: {
    nome: "Nomi pubblici",
    cosaFa: "Raccolta passiva dei sottodomini da fonti pubbliche: nessun pacchetto arriva al cliente.",
  },
  "cred-bind": {
    nome: "Accesso autenticato",
    cosaFa: "Bind LDAP e SMB con le credenziali passate al momento, che la sonda non salva.",
  },
  nuclei: {
    nome: "Nuclei",
    cosaFa: "Template di vulnerabilità note contro i servizi web trovati sulla subnet.",
  },
  "web-discovery": {
    nome: "Ricerca dei siti",
    cosaFa: "Cerca i servizi web della subnet e ne tiene l'elenco, da dare in pasto a Nuclei.",
  },
};

/** Profili del catalogo della sonda (`data/assessment_profiles.json`). */
const PROFILI: Record<string, { aCosaServe: string; quando: string }> = {
  "smoke-interno": {
    aCosaServe:
      "Il giro minimo: un solo modulo, l'impronta dei servizi. Nessuna enumerazione, nessun controllo di configurazione.",
    quando:
      "Per un primo passaggio veloce su una rete interna, o quando basta sapere che versioni parlano RDP, SSH, WinRM e SMB.",
  },
  "completo-interno": {
    aCosaServe:
      "Il giro completo su una rete interna: impronta dei servizi, postura, condivisioni SMB, LDAP, SNMP, posta e TLS.",
    quando:
      "È quello da scegliere per avere tutte le letture su una subnet del cliente. Sei moduli su sette sono facoltativi: dove il servizio non c'è, il passo si salta senza far fallire il giro.",
  },
  "validation-plus": {
    aCosaServe:
      "Come il completo interno, ma più a fondo: aggiunge il bind autenticato su LDAP e SMB, e non ammette salti su SMB, LDAP, postura e impronta dei servizi — se uno di quelli non riesce, il giro fallisce.",
    quando:
      "Per una verifica formale, quando il cliente ha dato le credenziali e l'autorizzazione scritta.",
  },
  "safe-esterno": {
    aCosaServe:
      "Il giro da fuori, su un dominio pubblico: nomi raccolti da fonti pubbliche, DNS e TLS. Amass non manda niente al cliente; DNS e TLS interrogano i server esposti, non la rete interna.",
    quando: "Per guardare l'esposizione pubblica di un dominio.",
  },
};

export function descriviModulo(id: string): DescrizioneModulo {
  const m = MODULI[id];
  if (m) return { ...m, descritto: true };
  return { nome: id, cosaFa: "Modulo del catalogo dell'edge, non ancora descritto in DA-IPAM.", descritto: false };
}

export interface ProfiloDescritto {
  aCosaServe: string;
  quando: string | null;
  descritto: boolean;
  moduli: DescrizioneModulo[];
}

/**
 * Descrizione del profilo scelto. Per un profilo che l'edge ha e qui non c'è, la
 * riga la costruiscono i suoi moduli: mai una scheda vuota.
 */
export function descriviProfilo(profilo: EdgeAssessmentProfile): ProfiloDescritto {
  const moduli = profilo.steps.map(descriviModulo);
  const p = PROFILI[profilo.id];
  if (p) return { ...p, descritto: true, moduli };
  return {
    aCosaServe:
      moduli.length > 0
        ? `Profilo del catalogo dell'edge non ancora descritto in DA-IPAM: esegue ${moduli.length === 1 ? "un modulo" : `${moduli.length} moduli`}, qui sotto.`
        : "Profilo del catalogo dell'edge non ancora descritto in DA-IPAM, e senza moduli: non farebbe niente.",
    quando: null,
    descritto: false,
    moduli,
  };
}

/** Riga compatta per la voce della tendina: «3 moduli», «1 modulo». */
export function contaModuli(profilo: EdgeAssessmentProfile): string {
  const n = profilo.steps.length;
  if (n === 0) return "nessun modulo";
  return n === 1 ? "1 modulo" : `${n} moduli`;
}
