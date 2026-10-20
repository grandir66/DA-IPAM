/**
 * Gli host con cui l'appliance è nota, letti sul server (Riccardo, 21/10): servono
 * a `urlPerIlBrowser` per dire «questo URL è l'appliance stessa» e aprirlo con
 * l'host del browser. Solo server (usa `os` e il DB dell'hub).
 *
 * Fonti: interfacce di rete vere della macchina (l'IP LAN registrato
 * dall'installatore ci sta anche se `APPLIANCE_LAN_IP` non è nell'ambiente del
 * servizio), nome della macchina, variabili d'ambiente dell'host pubblico e degli
 * URL di DA-IPAM, voce «DA-IPAM (this)» del vault scritta dall'installatore.
 */
import os from "node:os";
import { listCredentials } from "../credentials-vault";
import { applianceHostPubblici } from "./public-url";
import { raccogliHostAppliance, type InterfacceDiRete } from "./url-per-browser";

const ENV_URL_DA_IPAM = ["NEXTAUTH_URL", "AUTH_URL", "DA_IPAM_PUBLIC_URL"] as const;

function urlDaIpamDalVault(): string[] {
  try {
    return listCredentials()
      .filter((c) => /^da-ipam\b/i.test(c.label ?? "") && !!c.url)
      .map((c) => c.url as string);
  } catch {
    return [];
  }
}

function interfacce(): InterfacceDiRete {
  try {
    return os.networkInterfaces() as InterfacceDiRete;
  } catch {
    return {};
  }
}

export function hostDellAppliance(): string[] {
  return raccogliHostAppliance({
    nomeMacchina: os.hostname(),
    interfacce: interfacce(),
    hostDichiarati: [
      ...applianceHostPubblici(),
      ...ENV_URL_DA_IPAM.map((n) => process.env[n]),
      ...urlDaIpamDalVault(),
    ],
  });
}
