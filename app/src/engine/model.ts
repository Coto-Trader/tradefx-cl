// Modelo de datos de TradeFX (el "resultado"). Todo parametrizable.

export type OperationId = "T0" | "T1" | "T2" | "FWD" | "NDF" | "FX_SWAP";

export interface Operation {
  id: OperationId;
  label: string;
  twoLegs: boolean;      // FX swap
  forward: boolean;      // usa grilla de puntos
  needsMarketOpen: boolean; // T0 (valuta cero) exige mercado abierto
}

export const OPERATIONS: Operation[] = [
  { id: "T0", label: "Spot t0", twoLegs: false, forward: false, needsMarketOpen: true },
  { id: "T1", label: "t+1", twoLegs: false, forward: true, needsMarketOpen: false },
  { id: "T2", label: "Spot t+2", twoLegs: false, forward: true, needsMarketOpen: false },
  { id: "FWD", label: "Forward", twoLegs: false, forward: true, needsMarketOpen: false },
  { id: "NDF", label: "NDF", twoLegs: false, forward: true, needsMarketOpen: false },
  { id: "FX_SWAP", label: "FX Swap", twoLegs: true, forward: true, needsMarketOpen: false },
];

export interface Pair {
  id: string;            // "USDCLP"
  base: string;          // "USD"
  quote: string;         // "CLP"
  decimals: number;      // dígitos de cotización (CLP: 2)
  pip: number;           // valor de 1 punto (CLP: 0.01? aquí usamos "peso" = 1.0 para puntos fwd en CLP)
  spotLagDays: number;   // t+2 típico
  scenarioBand: number;  // media banda del escenario Normal (en unidades de quote, ej. 0.5 pesos)
  fwdScenarioBand: number; // media banda del escenario para fwd (en unidades de quote)
  marketHours: { openMin: number; closeMin: number }; // minutos desde 00:00 (hora local)
}

export interface Scenario {
  id: string;
  label: string;
  bandMultiplier: number; // multiplica scenarioBand (Normal=1, Volátil=2, ...)
  tone: "normal" | "warn" | "hot" | "panic";
}

export const SCENARIOS: Scenario[] = [
  { id: "NORMAL", label: "Normal", bandMultiplier: 1, tone: "normal" },
  { id: "VOLATIL", label: "Volátil", bandMultiplier: 2.5, tone: "warn" },
  { id: "HIGH", label: "Highly Volatile", bandMultiplier: 5, tone: "hot" },
  { id: "PANIC", label: "Pánico", bandMultiplier: 10, tone: "panic" },
];

export type ClientStatus = "normal" | "watch" | "blocked";

export interface ClientConfig {
  id: string;
  name: string;
  status: ClientStatus;    // normal | en mira (precio referencial) | bloqueado
  lineUSD: number;         // línea de crédito (equiv. USD)
  autoTradeMaxUSD: number; // monto máx. para autotrade (sobre esto va a RFQ)
  spreadSpot: number;      // spread del cliente sobre el precio de escenario, spot (unidades de quote)
  spreadFwd: number;       // spread del cliente para forward/swap (unidades de quote / puntos)
}

/** Grilla de puntos forward por par y tenor (en unidades de quote, bid/offer). */
export interface PointsRow { tenor: string; days: number; bid: number; offer: number; }
export type PointsGrid = Record<string, PointsRow[]>; // pairId -> filas

// ---- utilidades de fecha (business days simples) ----
const MS = 86400000;
export function addBusinessDays(from: Date, n: number): Date {
  let d = new Date(from.getTime());
  let rem = n;
  while (rem > 0) { d = new Date(d.getTime() + MS); const wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) rem--; }
  return d;
}
export function toISO(d: Date): string { return d.toISOString().slice(0, 10); }

/** minutos locales actuales (0..1439) */
export function nowMinutes(now = new Date()): number { return now.getHours() * 60 + now.getMinutes(); }

export function isMarketOpen(pair: Pair, now = new Date()): boolean {
  const wd = now.getDay();
  if (wd === 0 || wd === 6) return false;
  const m = nowMinutes(now);
  return m >= pair.marketHours.openMin && m <= pair.marketHours.closeMin;
}

/** valor de valuta por operación (fecha valor) */
export function valueDate(op: OperationId, pair: Pair, fwdDays: number, today = new Date()): Date {
  switch (op) {
    case "T0": return today;
    case "T1": return addBusinessDays(today, 1);
    case "T2": return addBusinessDays(today, pair.spotLagDays);
    default: return addBusinessDays(today, Math.max(fwdDays, pair.spotLagDays));
  }
}
