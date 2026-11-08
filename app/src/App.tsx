import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { MockFeed } from "./engine/feed";
import { OPERATIONS, SCENARIOS, isMarketOpen } from "./engine/model";
import { priceQuote } from "./engine/pricing";
import { BroadcastDealBus, Deal, DealSide, deskNetByPair, getTraderId, newDealId } from "./engine/deals";
import { BroadcastChatBus, ChatMsg, newMsgId, threadsForDesk } from "./engine/chat";
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
  const [quoteIn, setQuoteIn] = useState<Record<string, string>>({});
  const traderId = useRef(getTraderId()).current;
  const traderName = "Trader " + traderId;

  const feedRef = useRef<MockFeed>(new MockFeed(SEEDS));
  const busRef = useRef<BroadcastDealBus>(new BroadcastDealBus());
  const chatBusRef = useRef<BroadcastChatBus>(new BroadcastChatBus());
  const [deals, setDeals] = useState<Deal[]>([]);
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [selThread, setSelThread] = useState("A");
  const [, tick] = useReducer((x) => x + 1, 0);

  useEffect(() => {
    const id = setInterval(() => { feedRef.current.step(); tick(); }, 700);
    const unsub = busRef.current.subscribe(setDeals);
    const unsubChat = chatBusRef.current.subscribe(setChatMsgs);
    return () => { clearInterval(id); unsub(); unsubChat(); };
  }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); }, [toast]);

  const pair = PAIRS.find((p) => p.id === pairId)!;
  const op = OPERATIONS.find((o) => o.id === opId)!;
  const client = CLIENTS.find((c) => c.id === clientId)!;
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;
  const open = isMarketOpen(pair);

  useEffect(() => {
    const threadId = role === "trader" ? selThread : client.id;
    chatBusRef.current.markRead(threadId, role === "trader" ? "desk" : "client");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, selThread, client.id, chatMsgs.length]);

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
    setToast("RFQ enviado a la mesa. Mirá 'Mis RFQ' para el precio.");
  }
  function acknowledge(id: string) {
    const d = deals.find((x) => x.id === id);
    if (d) {
      busRef.current.publish({ ...d, status: "confirmed", acknowledgedByTrader: true, byTrader: traderName });
      postSystem(d.clientId, `✓ ${d.operation}${d.tenorLabel ? " " + d.tenorLabel : ""} · ${d.side === "client_buys" ? "compra" : "venta"} ${fmtAmt(d.amountBase)} ${d.base} @ ${d.rate.toFixed(decimalsOf(d.pair))} — confirmado`);
    }
  }
  // --- RFQ ---
  function claim(id: string) {
    const d = deals.find((x) => x.id === id);
    if (d && d.status === "pending_rfq") {
      busRef.current.publish({ ...d, status: "claimed", claimedBy: traderId, claimedByName: traderName });
      const mid = feedRef.current.mid(d.pair);
      if (mid != null) setQuoteIn((q) => ({ ...q, [id]: (d.side === "client_buys" ? mid + 0.3 : mid - 0.3).toFixed(decimalsOf(d.pair)) }));
    }
  }
  function giveQuote(id: string) {
    const d = deals.find((x) => x.id === id);
    const r = parseFloat(quoteIn[id] ?? "");
    if (d && d.status === "claimed" && d.claimedBy === traderId && isFinite(r) && r > 0)
      busRef.current.publish({ ...d, status: "quoted", quotedRate: r });
  }
  function clientAccept(id: string) {
    const d = deals.find((x) => x.id === id);
    if (d && d.status === "quoted") {
      busRef.current.publish({ ...d, status: "confirmed", rate: d.quotedRate!, acknowledgedByTrader: true });
      postSystem(d.clientId, `✓ RFQ ${d.operation} · ${d.side === "client_buys" ? "compra" : "venta"} ${fmtAmt(d.amountBase)} ${d.base} @ ${d.quotedRate!.toFixed(decimalsOf(d.pair))} — confirmado con ${d.claimedByName ?? "la mesa"}`);
    }
  }
  function clientReject(id: string) {
    const d = deals.find((x) => x.id === id);
    if (d && (d.status === "quoted" || d.status === "pending_rfq" || d.status === "claimed")) busRef.current.publish({ ...d, status: "rejected" });
  }
  // --- TradeChat ---
  function postSystem(clientId: string, text: string) {
    chatBusRef.current.publish({ id: newMsgId(), ts: Date.now(), clientId, from: "desk", fromName: "Sistema", text, system: true });
  }
  function sendChat() {
    const text = chatInput.trim();
    if (!text) return;
    const threadId = role === "trader" ? selThread : client.id;
    chatBusRef.current.publish({
      id: newMsgId(), ts: Date.now(), clientId: threadId,
      from: role === "trader" ? "desk" : "client",
      fromName: role === "trader" ? traderName : (CLIENTS.find((c) => c.id === threadId)?.name ?? threadId),
      text,
    });
    setChatInput("");
  }

  // ventana no-cerrable del trader
  const pendingAck = role === "trader"
    ? deals.filter((d) => d.route === "autotrade" && d.status === "executed" && !d.acknowledgedByTrader).sort((a, b) => a.ts - b.ts)
    : [];
  const ack = pendingAck[0];
  const rfqActive = (d: Deal) => d.route === "rfq" && (d.status === "pending_rfq" || d.status === "claimed" || d.status === "quoted");
  const rfqInbox = role === "trader" ? deals.filter(rfqActive).sort((a, b) => a.ts - b.ts) : [];
  const clientRfqs = role === "cliente" ? deals.filter((d) => rfqActive(d) && d.clientId === client.id).sort((a, b) => b.ts - a.ts) : [];

  // blotter (confirmación doble): trader ve todo; cliente ve lo suyo
  const blotter = (role === "trader" ? deals : deals.filter((d) => d.clientId === client.id))
    .filter((d) => d.status === "executed" || d.status === "confirmed").slice(0, 12);
  const net = deskNetByPair(deals);

  const canHit = quote.tradable && !op.twoLegs && (quote.route === "autotrade" || quote.route === "rfq");
  const hitLabel = (side: DealSide) => quote.route === "rfq" ? "Pedir precio" : side === "client_buys" ? `Comprar ${pair.base} ▸` : `◂ Vender ${pair.base}`;
  const onHit = (side: DealSide) => quote.route === "rfq" ? requestRFQ(side) : execute(side);

  // --- chat render ---
  const chatThread = role === "trader" ? selThread : client.id;
  const threadMsgs = chatMsgs.filter((m) => m.clientId === chatThread).sort((a, b) => a.ts - b.ts);
  const deskThreads = role === "trader" ? threadsForDesk(chatMsgs) : [];
  const totalUnread = deskThreads.reduce((s, t) => s + t.unread, 0);
  const isMine = (m: ChatMsg) => (role === "trader" && m.from === "desk" && !m.system) || (role === "cliente" && m.from === "client");
  const convNode = (
    <div className="conv">
      <div className="msgs">
        {threadMsgs.length === 0 ? (
          <div className="chat-empty">Sin mensajes. Escribí para {role === "trader" ? "responder al cliente" : "hablar con la mesa"}.</div>
        ) : threadMsgs.map((m) => (
          <div key={m.id} className={`bubble ${m.system ? "sys" : isMine(m) ? "me" : "them"}`}>
            {!m.system && <div className="who">{m.fromName}</div>}
            <span>{m.text}</span>
          </div>
        ))}
      </div>
      <div className="chat-input">
        <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") sendChat(); }}
          placeholder={role === "trader" ? `Responder a ${CLIENTS.find((c) => c.id === selThread)?.name ?? ""}` : "Mensaje a la mesa…"} />
        <button className="btn primary" onClick={sendChat}>Enviar</button>
      </div>
    </div>
  );

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
        {role === "trader" && <span className="role" title="identidad de trader (por ventana)">{traderId}</span>}
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

        {/* Cliente: mis RFQ (esperar / aceptar / rechazar) */}
        {role === "cliente" && clientRfqs.length > 0 && (
          <div className="panel">
            <div className="panel-head"><h2>Mis RFQ</h2><span className="hint">pediste precio a la mesa</span></div>
            <div className="panel-body"><table className="tbl">
              <thead><tr><th>Par · Op</th><th>Lado</th><th className="num">Monto</th><th>Estado</th><th></th></tr></thead>
              <tbody>{clientRfqs.map((d) => (
                <tr key={d.id}>
                  <td className="dim">{d.pair} {d.operation}{d.tenorLabel ? " " + d.tenorLabel : ""}</td>
                  <td className={d.side === "client_buys" ? "pos" : "neg"}>{d.side === "client_buys" ? "compra" : "vende"}</td>
                  <td className="num">{fmtAmt(d.amountBase)} {d.base}</td>
                  <td>
                    {d.status === "pending_rfq" && <span className="muted">esperando mesa…</span>}
                    {d.status === "claimed" && <span className="dim">{d.claimedByName} cotizando…</span>}
                    {d.status === "quoted" && <span className="pos mono">precio {d.quotedRate?.toFixed(decimalsOf(d.pair))}</span>}
                  </td>
                  <td className="num">
                    {d.status === "quoted" ? (
                      <div className="btn-row" style={{ justifyContent: "flex-end" }}>
                        <button className="btn primary" onClick={() => clientAccept(d.id)}>Aceptar</button>
                        <button className="btn" onClick={() => clientReject(d.id)}>Rechazar</button>
                      </div>
                    ) : <button className="btn ghost" onClick={() => clientReject(d.id)}>Cancelar</button>}
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          </div>
        )}

        {/* Trader: bandeja RFQ (tomar / dar precio) */}
        {role === "trader" && rfqInbox.length > 0 && (
          <div className="panel">
            <div className="panel-head"><h2>RFQ entrantes</h2><span className="hint">el primero que toma, cotiza (lock)</span></div>
            <div className="panel-body"><table className="tbl">
              <thead><tr><th>Cliente</th><th>Par · Op</th><th>Lado</th><th className="num">Monto</th><th>Acción</th></tr></thead>
              <tbody>{rfqInbox.map((d) => {
                const mine = d.claimedBy === traderId;
                return (
                  <tr key={d.id}>
                    <td>{d.clientName}</td>
                    <td className="dim">{d.pair} {d.operation}{d.tenorLabel ? " " + d.tenorLabel : ""}</td>
                    <td className={d.side === "client_buys" ? "pos" : "neg"}>{d.side === "client_buys" ? "compra" : "vende"}</td>
                    <td className="num">{fmtAmt(d.amountBase)} {d.base}</td>
                    <td>
                      {d.status === "pending_rfq" && (
                        <div className="btn-row"><button className="btn primary" onClick={() => claim(d.id)}>Tomar</button><button className="btn ghost" onClick={() => clientReject(d.id)}>Pasar</button></div>
                      )}
                      {d.status === "claimed" && mine && (
                        <div className="btn-row" style={{ alignItems: "center" }}>
                          <input style={{ width: 90 }} value={quoteIn[d.id] ?? ""} onChange={(e) => setQuoteIn((q) => ({ ...q, [d.id]: e.target.value }))} />
                          <button className="btn primary" onClick={() => giveQuote(d.id)}>Dar precio</button>
                        </div>
                      )}
                      {d.status === "claimed" && !mine && <span className="muted">tomado por {d.claimedByName}</span>}
                      {d.status === "quoted" && <span className="dim">{mine ? "cotizado" : `por ${d.claimedByName}`} @ {d.quotedRate?.toFixed(decimalsOf(d.pair))} — esperando cliente</span>}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table></div>
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

        <div className="panel">
          <div className="panel-head">
            <h2>TradeChat</h2>
            <span className="hint">{role === "cliente" ? "con la Mesa" : "hilos por cliente"}</span>
            <span className="spacer" />
            {role === "trader" && totalUnread > 0 && <span className="badge closed">{totalUnread} sin leer</span>}
          </div>
          <div className="panel-body">
            {role === "trader" ? (
              <div className="chat-grid">
                <div className="threads">
                  {deskThreads.length === 0 ? <div className="chat-empty" style={{ padding: 14 }}>sin hilos</div> :
                    deskThreads.map((t) => (
                      <div key={t.clientId} className={`thread ${selThread === t.clientId ? "on" : ""}`} onClick={() => setSelThread(t.clientId)}>
                        <span className="nm">{CLIENTS.find((c) => c.id === t.clientId)?.name ?? t.clientId}</span>
                        {t.unread > 0 && <span className="unread">{t.unread}</span>}
                      </div>
                    ))}
                </div>
                {convNode}
              </div>
            ) : convNode}
          </div>
        </div>

        <div className="notice">
          <b>Slices 3–5 (este):</b> autotrade + <b>ventana no-cerrable</b>, <b>RFQ completo</b> (claim/lock + cotización + accept/reject), y <b>TradeChat</b> cliente↔mesa (con aviso de confirmación). Sync por BroadcastChannel. &nbsp;
          <b>Siguiente:</b> ejecución FX swap, feed real (BBG/Datatec) y Supabase.
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
