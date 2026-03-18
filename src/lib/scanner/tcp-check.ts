import { createConnection } from "net";

/**
 * Verifica se un host risponde su una porta TCP (handshake).
 * Fallback quando ICMP non funziona (es. firewall blocca ping).
 */
export function tcpConnect(host: string, port: number, timeoutMs: number = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(
      { host, port },
      () => {
        socket.destroy();
        resolve(true);
      }
    );
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/** Porte TCP comuni da provare come fallback se ICMP fallisce */
export const FALLBACK_TCP_PORTS = [22, 80, 443, 3389, 8080, 8443];
