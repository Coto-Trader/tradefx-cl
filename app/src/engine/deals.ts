// Bus de operaciones compartido entre pantallas (trader ↔ cliente).
// Hoy: BroadcastChannel + localStorage (dos ventanas, misma máquina).
// Mañana: implementar DealBus contra Supabase Realtime sin tocar la UI.

export type DealSide = "client_buys" | "client_sells";
export type DealRouteKind = "autotrade" | "rfq";
export type DealStatus = "executed" | "pending_rfq" | "claimed" | "quoted" | "confirmed" | "rejected";

export interface Deal {
  id: string;
  ts: number;
  clientId: string;
  clientName: string;
  pair: string;
  base: string;
  operation: string;     // etiqueta de operación
  tenorLabel?: string;
  side: DealSide;
  amountBase: number;
  rate: number;          // precio ejecutado (outright)
  valueDateISO?: string;
  scenario: string;
  route: DealRouteKind;
  status: DealStatus;
  acknowledgedByTrader?: boolean;
  byTrader?: string;
  // RFQ
  claimedBy?: string;      // id del trader que tomó el RFQ (lock)
  claimedByName?: string;
  quotedRate?: number;     // precio ofrecido por la mesa
}

export interface DealBus {
  all(): Deal[];
  publish(d: Deal): void;
  subscribe(cb: (deals: Deal[]) => void): () => void;
}

const KEY = "tradefx.deals.v1";

export class BroadcastDealBus implements DealBus {
  private ch: BroadcastChannel | null = null;
  private listeners = new Set<(d: Deal[]) => void>();

  constructor() {
    try {
      this.ch = new BroadcastChannel("tradefx.deals");
      this.ch.onmessage = () => this.emit();
    } catch { /* sin BroadcastChannel: cae a storage events */ }
    try {
      window.addEventListener("storage", (e) => { if (e.key === KEY) this.emit(); });
    } catch { /* ignore */ }
  }

  all(): Deal[] {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]") as Deal[]; }
    catch { return []; }
  }

  publish(d: Deal): void {
    const list = this.all();
    const i = list.findIndex((x) => x.id === d.id);
    if (i >= 0) list[i] = { ...list[i], ...d };
    else list.unshift(d);
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 300))); } catch { /* ignore */ }
    try { this.ch?.postMessage("u"); } catch { /* ignore */ }
    this.emit();
  }

  subscribe(cb: (deals: Deal[]) => void): () => void {
    this.listeners.add(cb);
    cb(this.all());
    return () => { this.listeners.delete(cb); };
  }

  private emit(): void {
    const l = this.all();
    this.listeners.forEach((f) => f(l));
  }
}

export function newDealId(): string {
  return "D" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Identidad de trader por VENTANA (sessionStorage): así dos pestañas de trader
 *  son dos traders distintos y el claim del primero bloquea al resto. */
export function getTraderId(): string {
  try {
    let id = sessionStorage.getItem("tradefx.traderId");
    if (!id) { id = "T" + Math.random().toString(36).slice(2, 5).toUpperCase(); sessionStorage.setItem("tradefx.traderId", id); }
    return id;
  } catch { return "T" + Math.random().toString(36).slice(2, 5).toUpperCase(); }
}

/** Posición neta por par (base firmado): cliente compra base ⇒ mesa queda corta base. */
export function deskNetByPair(deals: Deal[]): Record<string, number> {
  const net: Record<string, number> = {};
  for (const d of deals) {
    if (d.status !== "executed" && d.status !== "confirmed") continue;
    const sign = d.side === "client_buys" ? -1 : +1; // mesa: corta si el cliente compra
    net[d.pair] = (net[d.pair] ?? 0) + sign * d.amountBase;
  }
  return net;
}
