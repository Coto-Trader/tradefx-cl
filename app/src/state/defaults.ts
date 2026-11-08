import { ClientConfig, Pair, PointsGrid } from "../engine/model";

export const PAIRS: Pair[] = [
  {
    id: "USDCLP", base: "USD", quote: "CLP", decimals: 2, pip: 0.01, spotLagDays: 2,
    scenarioBand: 0.5, fwdScenarioBand: 0.3,
    marketHours: { openMin: 8 * 60, closeMin: 17 * 60 }, // 08:00–17:00 CL (parametrizable)
  },
  {
    id: "EURUSD", base: "EUR", quote: "USD", decimals: 5, pip: 0.0001, spotLagDays: 2,
    scenarioBand: 0.00025, fwdScenarioBand: 0.00015,
    marketHours: { openMin: 0, closeMin: 1439 }, // ~24h
  },
];

// Semillas del MockFeed (mid + volatilidad por tick)
export const SEEDS: Record<string, { mid: number; vol: number; drift?: number }> = {
  USDCLP: { mid: 945.30, vol: 0.12 },
  EURUSD: { mid: 1.08500, vol: 0.00030 },
};

// Grilla de puntos forward (en unidades de quote, bid/offer)
export const POINTS: PointsGrid = {
  USDCLP: [
    { tenor: "O/N", days: 1, bid: 0.07, offer: 0.11 },
    { tenor: "1W", days: 7, bid: 0.52, offer: 0.66 },
    { tenor: "2W", days: 14, bid: 1.05, offer: 1.28 },
    { tenor: "1M", days: 30, bid: 2.35, offer: 2.85 },
    { tenor: "2M", days: 60, bid: 4.80, offer: 5.55 },
    { tenor: "3M", days: 90, bid: 7.30, offer: 8.25 },
    { tenor: "6M", days: 180, bid: 15.0, offer: 16.9 },
    { tenor: "1Y", days: 360, bid: 31.0, offer: 34.8 },
  ],
  EURUSD: [
    { tenor: "O/N", days: 1, bid: -0.00004, offer: -0.00002 },
    { tenor: "1W", days: 7, bid: -0.00028, offer: -0.00022 },
    { tenor: "1M", days: 30, bid: -0.00120, offer: -0.00100 },
    { tenor: "3M", days: 90, bid: -0.00360, offer: -0.00320 },
    { tenor: "6M", days: 180, bid: -0.00720, offer: -0.00650 },
    { tenor: "1Y", days: 360, bid: -0.01450, offer: -0.01320 },
  ],
};

export const CLIENTS: ClientConfig[] = [
  { id: "A", name: "Cliente A", status: "normal", lineUSD: 5_000_000, autoTradeMaxUSD: 1_000_000, spreadSpot: 1.0, spreadFwd: 0.20 },
  { id: "INST", name: "Institucional X", status: "normal", lineUSD: 50_000_000, autoTradeMaxUSD: 10_000_000, spreadSpot: 0.5, spreadFwd: 0.10 },
  { id: "B", name: "Cliente B (en mira)", status: "watch", lineUSD: 2_000_000, autoTradeMaxUSD: 500_000, spreadSpot: 1.5, spreadFwd: 0.30 },
  { id: "C", name: "Cliente C (sin línea)", status: "blocked", lineUSD: 0, autoTradeMaxUSD: 0, spreadSpot: 2.0, spreadFwd: 0.40 },
];
