# Skew-3D-Implied-Volatility

Cloudflare Worker + KV API for 3D implied-volatility surfaces and near-ATM mispricing research.

**Live worker:** https://skew-3d-implied-volatility-shiny-darkness-9ebb.2s6m8rz8fc.workers.dev/

**Matrix display:** https://skew-3d-implied-volatility-shiny-darkness-9ebb.2s6m8rz8fc.workers.dev/display

**OpenAPI 3.0.3:** https://skew-3d-implied-volatility-shiny-darkness-9ebb.2s6m8rz8fc.workers.dev/openapi.json

| Binding | KV namespace | ID |
|---------|-------------|----|
| `SKEW_IV` | `Skew-3D-Implied-Volatility` | `6090feecea284af3a313401f8d0ef0a9` |
| `ALPACA_MATRIX` | `alpaca-options-matrix-backup` | `e290dbe341d3496aac5e47d17042b3e5` |

## Endpoints

| Path | Description |
|------|-------------|
| `GET /display` | Overpriced / underpriced expiration × strike matrix UI |
| `GET /openapi.json` | OpenAPI 3.0.3 spec |
| `GET /health` | Worker + KV health (both bindings) |
| `GET /dates` | Available as-of dates |
| `GET /tickers` | Global manifest + matrix symbols |
| `GET /v1/as_of/{date\|latest}` | Day summary |
| `GET /v1/as_of/{date}/matrix/{symbol}` | Live matrix from latest Alpaca pull |
| `GET /v1/as_of/{date}/surface/{symbol}` | DTE × moneyness IV grid |
| `GET /v1/as_of/{date}/overpriced` | Mark ≫ HV Black-Scholes |
| `GET /v1/as_of/{date}/underpriced` | Mark ≪ HV Black-Scholes |
| `GET /v1/as_of/{date}/ticker-bias` | Ticker mean-edge rankings |

## Sync latest Alpaca pull

```bash
cp .env.example .env   # fill CLOUDFLARE_* credentials
npm install
npm run pull           # read latest by-date manifest from alpaca-options-matrix-backup
npm run upload         # write rankings / surfaces / matrix cache into SKEW_IV
npm run deploy         # bind SKEW_IV + ALPACA_MATRIX and publish worker
```

`GET /v1/as_of/latest/matrix/{symbol}` prefers a live read of
`{SYMBOL}/options_matrix/{YYYY-MM-DD}` from `alpaca-options-matrix-backup`, so the
display stays current with the most recent options matrix pull.

## Data

- Source matrices: `{TICKER}/options_matrix/{YYYY-MM-DD}` + `by-date/{YYYY-MM-DD}/manifest`
- Derived payload: `data/iv_surface_payload.json`
- Optional matrix cache files: `data/matrices/{as_of}/{SYMBOL}.json` (gitignored)

Pricing: edge = `(mark − BS) / BS` where BS is Black-Scholes-Merton using close-to-close HV
(`r=4%`, `T=dte/365.25`). When the latest Alpaca export omits `bs_price`/HV, the pull script and
live matrix API enrich from the newest prior HV-enriched export (fallback: OHLCV 252d HV).

Filter: DTE 5–180, moneyness 0.90–1.10, mark & BS ≥ $0.50, OI ≥ 20 or volume ≥ 10, mark/BS in [0.25, 4].

Latest integrated pull: **2026-08-10** (source `updated_at` 2026-08-10T22:06:04Z; 87 tickers sourced, 82 with HV, 13,262 eligible contracts). `by-date/2026-08-10/manifest` is missing, so the pull synthesizes the universe from dated `{SYM}/options_matrix/2026-08-10` keys (worker latest-date resolution does the same).
