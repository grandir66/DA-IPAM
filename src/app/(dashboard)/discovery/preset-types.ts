/**
 * Tipi serializzabili per i preset chip della pagina /discovery.
 *
 * I preset vivono sia in localStorage (chiave `discovery-presets`) sia nelle
 * preferenze utente lato hub.db (key `user:<email>:discovery-presets`). Poiché
 * vengono serializzati a JSON, l'icona è una **stringa** (`iconName`) — la
 * mappa stringa→componente lucide è dentro `presets-dialog.tsx` e
 * `discovery/page.tsx`.
 */

export type IconName =
  | "Server"
  | "Monitor"
  | "HardDrive"
  | "RouterIcon"
  | "Cable"
  | "Wifi"
  | "Shield"
  | "Network"
  | "BatteryCharging"
  | "Phone"
  | "Printer"
  | "Camera"
  | "Cpu"
  | "Smartphone"
  | "Database"
  | "Link2"
  | "Boxes"
  | "Activity"
  | "Package";

export interface ClassPreset {
  /** Valore impostato in classFilter quando la chip è attiva. Per preset
   *  built-in inizia con `group:` o coincide con una classification (router/switch/ecc).
   *  Per preset custom user-defined: `user:<slug>`. */
  filter: string;
  label: string;
  iconName: IconName;
  /** Classification che soddisfano il preset. Per `group:multihomed` e
   *  `group:other` è vuota (logica speciale nel filter). */
  match: string[];
  /** Marker per preset built-in vs user-created. */
  builtin?: boolean;
}
