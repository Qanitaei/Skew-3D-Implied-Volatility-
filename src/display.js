/** HTML UI for overpriced / underpriced options matrices (expirations × strikes). */
export const DISPLAY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SKEW — Options Mispricing Matrix</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,700;1,9..40,400&family=Syne:wght@600;700;800&display=swap" rel="stylesheet" />
  <style>
    :root {
      --ink: #12202b;
      --muted: #5b6b76;
      --paper: #f3f6f4;
      --panel: rgba(255,255,255,0.72);
      --line: rgba(18,32,43,0.12);
      --over: #b42318;
      --over-soft: #f8d5d0;
      --under: #0f6a4f;
      --under-soft: #cfece2;
      --fair: #8a939a;
      --accent: #1f6f8b;
      --shadow: 0 18px 50px rgba(18,32,43,0.08);
      --radius: 18px;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; }
    body {
      font-family: "DM Sans", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(1200px 600px at 10% -10%, #d9e8ef 0%, transparent 55%),
        radial-gradient(900px 500px at 90% 0%, #e7f3ec 0%, transparent 50%),
        linear-gradient(180deg, #eef3f1 0%, var(--paper) 40%, #e8eeea 100%);
    }
    .wrap { width: min(1280px, calc(100% - 2rem)); margin: 0 auto; padding: 1.5rem 0 3rem; }
    header.hero {
      display: grid;
      gap: 0.75rem;
      padding: 1.75rem 0 1.25rem;
      animation: rise 0.7s ease both;
    }
    .brand {
      font-family: Syne, sans-serif;
      font-weight: 800;
      font-size: clamp(2.6rem, 7vw, 4.6rem);
      letter-spacing: -0.04em;
      line-height: 0.95;
      margin: 0;
    }
    .brand span { color: var(--accent); }
    .lede {
      max-width: 42rem;
      margin: 0;
      color: var(--muted);
      font-size: 1.05rem;
      line-height: 1.5;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.6rem 1rem;
      color: var(--muted);
      font-size: 0.92rem;
    }
    .meta strong { color: var(--ink); font-weight: 700; }
    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      align-items: end;
      margin: 1.25rem 0 1rem;
      padding: 1rem;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      backdrop-filter: blur(10px);
      box-shadow: var(--shadow);
      animation: rise 0.8s ease 0.05s both;
    }
    label { display: grid; gap: 0.35rem; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
    select, button {
      font: inherit;
      border-radius: 12px;
      border: 1px solid var(--line);
      background: #fff;
      color: var(--ink);
      padding: 0.65rem 0.8rem;
      min-height: 2.6rem;
    }
    select { min-width: 8.5rem; }
    button {
      cursor: pointer;
      background: var(--ink);
      color: #fff;
      border-color: var(--ink);
      font-weight: 700;
      transition: transform 0.15s ease, opacity 0.15s ease;
    }
    button:hover { transform: translateY(-1px); }
    button.secondary { background: #fff; color: var(--ink); }
    .seg {
      display: inline-flex;
      padding: 0.2rem;
      gap: 0.2rem;
      background: rgba(18,32,43,0.05);
      border-radius: 12px;
    }
    .seg button {
      background: transparent;
      color: var(--muted);
      border: 0;
      min-height: 2.2rem;
      box-shadow: none;
    }
    .seg button.active {
      background: #fff;
      color: var(--ink);
      box-shadow: 0 1px 0 rgba(18,32,43,0.06);
    }
    .panels { display: grid; gap: 1rem; }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      overflow: hidden;
      animation: rise 0.85s ease 0.1s both;
    }
    .panel-head {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      align-items: baseline;
      padding: 1rem 1.1rem 0.7rem;
      border-bottom: 1px solid var(--line);
    }
    .panel-head h2 {
      margin: 0;
      font-family: Syne, sans-serif;
      font-size: 1.25rem;
      letter-spacing: -0.02em;
    }
    .panel-head p { margin: 0; color: var(--muted); font-size: 0.9rem; }
    .scroll { overflow: auto; max-height: min(70vh, 720px); }
    table.matrix {
      border-collapse: separate;
      border-spacing: 0;
      width: max-content;
      min-width: 100%;
      font-variant-numeric: tabular-nums;
      font-size: 0.82rem;
    }
    table.matrix th, table.matrix td {
      border-bottom: 1px solid var(--line);
      border-right: 1px solid rgba(18,32,43,0.06);
      padding: 0.45rem 0.5rem;
      text-align: center;
      white-space: nowrap;
    }
    table.matrix th {
      position: sticky;
      top: 0;
      background: #f8fbf9;
      z-index: 2;
      font-weight: 700;
      color: var(--muted);
      font-size: 0.72rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    table.matrix th.strike, table.matrix td.strike {
      position: sticky;
      left: 0;
      z-index: 3;
      background: #f8fbf9;
      text-align: right;
      font-weight: 700;
      min-width: 4.5rem;
    }
    table.matrix th.strike { z-index: 4; }
    td.cell { cursor: default; transition: transform 0.12s ease; }
    td.cell:hover { transform: scale(1.04); z-index: 1; }
    td.over { background: color-mix(in srgb, var(--over-soft) var(--heat, 40%), white); color: var(--over); font-weight: 700; }
    td.under { background: color-mix(in srgb, var(--under-soft) var(--heat, 40%), white); color: var(--under); font-weight: 700; }
    td.empty { color: #c0c6cb; }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem 1.25rem;
      margin: 0.25rem 0 1rem;
      color: var(--muted);
      font-size: 0.9rem;
      animation: rise 0.75s ease 0.08s both;
    }
    .swatch { display: inline-block; width: 0.8rem; height: 0.8rem; border-radius: 999px; margin-right: 0.35rem; vertical-align: -1px; }
    .swatch.over { background: var(--over); }
    .swatch.under { background: var(--under); }
    .status { min-height: 1.25rem; color: var(--muted); margin: 0.25rem 0 0.75rem; }
    .status.error { color: var(--over); }
    .lists {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 1rem;
      margin-top: 1rem;
    }
    @media (max-width: 860px) {
      .lists { grid-template-columns: 1fr; }
      .controls { align-items: stretch; }
      select, button { width: 100%; }
    }
    .rank {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.86rem;
    }
    .rank th, .rank td {
      text-align: left;
      padding: 0.45rem 0.4rem;
      border-bottom: 1px solid var(--line);
    }
    .rank th { color: var(--muted); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .edge-over { color: var(--over); font-weight: 700; }
    .edge-under { color: var(--under); font-weight: 700; }
    footer {
      margin-top: 1.5rem;
      color: var(--muted);
      font-size: 0.85rem;
    }
    footer a { color: var(--accent); }
    @keyframes rise {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="hero">
      <h1 class="brand">SKEW<span>.</span></h1>
      <p class="lede">Overpriced and underpriced options from the latest Alpaca matrix pull — expirations across the top, strikes down the side.</p>
      <div class="meta" id="meta">Loading latest matrix…</div>
    </header>

    <div class="controls">
      <label>Ticker
        <select id="symbol"></select>
      </label>
      <label>Side
        <div class="seg" id="sideSeg">
          <button type="button" data-side="C" class="active">Calls</button>
          <button type="button" data-side="P">Puts</button>
        </div>
      </label>
      <label>Show
        <div class="seg" id="biasSeg">
          <button type="button" data-bias="both" class="active">Both</button>
          <button type="button" data-bias="over">Over</button>
          <button type="button" data-bias="under">Under</button>
        </div>
      </label>
      <button type="button" id="reload">Refresh</button>
      <button type="button" class="secondary" id="apiLink">API</button>
    </div>

    <div class="legend">
      <span><i class="swatch over"></i>Overpriced (mark ≫ HV BS)</span>
      <span><i class="swatch under"></i>Underpriced (mark ≪ HV BS)</span>
      <span>Cell value = edge % = (mark − BS) / BS</span>
    </div>
    <div class="status" id="status"></div>

    <div class="panels">
      <section class="panel">
        <div class="panel-head">
          <h2 id="matrixTitle">Expiration × strike matrix</h2>
          <p id="matrixSub">edge % by contract</p>
        </div>
        <div class="scroll" id="matrixMount"></div>
      </section>
    </div>

    <div class="lists">
      <section class="panel">
        <div class="panel-head">
          <h2 id="overTitle">Top overpriced</h2>
          <p id="overSub">Selected ticker + universe</p>
        </div>
        <div class="scroll" id="overMount"></div>
      </section>
      <section class="panel">
        <div class="panel-head">
          <h2 id="underTitle">Top underpriced</h2>
          <p id="underSub">Selected ticker + universe</p>
        </div>
        <div class="scroll" id="underMount"></div>
      </section>
    </div>

    <footer>
      Source KV <code>alpaca-options-matrix-backup</code> ·
      <a href="/openapi.json">OpenAPI</a> ·
      <a href="/health">Health</a>
    </footer>
  </div>
  <script>
    const state = {
      side: "C",
      bias: "both",
      matrix: null,
      asOf: "latest",
      universeOver: [],
      universeUnder: [],
    };

    const $ = (id) => document.getElementById(id);
    const statusEl = $("status");

    function setStatus(msg, isError=false) {
      statusEl.textContent = msg || "";
      statusEl.className = "status" + (isError ? " error" : "");
    }

    function heat(edge) {
      const mag = Math.min(Math.abs(edge), 150);
      return Math.round(35 + (mag / 150) * 65) + "%";
    }

    function fmtExp(exp) {
      if (!exp) return "";
      const [, m, d] = exp.split("-");
      return m + "/" + d;
    }

    function renderMatrix(matrix) {
      const mount = $("matrixMount");
      if (!matrix) {
        mount.innerHTML = "<p style='padding:1rem;color:var(--muted)'>No matrix data.</p>";
        return;
      }
      const side = state.side;
      const grid = side === "P" ? (matrix.put_grid || []) : (matrix.call_grid || []);
      const exps = matrix.expirations || [];
      $("matrixTitle").textContent = matrix.symbol + " · " + (side === "P" ? "Puts" : "Calls");
      $("matrixSub").textContent = (matrix.eligible || 0) + " eligible · spot " + matrix.spot +
        " · " + (matrix.overpriced_count || 0) + " over / " + (matrix.underpriced_count || 0) + " under";

      if (!grid.length || !exps.length) {
        mount.innerHTML = "<p style='padding:1rem;color:var(--muted)'>No eligible contracts for this side.</p>";
        return;
      }

      let html = "<table class='matrix'><thead><tr><th class='strike'>Strike</th>";
      for (const exp of exps) html += "<th title='" + exp + "'>" + fmtExp(exp) + "</th>";
      html += "</tr></thead><tbody>";
      for (const row of grid) {
        html += "<tr><td class='strike'>" + row.strike + "</td>";
        for (const exp of exps) {
          const cell = (row.by_exp || {})[exp];
          if (!cell) {
            html += "<td class='empty'>—</td>";
            continue;
          }
          const bias = cell.edge_pct > 0 ? "over" : cell.edge_pct < 0 ? "under" : "fair";
          if (state.bias !== "both" && state.bias !== bias) {
            html += "<td class='empty'>—</td>";
            continue;
          }
          const title = [
            cell.cp === "P" ? "Put" : "Call",
            "K=" + cell.strike,
            "exp=" + cell.exp,
            "mark=" + cell.mark,
            "bs=" + cell.bs,
            "edge=" + cell.edge_pct + "%",
            "oi=" + cell.oi,
            "vol=" + cell.vol
          ].join(" · ");
          html += "<td class='cell " + bias + "' style='--heat:" + heat(cell.edge_pct) + "' title='" + title + "'>" +
            (cell.edge_pct > 0 ? "+" : "") + cell.edge_pct.toFixed(1) + "</td>";
        }
        html += "</tr>";
      }
      html += "</tbody></table>";
      mount.innerHTML = html;
    }

    function renderRanks(matrix, universeOver, universeUnder) {
      const sym = matrix?.symbol || "";
      const side = state.side;
      const sideLabel = side === "P" ? "puts" : "calls";
      const matchSide = (r) => !r.cp || r.cp === side;
      const localOver = (matrix?.overpriced || [])
        .filter(matchSide)
        .map((r) => ({ ...r, symbol: sym }));
      const localUnder = (matrix?.underpriced || [])
        .filter(matchSide)
        .map((r) => ({ ...r, symbol: sym }));
      const uniOver = (universeOver || []).filter(matchSide);
      const uniUnder = (universeUnder || []).filter(matchSide);
      // Prefer selected-ticker strike/expiration leaders; fall back to universe tables.
      const over = localOver.length ? localOver : uniOver;
      const under = localUnder.length ? localUnder : uniUnder;
      const local = Boolean(localOver.length || localUnder.length);
      $("overTitle").textContent = local ? (sym + " overpriced") : "Top overpriced";
      $("underTitle").textContent = local ? (sym + " underpriced") : "Top underpriced";
      $("overSub").textContent = local
        ? "By expiration × strike · " + sideLabel
        : "Universe leaders · " + sideLabel;
      $("underSub").textContent = local
        ? "By expiration × strike · " + sideLabel
        : "Universe leaders · " + sideLabel;

      const mk = (rows, cls) => {
        if (!rows || !rows.length) return "<p style='padding:1rem;color:var(--muted)'>None for " + sideLabel + "</p>";
        let html = "<table class='rank'><thead><tr><th>Sym</th><th>Exp</th><th>K</th><th>CP</th><th>Edge</th><th>Mark</th><th>BS</th></tr></thead><tbody>";
        for (const r of rows.slice(0, 25)) {
          html += "<tr>" +
            "<td><strong>" + (r.symbol || sym) + "</strong></td>" +
            "<td>" + fmtExp(r.exp) + "</td>" +
            "<td>" + r.strike + "</td>" +
            "<td>" + r.cp + "</td>" +
            "<td class='" + cls + "'>" + (r.edge_pct > 0 ? "+" : "") + Number(r.edge_pct).toFixed(2) + "%</td>" +
            "<td>" + r.mark + "</td>" +
            "<td>" + r.bs + "</td>" +
            "</tr>";
        }
        return html + "</tbody></table>";
      };
      $("overMount").innerHTML = mk(over, "edge-over");
      $("underMount").innerHTML = mk(under, "edge-under");
    }

    async function loadCatalog() {
      const health = await fetch("/health").then((r) => r.json());
      const asOf = health.latest_date || "latest";
      state.asOf = asOf;
      const symbols = (health.matrix_symbols && health.matrix_symbols.length)
        ? health.matrix_symbols
        : (health.surface_symbols || []);
      const sel = $("symbol");
      sel.innerHTML = "";
      for (const sym of symbols) {
        const opt = document.createElement("option");
        opt.value = sym;
        opt.textContent = sym;
        sel.appendChild(opt);
      }
      if (!sel.value && symbols.length) sel.value = symbols[0];
      $("meta").innerHTML =
        "<span>As-of <strong>" + (asOf || "—") + "</strong></span>" +
        "<span>Source <strong>" + (health.source_namespace || "alpaca-options-matrix-backup") + "</strong></span>" +
        "<span>Tickers <strong>" + symbols.length + "</strong></span>" +
        "<span>Updated <strong>" + (health.source_updated_at || health.updated_at || "—") + "</strong></span>";
      return sel.value;
    }

    async function loadAll() {
      try {
        setStatus("Loading matrix…");
        const symbol = $("symbol").value || await loadCatalog();
        if (!$("symbol").value) await loadCatalog();
        const sym = $("symbol").value || symbol;
        const [matrix, over, under] = await Promise.all([
          fetch("/v1/as_of/latest/matrix/" + encodeURIComponent(sym)).then((r) => r.json()),
          fetch("/v1/as_of/latest/overpriced").then((r) => r.json()),
          fetch("/v1/as_of/latest/underpriced").then((r) => r.json()),
        ]);
        if (!matrix.success) throw new Error(matrix.error || "Matrix failed");
        state.matrix = matrix;
        state.universeOver = over.contracts || [];
        state.universeUnder = under.contracts || [];
        renderMatrix(matrix);
        renderRanks(matrix, state.universeOver, state.universeUnder);
        setStatus("Live from " + (matrix.source_key || "KV") + " · " + (matrix.eligible || 0) + " eligible contracts");
      } catch (err) {
        setStatus(String(err.message || err), true);
      }
    }

    $("symbol").addEventListener("change", loadAll);
    $("reload").addEventListener("click", async () => { await loadCatalog(); await loadAll(); });
    $("apiLink").addEventListener("click", () => {
      const sym = $("symbol").value || "AAPL";
      window.open("/v1/as_of/latest/matrix/" + encodeURIComponent(sym), "_blank");
    });
    $("sideSeg").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-side]");
      if (!btn) return;
      state.side = btn.dataset.side;
      [...$("sideSeg").querySelectorAll("button")].forEach((b) => b.classList.toggle("active", b === btn));
      renderMatrix(state.matrix);
      renderRanks(state.matrix, state.universeOver, state.universeUnder);
    });
    $("biasSeg").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-bias]");
      if (!btn) return;
      state.bias = btn.dataset.bias;
      [...$("biasSeg").querySelectorAll("button")].forEach((b) => b.classList.toggle("active", b === btn));
      renderMatrix(state.matrix);
    });

    loadCatalog().then(loadAll);
  </script>
</body>
</html>`;
