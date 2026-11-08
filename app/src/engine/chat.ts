// TradeChat — mensajería en vivo cliente ↔ mesa (1:1 por cliente).
// Mismo transporte que el DealBus: BroadcastChannel + localStorage (demo dos
// ventanas). Swappable a Supabase Realtime sin tocar la UI.

export type ChatFrom = "client" | "desk";

export interface ChatMsg {
  id: string;
  ts: number;
  clientId: string;      // hilo (un cliente)
  from: ChatFrom;
  fromName: string;
  text: string;
  system?: boolean;      // mensaje automático (p.ej. confirmación de operación)
  readByDesk?: boolean;
  readByClient?: boolean;
}

const KEY = "tradefx.chat.v1";

export class BroadcastChatBus {
  private ch: BroadcastChannel | null = null;
  private listeners = new Set<(m: ChatMsg[]) => void>();

  constructor() {
    try { this.ch = new BroadcastChannel("tradefx.chat"); this.ch.onmessage = () => this.emit(); } catch { /* ignore */ }
    try { window.addEventListener("storage", (e) => { if (e.key === KEY) this.emit(); }); } catch { /* ignore */ }
  }

  all(): ChatMsg[] {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]") as ChatMsg[]; } catch { return []; }
  }

  private write(list: ChatMsg[]) {
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(-500))); } catch { /* ignore */ }
    try { this.ch?.postMessage("u"); } catch { /* ignore */ }
    this.emit();
  }

  publish(m: ChatMsg): void {
    const list = this.all();
    list.push(m);
    this.write(list);
  }

  /** marca leídos los mensajes de un hilo desde el lado opuesto al autor */
  markRead(clientId: string, side: ChatFrom): void {
    const list = this.all();
    let changed = false;
    for (const m of list) {
      if (m.clientId !== clientId) continue;
      if (side === "desk" && m.from === "client" && !m.readByDesk) { m.readByDesk = true; changed = true; }
      if (side === "client" && m.from === "desk" && !m.readByClient) { m.readByClient = true; changed = true; }
    }
    if (changed) this.write(list);
  }

  subscribe(cb: (m: ChatMsg[]) => void): () => void {
    this.listeners.add(cb);
    cb(this.all());
    return () => { this.listeners.delete(cb); };
  }

  private emit(): void { const l = this.all(); this.listeners.forEach((f) => f(l)); }
}

export function newMsgId(): string {
  return "M" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

/** hilos con actividad: clientId -> {última, no leídos por la mesa} */
export function threadsForDesk(msgs: ChatMsg[]): { clientId: string; lastName: string; lastTs: number; unread: number }[] {
  const by = new Map<string, { clientId: string; lastName: string; lastTs: number; unread: number }>();
  for (const m of msgs) {
    const t = by.get(m.clientId) ?? { clientId: m.clientId, lastName: m.fromName, lastTs: 0, unread: 0 };
    if (m.ts >= t.lastTs) { t.lastTs = m.ts; }
    if (m.from === "client") { t.lastName = m.fromName; if (!m.readByDesk) t.unread += 1; }
    by.set(m.clientId, t);
  }
  return [...by.values()].sort((a, b) => b.lastTs - a.lastTs);
}
