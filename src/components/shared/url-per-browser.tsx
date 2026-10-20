"use client";

/**
 * Lato client della regola «i link verso l'appliance usano l'host del browser»
 * (Riccardo, 21/10): il provider riceve dal layout gli host dell'appliance (letti
 * sul server) e l'Host della richiesta; `useUrlPerBrowser` restituisce la funzione
 * da applicare a ogni href, `src` di riquadro o `window.open` verso un servizio
 * dell'appliance. La regola sta in `lib/integrations/url-per-browser.ts`.
 *
 * Durante il render sul server e l'idratazione l'host è quello della richiesta;
 * subito dopo, quello di `window.location` (useSyncExternalStore): niente
 * differenze di idratazione, e un proxy che non inoltra l'Host si corregge da solo.
 */
import Link from "next/link";
import { createContext, useCallback, useContext, useSyncExternalStore, type AnchorHTMLAttributes, type ReactNode } from "react";
import { HOST_LOOPBACK, urlPerIlBrowser } from "@/lib/integrations/url-per-browser";

interface ContestoHost {
  hostAppliance: readonly string[];
  hostRichiesta: string | null;
}

const Contesto = createContext<ContestoHost>({ hostAppliance: HOST_LOOPBACK, hostRichiesta: null });

export function HostApplianceProvider({
  hostAppliance,
  hostRichiesta,
  children,
}: ContestoHost & { children: ReactNode }) {
  return <Contesto.Provider value={{ hostAppliance, hostRichiesta }}>{children}</Contesto.Provider>;
}

const nessunaIscrizione = () => () => {};

export type UrlPerBrowser = <T extends string | null | undefined>(url: T) => T;

/** La funzione che riscrive un URL dell'appliance con l'host del browser. */
export function useUrlPerBrowser(): UrlPerBrowser {
  const { hostAppliance, hostRichiesta } = useContext(Contesto);
  const hostBrowser = useSyncExternalStore(
    nessunaIscrizione,
    () => window.location.hostname,
    () => hostRichiesta ?? "",
  );
  return useCallback<UrlPerBrowser>((url) => urlPerIlBrowser(url, hostAppliance, hostBrowser), [hostAppliance, hostBrowser]);
}

/**
 * Collegamento per i componenti resi sul server (riquadri della dashboard): un
 * href assoluto passa dalla regola, uno relativo resta un `Link` di Next.
 */
export function LinkPerBrowser({ href, ...resto }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const perBrowser = useUrlPerBrowser();
  if (href.startsWith("/")) return <Link href={href} {...resto} />;
  return <a href={perBrowser(href)} {...resto} />;
}
