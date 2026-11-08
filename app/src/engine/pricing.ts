import { PriceFeed } from "./feed";
import {
  ClientConfig, Operation, Pair, PointsGrid, PointsRow, Scenario,
  isMarketOpen, toISO, valueDate,
} from "./model";

export type DealRoute = "autotrade" | "rfq" | "referential" | "blocked" | "market_closed";

export interface QuoteComponent { label: string; value: string; }

export interface Quote {
  pair: string;
  operation: string;
  tradable: boolean;
  route: DealRoute;
  mid: number | null;
  // outright (spot/fwd/ndf)
  bid?: number;
  offer?: number;
  valueDateISO?: string;
  // fx swap (puntos)
  swapBidPts?: number;
  swapOfferPts?: number;
  nearDateISO?: string;
  farDateISO?: string;
  // detalle
  scenarioHalf: number;
  clientSpread: number;
  fwdPtsMid?: number;
  overLine: boolean;
  components: QuoteComponent[];
  note?: string;
}

function interpPoints(rows: PointsRow[], days: number): PointsRow {
  if (!rows || rows.length === 0) return { tenor: "-", days, bid: 0, offer: 0 };
  const sorted = [...rows].sort((a, b) => a.days - b.days);
  if (days <= sorted[0].days) return sorted[0];
  if (days >= sorted[sorted.length - 1].days) return sorted[sorted.length - 1];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i];
    if (days <= b.days) {
      const w = (days - a.days) / (b.days - a.days);
      return { tenor: `${days}d`, days, bid: a.bid + w * (b.bid - a.bid), offer: a.offer + w * (b.offer - a.offer) };
    }
  }
  return sorted[sorted.length - 1];
}

export interface PriceArgs {
  pair: Pair;
  op: Operation;
  scenario: Scenario;
  client: ClientConfig;
  feed: PriceFeed;
  points: PointsGrid;
  tenorDays: number;   // para FWD/NDF/SWAP (far)
  amountUSD: number;
  today?: Date;
}

export function priceQuote(a: PriceArgs): Quote {
  const { pair, op, scenario, client, feed, points, tenorDays, amountUSD } = a;
  const today = a.today ?? new Date();
  const mid = feed.mid(pair.id);
  // Spot-family (t0/t1/t2) usa spread y banda SPOT; solo FWD/NDF/Swap usan fwd.
  // (op.forward controla el uso de la grilla de puntos, no el spread.)
  const usesFwdSpread = op.id === "FWD" || op.id === "NDF" || op.twoLegs;
  const scenarioHalf = (usesFwdSpread ? pair.fwdScenarioBand : pair.scenarioBand) * scenario.bandMultiplier;
  const clientSpread = usesFwdSpread ? client.spreadFwd : client.spreadSpot;
  const overLine = amountUSD > client.lineUSD;

  const base: Quote = {
    pair: pair.id, operation: op.label, tradable: false, route: "autotrade",
    mid, scenarioHalf, clientSpread, overLine, components: [],
  };

  // ruteo
  if (client.status === "blocked") return { ...base, route: "blocked", note: "Cliente bloqueado (sin línea)." };
  if (op.needsMarketOpen && !isMarketOpen(pair, today))
    return { ...base, route: "market_closed", note: "Fuera de horario: valuta cero (t0) no operable." };
  if (mid == null) return { ...base, route: "blocked", note: "Sin mid del feed." };

  let route: DealRoute = "autotrade";
  if (client.status === "watch") route = "referential";
  else if (amountUSD > client.autoTradeMaxUSD) route = "rfq";

  const rows = points[pair.id] ?? [];

  if (op.twoLegs) {
    // FX swap: pata corta (spot) vs pata larga (tenor). El precio son los puntos, neteado.
    const near = interpPoints(rows, pair.spotLagDays);
    const far = interpPoints(rows, tenorDays);
    const swapBidPts = (far.bid - near.offer) - clientSpread;
    const swapOfferPts = (far.offer - near.bid) + clientSpread;
    return {
      ...base, tradable: true, route,
      swapBidPts, swapOfferPts,
      nearDateISO: toISO(valueDate("T2", pair, pair.spotLagDays, today)),
      farDateISO: toISO(valueDate("FWD", pair, tenorDays, today)),
      components: [
        { label: "Mid spot", value: mid.toFixed(pair.decimals) },
        { label: "Pts pata corta (spot)", value: `${near.bid.toFixed(3)} / ${near.offer.toFixed(3)}` },
        { label: "Pts pata larga (far)", value: `${far.bid.toFixed(3)} / ${far.offer.toFixed(3)}` },
        { label: "Spread swap cliente", value: `±${clientSpread}` },
        { label: "Puntos swap (bid/offer)", value: `${swapBidPts.toFixed(3)} / ${swapOfferPts.toFixed(3)}` },
      ],
      note: route === "rfq" ? "Monto > autotrade → RFQ." : route === "referential" ? "Cliente en mira → precio referencial." : undefined,
    };
  }

  // outright: spot (t0/t1/t2) o forward/ndf
  const pts = op.forward ? interpPoints(rows, op.id === "T1" ? 1 : op.id === "T2" ? pair.spotLagDays : tenorDays) : { tenor: "spot", days: 0, bid: 0, offer: 0 };
  const fwdPtsMid = (pts.bid + pts.offer) / 2;
  const outrightMid = mid + (op.forward ? fwdPtsMid : 0);
  const half = scenarioHalf + clientSpread;
  const bid = outrightMid - half;
  const offer = outrightMid + half;

  return {
    ...base, tradable: true, route, bid, offer, fwdPtsMid,
    valueDateISO: toISO(valueDate(op.id, pair, tenorDays, today)),
    components: [
      { label: "Mid (feed)", value: mid.toFixed(pair.decimals) },
      ...(op.forward ? [{ label: `Puntos fwd (${pts.tenor})`, value: `${pts.bid.toFixed(3)} / ${pts.offer.toFixed(3)} → mid ${fwdPtsMid.toFixed(3)}` }] : []),
      ...(op.forward ? [{ label: "Mid outright", value: outrightMid.toFixed(pair.decimals) }] : []),
      { label: `Escenario (${scenario.label} ×${scenario.bandMultiplier})`, value: `± ${scenarioHalf.toFixed(3)}` },
      { label: "Spread cliente", value: `± ${clientSpread}` },
      { label: "Half total", value: `± ${half.toFixed(3)}` },
    ],
    note: route === "rfq" ? "Monto > autotrade → RFQ (pide precio al trader)."
      : route === "referential" ? "Cliente en mira → precio referencial hasta que el trader confirme."
      : overLine ? "⚠ Monto sobre la línea del cliente." : undefined,
  };
}
