/**
 * Tipi di credenziale che le API del caveau accettano in scrittura (creazione,
 * modifica, bootstrap dall'appliance). Un solo elenco per le tre rotte.
 *
 * `master` non c'è apposta: la password master la scrive solo `master-password.ts`.
 * La colonna `kind` è TEXT senza CHECK: una riga di un tipo tolto resta leggibile.
 * Il tipo dell'overlay precedente è tolto il 20/10/2026 (sul live 0 righe): una riga
 * vecchia si legge ancora, ma non se ne creano altre.
 */
import { z } from "zod";

export const TIPI_CREDENZIALE = [
  "wazuh",
  "graylog",
  "librenms",
  "truenas",
  "edge",
  "hub",
  "pve",
  "other",
] as const;

export const TipoCredenzialeSchema = z.enum(TIPI_CREDENZIALE);
