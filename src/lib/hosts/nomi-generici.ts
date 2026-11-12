/**
 * Nomi che un apparato si dà da solo e che non lo distinguono da un altro uguale (Riccardo, 11/11/2026).
 * Sull'hub 533 otto iPhone diversi erano un gruppo solo, e così quattro «MikroTik», perché il motore dei gruppi
 * riuniva le righe con lo stesso nome. Un nome di serie non è un'identità. Modulo puro, senza database.
 */
const GENERICI = new Set([
  "iphone", "ipad", "watch", "apple-watch", "mac", "macbook", "macbook-pro", "macbook-air", "imac", "mac-mini",
  "android", "galaxy", "pixel", "mikrotik", "routeros", "meross", "meross_smart_plug", "espressif", "raspberrypi",
  "tasmota", "shelly", "sonoff", "ubnt", "chromecast", "echo",
]);

/** Il nome, senza dominio e senza maiuscole, è uno di serie? Vale anche con un numero in coda («iPhone-2»). */
export function nomeGenerico(nome: string | null | undefined): boolean {
  const corto = (nome ?? "").trim().toLowerCase().split(".")[0];
  if (!corto) return false;
  return GENERICI.has(corto) || GENERICI.has(corto.replace(/[-_ ]?\d{1,2}$/, ""));
}

/**
 * Nome che un telefono, un tablet, un orologio o un Mac si dà da solo in DHCP. Serve solo alla bonifica delle righe
 * già sporche: lì è l'unico segno sicuro che i dati rimasti sono di un altro apparato (un iPhone non è «HP Inc.»).
 */
const NOME_PERSONALE = /^(iphone|ipad|watch|apple-?watch|mac|macbook[\w-]*|imac|galaxy[\w-]*|s2\d[\w-]*|pixel[\w-]*|fairphone[\w-]*|android-[0-9a-f]+|redmi[\w-]*|oneplus[\w-]*|xiaomi[\w-]*|huawei[\w-]*)$/i;

export function nomePersonale(nome: string | null | undefined): boolean {
  const corto = (nome ?? "").trim().split(".")[0];
  return NOME_PERSONALE.test(corto);
}
