/**
 * Skew 3D Implied Volatility API + options mispricing matrix display
 *
 * KV bindings:
 *   SKEW_IV       -> Skew-3D-Implied-Volatility (derived surfaces / rankings)
 *   ALPACA_MATRIX -> alpaca-options-matrix-backup (source options matrices)
 *
 * Key formats (SKEW_IV):
 *   manifest
 *   as_of/{YYYY-MM-DD}/summary
 *   as_of/{YYYY-MM-DD}/overpriced
 *   as_of/{YYYY-MM-DD}/underpriced
 *   as_of/{YYYY-MM-DD}/ticker-bias
 *   as_of/{YYYY-MM-DD}/surface/{SYMBOL}
 *   as_of/{YYYY-MM-DD}/matrix/{SYMBOL}
 *
 * Source keys (ALPACA_MATRIX):
 *   by-date/{YYYY-MM-DD}/manifest
 *   {SYMBOL}/options_matrix/{YYYY-MM-DD}
 */

import OPENAPI from "../openapi.json";
import { DISPLAY_HTML } from "./display.js";

const NAMESPACE_NAME = "Skew-3D-Implied-Volatility";
const NAMESPACE_ID = "6090feecea284af3a313401f8d0ef0a9";
const SOURCE_NAMESPACE = "alpaca-options-matrix-backup";
const SOURCE_NAMESPACE_ID = "e290dbe341d3496aac5e47d17042b3e5";
const WORKER_URL =
  "https://skew-3d-implied-volatility-shiny-darkness-9ebb.2s6m8rz8fc.workers.dev";
const GLOBAL_MANIFEST_KEY = "manifest";
const DATE_PATTERN = "\\d{4}-\\d{2}-\\d{2}";
const TICKER_PATTERN = "[A-Za-z][A-Za-z0-9.^_-]{0,15}";

const FILTER = {
  minDte: 5,
  maxDte: 180,
  minMny: 0.9,
  maxMny: 1.1,
  minMark: 0.5,
  minBs: 0.5,
  minOiOrVol: { oi: 20, vol: 10 },
  minRatio: 0.25,
  maxRatio: 4,
};

const BS_RISK_FREE = 0.04;
const BS_DAYCOUNT = 365.25;

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

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=60",
    },
  });
}

function notFound(error) {
  return json({ success: false, error }, 404);
}

function skewStore(env) {
  return env.SKEW_IV || env.SKEW_IV_KV || null;
}

function alpacaStore(env) {
  return env.ALPACA_MATRIX || env.ALPACA_OPTIONS_MATRIX || null;
}

async function kvGet(store, key) {
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

function matrixKey(date, symbol) {
  return `as_of/${date}/matrix/${symbol.toUpperCase()}`;
}

function cpCode(putCall) {
  const value = String(putCall || "").toUpperCase();
  if (value.startsWith("C")) return "C";
  if (value.startsWith("P")) return "P";
  return value.slice(0, 1) || "?";
}

function normCdf(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function erf(x) {
  // Abramowitz and Stegun approximation
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y =
    1 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function blackScholesPrice(spot, strike, dte, hv, putCall) {
  if (!(spot > 0) || !(strike > 0) || !(dte > 0) || !(hv > 0)) return null;
  const t = dte / BS_DAYCOUNT;
  if (!(t > 0)) return null;
  const sqrtT = Math.sqrt(t);
  const d1 =
    (Math.log(spot / strike) + (BS_RISK_FREE + 0.5 * hv * hv) * t) / (hv * sqrtT);
  const d2 = d1 - hv * sqrtT;
  const cp = cpCode(putCall);
  if (cp === "C") {
    return spot * normCdf(d1) - strike * Math.exp(-BS_RISK_FREE * t) * normCdf(d2);
  }
  if (cp === "P") {
    return strike * Math.exp(-BS_RISK_FREE * t) * normCdf(-d2) - spot * normCdf(-d1);
  }
  return null;
}

function extractHv(matrix) {
  if (!matrix) return null;
  if (typeof matrix.historical_volatility === "number" && matrix.historical_volatility > 0) {
    return matrix.historical_volatility;
  }
  for (const contract of matrix.contracts || []) {
    if (
      typeof contract.historical_volatility === "number" &&
      contract.historical_volatility > 0
    ) {
      return contract.historical_volatility;
    }
  }
  return null;
}

function marketIvPercent(contract) {
  for (const key of ["implied_volatility", "iv", "market_iv", "volatility"]) {
    const val = contract[key];
    if (typeof val === "number" && val > 0) {
      return Math.round((val <= 3 ? val * 100 : val) * 100) / 100;
    }
  }
  return null;
}

function enrichContract(contract, spot, hv) {
  const out = { ...contract };
  if (typeof hv === "number" && hv > 0) {
    out.historical_volatility = hv;
    if (typeof out.bs_price !== "number") {
      const bs = blackScholesPrice(
        spot,
        out.strike_price,
        out.days_to_expiration,
        hv,
        out.put_call
      );
      if (typeof bs === "number") {
        out.bs_price = bs;
        out.greeks_source = "black_scholes_close_to_close_hv";
      }
    }
  }
  return out;
}

function toEligible(contract, spot, symbol) {
  const mark = contract.mark;
  const bs = contract.bs_price;
  const strike = contract.strike_price;
  const dte = contract.days_to_expiration;
  if (
    typeof mark !== "number" ||
    typeof bs !== "number" ||
    typeof strike !== "number" ||
    typeof dte !== "number"
  ) {
    return null;
  }
  if (mark < FILTER.minMark || bs < FILTER.minBs || bs <= 0 || mark <= 0) return null;
  if (dte < FILTER.minDte || dte > FILTER.maxDte) return null;
  if (!(spot > 0)) return null;
  const mny = strike / spot;
  if (mny < FILTER.minMny || mny > FILTER.maxMny) return null;
  const oi = Number(contract.open_interest || 0) || 0;
  const vol = Number(contract.total_volume || 0) || 0;
  if (oi < FILTER.minOiOrVol.oi && vol < FILTER.minOiOrVol.vol) return null;
  const ratio = mark / bs;
  if (ratio < FILTER.minRatio || ratio > FILTER.maxRatio) return null;

  const edgePct = Math.round(((mark - bs) / bs) * 10000) / 100;
  const hv = contract.historical_volatility;
  const hvPct =
    typeof hv === "number" ? Math.round((hv <= 3 ? hv * 100 : hv) * 100) / 100 : null;
  const ivPct = marketIvPercent(contract);
  return {
    symbol,
    exp: contract.expiration_date,
    dte: Math.round(dte),
    strike,
    cp: cpCode(contract.put_call),
    mark: Math.round(mark * 10000) / 10000,
    bs: Math.round(bs * 10000) / 10000,
    edge_pct: edgePct,
    iv_pct: ivPct,
    hv_pct: hvPct,
    iv_minus_hv:
      ivPct != null && hvPct != null ? Math.round((ivPct - hvPct) * 100) / 100 : null,
    mny: Math.round(mny * 10000) / 10000,
    oi,
    vol,
    S: Math.round(spot * 10000) / 10000,
    option_symbol: contract.option_symbol || null,
  };
}

function buildMatrixPayload(symbol, asOf, source, rows, spot) {
  const expirations = [...new Set(rows.map((r) => r.exp))].sort();
  const strikes = [...new Set(rows.map((r) => r.strike))].sort((a, b) => a - b);
  const cells = new Map();
  const overpriced = [];
  const underpriced = [];

  for (const row of rows) {
    const key = `${row.strike}|${row.exp}|${row.cp}`;
    const cell = {
      exp: row.exp,
      dte: row.dte,
      strike: row.strike,
      cp: row.cp,
      mark: row.mark,
      bs: row.bs,
      edge_pct: row.edge_pct,
      mny: row.mny,
      oi: row.oi,
      vol: row.vol,
      iv_pct: row.iv_pct,
      hv_pct: row.hv_pct,
      bias: row.edge_pct > 0 ? "over" : row.edge_pct < 0 ? "under" : "fair",
    };
    cells.set(key, cell);
    if (row.edge_pct > 0) overpriced.push(cell);
    else if (row.edge_pct < 0) underpriced.push(cell);
  }

  overpriced.sort((a, b) => b.edge_pct - a.edge_pct);
  underpriced.sort((a, b) => a.edge_pct - b.edge_pct);

  function gridFor(side) {
    const out = [];
    for (const strike of strikes) {
      const byExp = {};
      let any = false;
      for (const exp of expirations) {
        const cell = cells.get(`${strike}|${exp}|${side}`);
        if (cell) {
          byExp[exp] = cell;
          any = true;
        }
      }
      if (any) {
        out.push({
          strike,
          moneyness: Math.round((strike / spot) * 10000) / 10000,
          by_exp: byExp,
        });
      }
    }
    return out;
  }

  return {
    success: true,
    symbol,
    as_of: asOf,
    spot,
    source_namespace: SOURCE_NAMESPACE,
    source_namespace_id: SOURCE_NAMESPACE_ID,
    source_key: `${symbol}/options_matrix/${asOf}`,
    source_exported_at: source?.exported_at || null,
    source_enriched_at: source?.enriched_at || null,
    eligible: rows.length,
    expiration_count: expirations.length,
    strike_count: strikes.length,
    expirations,
    strikes,
    call_grid: gridFor("C"),
    put_grid: gridFor("P"),
    overpriced,
    underpriced,
    overpriced_count: overpriced.length,
    underpriced_count: underpriced.length,
    axes: { rows: "strike", columns: "expiration", value: "edge_pct" },
    filter:
      "DTE 5-180, moneyness 0.90-1.10, mark&bs≥$0.50, OI≥20 or vol≥10, mark/bs in [0.25,4]",
    definition: "edge_pct=(mark-bs)/bs*100; over>0 under<0",
  };
}

async function resolveDateFromSkew(env, dateOrLatest) {
  if (dateOrLatest && dateOrLatest !== "latest") return dateOrLatest;
  const manifest = await kvGet(skewStore(env), GLOBAL_MANIFEST_KEY);
  return manifest?.latest_date || (manifest?.dates || []).slice(-1)[0] || null;
}

async function resolveLatestSourceDate(env) {
  const store = alpacaStore(env);
  if (!store) return null;

  // Scan by-date manifests with pagination so the newest export is never missed.
  const dates = [];
  let cursor;
  do {
    const listed = await store.list({
      prefix: "by-date/",
      limit: 1000,
      cursor,
    });
    for (const key of listed.keys || []) {
      const m = /^by-date\/(\d{4}-\d{2}-\d{2})\/manifest$/.exec(key.name);
      if (m) dates.push(m[1]);
    }
    cursor = listed.list_complete ? undefined : listed.cursor;
  } while (cursor);

  dates.sort();
  if (dates.length) return dates[dates.length - 1];

  // Fallback: derived rankings manifest on SKEW_IV.
  return resolveDateFromSkew(env, "latest");
}

async function resolveDate(env, dateOrLatest) {
  if (dateOrLatest && dateOrLatest !== "latest") return dateOrLatest;
  const sourceDate = await resolveLatestSourceDate(env);
  if (sourceDate) return sourceDate;
  return resolveDateFromSkew(env, "latest");
}

async function loadSourceMatrix(env, symbol, asOf) {
  const store = alpacaStore(env);
  if (!store) return null;
  return kvGet(store, `${symbol.toUpperCase()}/options_matrix/${asOf}`);
}

async function loadHvMap(env, asOf) {
  const payload = await kvGet(skewStore(env), `as_of/${asOf}/hv-by-symbol`);
  return payload?.hv_by_symbol || null;
}

async function resolveSymbolHv(env, symbol, source, asOf, hvMap) {
  const sym = symbol.toUpperCase();
  const fromSource = extractHv(source);
  if (fromSource != null) return { hv: fromSource, source: "matrix" };
  if (hvMap && typeof hvMap[sym] === "number" && hvMap[sym] > 0) {
    return { hv: hvMap[sym], source: "skew_hv_map" };
  }
  // Walk a few prior calendar days for an enriched source matrix.
  const base = new Date(`${asOf}T00:00:00Z`);
  if (!Number.isNaN(base.getTime())) {
    for (let i = 1; i <= 14; i += 1) {
      const d = new Date(base.getTime() - i * 86400000);
      const date = d.toISOString().slice(0, 10);
      const prior = await loadSourceMatrix(env, sym, date);
      const hv = extractHv(prior);
      if (hv != null) return { hv, source: `prior:${date}` };
    }
  }
  return { hv: null, source: "none" };
}

async function buildLiveMatrix(env, symbol, asOf) {
  const source = await loadSourceMatrix(env, symbol, asOf);
  if (!source) return null;
  const spot = Number(source.underlying_price || 0);
  const hvMap = await loadHvMap(env, asOf);
  const { hv, source: hvSource } = await resolveSymbolHv(
    env,
    symbol,
    source,
    asOf,
    hvMap
  );
  const rows = [];
  for (const contract of source.contracts || []) {
    const enriched = enrichContract(contract, spot, hv);
    const row = toEligible(enriched, spot, symbol.toUpperCase());
    if (row) rows.push(row);
  }
  const payload = buildMatrixPayload(symbol.toUpperCase(), asOf, source, rows, spot);
  payload.hv = hv;
  payload.hv_source = hvSource;
  payload.pricing =
    "edge=(mark-bs)/bs; BS=BSM(HV,r=4%,T=dte/365.25); live enrichment when source omits bs_price";
  return payload;
}

async function getMatrix(env, symbol, asOf) {
  const live = await buildLiveMatrix(env, symbol, asOf);
  if (live) return live;

  const cached = await kvGet(skewStore(env), matrixKey(asOf, symbol));
  if (cached) {
    return {
      success: true,
      source_namespace: SOURCE_NAMESPACE,
      source_mode: "skew_cache",
      ...cached,
      as_of: asOf,
      symbol: symbol.toUpperCase(),
    };
  }
  return null;
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
  const skew = skewStore(env);
  const alpaca = alpacaStore(env);
  const manifest = skew ? await kvGet(skew, GLOBAL_MANIFEST_KEY) : null;
  const sourceDate = await resolveLatestSourceDate(env);
  let sourceManifest = null;
  if (alpaca && sourceDate) {
    sourceManifest = await kvGet(alpaca, `by-date/${sourceDate}/manifest`);
  }

  return {
    success: true,
    openapi: OPENAPI.openapi || "3.0.3",
    openapi_url: `${baseUrl}/openapi.json`,
    display_url: `${baseUrl}/display`,
    retrievals_url: `${baseUrl}/retrievals`,
    kv_connected: Boolean(skew),
    source_kv_connected: Boolean(alpaca),
    kv_bindings: [
      {
        binding: "SKEW_IV",
        namespace: NAMESPACE_NAME,
        namespace_id: NAMESPACE_ID,
        connected: Boolean(skew),
      },
      {
        binding: "ALPACA_MATRIX",
        namespace: SOURCE_NAMESPACE,
        namespace_id: SOURCE_NAMESPACE_ID,
        connected: Boolean(alpaca),
      },
    ],
    kv_key_format: {
      manifest: GLOBAL_MANIFEST_KEY,
      summary: "as_of/{YYYY-MM-DD}/summary",
      surface: "as_of/{YYYY-MM-DD}/surface/{SYMBOL}",
      matrix: "as_of/{YYYY-MM-DD}/matrix/{SYMBOL}",
      overpriced: "as_of/{YYYY-MM-DD}/overpriced",
      underpriced: "as_of/{YYYY-MM-DD}/underpriced",
      ticker_bias: "as_of/{YYYY-MM-DD}/ticker-bias",
      source_matrix: "{SYMBOL}/options_matrix/{YYYY-MM-DD}",
      source_day_manifest: "by-date/{YYYY-MM-DD}/manifest",
    },
    namespace: NAMESPACE_NAME,
    namespace_id: NAMESPACE_ID,
    source_namespace: SOURCE_NAMESPACE,
    source_namespace_id: SOURCE_NAMESPACE_ID,
    date_count: manifest?.date_count ?? (manifest?.dates || []).length,
    dates: manifest?.dates || [],
    latest_date: sourceDate || manifest?.latest_date || null,
    surface_symbols: manifest?.surface_symbols || [],
    matrix_symbols: sourceManifest?.symbols || manifest?.matrix_symbols || [],
    source_updated_at: sourceManifest?.updated_at || null,
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
    const accept = request.headers.get("Accept") || "";

    if (path === "/display" || path === "/ui") {
      return html(DISPLAY_HTML);
    }

    // Browser-friendly root: HTML display; machines still get OpenAPI via /openapi.json
    if (path === "/" && accept.includes("text/html") && !accept.includes("application/json")) {
      return html(DISPLAY_HTML);
    }

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
        primary_matrix: "get:/v1/as_of/{date}/matrix/{symbol}",
        display: `${baseUrl}/display`,
        retrievals: buildRetrievals(baseUrl),
      });
    }

    if (path === "/tickers") {
      const health = await buildHealth(env, baseUrl);
      const manifest = await kvGet(skewStore(env), GLOBAL_MANIFEST_KEY);
      return json({
        success: true,
        ...(manifest || {}),
        latest_date: health.latest_date,
        matrix_symbols: health.matrix_symbols,
        source_namespace: SOURCE_NAMESPACE,
        source_updated_at: health.source_updated_at,
      });
    }

    if (path === "/dates") {
      const manifest = await kvGet(skewStore(env), GLOBAL_MANIFEST_KEY);
      const sourceDate = await resolveLatestSourceDate(env);
      const dates = [...new Set([...(manifest?.dates || []), sourceDate].filter(Boolean))].sort();
      return json({
        success: true,
        date_count: dates.length,
        dates,
        latest_date: sourceDate || manifest?.latest_date || dates[dates.length - 1] || null,
        updated_at: manifest?.updated_at,
        source_namespace: SOURCE_NAMESPACE,
        kv_key: GLOBAL_MANIFEST_KEY,
      });
    }

    if (path === "/keys") {
      const store = skewStore(env);
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
      const summary = await kvGet(skewStore(env), summaryKey(asOf));
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
      const surface = await kvGet(skewStore(env), surfaceKey(asOf, symbol));
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

    match = path.match(
      new RegExp(`^/v1/as_of/(latest|${DATE_PATTERN})/matrix/(${TICKER_PATTERN})$`),
    );
    if (match) {
      const asOf = await resolveDate(env, match[1]);
      if (!asOf) return notFound("No as-of dates available");
      const symbol = match[2].toUpperCase();
      const matrix = await getMatrix(env, symbol, asOf);
      if (!matrix) {
        return notFound(
          `Missing matrix for ${symbol} on ${asOf} (source key ${symbol}/options_matrix/${asOf})`,
        );
      }
      return json(matrix);
    }

    match = path.match(new RegExp(`^/v1/as_of/(latest|${DATE_PATTERN})/overpriced$`));
    if (match) {
      const asOf = await resolveDate(env, match[1]);
      if (!asOf) return notFound("No as-of dates in manifest");
      const data = await kvGet(skewStore(env), overpricedKey(asOf));
      if (!data) return notFound(`Missing overpriced: ${overpricedKey(asOf)}`);
      return json({ success: true, as_of: asOf, ...data });
    }

    match = path.match(new RegExp(`^/v1/as_of/(latest|${DATE_PATTERN})/underpriced$`));
    if (match) {
      const asOf = await resolveDate(env, match[1]);
      if (!asOf) return notFound("No as-of dates in manifest");
      const data = await kvGet(skewStore(env), underpricedKey(asOf));
      if (!data) return notFound(`Missing underpriced: ${underpricedKey(asOf)}`);
      return json({ success: true, as_of: asOf, ...data });
    }

    match = path.match(new RegExp(`^/v1/as_of/(latest|${DATE_PATTERN})/ticker-bias$`));
    if (match) {
      const asOf = await resolveDate(env, match[1]);
      if (!asOf) return notFound("No as-of dates in manifest");
      const data = await kvGet(skewStore(env), tickerBiasKey(asOf));
      if (!data) return notFound(`Missing ticker-bias: ${tickerBiasKey(asOf)}`);
      return json({ success: true, as_of: asOf, ...data });
    }

    return notFound(`Unknown path: ${path}`);
  },
};
