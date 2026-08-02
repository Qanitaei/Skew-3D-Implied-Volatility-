"""Shared Cloudflare API helpers."""

from __future__ import annotations

import json
import ssl
import urllib.error
import urllib.request

import certifi

_SSL_CTX = ssl.create_default_context(cafile=certifi.where())


def verify_token(api_token: str, account_id: str) -> dict:
    """Verify a Cloudflare API token (user or account scoped).

    Account API tokens (``cfat_``) must use the account verify endpoint.
    """
    token = api_token.strip()
    account = account_id.strip().lower()
    if not token:
        raise RuntimeError("Missing CLOUDFLARE_API_TOKEN")

    endpoints: list[str] = []
    if account:
        endpoints.append(
            f"https://api.cloudflare.com/client/v4/accounts/{account}/tokens/verify"
        )
    endpoints.append("https://api.cloudflare.com/client/v4/user/tokens/verify")

    last_error: str | None = None
    for url in endpoints:
        req = urllib.request.Request(
            url,
            headers={"Authorization": f"Bearer {token}"},
        )
        try:
            with urllib.request.urlopen(req, timeout=30, context=_SSL_CTX) as resp:
                body = json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")
            try:
                payload = json.loads(detail)
                errors = payload.get("errors") or []
                if errors:
                    last_error = errors[0].get("message") or detail
                else:
                    last_error = detail
            except json.JSONDecodeError:
                last_error = detail
            continue
        if body.get("success"):
            return body.get("result") or {}
        errors = body.get("errors") or []
        last_error = errors[0].get("message") if errors else str(body)

    raise RuntimeError(
        f"Invalid Cloudflare API token (HTTP 401 code 1000): {last_error or 'verify failed'}"
    )
