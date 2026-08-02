/**
 * Skew 3D Implied Volatility API
 * KV namespace: Skew-3D-Implied-Volatility
 * Binding: SKEW_IV
 *
 * Key format:
 *   manifest
 *   as_of/{YYYY-MM-DD}/summary
 *   as_of/{YYYY-MM-DD}/overpriced
 *   as_of/{YYYY-MM-DD}/underpriced
 *   as_of/{YYYY-MM-DD}/ticker-bias
 *   as_of/{YYYY-MM-DD}/surface/{SYMBOL}
 */

import OPENAPI from "../openapi.json";

const NAMESPACE_NAME = "Skew-3D-Implied-Volatility";
const NAMESPACE_ID = "6090feecea284af3a313401f8d0ef0a9";
const WORKER_URL =
  "https://skew-3d-implied-volatility-shiny-darkness-9ebb.2s6m8rz8fc.workers.dev";
const GLOBAL_MANIFEST_KEY = "manifest";
const DATE_PATTERN = "\\d{4}-\\d{2}-\\d{2}";
const TICKER_PATTERN = "[A-Za-z][A-Za-z0-9.^_-]{0,15}";

function corsHeaders(methods = "GET, OPTIONS") {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json; charset=utf-8",
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: corsHeaders(),
  });
}

function notFound(error) {
  return json({ success: false, error }, 404);
}

function kvStore(env) {
  return env.SKEW_IV || env.SKEW_IV_KV || null;
}

async function kvGet(env, key) {
  const store = kvStore(env);
  if (!store) return null;
  return store.get(key, "json");
}

function summaryKey(date) {
  return `as_of/${date}/summary`;
}

function surfaceKey(date, symbol) {
  return `as_of/${date}/surface/${symbol.toUpperCase()}`;
}

function overpricedKey(date) {
  return `as_of/${date}/overpriced`;
}

function underpricedKey(date) {
  return `as_of/${date}/underpriced`;
}

function tickerBiasKey(date) {
  return `as_of/${date}/ticker-bias`;
}

async function resolveDate(env, dateOrLatest) {
  if (dateOrLatest && dateOrLatest !== "latest") return dateOrLatest;
  const manifest = await kvGet(env, GLOBAL_MANIFEST_KEY);
  return manifest?.latest_date || (manifest?.dates || []).slice(-1)[0] || null;
}

function buildRetrievals(baseUrl) {
  const paths = Object.keys(OPENAPI.paths || {});
  return paths.map((path) => {
    const methods = Object.keys(OPENAPI.paths[path] || {});
    const method = methods[0] || "get";
    const op = OPENAPI.paths[path][method] || {};
    return {
      method: method.toUpperCase(),
      path,
      operationId: op.operationId || null,
      summary: op.summary || null,
      href: `${baseUrl}${path.replace(/\{[^}]+\}/g, "example")}`,
    };
  });
}

async function buildHealth(env, baseUrl) {
  const store = kvStore(env);
  const manifest = store ? await kvGet(env, GLOBAL_MANIFEST_KEY) : null;
  return {
    success: true,
    openapi: OPENAPI.openapi || "3.0.3",
    openapi_url: `${baseUrl}/openapi.json`,
    retrievals_url: `${baseUrl}/retrievals`,
    kv_connected: Boolean(store),
    kv_bindings: [
      {
        binding: "SKEW_IV",
        namespace: NAMESPACE_NAME,
        namespace_id: NAMESPACE_ID,
        connected: Boolean(store),
      },
    ],
    kv_key_format: {
      manifest: GLOBAL_MANIFEST_KEY,
      summary: "as_of/{YYYY-MM-DD}/summary",
      surface: "as_of/{YYYY-MM-DD}/surface/{SYMBOL}",
      overpriced: "as_of/{YYYY-MM-DD}/overpriced",
      underpriced: "as_of/{YYYY-MM-DD}/underpriced",
      ticker_bias: "as_of/{YYYY-MM-DD}/ticker-bias",
    },
    namespace: NAMESPACE_NAME,
    namespace_id: NAMESPACE_ID,
    date_count: manifest?.date_count ?? (manifest?.dates || []).length,
    dates: manifest?.dates || [],
    latest_date: manifest?.latest_date || null,
    surface_symbols: manifest?.surface_symbols || [],
    updated_at: manifest?.updated_at || null,
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const baseUrl = WORKER_URL.replace(/\/+$/, "");
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/" || path === "/openapi.json") {
      const spec = {
        ...OPENAPI,
        servers: [{ url: baseUrl, description: "Workers KV production" }],
      };
      return json(spec);
    }

    if (path === "/health") {
      return json(await buildHealth(env, baseUrl));
    }

    if (path === "/retrievals") {
      return json({
        success: true,
        count: Object.keys(OPENAPI.paths || {}).length,
        openapi: "3.0.3",
        openapi_import_url: `${baseUrl}/openapi.json`,
        primary_surface: "get:/v1/as_of/{date}/surface/{symbol}",
        retrievals: buildRetrievals(baseUrl),
      });
    }

    if (path === "/tickers") {
      const manifest = await kvGet(env, GLOBAL_MANIFEST_KEY);
      return json(
        manifest
          ? { success: true, ...manifest }
          : { success: true, dates: [], surface_symbols: [], date_count: 0 },
      );
    }

    if (path === "/dates") {
      const manifest = await kvGet(env, GLOBAL_MANIFEST_KEY);
      const dates = manifest?.dates || [];
      return json({
        success: true,
        date_count: dates.length,
        dates,
        latest_date: manifest?.latest_date || dates[dates.length - 1] || null,
        updated_at: manifest?.updated_at,
        kv_key: GLOBAL_MANIFEST_KEY,
      });
    }

    if (path === "/keys") {
      const store = kvStore(env);
      if (!store) {
        return json(
          { success: false, error: "KV binding missing", expected_binding: "SKEW_IV" },
          500,
        );
      }
      const prefix = url.searchParams.get("prefix") || "";
      const limit = Math.min(Number(url.searchParams.get("limit") || 1000), 1000);
      const list = await store.list({ prefix, limit });
      return json({
        success: true,
        namespace: NAMESPACE_NAME,
        namespace_id: NAMESPACE_ID,
        prefix,
        count: list.keys.length,
        keys: list.keys.map((k) => k.name),
        list_complete: list.list_complete,
      });
    }

    let match = path.match(new RegExp(`^/v1/as_of/(latest|${DATE_PATTERN})$`));
    if (match) {
      const asOf = await resolveDate(env, match[1]);
      if (!asOf) return notFound("No as-of dates in manifest");
      const summary = await kvGet(env, summaryKey(asOf));
      if (!summary) return notFound(`Missing summary: ${summaryKey(asOf)}`);
      return json({ success: true, as_of: asOf, ...summary });
    }

    match = path.match(
      new RegExp(`^/v1/as_of/(latest|${DATE_PATTERN})/surface/(${TICKER_PATTERN})$`),
    );
    if (match) {
      const asOf = await resolveDate(env, match[1]);
      if (!asOf) return notFound("No as-of dates in manifest");
      const symbol = match[2].toUpperCase();
      const surface = await kvGet(env, surfaceKey(asOf, symbol));
      if (!surface) return notFound(`Missing surface: ${surfaceKey(asOf, symbol)}`);
      const points = surface.points || surface;
      return json({
        success: true,
        as_of: asOf,
        symbol,
        point_count: Array.isArray(points) ? points.length : 0,
        axes: {
          x: "dte_days",
          y: "moneyness_k_over_s",
          z: "market_iv_percent",
        },
        ...(Array.isArray(points) ? { points } : surface),
      });
    }

    match = path.match(new RegExp(`^/v1/as_of/(latest|${DATE_PATTERN})/overpriced$`));
    if (match) {
      const asOf = await resolveDate(env, match[1]);
      if (!asOf) return notFound("No as-of dates in manifest");
      const data = await kvGet(env, overpricedKey(asOf));
      if (!data) return notFound(`Missing overpriced: ${overpricedKey(asOf)}`);
      return json({ success: true, as_of: asOf, ...data });
    }

    match = path.match(new RegExp(`^/v1/as_of/(latest|${DATE_PATTERN})/underpriced$`));
    if (match) {
      const asOf = await resolveDate(env, match[1]);
      if (!asOf) return notFound("No as-of dates in manifest");
      const data = await kvGet(env, underpricedKey(asOf));
      if (!data) return notFound(`Missing underpriced: ${underpricedKey(asOf)}`);
      return json({ success: true, as_of: asOf, ...data });
    }

    match = path.match(new RegExp(`^/v1/as_of/(latest|${DATE_PATTERN})/ticker-bias$`));
    if (match) {
      const asOf = await resolveDate(env, match[1]);
      if (!asOf) return notFound("No as-of dates in manifest");
      const data = await kvGet(env, tickerBiasKey(asOf));
      if (!data) return notFound(`Missing ticker-bias: ${tickerBiasKey(asOf)}`);
      return json({ success: true, as_of: asOf, ...data });
    }

    return notFound(`Unknown path: ${path}`);
  },
};
