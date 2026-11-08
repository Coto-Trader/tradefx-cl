import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { MockFeed } from "./engine/feed";
import { OPERATIONS, SCENARIOS, isMarketOpen } from "./engine/model";
import { priceQuote } from "./engine/pricing";
import { CLIENTS, PAIRS, POINTS, SEEDS } from "./state/defaults";

const TENORS = [
  { label: "1W", days: 7 }, { label: "1M", days: 30 }, { label: "3M", days: 90 },
  { label: "6M", days: 180 }, { label: "1Y", days: 360 },
];

const ROUTE_LABEL: Record<string, string> = {
  autotrade: "AUTOTRADE", rfq: "RFQ", referential: "REFERENCIAL", blocked: "BLOQUEADO", market_closed: "CERRADO",
};

function fmtAmt(n: number) { return n.toLocaleString("es-CL", { maximumFractionDigits: 0 }); }

export function App() {
  const [role, setRole] = useState<"trader" | "cliente">("trader");
  const [pairId, setPairId] = useState("USDCLP");
  const [opId, setOpId] = useState("T2");
  const [clientId, setClientId] = useState("A");
  const [scenarioId, setScenarioId] = useState("NORMAL");
  const [tenorDays, setTenorDays] = useState(30);
  const [amount, setAmount] = useState(500_000);

  const feedRef = useRef<MockFeed>(new MockFeed(SEEDS));
  const [, tick] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    const id = setInterval(() => { feedRef.current.step(); tick(); }, 700);
    return () => clearInterval(id);
  }, []);

  const pair = PAIRS.find((p) => p.id === pairId)!;
  const op = OPERATIONS.find((o) => o.id === opId)!;
  const client = CLIENTS.find((c) => c.id === clientId)!;
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;
  const open = isMarketOpen(pair);

  const quote = useMemo(
    () => priceQuote({ pair, op, scenario, client, feed: feedRef.current, points: POINTS, tenorDays, amountUSD: amount }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pair, op, scenario, client, tenorDays, amount, feedRef.current.mid(pairId)]
  );

  // animación de tick
  const prev = useRef<{ bid?: number; offer?: number }>({});
  const bidCls = quote.bid != null && prev.current.bid != null ? (quote.bid > prev.current.bid ? "tick-up" : quote.bid < prev.current.bid ? "tick-dn" : "") : "";
  const offCls = quote.offer != null && prev.current.offer != null ? (quote.offer > prev.current.offer ? "tick-up" : quote.offer < prev.current.offer ? "tick-dn" : "") : "";
  prev.current = { bid: quote.bid, offer: quote.offer };

  const px = (v: number) => {
    const s = v.toFixed(pair.decimals);
    const cut = s.length - 2;
    return <><span>{s.slice(0, cut)}</span><span className="big">{s.slice(cut)}</span></>;
  };

  return (
    <>
      <div className="ribbon">
        <a href="https://tradeai.cl" target="_blank" rel="noreferrer">Suite TradeAI ↗</a>
        <span className="sep">|</span>
        <a href="https://tradeswap.cl" target="_blank" rel="noreferrer">TradeSwap ↗</a>
        <span className="sep">|</span>
        <span className="here">TradeFX</span>
        <span className="spacer" />
        <div className="seg">
          <button className={role === "trader" ? "on" : ""} onClick={() => setRole("trader")}>Trader</button>
          <button className={role === "cliente" ? "on" : ""} onClick={() => setRole("cliente")}>Cliente</button>
        </div>
      </div>

      <div className="header">
        <h1>Trade<span className="accent">FX</span> · Pantalla de Dealing</h1>
        <div className="sub">
          Spot t0/t+1/t+2 · Forward/NDF · FX Swap — pricing en vivo · escenarios · spread por cliente
          &nbsp;·&nbsp; <span className="dot live" style={{ display: "inline-block" }} /> feed <span className={`badge ${feedRef.current.source() === "MOCK" ? "mock" : "live"}`}>{feedRef.current.source()}</span>
        </div>
      </div>

      <div className="main">
        {/* Controles */}
        <div className="panel">
          <div className="panel-head">
            <h2>Condiciones</h2>
            <span className="hint">{role === "cliente" ? "vista cliente" : "vista trader"}</span>
            <span className="spacer" />
            <span className={`badge ${open ? "live" : "closed"}`}>mercado {open ? "abierto" : "cerrado"}</span>
          </div>
          <div className="panel-body">
            <div className="grid c4" style={{ marginBottom: 12 }}>
              <label className="field"><span className="lbl">Par</span>
                <select value={pairId} onChange={(e) => setPairId(e.target.value)}>
                  {PAIRS.map((p) => <option key={p.id} value={p.id}>{p.base}/{p.quote}</option>)}
                </select></label>
              <label className="field"><span className="lbl">Cliente</span>
                <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  {CLIENTS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></label>
              <label className="field"><span className="lbl">Monto ({pair.base})</span>
                <input type="number" value={amount} onChange={(e) => setAmount(parseFloat(e.target.value || "0"))} /></label>
              <label className="field"><span className="lbl">Autotrade máx</span>
                <input value={fmtAmt(client.autoTradeMaxUSD)} readOnly /></label>
            </div>

            <div className="grid c2">
              <label className="field"><span className="lbl">Operación</span>
                <div className="seg" style={{ flexWrap: "wrap" }}>
                  {OPERATIONS.map((o) => (
                    <button key={o.id} className={opId === o.id ? "on" : ""} onClick={() => setOpId(o.id)}>{o.label}</button>
                  ))}
                </div></label>
              {(op.forward && op.id !== "T1" && op.id !== "T2") ? (
                <label className="field"><span className="lbl">Plazo</span>
                  <div className="seg">
                    {TENORS.map((t) => (
                      <button key={t.days} className={tenorDays === t.days ? "on" : ""} onClick={() => setTenorDays(t.days)}>{t.label}</button>
                    ))}
                  </div></label>
              ) : <div />}
            </div>

            {role === "trader" && (
              <label className="field" style={{ marginTop: 12 }}><span className="lbl">Escenario (lever del trader)</span>
                <div className="seg">
                  {SCENARIOS.map((s) => (
                    <button key={s.id} className={scenarioId === s.id ? "on" : ""} onClick={() => setScenarioId(s.id)}>{s.label}</button>
                  ))}
                </div></label>
            )}
          </div>
        </div>

        {/* Cotización en vivo */}
        <div className="panel">
          <div className="panel-head">
            <h2>{pair.base}/{pair.quote} · {op.label}{op.forward && op.id !== "T1" && op.id !== "T2" ? ` ${TENORS.find((t) => t.days === tenorDays)?.label}` : ""}</h2>
            <span className="spacer" />
            <span className={`badge ${quote.route === "autotrade" ? "live" : quote.route === "blocked" || quote.route === "market_closed" ? "closed" : "mock"}`}>{ROUTE_LABEL[quote.route]}</span>
          </div>
          <div className="panel-body">
            {!quote.tradable ? (
              <div className="notice"><b>No operable.</b> {quote.note}</div>
            ) : op.twoLegs ? (
              <>
                <div className="quote">
                  <div className={`tile bid ${bidCls}`}>
                    <div className="side">Puntos bid</div>
                    <div className="px">{quote.swapBidPts?.toFixed(3)}</div>
                    <div className="sub">pata corta {quote.nearDateISO}</div>
                  </div>
                  <div className="mid-chip">
                    <div className="k">FX Swap</div>
                    <div className="v">{((quote.swapBidPts! + quote.swapOfferPts!) / 2).toFixed(3)}</div>
                    <div className="spr">pts netos</div>
                  </div>
                  <div className={`tile offer ${offCls}`}>
                    <div className="side">Puntos offer</div>
                    <div className="px">{quote.swapOfferPts?.toFixed(3)}</div>
                    <div className="sub">pata larga {quote.farDateISO}</div>
                  </div>
                </div>
              </>
            ) : (
              <div className="quote">
                <div className={`tile bid ${bidCls}`}>
                  <div className="side">Bid · mesa compra {pair.base}</div>
                  <div className="px">{px(quote.bid!)}</div>
                  <div className="sub">vta {quote.valueDateISO}</div>
                  <div className="act"><button className="btn" disabled>{quote.route === "rfq" ? "Pedir precio" : "Pegar ▸"}</button></div>
                </div>
                <div className="mid-chip">
                  <div className="k">Mid</div>
                  <div className="v">{quote.mid?.toFixed(pair.decimals)}</div>
                  <div className="spr">spread {(quote.offer! - quote.bid!).toFixed(pair.decimals)}</div>
                </div>
                <div className={`tile offer ${offCls}`}>
                  <div className="side">Offer · mesa vende {pair.base}</div>
                  <div className="px">{px(quote.offer!)}</div>
                  <div className="sub">vta {quote.valueDateISO}</div>
                  <div className="act"><button className="btn" disabled>{quote.route === "rfq" ? "Pedir precio" : "◂ Pegar"}</button></div>
                </div>
              </div>
            )}

            {quote.note && quote.tradable && <div className="notice" style={{ marginTop: 12 }}>{quote.note}</div>}

            {/* breakdown */}
            {quote.components.length > 0 && (
              <table className="tbl" style={{ marginTop: 14 }}>
                <thead><tr><th>Componente</th><th className="num">Valor</th></tr></thead>
                <tbody>{quote.components.map((c, i) => (
                  <tr key={i}><td className="dim">{c.label}</td><td className="num">{c.value}</td></tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>

        <div className="notice">
          <b>Slice 1 (este):</b> motor de precio en vivo (mid → escenario → spread cliente → grillas → bid/offer). &nbsp;
          <b>Siguiente:</b> ejecución (autotrade con ventana no-cerrable del trader), RFQ con claim por primer trader, confirmaciones dobles y TradeChat — y el feed real (BBG/Datatec) por la interfaz. Hoy el feed es <b>MOCK</b>.
        </div>
      </div>
    </>
  );
}
