#!/usr/bin/env python3
"""Pull the latest Alpaca options matrices and build mispricing payloads.

Source KV: alpaca-options-matrix-backup (e290dbe341d3496aac5e47d17042b3e5)
Writes data/iv_surface_payload.json with overpriced / underpriced rankings
plus per-ticker expiration × strike matrices.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean, median

import certifi
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

from cf_utils import verify_token  # noqa: E402

SOURCE_NAMESPACE = "alpaca-options-matrix-backup"
SOURCE_NAMESPACE_ID = "e290dbe341d3496aac5e47d17042b3e5"
DEFAULT_OUT = ROOT / "data" / "iv_surface_payload.json"
SURFACE_DEFAULTS = [
    "NVDA",
    "AAPL",
    "MSFT",
    "AMZN",
    "META",
    "TSLA",
    "GOOGL",
    "AMD",
    "AVGO",
    "PLTR",
    "NFLX",
    "MU",
]
FILTER_NOTE = (
    "DTE 5-180, moneyness 0.90-1.10, mark&bs≥$0.50, OI≥20 or vol≥10, mark/bs in [0.25,4]"
)
PRICING_NOTE = (
    "edge=(mark-bs)/bs; market IV inverted from mark via BSM; HV=252d close-to-close"
)
_SSL_CTX = ssl.create_default_context(cafile=certifi.where())


def clean_token(raw: str) -> str:
    match = re.search(r"cfat_[A-Za-z0-9_\-]+", raw or "")
    if match:
        return match.group(0)
    return (raw or "").strip().lstrip("-").strip()


def api_json(url: str, token: str) -> dict:
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=120, context=_SSL_CTX) as resp:
        return json.loads(resp.read().decode())


def kv_get_json(account_id: str, namespace_id: str, token: str, key: str):
    encoded = urllib.parse.quote(key, safe="")
    url = (
        f"https://api.cloudflare.com/client/v4/accounts/{account_id}"
        f"/storage/kv/namespaces/{namespace_id}/values/{encoded}"
    )
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=180, context=_SSL_CTX) as resp:
            raw = resp.read().decode()
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise
    return json.loads(raw)


def list_keys(
    account_id: str,
    namespace_id: str,
    token: str,
    *,
    prefix: str = "",
    limit: int = 1000,
) -> list[str]:
    keys: list[str] = []
    cursor = None
    while True:
        qs = [f"limit={limit}"]
        if prefix:
            qs.append(f"prefix={urllib.parse.quote(prefix)}")
        if cursor:
            qs.append(f"cursor={urllib.parse.quote(cursor)}")
        url = (
            f"https://api.cloudflare.com/client/v4/accounts/{account_id}"
            f"/storage/kv/namespaces/{namespace_id}/keys?{'&'.join(qs)}"
        )
        data = api_json(url, token)
        keys.extend(k["name"] for k in data.get("result") or [])
        cursor = (data.get("result_info") or {}).get("cursor")
        if not cursor:
            break
    return keys


def resolve_latest_export(
    account_id: str, namespace_id: str, token: str, explicit: str | None
) -> tuple[str, dict]:
    if explicit:
        manifest = kv_get_json(
            account_id, namespace_id, token, f"by-date/{explicit}/manifest"
        )
        if not manifest:
            raise SystemExit(f"Missing by-date/{explicit}/manifest")
        return explicit, manifest

    keys = list_keys(account_id, namespace_id, token, prefix="by-date/")
    dates = sorted(
        {
            m.group(1)
            for key in keys
            for m in [re.match(r"by-date/(\d{4}-\d{2}-\d{2})/manifest$", key)]
            if m
        }
    )
    if not dates:
        raise SystemExit("No by-date manifests found in alpaca-options-matrix-backup")
    latest = dates[-1]
    manifest = kv_get_json(account_id, namespace_id, token, f"by-date/{latest}/manifest")
    if not manifest:
        raise SystemExit(f"Missing by-date/{latest}/manifest")
    return latest, manifest


def cp_code(put_call: str | None) -> str:
    value = (put_call or "").upper()
    if value.startswith("C"):
        return "C"
    if value.startswith("P"):
        return "P"
    return value[:1] or "?"


def market_iv_percent(contract: dict) -> float | None:
    """Best-effort market IV % from contract fields."""
    for key in ("implied_volatility", "iv", "market_iv"):
        val = contract.get(key)
        if isinstance(val, (int, float)) and val > 0:
            return round(val * 100.0 if val <= 3 else float(val), 2)
    # Alpaca backup stores BSM greeks under HV; keep volatility when present.
    vol = contract.get("volatility")
    if isinstance(vol, (int, float)) and vol > 0:
        return round(vol * 100.0 if vol <= 3 else float(vol), 2)
    return None


def eligible_contract(contract: dict, spot: float) -> dict | None:
    mark = contract.get("mark")
    bs = contract.get("bs_price")
    strike = contract.get("strike_price")
    dte = contract.get("days_to_expiration")
    if not isinstance(mark, (int, float)) or not isinstance(bs, (int, float)):
        return None
    if not isinstance(strike, (int, float)) or not isinstance(dte, (int, float)):
        return None
    if mark < 0.5 or bs < 0.5 or bs <= 0 or mark <= 0:
        return None
    if dte < 5 or dte > 180:
        return None
    if spot <= 0:
        return None
    mny = strike / spot
    if mny < 0.90 or mny > 1.10:
        return None
    oi = contract.get("open_interest") or 0
    vol = contract.get("total_volume") or 0
    try:
        oi_n = int(oi)
    except (TypeError, ValueError):
        oi_n = 0
    try:
        vol_n = int(vol)
    except (TypeError, ValueError):
        vol_n = 0
    if oi_n < 20 and vol_n < 10:
        return None
    ratio = mark / bs
    if ratio < 0.25 or ratio > 4:
        return None

    edge = (mark - bs) / bs
    hv = contract.get("historical_volatility")
    hv_pct = None
    if isinstance(hv, (int, float)):
        hv_pct = round(hv * 100.0 if hv <= 3 else float(hv), 2)
    iv_pct = market_iv_percent(contract)
    iv_minus_hv = None
    if iv_pct is not None and hv_pct is not None:
        iv_minus_hv = round(iv_pct - hv_pct, 2)

    return {
        "symbol": contract.get("underlying_symbol"),
        "exp": contract.get("expiration_date"),
        "dte": int(dte),
        "strike": float(strike),
        "cp": cp_code(contract.get("put_call")),
        "mark": round(float(mark), 4),
        "bs": round(float(bs), 4),
        "edge_pct": round(edge * 100.0, 2),
        "iv_pct": iv_pct,
        "hv_pct": hv_pct,
        "iv_minus_hv": iv_minus_hv,
        "mny": round(mny, 4),
        "oi": oi_n,
        "vol": vol_n,
        "S": round(float(spot), 4),
        "option_symbol": contract.get("option_symbol"),
    }


def build_ticker_matrix(rows: list[dict], *, spot: float, symbol: str, as_of: str) -> dict:
    expirations = sorted({r["exp"] for r in rows})
    strikes = sorted({r["strike"] for r in rows})
    cells: dict[str, dict] = {}
    over_cells: list[dict] = []
    under_cells: list[dict] = []

    for row in rows:
        key = f"{row['strike']}|{row['exp']}|{row['cp']}"
        cell = {
            "exp": row["exp"],
            "dte": row["dte"],
            "strike": row["strike"],
            "cp": row["cp"],
            "mark": row["mark"],
            "bs": row["bs"],
            "edge_pct": row["edge_pct"],
            "mny": row["mny"],
            "oi": row["oi"],
            "vol": row["vol"],
            "iv_pct": row["iv_pct"],
            "hv_pct": row["hv_pct"],
            "bias": "over" if row["edge_pct"] > 0 else "under" if row["edge_pct"] < 0 else "fair",
        }
        cells[key] = cell
        if row["edge_pct"] > 0:
            over_cells.append(cell)
        elif row["edge_pct"] < 0:
            under_cells.append(cell)

    # Compact grid: strike rows × expiration columns, split by call/put.
    def grid_for(side: str) -> list[dict]:
        out = []
        for strike in strikes:
            row = {"strike": strike, "moneyness": round(strike / spot, 4), "by_exp": {}}
            for exp in expirations:
                cell = cells.get(f"{strike}|{exp}|{side}")
                if cell:
                    row["by_exp"][exp] = cell
            if row["by_exp"]:
                out.append(row)
        return out

    over_cells.sort(key=lambda c: c["edge_pct"], reverse=True)
    under_cells.sort(key=lambda c: c["edge_pct"])

    return {
        "symbol": symbol,
        "as_of": as_of,
        "spot": spot,
        "eligible": len(rows),
        "expiration_count": len(expirations),
        "strike_count": len(strikes),
        "expirations": expirations,
        "strikes": strikes,
        "call_grid": grid_for("C"),
        "put_grid": grid_for("P"),
        "overpriced": over_cells,
        "underpriced": under_cells,
        "overpriced_count": len(over_cells),
        "underpriced_count": len(under_cells),
        "axes": {"rows": "strike", "columns": "expiration", "value": "edge_pct"},
        "definition": "edge_pct=(mark-bs)/bs*100; over>0 under<0",
    }


def ticker_bias(rows: list[dict], spot: float, hv_pct: float | None) -> dict:
    edges = [r["edge_pct"] for r in rows]
    over = sum(1 for e in edges if e > 0)
    under = sum(1 for e in edges if e < 0)
    n = len(edges)
    return {
        "symbol": rows[0]["symbol"] if rows else None,
        "S": spot,
        "hv_pct": hv_pct,
        "n": n,
        "mean_edge": round(mean(edges), 2) if edges else None,
        "median_edge": round(median(edges), 2) if edges else None,
        "pct_over": round(100.0 * over / n, 2) if n else 0.0,
        "pct_under": round(100.0 * under / n, 2) if n else 0.0,
    }


def surface_points_from_rows(rows: list[dict]) -> list[dict]:
    """Lightweight call-only surface points from eligible rows (no IDW)."""
    points = []
    for row in rows:
        if row["cp"] != "C":
            continue
        if row["iv_pct"] is None:
            continue
        points.append(
            {
                "dte": row["dte"],
                "strike": row["strike"],
                "mny": row["mny"],
                "iv": row["iv_pct"],
                "edge": row["edge_pct"],
                "exp": row["exp"],
            }
        )
    points.sort(key=lambda p: (p["dte"], p["mny"]))
    return points


def main() -> None:
    load_dotenv(ROOT / ".env")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--account-id", default=os.getenv("CLOUDFLARE_ACCOUNT_ID", ""))
    parser.add_argument("--api-token", default=os.getenv("CLOUDFLARE_API_TOKEN", ""))
    parser.add_argument(
        "--namespace-id",
        default=os.getenv("CLOUDFLARE_ALPACA_MATRIX_NAMESPACE_ID", SOURCE_NAMESPACE_ID),
    )
    parser.add_argument("--as-of", default="", help="Optional YYYY-MM-DD; default latest")
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    parser.add_argument("--top-n", type=int, default=50)
    parser.add_argument(
        "--matrix-symbols",
        default="",
        help="Comma symbols for matrix export (default: all with eligible rows)",
    )
    parser.add_argument(
        "--surface-symbols",
        default=",".join(SURFACE_DEFAULTS),
        help="Comma symbols to include in surfaces map",
    )
    args = parser.parse_args()

    account_id = (args.account_id or "").strip().lower()
    token = clean_token(args.api_token)
    if not account_id or not token:
        raise SystemExit("Missing CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN")

    print(verify_token(token, account_id), file=sys.stderr)
    as_of, day_manifest = resolve_latest_export(
        account_id, args.namespace_id, token, args.as_of or None
    )
    symbols = list(day_manifest.get("symbols") or [])
    print(
        f"Latest export {as_of} tickers={len(symbols)} updated_at={day_manifest.get('updated_at')}",
        flush=True,
    )

    matrix_filter = (
        {s.strip().upper() for s in args.matrix_symbols.split(",") if s.strip()}
        if args.matrix_symbols
        else None
    )
    surface_symbols = [
        s.strip().upper() for s in args.surface_symbols.split(",") if s.strip()
    ]

    all_rows: list[dict] = []
    matrices: dict[str, dict] = {}
    surfaces: dict[str, list] = {}
    bias_rows: list[dict] = []
    empty_no_chain: list[str] = []
    hv_enrich_failed: list[str] = []

    for idx, symbol in enumerate(symbols, 1):
        key = f"{symbol}/options_matrix/{as_of}"
        matrix = kv_get_json(account_id, args.namespace_id, token, key)
        if not matrix:
            empty_no_chain.append(symbol)
            print(f"[{idx}/{len(symbols)}] {symbol} missing", flush=True)
            continue

        spot = float(matrix.get("underlying_price") or 0)
        contracts = matrix.get("contracts") or []
        rows: list[dict] = []
        for contract in contracts:
            row = eligible_contract(contract, spot)
            if row:
                row["symbol"] = symbol
                rows.append(row)

        hv = matrix.get("historical_volatility")
        hv_pct = None
        if isinstance(hv, (int, float)):
            hv_pct = round(hv * 100.0 if hv <= 3 else float(hv), 2)
        else:
            hv_enrich_failed.append(symbol)

        print(
            f"[{idx}/{len(symbols)}] {symbol} contracts={len(contracts)} eligible={len(rows)}",
            flush=True,
        )
        if not rows:
            continue

        all_rows.extend(rows)
        bias_rows.append(ticker_bias(rows, spot, hv_pct))

        if matrix_filter is None or symbol in matrix_filter:
            matrices[symbol] = build_ticker_matrix(
                rows, spot=spot, symbol=symbol, as_of=as_of
            )

        if symbol in surface_symbols:
            surfaces[symbol] = surface_points_from_rows(rows)

    overpriced = sorted(all_rows, key=lambda r: r["edge_pct"], reverse=True)[: args.top_n]
    underpriced = sorted(all_rows, key=lambda r: r["edge_pct"])[: args.top_n]
    bias_over = sorted(bias_rows, key=lambda r: r["mean_edge"] or -math.inf, reverse=True)[
        :12
    ]
    bias_under = sorted(bias_rows, key=lambda r: r["mean_edge"] or math.inf)[:12]

    # Prefer existing interpolated surfaces when same as_of is already present.
    existing_path = Path(args.out)
    if existing_path.exists():
        try:
            existing = json.loads(existing_path.read_text(encoding="utf-8"))
            if existing.get("as_of") == as_of and existing.get("surfaces"):
                for sym, pts in (existing.get("surfaces") or {}).items():
                    if pts:
                        surfaces[sym] = pts
                surface_symbols = list(existing.get("surface_symbols") or surface_symbols)
        except json.JSONDecodeError:
            pass

    # Keep the committed payload lean: write full matrices beside it (gitignored).
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    matrix_dir = out_path.parent / "matrices" / as_of
    matrix_dir.mkdir(parents=True, exist_ok=True)
    matrix_index: dict[str, dict] = {}
    for symbol, matrix in matrices.items():
        (matrix_dir / f"{symbol}.json").write_text(
            json.dumps(matrix, separators=(",", ":"), ensure_ascii=False),
            encoding="utf-8",
        )
        matrix_index[symbol] = {
            "eligible": matrix.get("eligible"),
            "expiration_count": matrix.get("expiration_count"),
            "strike_count": matrix.get("strike_count"),
            "overpriced_count": matrix.get("overpriced_count"),
            "underpriced_count": matrix.get("underpriced_count"),
            "spot": matrix.get("spot"),
            "path": f"matrices/{as_of}/{symbol}.json",
        }

    payload = {
        "as_of": as_of,
        "namespace": SOURCE_NAMESPACE,
        "namespace_id": args.namespace_id,
        "source_updated_at": day_manifest.get("updated_at"),
        "pulled_at": datetime.now(timezone.utc).isoformat(),
        "kv_tickers": len(symbols) - len(empty_no_chain),
        "exported_universe": day_manifest.get("ticker_count") or len(symbols),
        "empty_no_chain": empty_no_chain,
        "hv_enrich_failed": sorted(set(hv_enrich_failed)),
        "filter": FILTER_NOTE,
        "pricing": PRICING_NOTE,
        "eligible": len(all_rows),
        "tickers_with_eligible": len(bias_rows),
        "overpriced": overpriced,
        "underpriced": underpriced,
        "ticker_bias_over": bias_over,
        "ticker_bias_under": bias_under,
        "matrix_index": matrix_index,
        "matrix_symbols": sorted(matrices.keys()),
        "surfaces": surfaces,
        "surface_symbols": [s for s in surface_symbols if s in surfaces],
        "surface_note": (
            "Call IV points from eligible contracts; interpolated grid retained when available"
        ),
        "symbols": symbols,
    }

    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    summary = {
        "as_of": as_of,
        "eligible": len(all_rows),
        "matrix_symbols": len(matrices),
        "matrix_dir": str(matrix_dir),
        "overpriced": len(overpriced),
        "underpriced": len(underpriced),
        "out": str(out_path),
        "bytes": out_path.stat().st_size,
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
