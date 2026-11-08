import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { MockFeed } from "./engine/feed";
import { OPERATIONS, SCENARIOS, isMarketOpen } from "./engine/model";
import { priceQuote } from "./engine/pricing";
import { BroadcastDealBus, Deal, DealSide, deskNetByPair, newDealId } from "./engine/deals";
import { CLIENTS, PAIRS, POINTS, SEEDS } from "./state/defaults";

const TENORS = [
  { label: "1W", days: 7 }, { label: "1M", days: 30 }, { label: "3M", days: 90 },
  { label: "6M", days: 180 }, { label: "1Y", days: 360 },
];
const ROUTE_LABEL: Record<string, string> = {
  autotrade: "AUTOTRADE", rfq: "RFQ", referential: "REFERENCIAL", blocked: "BLOQUEADO", market_closed: "CERRADO",
};
const fmtAmt = (n: number) => n.toLocaleString("es-CL", { maximumFractionDigits: 0 });
const decimalsOf = (pairId: string) => PAIRS.find((p) => p.id === pairId)?.decimals ?? 2;

export function App() {
  const [role, setRole] = useState<"trader" | "cliente">("trader");
  const [pairId, setPairId] = useState("USDCLP");
  const [opId, setOpId] = useState("T2");
  const [clientId, setClientId] = useState("A");
  const [scenarioId, setScenarioId] = useState("NORMAL");
  const [tenorDays, setTenorDays] = useState(30);
  const [amount, setAmount] = useState(500_000);
  const [toast, setToast] = useState<string | null>(null);

  const feedRef = useRef<MockFeed>(new MockFeed(SEEDS));
  const busRef = useRef<BroadcastDealBus>(new BroadcastDealBus());
  const [deals, setDeals] = useState<Deal[]>([]);
  const [, tick] = useReducer((x) => x + 1, 0);

  useEffect(() => {
    const id = setInterval(() => { feedRef.current.step(); tick(); }, 700);
    const unsub = busRef.current.subscribe(setDeals);
    return () => { clearInterval(id); unsub(); };
  }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); }, [toast]);

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

  const prev = useRef<{ bid?: number; offer?: number }>({});
  const bidCls = quote.bid != null && prev.current.bid != null ? (quote.bid > prev.current.bid ? "tick-up" : quote.bid < prev.current.bid ? "tick-dn" : "") : "";
  const offCls = quote.offer != null && prev.current.offer != null ? (quote.offer > prev.current.offer ? "tick-up" : quote.offer < prev.current.offer ? "tick-dn" : "") : "";
  prev.current = { bid: quote.bid, offer: quote.offer };

  const px = (v: number) => { const s = v.toFixed(pair.decimals); const c = s.length - 2; return <><span>{s.slice(0, c)}</span><span className="big">{s.slice(c)}</span></>; };
  const tenorLabel = op.forward && op.id !== "T1" && op.id !== "T2" ? TENORS.find((t) => t.days === tenorDays)?.label : undefined;

  // --- ejecución ---
  function execute(side: DealSide) {
    if (!quote.tradable || op.twoLegs || quote.route !== "autotrade") return;
    const rate = side === "client_buys" ? quote.offer! : quote.bid!;
    busRef.current.publish({
      id: newDealId(), ts: Date.now(), clientId: client.id, clientName: client.name,
      pair: pair.id, base: pair.base, operation: op.label, tenorLabel, side,
      amountBase: amount, rate, valueDateISO: quote.valueDateISO, scenario: scenario.label,
      route: "autotrade", status: "executed",
    });
    setToast(`✓ ${side === "client_buys" ? "Compra" : "Venta"} ${fmtAmt(amount)} ${pair.base} @ ${rate.toFixed(pair.decimals)}`);
  }
  function requestRFQ(side: DealSide) {
    if (!quote.tradable || op.twoLegs) return;
    busRef.current.publish({
      id: newDealId(), ts: Date.now(), clientId: client.id, clientName: client.name,
      pair: pair.id, base: pair.base, operation: op.label, tenorLabel, side,
      amountBase: amount, rate: 0, valueDateISO: quote.valueDateISO, scenario: scenario.label,
      route: "rfq", status: "pending_rfq",
    });
    setToast("RFQ enviado a la mesa (cotización = próximo slice).");
  }
  function acknowledge(id: string) {
    const d = deals.find((x) => x.id === id);
    if (d) busRef.current.publish({ ...d, status: "confirmed", acknowledgedByTrader: true, byTrader: "Trader 1" });
  }

  // ventana no-cerrable del trader
  const pendingAck = role === "trader"
    ? deals.filter((d) => d.route === "autotrade" && d.status === "executed" && !d.acknowledgedByTrader).sort((a, b) => a.ts - b.ts)
    : [];
  const ack = pendingAck[0];
  const rfqInbox = role === "trader" ? deals.filter((d) => d.status === "pending_rfq") : [];

  // blotter (confirmación doble): trader ve todo; cliente ve lo suyo
  const blotter = (role === "trader" ? deals : deals.filter((d) => d.clientId === client.id))
    .filter((d) => d.status === "executed" || d.status === "confirmed").slice(0, 12);
  const net = deskNetByPair(deals);

  const canHit = quote.tradable && !op.twoLegs && (quote.route === "autotrade" || quote.route === "rfq");
  const hitLabel = (side: DealSide) => quote.route === "rfq" ? "Pedir precio" : side === "client_buys" ? `Comprar ${pair.base} ▸` : `◂ Vender ${pair.base}`;
  const onHit = (side: DealSide) => quote.route === "rfq" ? requestRFQ(side) : execute(side);

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
          Spot · Forward/NDF · FX Swap — pricing en vivo · autotrade + RFQ · confirmación doble
          &nbsp;·&nbsp; feed <span className={`badge ${feedRef.current.source() === "MOCK" ? "mock" : "live"}`}>{feedRef.current.source()}</span>
          &nbsp;·&nbsp; abrí otra ventana en el otro rol para ver el flujo trader↔cliente
        </div>
      </div>

      <div className="main">
        <div className="panel">
          <div className="panel-head">
            <h2>Condiciones</h2><span className="hint">{role === "cliente" ? "vista cliente" : "vista trader"}</span>
            <span className="spacer" />
            <span className={`badge ${open ? "live" : "closed"}`}>mercado {open ? "abierto" : "cerrado"}</span>
          </div>
          <div className="panel-body">
            <div className="grid c4" style={{ marginBottom: 12 }}>
              <label className="field"><span className="lbl">Par</span>
                <select value={pairId} onChange={(e) => setPairId(e.target.value)}>{PAIRS.map((p) => <option key={p.id} value={p.id}>{p.base}/{p.quote}</option>)}</select></label>
              <label className="field"><span className="lbl">Cliente</span>
                <select value={clientId} onChange={(e) => setClientId(e.target.value)}>{CLIENTS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label className="field"><span className="lbl">Monto ({pair.base})</span>
                <input type="number" value={amount} onChange={(e) => setAmount(parseFloat(e.target.value || "0"))} /></label>
              <label className="field"><span className="lbl">Autotrade máx</span><input value={fmtAmt(client.autoTradeMaxUSD)} readOnly /></label>
            </div>
            <div className="grid c2">
              <label className="field"><span className="lbl">Operación</span>
                <div className="seg" style={{ flexWrap: "wrap" }}>{OPERATIONS.map((o) => <button key={o.id} className={opId === o.id ? "on" : ""} onClick={() => setOpId(o.id)}>{o.label}</button>)}</div></label>
              {(op.forward && op.id !== "T1" && op.id !== "T2") ? (
                <label className="field"><span className="lbl">Plazo</span>
                  <div className="seg">{TENORS.map((t) => <button key={t.days} className={tenorDays === t.days ? "on" : ""} onClick={() => setTenorDays(t.days)}>{t.label}</button>)}</div></label>
              ) : <div />}
            </div>
            {role === "trader" && (
              <label className="field" style={{ marginTop: 12 }}><span className="lbl">Escenario (lever del trader)</span>
                <div className="seg">{SCENARIOS.map((s) => <button key={s.id} className={scenarioId === s.id ? "on" : ""} onClick={() => setScenarioId(s.id)}>{s.label}</button>)}</div></label>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>{pair.base}/{pair.quote} · {op.label}{tenorLabel ? ` ${tenorLabel}` : ""}</h2>
            <span className="spacer" />
            <span className={`badge ${quote.route === "autotrade" ? "live" : quote.route === "blocked" || quote.route === "market_closed" ? "closed" : "mock"}`}>{ROUTE_LABEL[quote.route]}</span>
          </div>
          <div className="panel-body">
            {!quote.tradable ? (
              <div className="notice"><b>No operable.</b> {quote.note}</div>
            ) : op.twoLegs ? (
              <>
                <div className="quote">
                  <div className={`tile bid ${bidCls}`}><div className="side">Puntos bid</div><div className="px">{quote.swapBidPts?.toFixed(3)}</div><div className="sub">pata corta {quote.nearDateISO}</div></div>
                  <div className="mid-chip"><div className="k">FX Swap</div><div className="v">{((quote.swapBidPts! + quote.swapOfferPts!) / 2).toFixed(3)}</div><div className="spr">pts netos</div></div>
                  <div className={`tile offer ${offCls}`}><div className="side">Puntos offer</div><div className="px">{quote.swapOfferPts?.toFixed(3)}</div><div className="sub">pata larga {quote.farDateISO}</div></div>
                </div>
                <div className="notice" style={{ marginTop: 12 }}>Ejecución de FX Swap: próximo slice.</div>
              </>
            ) : (
              <div className="quote">
                <div className={`tile bid ${bidCls}`}>
                  <div className="side">Bid · mesa compra {pair.base}</div>
                  <div className="px">{px(quote.bid!)}</div>
                  <div className="sub">vta {quote.valueDateISO}</div>
                  <div className="act"><button className="btn" disabled={!canHit || role !== "cliente"} onClick={() => onHit("client_sells")}>{hitLabel("client_sells")}</button></div>
                </div>
                <div className="mid-chip"><div className="k">Mid</div><div className="v">{quote.mid?.toFixed(pair.decimals)}</div><div className="spr">spread {(quote.offer! - quote.bid!).toFixed(pair.decimals)}</div></div>
                <div className={`tile offer ${offCls}`}>
                  <div className="side">Offer · mesa vende {pair.base}</div>
                  <div className="px">{px(quote.offer!)}</div>
                  <div className="sub">vta {quote.valueDateISO}</div>
                  <div className="act"><button className="btn primary" disabled={!canHit || role !== "cliente"} onClick={() => onHit("client_buys")}>{hitLabel("client_buys")}</button></div>
                </div>
              </div>
            )}
            {quote.note && quote.tradable && <div className="notice" style={{ marginTop: 12 }}>{quote.note}</div>}
            {role === "trader" && !op.twoLegs && quote.tradable && <div className="notice" style={{ marginTop: 12 }}>Los botones de pegar están en la <b>vista cliente</b>. Cambiá el rol arriba (o abrí otra ventana como Cliente) para disparar un autotrade.</div>}

            {quote.components.length > 0 && (
              <table className="tbl" style={{ marginTop: 14 }}>
                <thead><tr><th>Componente</th><th className="num">Valor</th></tr></thead>
                <tbody>{quote.components.map((c, i) => <tr key={i}><td className="dim">{c.label}</td><td className="num">{c.value}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        </div>

        {role === "trader" && rfqInbox.length > 0 && (
          <div className="panel">
            <div className="panel-head"><h2>RFQ entrantes</h2><span className="hint">cotización = próximo slice</span></div>
            <div className="panel-body"><table className="tbl"><tbody>
              {rfqInbox.map((d) => <tr key={d.id}><td>{d.clientName}</td><td className="dim">{d.pair} {d.operation}</td><td className="num">{fmtAmt(d.amountBase)} {d.base}</td><td className="dim">{d.side === "client_buys" ? "compra" : "vende"}</td></tr>)}
            </tbody></table></div>
          </div>
        )}

        <div className="panel">
          <div className="panel-head">
            <h2>Confirmaciones {role === "trader" ? "· blotter" : "· mis operaciones"}</h2>
            <span className="spacer" />
            {role === "trader" && Object.keys(net).length > 0 && (
              <div className="net">{Object.entries(net).map(([p, v]) => <span key={p} className="cell">pos {p}: <b className={v >= 0 ? "pos" : "neg"}>{v >= 0 ? "+" : ""}{fmtAmt(v)}</b></span>)}</div>
            )}
          </div>
          <div className="panel-body">
            {blotter.length === 0 ? <div className="muted mono" style={{ fontSize: 12 }}>Sin operaciones aún. {role === "cliente" ? "Pegá un precio arriba." : ""}</div> : (
              <table className="tbl">
                <thead><tr><th>Hora</th><th>Cliente</th><th>Par · Op</th><th>Lado</th><th className="num">Monto</th><th className="num">Precio</th><th>Estado</th></tr></thead>
                <tbody>{blotter.map((d) => (
                  <tr key={d.id}>
                    <td className="dim">{new Date(d.ts).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
                    <td>{d.clientName}</td>
                    <td className="dim">{d.pair} {d.operation}{d.tenorLabel ? " " + d.tenorLabel : ""}</td>
                    <td className={d.side === "client_buys" ? "pos" : "neg"}>{d.side === "client_buys" ? "compra" : "vende"}</td>
                    <td className="num">{fmtAmt(d.amountBase)} {d.base}</td>
                    <td className="num">{d.rate.toFixed(decimalsOf(d.pair))}</td>
                    <td><span className={`badge ${d.status === "confirmed" ? "live" : "mock"}`}>{d.status === "confirmed" ? "confirmado" : "sin gestionar"}</span></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>

        <div className="notice">
          <b>Slice 3 (este):</b> autotrade (cliente pega → cierra), <b>ventana no-cerrable</b> en el trader hasta gestionar, y <b>confirmación doble</b> (blotter en ambas pantallas, sync por BroadcastChannel). &nbsp;
          <b>Siguiente:</b> RFQ con claim + cotización, FX swap, feed real y Supabase.
        </div>
      </div>

      {/* Ventana de aceptación NO-CERRABLE del trader */}
      {ack && (
        <div className="overlay">
          <div className="modal">
            <div className="mh"><span className="t">⚠ Autotrade ejecutado</span><span className="q">{pendingAck.length > 1 ? `+${pendingAck.length - 1} en cola` : ""}</span></div>
            <div className="mb">
              <div className="big-rate">{ack.pair} @ {ack.rate.toFixed(decimalsOf(ack.pair))}</div>
              <div className="kv" style={{ marginTop: 10 }}>
                <span className="k">Cliente</span><span className="v">{ack.clientName}</span>
                <span className="k">Operación</span><span className="v">{ack.operation}{ack.tenorLabel ? " " + ack.tenorLabel : ""}</span>
                <span className="k">Lado</span><span className="v">{ack.side === "client_buys" ? `cliente compra ${ack.base}` : `cliente vende ${ack.base}`}</span>
                <span className="k">Monto</span><span className="v">{fmtAmt(ack.amountBase)} {ack.base}</span>
                <span className="k">Fecha valor</span><span className="v">{ack.valueDateISO}</span>
                <span className="k">Escenario</span><span className="v">{ack.scenario}</span>
              </div>
              <div className="lock">🔒 No se puede cerrar hasta gestionar la posición.</div>
            </div>
            <div className="mf"><button className="btn primary" onClick={() => acknowledge(ack.id)}>Visto — gestioné la posición</button></div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
