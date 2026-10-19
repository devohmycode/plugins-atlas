/** What the static demo embeds instead of calling the API: `/api/state` and full fiches. */
export interface PageEmbed {
  state: unknown;
  plugins: unknown[];
}

/** The single page. With `embed`, it reads the fiches from the page itself and has no server. */
export function renderPage(embed?: PageEmbed): string {
  const data = embed ? `<script type="application/json" id="embed">${JSON.stringify(embed).replace(/</g, '\\u003c')}</script>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>plugins-atlas</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <h1>plugins-atlas</h1>
  <p id="banner" class="note" hidden></p>
  <div class="filters">
    <input id="q" type="search" placeholder="Search plugins" aria-label="Search plugins" autocomplete="off">
    <select id="theme" aria-label="Theme"><option value="">All themes</option></select>
    <select id="agent" aria-label="Agent"><option value="">All agents</option></select>
    <label class="check"><input id="official" type="checkbox"> Official only</label>
  </div>
</header>
<main>
  <section aria-label="Plugins">
    <p id="count" class="muted" aria-live="polite"></p>
    <ul id="list"></ul>
    <button id="more" type="button" hidden>More</button>
  </section>
  <section id="detail" aria-label="Plugin" aria-live="polite"><p class="muted">Choose a plugin to see its fiche.</p></section>
</main>
${data}
<script>${SCRIPT}</script>
</body>
</html>
`;
}

const CSS = `
:root { color-scheme: light dark; --bg: #fafaf9; --fg: #1c1917; --muted: #57534e; --card: #fff; --line: #d6d3d1; --accent: #1d4ed8; --high: #b91c1c; --medium: #a16207; --ok: #15803d; }
@media (prefers-color-scheme: dark) { :root { --bg: #161412; --fg: #f5f5f4; --muted: #a8a29e; --card: #22201d; --line: #44403c; --accent: #93b4ff; --high: #f87171; --medium: #facc15; --ok: #4ade80; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.45 system-ui, sans-serif; }
header, main { max-width: 1100px; margin: 0 auto; padding: 12px 16px; }
h1 { font-size: 1.3rem; margin: 0 0 8px; }
h2 { font-size: 1.15rem; margin: 0 0 4px; overflow-wrap: anywhere; }
h3 { font-size: 1rem; margin: 16px 0 6px; }
.filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.filters input[type=search] { flex: 1 1 220px; min-width: 0; }
input, select, button { font: inherit; color: inherit; }
input[type=search], select { padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--card); max-width: 100%; }
button { padding: 6px 12px; border: 1px solid var(--accent); border-radius: 6px; background: var(--accent); color: var(--bg); cursor: pointer; }
button.ghost { background: transparent; color: var(--accent); }
button:disabled { opacity: .5; cursor: not-allowed; }
main { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); gap: 16px; align-items: start; }
@media (max-width: 760px) { main { grid-template-columns: minmax(0, 1fr); } }
ul { list-style: none; margin: 0; padding: 0; }
#list li { margin-bottom: 8px; }
#list button.card { display: block; width: 100%; text-align: left; background: var(--card); color: var(--fg); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
#list button.card[aria-current=true] { border-color: var(--accent); outline: 2px solid var(--accent); }
.card strong { overflow-wrap: anywhere; }
.card .desc { display: block; color: var(--muted); font-size: .9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#detail { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; min-width: 0; }
.muted { color: var(--muted); }
.id { font-family: ui-monospace, monospace; font-size: .85rem; color: var(--muted); overflow-wrap: anywhere; }
.badge { display: inline-block; font-size: .75rem; border: 1px solid var(--line); border-radius: 999px; padding: 0 7px; margin: 2px 4px 0 0; }
.badge.fail, .high { color: var(--high); border-color: var(--high); }
.medium { color: var(--medium); }
.badge.official, .ok { color: var(--ok); border-color: var(--ok); }
dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 2px 10px; margin: 8px 0; }
dt { color: var(--muted); } dd { margin: 0; overflow-wrap: anywhere; }
pre { background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 8px; overflow-x: auto; font-size: .82rem; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 420px; }
a { color: var(--accent); }
fieldset { border: 1px solid var(--line); border-radius: 8px; margin: 12px 0 0; padding: 8px 12px 12px; min-width: 0; }
legend { font-weight: 600; padding: 0 4px; }
.check { display: inline-flex; gap: 6px; align-items: center; margin: 2px 12px 2px 0; }
.row { display: flex; flex-wrap: wrap; gap: 4px 0; margin: 6px 0; }
.note { border-left: 3px solid var(--medium); padding: 4px 10px; margin: 8px 0; }
.proposal { border-top: 1px solid var(--line); padding: 6px 0; overflow-wrap: anywhere; }
.error { color: var(--high); }
`;

// Plain JS, no template literals and no backslashes: it sits inside a TypeScript template string.
const SCRIPT = `
'use strict';
var embedEl = document.getElementById('embed');
var EMBED = embedEl ? JSON.parse(embedEl.textContent) : null;
var TOKEN = location.hash.slice(1);
var state = null, current = null, offset = 0, timer = 0;
var DEMO_NOTE = 'This is a demo: it installs nothing. Run plugins-atlas ui on your own machine to review and install a plugin.';

function $(id) { return document.getElementById(id); }
function el(tag, props) {
  var node = document.createElement(tag);
  for (var key in props || {}) {
    if (key === 'text') node.textContent = props[key];
    else if (key === 'class') node.className = props[key];
    else if (key === 'on') node.addEventListener('click', props[key]);
    else if (props[key] === true) node.setAttribute(key, '');
    else if (props[key] !== false && props[key] != null) node.setAttribute(key, props[key]);
  }
  for (var i = 2; i < arguments.length; i++) {
    var kid = arguments[i];
    if (kid == null || kid === false) continue;
    node.append(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return node;
}

async function api(path, body) {
  if (EMBED) return local(path);
  var headers = { 'x-atlas-token': TOKEN };
  if (body) headers['content-type'] = 'application/json';
  var res = await fetch(path, { method: body ? 'POST' : 'GET', headers: headers, body: body ? JSON.stringify(body) : undefined });
  var data = await res.json();
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

function rank(p) { return p.official && p.origins.length > 1 ? 0 : p.official ? 1 : 2; }
function local(path) {
  var url = new URL(path, 'http://demo'), q = url.searchParams;
  if (url.pathname === '/api/state') return EMBED.state;
  if (url.pathname === '/api/plugin') return EMBED.plugins.find(function (p) { return p.id === q.get('id'); });
  if (url.pathname === '/api/search') {
    var tokens = (q.get('q') || '').toLowerCase().split(' ').filter(Boolean);
    var found = EMBED.plugins.filter(function (p) {
      if (q.get('official') === '1' && !p.official) return false;
      if (q.get('theme') && p.themes.indexOf(q.get('theme')) < 0) return false;
      if (q.get('agent') && p.agents.indexOf(q.get('agent')) < 0) return false;
      var hay = [p.name, p.description].concat(p.keywords, [p.id]).join(' ').toLowerCase();
      return tokens.every(function (t) { return hay.indexOf(t) >= 0; });
    }).sort(function (a, b) { return rank(a) - rank(b) || a.id.localeCompare(b.id); });
    var start = Number(q.get('offset')) || 0;
    return { total: found.length, offset: start, items: found.slice(start, start + 50) };
  }
  throw new Error(DEMO_NOTE);
}

function label(agent) { var a = state.agents.find(function (x) { return x.id === agent; }); return a ? a.label : agent; }
function themeLabel(id) { var t = state.themes.find(function (x) { return x.id === id; }); return t ? t.label : id; }
function badges(p) {
  var row = el('span', {});
  if (p.official) row.append(el('span', { class: 'badge official', text: 'official' }));
  if (p.audit === 'fail') row.append(el('span', { class: 'badge fail', text: 'high risk' }));
  if (p.audit === 'unaudited') row.append(el('span', { class: 'badge', text: 'components unknown' }));
  p.themes.forEach(function (t) { row.append(el('span', { class: 'badge', text: themeLabel(t) })); });
  return row;
}

function query() {
  var params = new URLSearchParams({ q: $('q').value, theme: $('theme').value, agent: $('agent').value, official: $('official').checked ? '1' : '', offset: String(offset) });
  return '/api/search?' + params;
}

async function search(append) {
  if (!append) offset = 0;
  try {
    var page = await api(query());
    if (!append) $('list').replaceChildren();
    page.items.forEach(function (p) {
      var card = el('button', { type: 'button', class: 'card', 'data-id': p.id, on: function () { show(p.id); } },
        el('strong', { text: p.name }), ' ', el('span', { class: 'id', text: p.id }),
        el('span', { class: 'desc', text: p.description || '' }), badges(p));
      $('list').append(el('li', {}, card));
    });
    offset = page.offset + page.items.length;
    $('count').textContent = page.total + (page.total === 1 ? ' plugin' : ' plugins') + (EMBED ? ' in this demo extract' : '');
    $('more').hidden = offset >= page.total;
  } catch (e) { $('count').textContent = e.message; }
}

function list(title, lines, empty) {
  return [el('h3', { text: title }), lines && lines.length ? el('pre', { text: lines.join(String.fromCharCode(10)) }) : el('p', { class: 'muted', text: empty })];
}

async function show(id) {
  document.querySelectorAll('#list button.card').forEach(function (b) { b.setAttribute('aria-current', String(b.dataset.id === id)); });
  var detail = $('detail');
  try { current = await api('/api/plugin?id=' + encodeURIComponent(id)); } catch (e) { detail.replaceChildren(el('p', { class: 'error', text: e.message })); return; }
  var p = current;
  var meta = el('dl', {});
  function add(k, v) { if (v) meta.append(el('dt', { text: k }), el('dd', {}, v)); }
  add('Version', p.version);
  add('Author', p.author);
  add('Marketplace', p.marketplace);
  add('Repository', p.repository && p.repository.indexOf('https://') === 0 ? el('a', { href: p.repository, rel: 'noopener noreferrer', target: '_blank', text: p.repository }) : p.repository);
  add('Agents', p.agents.map(label).join(', ') || 'none known');
  add('Sources', p.origins.join(', '));
  add('Keywords', p.keywords.join(', '));
  var risks = el('ul', {});
  p.risks.forEach(function (r) { risks.append(el('li', {}, el('span', { class: r.level, text: r.level + ': ' }), r.detail)); });
  var preview = el('div', {});
  var previewButton = el('button', { type: 'button', class: 'ghost', disabled: Boolean(EMBED), on: async function () {
    previewButton.disabled = true;
    preview.replaceChildren(el('p', { class: 'muted', text: 'Reading the repository...' }));
    try {
      var read = await api('/api/preview?id=' + encodeURIComponent(p.id));
      if (read.error) preview.replaceChildren(el('p', { class: 'error', text: read.error }));
      else preview.replaceChildren.apply(preview, list('README', read.readme ? [read.readme] : [], 'No README.').concat(list('Components in the repository', read.components, 'None found.')));
    } catch (e) { preview.replaceChildren(el('p', { class: 'error', text: e.message })); }
    previewButton.disabled = false;
  } }, 'Preview README');
  detail.replaceChildren(
    el('h2', { text: p.name }), el('div', { class: 'id', text: p.id }), badges(p),
    el('p', { text: p.description || 'No description.' }), meta);
  list('Components', p.components, 'Components unknown: the repository was not read.').forEach(function (n) { detail.append(n); });
  detail.append(el('h3', { text: 'Risks' }), p.audit === 'unaudited' ? el('p', { class: 'muted', text: 'Not audited: its components could not be read.' }) : p.risks.length ? risks : el('p', { class: 'ok', text: 'No risk found.' }));
  detail.append(el('div', { class: 'row' }, previewButton), preview, installForm(p));
  if (matchMedia('(max-width: 760px)').matches) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function installForm(p) {
  var off = Boolean(state.demo);
  var box = el('fieldset', {}, el('legend', { text: 'Install' }));
  if (off) box.append(el('p', { class: 'note', text: DEMO_NOTE }));
  var agents = el('div', { class: 'row' });
  state.agents.forEach(function (a) {
    var reads = p.agents.indexOf(a.id) >= 0;
    var input = el('input', { type: 'checkbox', name: 'agent', value: a.id, disabled: off, checked: !off && reads && state.defaults.agents.indexOf(a.id) >= 0 });
    agents.append(el('label', { class: 'check' }, input, a.label + (reads ? '' : ' (no manifest it reads)')));
  });
  var scopes = el('div', { class: 'row' });
  ['project', 'user'].forEach(function (s) {
    scopes.append(el('label', { class: 'check' }, el('input', { type: 'radio', name: 'scope', value: s, disabled: off, checked: s === state.defaults.scope }), s));
  });
  var risky = el('input', { type: 'checkbox', disabled: off });
  var out = el('div', { 'aria-live': 'polite' });
  var reviewButton = el('button', { type: 'button', disabled: off }, 'Review');
  box.append(el('h3', { text: 'Agents' }), agents, el('h3', { text: 'Scope' }), scopes,
    el('label', { class: 'check' }, risky, 'Install despite a high risk (plans this review with the audit off)'),
    el('div', { class: 'row' }, reviewButton), out);
  // A changed choice voids the review shown; the confirmation box inside it does not.
  box.addEventListener('change', function (e) { if (!out.contains(e.target)) out.replaceChildren(); });
  reviewButton.addEventListener('click', async function () {
    var chosen = Array.from(box.querySelectorAll('input[name=agent]:checked')).map(function (i) { return i.value; });
    var scope = box.querySelector('input[name=scope]:checked').value;
    if (!chosen.length) { out.replaceChildren(el('p', { class: 'error', text: 'Choose at least one agent.' })); return; }
    reviewButton.disabled = true;
    try {
      var review = await api('/api/review', { ids: [p.id], agents: chosen, scope: scope, noAudit: risky.checked });
      out.replaceChildren(renderReview(review));
    } catch (e) { out.replaceChildren(el('p', { class: 'error', text: e.message })); }
    reviewButton.disabled = false;
  });
  return box;
}

function proposalNode(r, done) {
  var who = r.plugin + ': ' + r.agents.map(label).join(' + ') + ', ' + r.scope + (r.mechanism ? ' (' + r.mechanism + ')' : '');
  var node = el('div', { class: 'proposal' }, el('strong', { text: who }));
  if (r.actions) node.append(el('div', { text: 'Actions: ' + r.actions }));
  r.risks.forEach(function (k) { node.append(el('div', { class: k.level, text: k.level + ': ' + k.detail })); });
  if (r.error) node.append(el('div', { class: 'error', text: (done ? 'Failed: ' : 'Will not install: ') + r.error }));
  else if (done) node.append(el('div', { class: 'ok', text: 'Installed.' }));
  return node;
}

function renderReview(review) {
  var node = el('div', {}, el('h3', { text: 'Review' }));
  if (!review.audit) node.append(el('p', { class: 'note', text: 'The audit is off for this review: a high risk does not block it.' }));
  review.proposals.forEach(function (r) { node.append(proposalNode(r, false)); });
  if (!review.installable) { node.append(el('p', { class: 'muted', text: 'Nothing to install.' })); return node; }
  var confirm = el('input', { type: 'checkbox' });
  var go = el('button', { type: 'button', disabled: true }, 'Install');
  confirm.addEventListener('change', function () { go.disabled = !confirm.checked; });
  go.addEventListener('click', async function () {
    go.disabled = true; confirm.disabled = true;
    try {
      var done = await api('/api/install', { reviewId: review.reviewId, confirm: true });
      var result = el('div', {}, el('h3', { text: 'Result' }));
      done.results.forEach(function (r) { result.append(proposalNode(r, true)); });
      node.replaceChildren(result);
    } catch (e) { node.append(el('p', { class: 'error', text: e.message })); }
  });
  node.append(el('label', { class: 'check' }, confirm, 'I have read this review and want to install'), el('div', { class: 'row' }, go));
  return node;
}

async function start() {
  try { state = await api('/api/state'); } catch (e) { $('count').textContent = e.message; return; }
  if (state.demo) { $('banner').textContent = DEMO_NOTE; $('banner').hidden = false; }
  state.themes.forEach(function (t) { $('theme').append(el('option', { value: t.id, text: t.label })); });
  state.agents.forEach(function (a) { $('agent').append(el('option', { value: a.id, text: a.label })); });
  $('q').addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { search(false); }, 200); });
  ['theme', 'agent', 'official'].forEach(function (id) { $(id).addEventListener('change', function () { search(false); }); });
  $('more').addEventListener('click', function () { search(true); });
  search(false);
}
start();
`;
