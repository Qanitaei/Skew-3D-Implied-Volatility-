#!/usr/bin/env python3
"""Deploy Skew-3D-Implied-Volatility Cloudflare Worker bound to SKEW_IV KV."""

from __future__ import annotations

import json
import os
import ssl
import uuid
import urllib.request
from pathlib import Path

import certifi

ROOT = Path(__file__).resolve().parents[1]
WORKER_DIR = ROOT
SCRIPT_NAME = os.getenv(
    "SKEW_IV_WORKER_SCRIPT_NAME",
    "skew-3d-implied-volatility-shiny-darkness-9ebb",
)
NAMESPACE_NAME = os.getenv("SKEW_IV_NAMESPACE_NAME", "Skew-3D-Implied-Volatility")
NAMESPACE_ID = os.getenv(
    "SKEW_IV_NAMESPACE_ID",
    "6090feecea284af3a313401f8d0ef0a9",
)
WORKER_URL = os.getenv(
    "SKEW_IV_WORKER_URL",
    f"https://{SCRIPT_NAME}.2s6m8rz8fc.workers.dev",
)
KV_BINDINGS = [
    {
        "type": "kv_namespace",
        "name": "SKEW_IV",
        "namespace_id": NAMESPACE_ID,
    },
]
_SSL_CTX = ssl.create_default_context(cafile=certifi.where())
DEFAULT_CREDENTIALS = Path("/Users/ruslantkach/Desktop/economic-calendar/.cloudflare-credentials.json")


def _credentials() -> tuple[str, str]:
    if DEFAULT_CREDENTIALS.exists():
        data = json.loads(DEFAULT_CREDENTIALS.read_text(encoding="utf-8"))
        return data["account_id"], data["api_token"]
    account_id = os.getenv("CLOUDFLARE_ACCOUNT_ID", "")
    api_token = os.getenv("CLOUDFLARE_API_TOKEN", "")
    if not account_id or not api_token:
        raise SystemExit("Missing Cloudflare credentials.")
    return account_id, api_token


def _bundle_worker() -> str:
    index_src = (WORKER_DIR / "src" / "index.js").read_text(encoding="utf-8")
    openapi = json.loads((WORKER_DIR / "openapi.json").read_text(encoding="utf-8"))
    openapi["info"]["contact"] = {"name": SCRIPT_NAME, "url": WORKER_URL}
    openapi["servers"] = [{"url": WORKER_URL, "description": "Workers KV production"}]
    index_src = (
        index_src.replace(
            'const NAMESPACE_NAME = "Skew-3D-Implied-Volatility";',
            f'const NAMESPACE_NAME = "{NAMESPACE_NAME}";',
        )
        .replace(
            'const NAMESPACE_ID = "6090feecea284af3a313401f8d0ef0a9";',
            f'const NAMESPACE_ID = "{NAMESPACE_ID}";',
        )
        .replace(
            'const WORKER_URL =\n  "https://skew-3d-implied-volatility-shiny-darkness-9ebb.2s6m8rz8fc.workers.dev";',
            f'const WORKER_URL =\n  "{WORKER_URL}";',
        )
    )
    return index_src.replace(
        'import OPENAPI from "../openapi.json";\n',
        f"const OPENAPI = {json.dumps(openapi, separators=(',', ':'))};\n",
    )


def deploy() -> None:
    account_id, api_token = _credentials()
    bundled = _bundle_worker()

    metadata = {
        "main_module": "index.js",
        "compatibility_date": "2024-11-01",
        "bindings": KV_BINDINGS,
    }

    boundary = f"----WebKitFormBoundary{uuid.uuid4().hex}"
    parts: list[bytes] = []

    def add(name: str, content: str, content_type: str, filename: str = "") -> None:
        disp = f'Content-Disposition: form-data; name="{name}"'
        if filename:
            disp += f'; filename="{filename}"'
        parts.append(
            (
                f"--{boundary}\r\n"
                f"{disp}\r\n"
                f"Content-Type: {content_type}\r\n\r\n"
                f"{content}\r\n"
            ).encode()
        )

    add("metadata", json.dumps(metadata), "application/json")
    add("index.js", bundled, "application/javascript+module", "index.js")
    body = b"".join(parts) + f"--{boundary}--\r\n".encode()

    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/scripts/{SCRIPT_NAME}"
    req = urllib.request.Request(
        url,
        data=body,
        method="PUT",
        headers={
            "Authorization": f"Bearer {api_token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    with urllib.request.urlopen(req, timeout=180, context=_SSL_CTX) as resp:
        result = json.loads(resp.read().decode())
        if not result.get("success"):
            raise SystemExit(f"Deploy failed: {result}")

    # Ensure workers.dev subdomain is enabled
    sub_url = (
        f"https://api.cloudflare.com/client/v4/accounts/{account_id}"
        f"/workers/scripts/{SCRIPT_NAME}/subdomain"
    )
    sub_req = urllib.request.Request(
        sub_url,
        data=json.dumps({"enabled": True}).encode(),
        method="POST",
        headers={
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(sub_req, timeout=60, context=_SSL_CTX) as resp:
            sub = json.loads(resp.read().decode())
            print("subdomain", sub.get("success"), sub.get("result"))
    except Exception as exc:  # noqa: BLE001
        print(f"subdomain warning: {exc}")

    print(
        json.dumps(
            {
                "success": True,
                "worker": SCRIPT_NAME,
                "url": WORKER_URL,
                "namespace": NAMESPACE_NAME,
                "namespace_id": NAMESPACE_ID,
                "binding": "SKEW_IV",
                "openapi": f"{WORKER_URL}/openapi.json",
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    deploy()
