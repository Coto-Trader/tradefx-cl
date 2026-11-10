// Capa de precio en tiempo real. Se programa contra la interfaz PriceFeed;
// hoy corre MockFeed (tickea solo). El BbgFeed queda como adapter para cuando
// haya licencia/terminal logueada o la API en vivo (misma interfaz, cero cambios
// aguas arriba).

export interface Tick {
  pair: string;
  mid: number;
  ts: number;
}

export interface PriceFeed {
  source(): string;
  pairs(): string[];
  mid(pair: string): number | null;
  /** avanza el/los precios un paso (mock) y devuelve los ticks cambiados */
  step(): Tick[];
}

interface MockState { mid: number; vol: number; drift: number; }

/** Mid simulado por random-walk alrededor de una semilla. Siempre disponible. */
export class MockFeed implements PriceFeed {
  private st = new Map<string, MockState>();

  constructor(seeds: Record<string, { mid: number; vol: number; drift?: number }>) {
    for (const [p, s] of Object.entries(seeds)) {
      this.st.set(p, { mid: s.mid, vol: s.vol, drift: s.drift ?? 0 });
    }
  }

  source() { return "MOCK"; }
  pairs() { return [...this.st.keys()]; }
  mid(pair: string) { return this.st.get(pair)?.mid ?? null; }
  setMid(pair: string, mid: number) { const s = this.st.get(pair); if (s) s.mid = mid; else this.st.set(pair, { mid, vol: 0.12, drift: 0 }); }

  step(): Tick[] {
    const ts = Date.now();
    const out: Tick[] = [];
    for (const [pair, s] of this.st) {
      const shock = (Math.random() - 0.5) * 2 * s.vol + s.drift;
      s.mid = Math.max(1e-6, s.mid + shock);
      out.push({ pair, mid: s.mid, ts });
    }
    return out;
  }
}

/**
 * Adapter Bloomberg (stub). Requiere terminal logueada + licencia (hoy) o la API
 * en vivo cuando se contrate. No se usa aún; se enchufa implementando mid()/step()
 * contra la fuente real sin tocar el motor de precio.
 */
export class BbgFeed implements PriceFeed {
  source() { return "BBG"; }
  pairs(): string[] { return []; }
  mid(_pair: string): number | null { return null; }
  step(): Tick[] { return []; } // TODO: suscripción real (BLPAPI / API de pago)
}
