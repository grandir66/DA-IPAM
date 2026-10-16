// src/lib/topology/tree-layout-consts.ts
/** Misure condivise fra le due disposizioni (tb in tree-layout.ts, lr in tree-layout-lr.ts). */
export const BOX_H = 44, GAP = 18, LEVEL_GAP = 56, AP_W = 150, AP_H = 40, AP_COLS = 4, AP_HEAD = 18;
export const VM_COLS = 3, VM_W = 150, VM_H = 22, VM_ROW = 26;
export const ATT_W = 160, ATT_ROW = 20, ATT_MAX = 4, CHAR_W = 7, ROOT_GAP = 60, MARGIN = 40;
/** Disposizione «Verticale» (da sinistra a destra, spec §12.2). */
export const LEVEL_GAP_LR = 90, ATT_INDENT = 12, AP_COLS_LR = 2, VM_COLS_LR = 2;
export const AP_BLOCK_LR = AP_COLS_LR * (AP_W + 8);
export const AP_BLOCK = AP_COLS * (AP_W + 8);
export const ATT_SIDE = ATT_W + 10;

/**
 * La riga «DNS: <nome di prima>» sotto il nome di un hypervisor rinominato dal Proxmox (spec §12.5): 13 px su una
 * riga alta 16. Allunga l'intestazione del riquadro (schermo e stampa), e le VM aperte partono sotto.
 */
export const DNS_H = 16;

/**
 * La riga «+N apparati non gestiti» sotto la capsula di un segmento (T3, spec §13.10.3): 13 px su una riga alta 16, più il
 * margine. In verticale la disposizione la tiene libera, così non copre le porte del riquadro che segue (verifica a schermo di
 * T3, revisione finale M10). In orizzontale sta già nello spazio fra i livelli.
 */
export const SEGMENTO_SOTTO = 18;

export function dnsLine(n: { dnsName?: string }): string | null {
  return n.dnsName ? `DNS: ${n.dnsName}` : null;
}

/** L'altezza dell'intestazione di un riquadro: BOX_H, più la riga «DNS:» se c'è. */
export function headHeight(n: { dnsName?: string }): number {
  return BOX_H + (n.dnsName ? DNS_H : 0);
}

export function nodeWidth(label: string): number {
  return Math.min(230, Math.max(170, label.length * CHAR_W + 44));
}

export function fitLabel(label: string, width: number): string {
  const max = Math.floor((width - 44) / CHAR_W);
  return label.length > max ? `${label.slice(0, Math.max(1, max - 1))}…` : label;
}

