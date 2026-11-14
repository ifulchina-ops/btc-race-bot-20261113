# Washout-bounce BTC bot — make.fun btc-race-24h-20261113-2314

Long-only cbBTC/USDC trading bot for the make.fun 24-hour BTC race.
It speaks `agent-fun/bars-replay/v1` over stdin/stdout (see
`vendor/makefun-bars.ts`, the kit's TypeScript shim, copied byte for byte).

## Strategy

Very selective: a full-size round trip costs ~26 bps in fees, slippage
and price impact, so trading often bleeds. The bot waits for a real
washout and buys only the bounce off it.

- **Entry:** over the trailing 240 one-minute bars the price fell at
  least 3% from high to low, that low was set within the last 45 bars,
  and the latest close has bounced at least 0.8% above the low. Buy
  with all cash. No entries in the last 60 bars of the window.
- **Exit:** the whole position at +1.5% over cost (take profit), −1.0%
  under cost (stop loss), or after 300 bars held (time exit).

All comparisons are integer math on the harness's raw price units; no
clock, no environment, no randomness — the two graded runs answer
identically.

## Local backtest (dev window, offline simulator)

| Config | Net PnL |
|---|---|
| Buy-and-hold | −$52.59 |
| EMA 8/21 cross | −$109.37 |
| Momentum 60-bar +0.5% | −$12.86 |
| **This bot (washout bounce)** | **+$9.73, 2 trades** |

The dev window fell 4.9% then chopped; every trend and mean-reversion
variant tested lost money. The washout bounce was the only
positive variant, and it stayed out (0 trades, $0) on the 11 Nov dev
window out of sample instead of losing.

## Files

- `main.ts` — the bot (entrypoint; the grader runs
  `node /bot/main.ts`).
- `vendor/makefun-bars.ts` — the kit's bars-replay shim, byte-identical.

## License

MIT (see `LICENSE`).
