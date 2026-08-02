#!/usr/bin/env python3
"""Upload 3D IV surface / mispricing payloads to Skew-3D-Implied-Volatility KV."""

from __future__ import annotations

import argparse
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import certifi
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(SCRIPTS))

from cf_utils import verify_token  # noqa: E402

DEFAULT_NAMESPACE_NAME = "Skew-3D-Implied-Volatility"
DEFAULT_NAMESPACE_ID = "6090feecea284af3a313401f8d0ef0a9"
DEFAULT_PAYLOAD = ROOT / "data" / "iv_surface_payload.json"
_SSL_CTX = ssl.create_default_context(cafile=certifi.where())
DEFAULT_CREDENTIALS = Path("/Users/ruslantkach/Desktop/economic-calendar/.cloudflare-credentials.json")


def load_credentials(account_id: str, api_token: str, credentials_path: Path | None) -> tuple[str, str]:
    load_dotenv(ROOT / ".env")
    if account_id and api_token:
        return account_id, api_token
    cred_path = credentials_path or DEFAULT_CREDENTIALS
    if cred_path.exists():
        data = json.loads(cred_path.read_text(encoding="utf-8"))
        return data.get("account_id", account_id), data.get("api_token", api_token)
    return (
        os.getenv("CLOUDFLARE_ACCOUNT_ID", account_id),
        os.getenv("CLOUDFLARE_API_TOKEN", api_token),
    )


def compact_json(obj: object) -> str:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def upload_bulk(
    *,
    account_id: str,
    namespace_id: str,
    api_token: str,
    entries: list[dict[str, str]],
    max_retries: int = 6,
) -> None:
    if not entries:
        return
    url = (
        f"https://api.cloudflare.com/client/v4/accounts/{account_id}"
        f"/storage/kv/namespaces/{namespace_id}/bulk"
    )
    body = json.dumps(entries).encode("utf-8")
    for attempt in range(max_retries):
        req = urllib.request.Request(
            url,
            data=body,
            method="PUT",
            headers={
                "Authorization": f"Bearer {api_token}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=300, context=_SSL_CTX) as resp:
                result = json.loads(resp.read().decode())
                if not result.get("success"):
                    raise RuntimeError(f"KV bulk upload failed: {result}")
                return
        except urllib.error.HTTPError as exc:
            if exc.code in (429, 524) and attempt + 1 < max_retries:
                time.sleep(min(2**attempt, 30))
                continue
            raise
        except (TimeoutError, urllib.error.URLError, ssl.SSLError, OSError):
            if attempt + 1 < max_retries:
                time.sleep(min(2**attempt, 30))
                continue
            raise


def build_entries(payload: dict, *, namespace_name: str, namespace_id: str) -> list[dict[str, str]]:
    as_of = str(payload["as_of"])
    uploaded_at = datetime.now(timezone.utc).isoformat()
    surface_symbols = list(payload.get("surface_symbols") or [])
    surfaces = payload.get("surfaces") or {}

    summary = {
        "namespace": namespace_name,
        "namespace_id": namespace_id,
        "as_of": as_of,
        "source_options_kv": payload.get("namespace") or "alpaca-options-matrix-backup",
        "exported_universe": payload.get("exported_universe"),
        "kv_tickers": payload.get("kv_tickers"),
        "eligible": payload.get("eligible"),
        "tickers_with_eligible": payload.get("tickers_with_eligible"),
        "empty_no_chain": payload.get("empty_no_chain") or [],
        "hv_enrich_failed": payload.get("hv_enrich_failed") or [],
        "filter": payload.get("filter"),
        "pricing": payload.get("pricing"),
        "surface_note": payload.get("surface_note"),
        "surface_symbols": surface_symbols,
        "updated_at": uploaded_at,
    }

    overpriced = {
        "count": len(payload.get("overpriced") or []),
        "contracts": payload.get("overpriced") or [],
        "definition": "mark > HV Black-Scholes theoretical (edge=(mark-bs)/bs)",
    }
    underpriced = {
        "count": len(payload.get("underpriced") or []),
        "contracts": payload.get("underpriced") or [],
        "definition": "mark < HV Black-Scholes theoretical (edge=(mark-bs)/bs)",
    }
    ticker_bias = {
        "overpriced_bias": payload.get("ticker_bias_over") or [],
        "underpriced_bias": payload.get("ticker_bias_under") or [],
    }

    manifest = {
        "name": namespace_name,
        "namespace_id": namespace_id,
        "openapi": "3.0.3",
        "dates": [as_of],
        "date_count": 1,
        "latest_date": as_of,
        "surface_symbols": surface_symbols,
        "source": "alpaca-options-matrix-backup + HV/BS enrichment",
        "updated_at": uploaded_at,
        "kv_key_format": {
            "summary": "as_of/{YYYY-MM-DD}/summary",
            "surface": "as_of/{YYYY-MM-DD}/surface/{SYMBOL}",
            "overpriced": "as_of/{YYYY-MM-DD}/overpriced",
            "underpriced": "as_of/{YYYY-MM-DD}/underpriced",
            "ticker_bias": "as_of/{YYYY-MM-DD}/ticker-bias",
        },
    }

    entries: list[dict[str, str]] = [
        {"key": "manifest", "value": compact_json(manifest)},
        {"key": f"as_of/{as_of}/summary", "value": compact_json(summary)},
        {"key": f"as_of/{as_of}/overpriced", "value": compact_json(overpriced)},
        {"key": f"as_of/{as_of}/underpriced", "value": compact_json(underpriced)},
        {"key": f"as_of/{as_of}/ticker-bias", "value": compact_json(ticker_bias)},
    ]

    for symbol in surface_symbols:
        points = surfaces.get(symbol) or []
        surface_payload = {
            "as_of": as_of,
            "symbol": symbol,
            "point_count": len(points),
            "points": points,
            "axes": {
                "x": "dte_days",
                "y": "moneyness_k_over_s",
                "z": "market_iv_percent",
            },
        }
        entries.append(
            {
                "key": f"as_of/{as_of}/surface/{symbol}",
                "value": compact_json(surface_payload),
            }
        )
    return entries


def main() -> None:
    load_dotenv(ROOT / ".env")
    p = argparse.ArgumentParser(description="Upload Skew 3D IV surface data to KV.")
    p.add_argument("--payload", default=str(DEFAULT_PAYLOAD))
    p.add_argument("--namespace-id", default=os.getenv("CLOUDFLARE_SKEW_IV_NAMESPACE_ID", DEFAULT_NAMESPACE_ID))
    p.add_argument("--namespace-name", default=DEFAULT_NAMESPACE_NAME)
    p.add_argument("--account-id", default=os.getenv("CLOUDFLARE_ACCOUNT_ID", ""))
    p.add_argument("--api-token", default=os.getenv("CLOUDFLARE_API_TOKEN", ""))
    p.add_argument("--credentials", default="")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--batch-size", type=int, default=25)
    args = p.parse_args()

    account_id, api_token = load_credentials(
        args.account_id,
        args.api_token,
        Path(args.credentials).expanduser() if args.credentials else None,
    )
    if not account_id or not api_token:
        raise SystemExit("Missing Cloudflare credentials")
    print(verify_token(api_token, account_id), file=sys.stderr)

    payload_path = Path(args.payload).expanduser()
    payload = json.loads(payload_path.read_text(encoding="utf-8"))
    entries = build_entries(
        payload,
        namespace_name=args.namespace_name,
        namespace_id=args.namespace_id,
    )
    print(
        f"Prepared {len(entries)} keys for as_of={payload.get('as_of')} "
        f"surfaces={len(payload.get('surface_symbols') or [])}",
        flush=True,
    )
    if args.dry_run:
        for e in entries:
            print(f"  {e['key']} bytes={len(e['value'].encode())}")
        return

    batch = max(1, args.batch_size)
    for i in range(0, len(entries), batch):
        chunk = entries[i : i + batch]
        upload_bulk(
            account_id=account_id,
            namespace_id=args.namespace_id,
            api_token=api_token,
            entries=chunk,
        )
        print(f"Uploaded batch {i // batch + 1} ({len(chunk)} keys)", flush=True)

    summary = {
        "namespace": args.namespace_name,
        "namespace_id": args.namespace_id,
        "as_of": payload.get("as_of"),
        "keys": len(entries),
        "surface_symbols": payload.get("surface_symbols"),
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }
    out = payload_path.parent / f"skew_kv_upload_{payload.get('as_of')}.json"
    out.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    print(f"Done -> {args.namespace_name}", flush=True)


if __name__ == "__main__":
    main()
