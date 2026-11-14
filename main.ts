// Washout-bounce bot for the btc-race-24h-20261113-2314 race.
//
// Strategy: long only, one position, very selective. BTC spends most of
// a 24h window chopping, and a full-size round trip costs ~26 bps in
// fees, slippage and price impact, so trading often bleeds. This bot
// waits for a real washout and buys only the bounce off it:
//
//   - Entry: over the trailing 240 one-minute bars the price fell at
//     least 3% from its high to its low, that low was set within the
//     last 45 bars, and the latest close has bounced at least 0.8%
//     above the low. Buy with all cash.
//   - Exit: the whole position when its value is 1.5% over its cost
//     (take profit), 1.0% under its cost (stop loss), or after 300
//     bars held (time exit, so a flat position does not sit through
//     the rest of the window).
//
// All comparisons are bigint math on the harness's raw price units, so
// the two graded runs answer identically. No clock, no environment, no
// randomness: the bot's only inputs are the hello, the batches and the
// fills the harness sends. Orders are decided on one bar's close and
// fill at the next bar's open; max_slippage_bps 100 (1%) caps how far
// a fill may move from the close the order was decided on.
//
// The replay speaks agent-fun/bars-replay/v1; vendor/makefun-bars.ts
// is the kit's TypeScript shim, copied byte for byte, and owns the
// wire: it reads the hello, applies each batch to the state, and writes
// exactly one reply per batch echoing its seq.

import { BPS, runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// Trailing window (bars) the washout is measured over.
const LOOKBACK_BARS = 240;
// The low must have been set within this many bars of the entry bar.
const LOW_RECENCY_BARS = 45;
// Entry needs a drawdown of at least this many bps from the window
// high to the window low (300 bps = 3%).
const MIN_DRAWDOWN_BPS = 300n;
// Entry needs the close at least this many bps above the window low
// (80 bps = 0.8%).
const MIN_BOUNCE_BPS = 80n;
// Take profit / stop loss, in bps of the position's cost.
const TAKE_PROFIT_BPS = 150n;
const STOP_LOSS_BPS = 100n;
// Longest a position is held, in bars.
const MAX_HOLD_BARS = 300;
// No new entries once this many bars of the window have been seen
// (the window is 1440 bars; a buy in the last 60 would just pay
// round-trip costs to the final flatten).
const ENTRY_CUTOFF_BARS = 1380;
// Slippage cap on every order, in bps from the latest close.
const MAX_SLIPPAGE_BPS = 100;

/** The strategy state: the closes seen so far and the entry bar. */
class WashoutBot {
  // Closes in raw price units, one per CBBTC bar, in order.
  closes: bigint[] = [];
  // Close time (ms) of the last bar recorded, so a batch that carries
  // no new CBBTC bar does not record the same close twice.
  lastT: number | null = null;
  // Index into closes of the bar the current position was entered on.
  entryBar: number | null = null;

  onBatch(state: BarsState): (BuyInput | SellInput)[] {
    // Record this batch's CBBTC bar, if it carried a new one. A minute
    // the recorder missed has no bar and adds nothing.
    const bar = state.latest.get(SYMBOL);
    if (bar !== undefined && bar.t !== this.lastT) {
      this.closes.push(BigInt(bar.c));
      this.lastT = bar.t;
    }
    if (state.warmingUp) return [];
    const held = state.positions.get(SYMBOL);
    if (held !== undefined) return this.maybeExit(state, held);
    return this.maybeEnter(state);
  }

  maybeExit(state: BarsState, held: { qty: bigint; cost: bigint }): SellInput[] {
    const value = state.value(SYMBOL, held.qty);
    const cost = held.cost;
    if (cost > 0n) {
      if (value * BPS >= cost * (BPS + TAKE_PROFIT_BPS)) return [this.sell(held)];
      if (value * BPS <= cost * (BPS - STOP_LOSS_BPS)) return [this.sell(held)];
    }
    if (this.entryBar !== null && this.closes.length - this.entryBar >= MAX_HOLD_BARS) {
      return [this.sell(held)];
    }
    return [];
  }

  maybeEnter(state: BarsState): BuyInput[] {
    const n = this.closes.length;
    if (n < LOOKBACK_BARS || n >= ENTRY_CUTOFF_BARS) return [];
    const window = this.closes.slice(n - LOOKBACK_BARS);
    let low = window[0];
    let high = window[0];
    for (const c of window) {
      if (c < low) low = c;
      if (c > high) high = c;
    }
    // The washout: high to low fell at least MIN_DRAWDOWN_BPS.
    if (low * BPS > high * (BPS - MIN_DRAWDOWN_BPS)) return [];
    // The low must be recent: set within LOW_RECENCY_BARS bars.
    let lowAge = 0;
    for (let i = window.length - 1; i >= 0; i--) {
      if (window[i] === low) {
        lowAge = window.length - 1 - i;
        break;
      }
    }
    if (lowAge > LOW_RECENCY_BARS) return [];
    // The bounce: the latest close is MIN_BOUNCE_BPS above the low.
    const close = this.closes[n - 1];
    if (close * BPS < low * (BPS + MIN_BOUNCE_BPS)) return [];
    const cash = state.cash;
    if (cash < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    this.entryBar = n - 1;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  }

  sell(held: { qty: bigint; cost: bigint }): SellInput {
    return { side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
  }
}

const bot = new WashoutBot();
await runBars({ onBatch: (state) => bot.onBatch(state) });
