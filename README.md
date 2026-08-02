# Skew-3D-Implied-Volatility

Cloudflare Worker + KV API for 3D implied-volatility surfaces and near-ATM mispricing research.

**Live worker:** https://skew-3d-implied-volatility-shiny-darkness-9ebb.2s6m8rz8fc.workers.dev/

**OpenAPI 3.0.3:** https://skew-3d-implied-volatility-shiny-darkness-9ebb.2s6m8rz8fc.workers.dev/openapi.json

**KV namespace:** `Skew-3D-Implied-Volatility` (`6090feecea284af3a313401f8d0ef0a9`)  
**Binding:** `SKEW_IV`

## Endpoints

| Path | Description |
|------|-------------|
| `GET /openapi.json` | OpenAPI 3.0.3 spec |
| `GET /health` | Worker + KV health |
| `GET /dates` | Available as-of dates |
| `GET /tickers` | Global manifest |
| `GET /v1/as_of/{date\|latest}` | Day summary |
| `GET /v1/as_of/{date}/surface/{symbol}` | DTE × moneyness IV grid |
| `GET /v1/as_of/{date}/overpriced` | Mark ≫ HV Black-Scholes |
| `GET /v1/as_of/{date}/underpriced` | Mark ≪ HV Black-Scholes |
| `GET /v1/as_of/{date}/ticker-bias` | Ticker mean-edge rankings |

## Deploy

```bash
cp .env.example .env   # fill CLOUDFLARE_* credentials
npm install
python3 scripts/upload_kv_skew_3d_iv.py --payload data/iv_surface_payload.json
python3 scripts/deploy_worker_skew_3d_iv.py
```

## Data

Sample payload: `data/iv_surface_payload.json` (as-of `2026-07-31`).

Pricing: market IV inverted from option mark via Black-Scholes-Merton; edge = `(mark − BS) / BS` using 252-day close-to-close HV.
