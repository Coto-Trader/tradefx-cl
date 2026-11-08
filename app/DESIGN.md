# TradeFX — Diseño

Pantalla de **FX dealing** de la Suite TradeAI: pricing en tiempo real, escenarios
de mercado, spreads por cliente, autotrade / RFQ, confirmaciones y TradeChat.

## Decisiones de arquitectura

- **Front:** React + TS estático (igual que el resto de la suite), desplegable en
  Pages / `tradefx.cl`. El `base` de Vite es relativo (`./`).
- **Tiempo real / multiusuario:** hoy **sin backend**. Trader y Cliente son dos
  *vistas*; para el demo de dos pantallas se sincroniza por `BroadcastChannel`
  (dos ventanas, misma máquina). Cuando vaya a cliente real → **Supabase**
  (Postgres + Realtime + Auth + RLS) sin tocar la lógica de precio.
- **Feed de precio:** interfaz `PriceFeed`. Hoy `MockFeed` (random-walk, siempre
  disponible). `BbgFeed` queda como adapter (requiere terminal logueada +
  licencia, o la API de pago/Datatec cuando se contrate). Se enchufa sin tocar el
  motor de precio.
- **Alcance:** mecanismo completo en modo **interno/demo, feed MOCK, sin
  settlement real**. Enganchar ejecución/liquidación real es un paso aparte y
  regulado.

## Actores

- **Trader** (perfil trader): fija escenario, da de alta clientes, spreads,
  líneas, umbral de autotrade; recibe RFQ y la ventana de aceptación.
- **Cliente** (perfil cliente): setea condiciones, pincha precio (autotrade) o
  pide RFQ.

## Operaciones

`T0` (valuta cero, exige mercado abierto) · `T1` · `T2` (spot) · `FWD` (físico) ·
`NDF` · `FX Swap` (pata corta + larga). *(Estrategia: pendiente.)*

## Pipeline de precio

```
mid (feed)                        ── Datatec/BBG en vivo (hoy MOCK)
  → escenario  (Normal ±band ×mult; Volátil, Highly, Pánico)
  → spread por cliente (spot vs fwd)
  → grillas: VALUTAS (fecha valor por operación/moneda) + PUNTOS (fwd points bid/offer)
  → BID / OFFER en pantalla   (el peor precio; el trader lo deja o lo mejora)
```

- **Outright (spot/fwd/ndf):** `outrightMid = mid + fwdPtsMid`;
  `bid/offer = outrightMid ∓ (escenarioHalf + spreadCliente)`.
- **FX Swap:** puntos neteados `far − near` (bid/offer cruzados) + spread swap.
- **Ruteo:** `blocked` (sin línea) · `market_closed` (t0 fuera de hora) ·
  `referential` (cliente en mira) · `rfq` (monto > autotrade) · `autotrade`.

## Modelo de datos (ver `src/engine/model.ts`)

`Pair` · `Operation` · `Scenario` · `ClientConfig` (status, línea, autoTradeMax,
spreadSpot, spreadFwd) · `PointsGrid` · `Quote`.

## Pantallas

1. **Dealing (hecho, slice 1):** condiciones (par, operación, plazo, cliente,
   monto) + escenario (trader) + **bid/offer en vivo** + breakdown + ruteo.
2. **Admin de clientes (trader):** alta/edición de spreads, líneas, umbral,
   estado (normal/mira/bloqueado), elegibilidad de escenario.
3. **Ejecución:** autotrade → ventana de aceptación **no-cerrable** en el trader;
   RFQ → broadcast a traders, **claim del primero**, precio, aceptación, y
   **confirmación doble** (estilo Bloomberg).
4. **TradeChat:** 1:1 cliente↔mesa, en tiempo real, persistente.
5. **Blotter / confirmaciones:** ticket por operación; engancha con **TradeBlotter**.

## Roadmap de slices

1. ✔ Motor de precio en vivo (este).
2. Admin de clientes + escenarios persistido (Supabase o local).
3. Flujo autotrade (ventana no-cerrable) + confirmación doble.
4. RFQ con claim por primer trader.
5. TradeChat.
6. Feed real (BBG/Datatec) por la interfaz + hosting multiusuario (Supabase).
7. Grillas finas de valutas/puntos y estrategias; emisión de ticket a TradeBlotter.
