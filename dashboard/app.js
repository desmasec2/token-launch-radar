// Token Launch Radar — board, filters and detail view. Reads window.RADAR from
// ../data.js (written by main.ts from the same board the gate checks), so what the
// page shows is exactly what board.json holds. No network, no framework.
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) return;
  var rows = R.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  function $(id) { return document.getElementById(id); }
  function money(usd) {
    if (usd >= 1e9) return '$' + (usd / 1e9).toFixed(2) + 'B';
    if (usd >= 1e6) return '$' + (usd / 1e6).toFixed(1) + 'M';
    if (usd >= 1e3) return '$' + (usd / 1e3).toFixed(0) + 'K';
    return '$' + usd;
  }
  function full(usd) { return '$' + usd.toLocaleString('en-US'); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- masthead + method -------------------------------------------------
  $('stats').innerHTML =
    stat(R.protocol_count, 'protocols scanned') +
    stat(R.pretoken_count, 'record no token') +
    stat(R.board_size, 'on the board') +
    stat(R.watchlist_count, 'watchlist covered') +
    '<div class="stat hot"><b>' + money(R.total_implied_usd) + '</b><span>total implied value</span></div>';
  function stat(v, label) { return '<div class="stat"><b>' + v + '</b><span>' + label + '</span></div>'; }

  $('method-text').innerHTML =
    'Every protocol in the sealed DefiLlama snapshot (as of <b>' + esc(R.as_of) + '</b>) that records no token is a candidate. ' +
    '<b>' + R.screened_count + '</b> are set aside by the watchlist\u2019s own screen \u2014 wrapped, staked or bridged products of tokens that ' +
    'already trade, exchange house products and superseded versions \u2014 because there is no launch left to radar. Each remaining protocol\u2019s ' +
    'implied value is its TVL times its category\u2019s median market-cap/TVL among the snapshot\u2019s tokenised protocols (global median ' +
    '<b>' + R.global_multiple.toFixed(2) + '\u00d7</b>, category multiples capped at 3\u00d7), adjusted for 7-day TVL momentum, for how long it has ' +
    'run with no token, and for chain breadth. The <b>' + R.watchlist_count + '-protocol watchlist</b> (TVL at or above ' +
    money(R.floor_usd) + ') is the floor of the board, never its ceiling: the radar\u2019s job is the early ones below it.';

  // ---- filter state --------------------------------------------------------
  var state = { q: '', cat: '', chain: '', watch: false, sort: 'rank' };
  var cats = {}, chains = {};
  rows.forEach(function (r) {
    if (r.category) cats[r.category] = true;
    r.chains.forEach(function (c) { chains[c] = true; });
  });
  fillSelect($('cat'), Object.keys(cats).sort(), 'All categories');
  fillSelect($('chain'), Object.keys(chains).sort(), 'All chains');
  function fillSelect(el, values, allLabel) {
    el.innerHTML = '<option value="">' + allLabel + '</option>' + values.map(function (v) {
      return '<option value="' + esc(v) + '">' + esc(v) + '</option>';
    }).join('');
  }

  function parseHash() {
    var h = location.hash.replace(/^#/, '');
    var out = {};
    h.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      if (kv.length === 2) out[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
    });
    return out;
  }
  function boardHash() {
    var parts = [];
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.cat) parts.push('cat=' + encodeURIComponent(state.cat));
    if (state.chain) parts.push('chain=' + encodeURIComponent(state.chain));
    if (state.watch) parts.push('watch=1');
    if (state.sort !== 'rank') parts.push('sort=' + state.sort);
    return parts.join('&');
  }

  // ---- board ---------------------------------------------------------------
  function visible() {
    var q = state.q.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      return true;
    });
    var by = {
      rank: function (a, b) { return a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      change: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); },
      multiple: function (a, b) { return b.multiple - a.multiple; },
      name: function (a, b) { return a.name.localeCompare(b.name); }
    };
    return list.sort(by[state.sort] || by.rank);
  }

  function changeCell(v) {
    if (v === null || v === undefined) return '<span class="flat">—</span>';
    var cls = v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'flat';
    return '<span class="' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '%</span>';
  }

  function renderBoard() {
    var list = visible();
    $('count').textContent = list.length + ' of ' + rows.length + ' protocols';
    $('empty').hidden = list.length > 0;
    $('rows').innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num rank">' + r.rank + '</td>' +
        '<td class="name">' + esc(r.name) + (r.watchlist ? '<span class="badge">Watchlist</span>' : '') +
          '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td class="cat">' + esc(r.category || '—') + '</td>' +
        '<td class="chains" title="' + esc(r.chains.join(', ')) + '">' + esc(r.chains.slice(0, 3).join(', ')) +
          (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + changeCell(r.change_7d) + '</td>' +
        '<td class="num implied">' + money(r.implied_value_usd) + '</td>' +
        '<td class="num">' + r.multiple.toFixed(2) + '\u00d7</td></tr>';
    }).join('');
  }

  // ---- detail ----------------------------------------------------------------
  function factor(label, pct, text) {
    var w = Math.max(2, Math.min(100, Math.abs(pct) / 25 * 100));
    return '<div class="factor"><span class="fname">' + label + '</span>' +
      '<span class="track"><span class="fill" style="width:' + w + '%"></span></span>' +
      '<span class="fval">' + text + '</span></div>';
  }

  function renderDetail(r) {
    var age = r.age_days === null ? 'not recorded' :
      r.age_days >= 730 ? (r.age_days / 365.25).toFixed(1) + ' years' :
      r.age_days >= 60 ? Math.round(r.age_days / 30.4) + ' months' : r.age_days + ' days';
    var mult = R.category_multiples.filter(function (c) { return c.category === r.category; })[0];
    $('detail-view').innerHTML =
      '<button class="back" id="back">\u2190 Back to the board</button>' +
      '<div class="detail-head"><h2>' + esc(r.name) + '</h2>' +
        '<span class="of">rank #' + r.rank + ' of ' + R.board_size + '</span>' +
        (r.watchlist ? '<span class="badge">Watchlist</span>' : '') + '</div>' +
      '<div class="detail-grid">' +
        card('Implied launch value', full(r.implied_value_usd), true) +
        card('TVL (snapshot)', full(r.tvl_usd), false) +
        card('Implied \u00d7 TVL', r.multiple.toFixed(2) + '\u00d7', false) +
        card('TVL change, 7 days', r.change_7d === null ? 'not reported' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%', false) +
        card('Tracked with no token', age, false) +
        card('Category', esc(r.category || 'Uncategorised'), false) +
      '</div>' +
      '<div class="panel"><h3>Why this value</h3>' +
        '<p>The model prices ' + esc(r.name) + ' from the snapshot alone: TVL of ' + full(r.tvl_usd) + ' times the ' +
        esc(r.category || 'global') + ' multiple of <b>' + r.base_multiple.toFixed(2) + '\u00d7</b>' +
        (mult ? ' (median of ' + mult.samples + ' tokenised ' + esc(r.category) + (mult.samples === 1 ? ' protocol' : ' protocols') + ', shrunk toward the global median)' : ' (the global median; the snapshot holds no tokenised comparable in its category)') +
        ', then three adjustments from its own record:</p>' +
        factor('Momentum (7d TVL)', r.momentum_pct, (r.momentum_pct >= 0 ? '+' : '') + r.momentum_pct.toFixed(1) + '%') +
        factor('Maturity (time pre-token)', r.maturity_pct, '+' + r.maturity_pct.toFixed(1) + '%') +
        factor('Breadth (chains)', r.breadth_pct, '+' + r.breadth_pct.toFixed(1) + '%') +
        '<p>No name on the board is priced by hand: change the snapshot and every value moves.</p></div>' +
      '<div class="panel"><h3>How to farm it</h3><ol class="steps">' +
        r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol></div>' +
      '<div class="panel"><h3>Chains</h3><div class="chiprow">' +
        r.chains.map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('') +
      '</div></div>';
    $('back').addEventListener('click', function () { location.hash = boardHash(); });
  }
  function card(label, value, hot) {
    return '<div class="card' + (hot ? ' hot' : '') + '"><span>' + label + '</span><b>' + value + '</b></div>';
  }

  // ---- routing -----------------------------------------------------------------
  function route() {
    var h = parseHash();
    if (h.p && bySlug[h.p]) {
      $('board-view').hidden = true;
      $('method').hidden = true;
      $('detail-view').hidden = false;
      renderDetail(bySlug[h.p]);
      window.scrollTo(0, 0);
      return;
    }
    $('detail-view').hidden = true;
    $('method').hidden = false;
    $('board-view').hidden = false;
    state.q = h.q || ''; state.cat = h.cat || ''; state.chain = h.chain || '';
    state.watch = h.watch === '1'; state.sort = h.sort || 'rank';
    $('q').value = state.q; $('cat').value = state.cat; $('chain').value = state.chain;
    $('watch').checked = state.watch; $('sort').value = state.sort;
    renderBoard();
  }

  function pushState() {
    var target = '#' + boardHash();
    if (location.hash !== target) history.replaceState(null, '', target || '#');
    renderBoard();
  }
  $('q').addEventListener('input', function () { state.q = this.value; pushState(); });
  $('cat').addEventListener('change', function () { state.cat = this.value; pushState(); });
  $('chain').addEventListener('change', function () { state.chain = this.value; pushState(); });
  $('watch').addEventListener('change', function () { state.watch = this.checked; pushState(); });
  $('sort').addEventListener('change', function () { state.sort = this.value; pushState(); });
  $('rows').addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-slug]');
    if (tr) location.hash = 'p=' + encodeURIComponent(tr.getAttribute('data-slug'));
  });
  window.addEventListener('hashchange', route);
  route();
})();
