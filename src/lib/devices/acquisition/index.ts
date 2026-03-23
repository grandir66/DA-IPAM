/**
 * Entry point per il registry acquisizione.
 *
 * Importare questo modulo registra tutti gli handler disponibili.
 * Il registry può essere usato da switch-client.ts e router-client.ts
 * come facade per delegare le operazioni agli handler specifici.
 */

export * from "./registry";

import "./mikrotik";
