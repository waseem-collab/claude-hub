'use strict';

const TOKEN = window.HUB_TOKEN;
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SPARK = (() => {
  let rays = '';
  for (let i = 0; i < 12; i++) {
    const len = i % 2 ? 7.2 : 9.6;
    rays += `<rect x="11.1" y="${12 - len}" width="1.8" height="${len}" rx="0.9" transform="rotate(${i * 30 + (i % 3) * 4} 12 12)"/>`;
  }
  return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${rays}</svg>`;
})();
document.querySelectorAll('.spark').forEach(el => { el.innerHTML = SPARK; });

const CHEV = '<svg class="chev" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICONS = {
  terminal: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 5l3 3-3 3M8 11h5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  file: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 2h5l3 3v9H4z M9 2v3h3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  edit: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M10.5 2.5l3 3L6 13H3v-3z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  search: '<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.2 10.2L13.5 13.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  globe: '<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 8h11M8 2.4c-2 2.2-2 9 0 11.2M8 2.4c2 2.2 2 9 0 11.2" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>',
  agent: '<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="6" r="2.6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3 14c.6-2.7 2.6-4 5-4s4.4 1.3 5 4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  think: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 2.5a4 4 0 0 0-2.3 7.3V12h4.6V9.8A4 4 0 0 0 8 2.5zM6.3 14h3.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  list: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M6 4.5h7M6 8h7M6 11.5h7M3 4.5h.01M3 8h.01M3 11.5h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  tool: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M9.8 2.6a3.4 3.4 0 0 0-3.9 4.6L2.6 10.5a1.3 1.3 0 0 0 1.9 1.9l3.3-3.3a3.4 3.4 0 0 0 4.6-3.9l-2 2-1.8-.3-.3-1.8z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  shield: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 2l5 1.9v3.7c0 3-2 5.3-5 6.4-3-1.1-5-3.4-5-6.4V3.9z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  sparkle: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M12 4l-2 2M6 10l-2 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
};

// ------------------------------------------------------------------ state

const state = {
  sessions: [],
  current: null,      // session id, or null on the new-chat screen
  items: [],          // loaded items (contiguous range)
  start: 0,           // index of items[0] in the full transcript
  es: null,
  hostStatus: null,   // starting | busy | idle | exited | null
  activity: '',
  perms: new Map(),
  draft: '',
  dirs: [],
  temporary: false,   // new-chat toggle
  attachments: [],    // { id, name, size, path, uploading, error, preview }
  home: '',
};

const pref = {
  get(k, d) { try { const v = localStorage.getItem('hub-' + k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('hub-' + k, v); } catch { /* storage unavailable */ } },
};

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: { 'x-hub-token': TOKEN, 'content-type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  // Server restarted with a different token: reload to pick up the current one (at most once a minute).
  if (r.status === 401) {
    let last = 0;
    try { last = Number(sessionStorage.getItem('hub-reloaded')) || 0; } catch { /* storage unavailable */ }
    if (Date.now() - last > 60000) {
      try { sessionStorage.setItem('hub-reloaded', String(Date.now())); } catch { /* storage unavailable */ }
      location.reload();
      return new Promise(() => {});
    }
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || r.statusText), { status: r.status, data });
  return data;
}

function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.className = ''; }, err ? 5000 : 2200);
}

function copy(text, label = 'Copied') {
  navigator.clipboard.writeText(text).then(() => toast(label), () => toast('Copy failed', true));
}

function ago(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const home = p => (p && state.home && p.startsWith(state.home) ? '~' + p.slice(state.home.length) : p || '');
const base = p => (p ? p.split('/').filter(Boolean).pop() || '/' : '');
const currentSession = () => state.sessions.find(s => s.id === state.current);

// ------------------------------------------------------------------ markdown

if (window.marked) marked.setOptions({ gfm: true, breaks: false });

function md(text) {
  const html = window.marked ? marked.parse(text || '') : `<p>${esc(text).replace(/\n/g, '<br>')}</p>`;
  const clean = window.DOMPurify ? DOMPurify.sanitize(html) : html;
  const div = document.createElement('div');
  div.className = 'md';
  div.innerHTML = clean;
  div.querySelectorAll('pre > code').forEach(code => {
    const pre = code.parentElement;
    const lang = (code.className.match(/language-([\w+-]+)/) || [])[1] || '';
    const wrap = document.createElement('div');
    wrap.className = 'codeblock';
    wrap.innerHTML = `<div class="codeblock-head"><span>${esc(lang || 'text')}</span><button class="copy-btn" type="button">Copy</button></div>`;
    pre.replaceWith(wrap);
    wrap.appendChild(pre);
    if (window.hljs && lang && hljs.getLanguage(lang)) { try { hljs.highlightElement(code); } catch { /* ignore */ } }
    $('.copy-btn', wrap).onclick = () => copy(code.textContent);
  });
  div.querySelectorAll('a[href]').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
  return div;
}

// ------------------------------------------------------------------ sidebar

function renderSidebar() {
  // don't wipe an open rename box; render once it closes
  if (state.renaming) { state.sidebarStale = true; return; }
  const q = $('#search').value.trim().toLowerCase();
  const match = s => !q || (s.title || '').toLowerCase().includes(q) || (s.cwd || '').toLowerCase().includes(q);
  const isLive = s => !!(s.terminal || (s.hosted && s.hosted.status !== 'exited'));
  const mode = $('#group-by').value;
  // Status grouping covers live sessions itself, so the pinned "Live now" section is dropped there.
  const live = mode === 'status' ? [] : state.sessions.filter(s => isLive(s) && match(s));
  const recent = state.sessions.filter(s => !live.includes(s) && match(s)).slice(0, 400);
  const row = s => {
    const st = s.hosted ? s.hosted.status : s.terminal ? s.terminal.status : null;
    const where = s.hosted ? 'here' : s.terminal ? 'terminal' : '';
    const dot = st ? `<span class="dot ${st === 'busy' || st === 'starting' ? 'busy' : 'idle'}" title="${esc(where)} · ${esc(st)}"></span>` : '';
    const sub = s.hosted && s.hosted.temporary ? ['temporary · not saved', ago(s.mtime)].join(' · ') : [mode === 'folder' ? '' : base(s.cwd), where && (st === 'busy' ? `working in ${where}` : `open in ${where}`), ago(s.mtime)].filter(Boolean).join(' · ');
    return `<li class="sess-li" data-id="${s.id}"><a class="sess${s.id === state.current ? ' active' : ''}" href="#/s/${s.id}"><span class="txt"><span class="t">${esc(s.title)}</span><span class="sub">${esc(sub)}</span></span>${dot}</a><button type="button" class="icon-btn xs sess-more" aria-label="More options for ${esc(s.title)}" title="More"><svg viewBox="0 0 16 16" width="15" height="15"><circle cx="3.5" cy="8" r="1.3" fill="currentColor"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="12.5" cy="8" r="1.3" fill="currentColor"/></svg></button></li>`;
  };
  $('#live-section').hidden = !live.length;
  $('#live-list').innerHTML = live.map(row).join('');
  const box = $('#chat-groups');
  const groups = groupSessions(recent, mode);
  const collapsed = groupCollapsed(mode);
  $('#collapse-all').hidden = mode === 'none' || groups.length < 2;
  if (!recent.length) {
    box.innerHTML = `<ul><li class="sb-empty">${q ? 'No matches' : 'No sessions yet'}</li></ul>`;
  } else if (mode === 'none') {
    box.innerHTML = `<ul>${recent.map(row).join('')}</ul>`;
  } else {
    box.innerHTML = groups.map(g => {
      // while searching, show every match regardless of collapsed groups
      const closed = !q && collapsed.has(g.key);
      const add = g.cwd ? `<button type="button" class="icon-btn xs g-new" data-cwd="${esc(g.cwd)}" title="New chat in ${esc(home(g.cwd))}" aria-label="New chat in this folder"><svg viewBox="0 0 16 16" width="12" height="12"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>` : '';
      return `<div class="sb-group${closed ? ' closed' : ''}" data-key="${esc(g.key)}">
        <div class="g-head"><button type="button" class="g-toggle" title="${esc(g.title || g.label)}" aria-expanded="${!closed}">${CHEV}<span class="g-label">${esc(g.label)}</span>${g.hint ? `<span class="g-hint">${esc(g.hint)}</span>` : ''}<span class="g-count">${g.items.length}</span></button>${add}</div>
        <ul>${closed ? '' : g.items.map(row).join('')}</ul>
      </div>`;
    }).join('');
  }
  $('#count-label').textContent = `${state.sessions.length} sessions · ${state.sessions.filter(isLive).length} live`;
}

// ------------------------------------------------------------------ sidebar grouping

const DAY = 86400000;

function dateBucket(ms) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const t0 = start.getTime();
  if (ms >= t0) return ['0', 'Today'];
  if (ms >= t0 - DAY) return ['1', 'Yesterday'];
  if (ms >= t0 - 7 * DAY) return ['2', 'Previous 7 days'];
  if (ms >= t0 - 30 * DAY) return ['3', 'Previous 30 days'];
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return [`m${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`, d.toLocaleDateString(undefined, sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' })];
}

function prettyModel(m) {
  if (!m) return 'Unknown model';
  const x = m.replace(/^claude-/, '').replace(/-\d{8}$/, '');
  const [fam, ...ver] = x.split('-');
  return fam[0].toUpperCase() + fam.slice(1) + (ver.length ? ' ' + ver.join('.') : '');
}

function statusOf(s) {
  const st = s.hosted && s.hosted.status !== 'exited' ? s.hosted.status : s.terminal ? s.terminal.status : null;
  if (st === 'busy' || st === 'starting') return ['0', 'Working now'];
  if (s.hosted && s.hosted.status !== 'exited') return ['1', 'Open here'];
  if (s.terminal) return ['2', 'Open in a terminal'];
  return ['3', 'Inactive'];
}

// Returns [{ key, label, hint?, title?, cwd?, items }], sessions already newest-first.
function groupSessions(list, mode) {
  if (mode === 'none') return [{ key: 'all', label: 'All', items: list }];
  const map = new Map();
  const put = (key, meta, s) => {
    if (!map.has(key)) map.set(key, { key, items: [], ...meta });
    map.get(key).items.push(s);
  };
  for (const s of list) {
    if (mode === 'date') { const [k, label] = dateBucket(s.mtime); put(k, { label, order: k }, s); }
    else if (mode === 'status') { const [k, label] = statusOf(s); put(k, { label, order: k }, s); }
    else if (mode === 'model') { const label = prettyModel(s.model || (s.hosted && s.hosted.model)); put(label, { label }, s); }
    else if (mode === 'folder') {
      const cwd = s.cwd || '';
      put(cwd || '?', { label: cwd ? base(cwd) : 'Unknown folder', title: home(cwd), cwd: cwd || null }, s);
    }
  }
  const groups = [...map.values()];
  if (mode === 'date') groups.sort((a, b) => (a.order[0] === 'm' && b.order[0] === 'm' ? b.order.localeCompare(a.order) : a.order.localeCompare(b.order)));
  else if (mode === 'status') groups.sort((a, b) => a.order.localeCompare(b.order));
  else groups.sort((a, b) => b.items[0].mtime - a.items[0].mtime); // most recently active first
  if (mode === 'folder') {
    // same folder name in two places: show where each one lives
    const seen = {};
    for (const g of groups) seen[g.label] = (seen[g.label] || 0) + 1;
    for (const g of groups) if (seen[g.label] > 1 && g.cwd) g.hint = home(g.cwd.slice(0, g.cwd.lastIndexOf('/')) || '/');
  }
  return groups;
}

function groupCollapsed(mode) {
  try { return new Set(JSON.parse(pref.get('collapsed-' + mode, '[]'))); } catch { return new Set(); }
}

function setGroupCollapsed(mode, set) { pref.set('collapsed-' + mode, JSON.stringify([...set])); }

$('#group-by').value = ['none', 'date', 'folder', 'status', 'model'].includes(pref.get('group', 'date')) ? pref.get('group', 'date') : 'date';
$('#group-by').addEventListener('change', e => { pref.set('group', e.target.value); renderSidebar(); });

$('#chat-groups').addEventListener('click', e => {
  const add = e.target.closest('.g-new');
  if (add) {
    $('#cwd-input').value = add.dataset.cwd;
    location.hash = '#/new';
    setTimeout(() => $('#input').focus(), 50);
    return;
  }
  const t = e.target.closest('.g-toggle');
  if (!t) return;
  const mode = $('#group-by').value;
  const key = t.closest('.sb-group').dataset.key;
  const set = groupCollapsed(mode);
  set.has(key) ? set.delete(key) : set.add(key);
  setGroupCollapsed(mode, set);
  renderSidebar();
});

$('#collapse-all').onclick = () => {
  const mode = $('#group-by').value;
  const keys = [...document.querySelectorAll('#chat-groups .sb-group')].map(g => g.dataset.key);
  const set = groupCollapsed(mode);
  // collapse everything except the active chat's group, or expand all if already collapsed
  const activeKey = document.querySelector('#chat-groups .sess.active')?.closest('.sb-group')?.dataset.key;
  const allClosed = keys.every(k => set.has(k) || k === activeKey);
  setGroupCollapsed(mode, new Set(allClosed ? [] : keys.filter(k => k !== activeKey)));
  renderSidebar();
};

$('#search').addEventListener('input', renderSidebar);

// ------------------------------------------------------------------ header / banner / composer state

function renderChrome() {
  const s = currentSession();
  const main = $('#main');
  main.classList.toggle('new', !state.current);
  main.classList.toggle('temp', !state.current ? state.temporary : !!(currentSession()?.hosted?.temporary));
  $('#temp-btn').setAttribute('aria-pressed', String(state.temporary));
  if (!state.current) {
    document.title = state.temporary ? 'Temporary chat · Claude Hub' : 'Claude Hub';
    $('#banner').hidden = true;
    const h = new Date().getHours();
    $('#greeting').textContent = state.temporary ? 'Temporary chat' : h < 5 ? 'Up late?' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    $('#greet-sub').textContent = state.temporary
      ? "This chat won't be saved to your history. It ends when you disconnect it or after 30 idle minutes."
      : 'Pick a session on the left, or start a new one in any folder.';
    $('#input').placeholder = state.temporary ? 'Ask anything. This chat won\'t be saved' : 'How can I help you today?';
    updateSend();
    return;
  }
  if ($('#title')) $('#title').textContent = s ? s.title : 'Loading…';
  document.title = (s ? s.title : 'Session') + ' · Claude Hub';
  $('#cwd-chip').textContent = s && s.cwd ? home(s.cwd) : '';
  $('#resume-btn').hidden = !s;
  const hostSt = state.hostStatus && state.hostStatus !== 'exited' ? state.hostStatus : null;
  $('#release-btn').hidden = !hostSt;
  const pill = $('#status-pill');
  const temp = !!(s && s.hosted && s.hosted.temporary) || state.tempEnded;
  if (temp) {
    pill.hidden = false;
    pill.className = 'pill temp-pill';
    pill.innerHTML = state.tempEnded ? 'Temporary · ended' : `<span class="dot ${hostSt === 'idle' ? 'idle' : 'busy'}"></span>Temporary · not saved`;
  } else if (hostSt) {
    pill.hidden = false;
    pill.className = 'pill';
    pill.innerHTML = `<span class="dot ${hostSt === 'idle' ? 'idle' : 'busy'}"></span>Running here · ${hostSt === 'idle' ? 'ready' : 'working'}`;
  } else if (s && s.terminal) {
    pill.hidden = false;
    pill.className = 'pill';
    pill.innerHTML = `<span class="dot ${s.terminal.status === 'busy' ? 'busy' : 'idle'}"></span>Terminal · ${s.terminal.status === 'busy' ? 'working' : 'idle'}`;
  } else pill.hidden = true;

  $('#resume-btn').hidden = !s || temp;
  const banner = $('#banner');
  if (state.tempEnded) {
    banner.hidden = false;
    banner.innerHTML = '<span>This temporary chat has ended and was not saved. <a href="#/new">Start a new chat</a></span>';
  } else if (s && s.terminal && !hostSt) {
    banner.hidden = false;
    banner.innerHTML = `<span class="dot ${s.terminal.status === 'busy' ? 'busy' : 'idle'}"></span><span>Open in a terminal (pid ${s.terminal.pid}) — you're watching it live. Sending a message lets you take it over or fork it.</span>`;
  } else banner.hidden = true;
  $('#input').placeholder = 'Reply to Claude…';
  renderWorking();
  updateSend();
}

function isBusy() {
  if (state.hostStatus === 'busy' || state.hostStatus === 'starting') return true;
  const s = currentSession();
  return !!(s && !state.hostStatus && s.terminal && s.terminal.status === 'busy');
}

function updateSend() {
  const btn = $('#send');
  const uploading = state.attachments.some(a => a.uploading);
  const hasText = $('#input').value.trim().length > 0 || state.attachments.some(a => a.path);
  const canStop = state.current && (state.hostStatus === 'busy' || state.hostStatus === 'starting');
  btn.classList.toggle('stop', !hasText && !!canStop);
  btn.disabled = (!hasText && !canStop) || (hasText && uploading);
  btn.title = uploading ? 'Waiting for uploads to finish' : '';
  btn.setAttribute('aria-label', btn.classList.contains('stop') ? 'Stop' : 'Send');
}

// ------------------------------------------------------------------ thread rendering

const R = { turn: null, group: null, cards: new Map(), lastCmd: null };

function resetRender() {
  $('#thread').innerHTML = '';
  R.turn = null; R.group = null; R.cards = new Map(); R.lastCmd = null;
}

function closeTurn() { R.turn = null; R.group = null; }

function ensureTurn() {
  if (!R.turn) {
    R.turn = document.createElement('div');
    R.turn.className = 'turn';
    insertBeforeTail(R.turn);
  }
  return R.turn;
}

// Keep the live "working" indicator and streaming draft at the bottom of the thread.
function insertBeforeTail(el) {
  const thread = $('#thread');
  const tail = thread.querySelector(':scope > .tail');
  thread.insertBefore(el, tail);
}

function toolInfo(name, input = {}) {
  const fp = input.file_path || input.notebook_path || input.path || '';
  switch (name) {
    case 'Bash': return { ico: 'terminal', cat: 'cmd', sub: input.description || input.command };
    case 'Read': return { ico: 'file', cat: 'read', sub: home(fp) };
    case 'Write': return { ico: 'edit', cat: 'write', sub: home(fp) };
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return { ico: 'edit', cat: 'edit', sub: home(fp) };
    case 'Grep': return { ico: 'search', cat: 'search', sub: input.pattern + (input.path ? `  in ${home(input.path)}` : '') };
    case 'Glob': return { ico: 'search', cat: 'search', sub: input.pattern };
    case 'WebFetch': return { ico: 'globe', cat: 'web', sub: input.url };
    case 'WebSearch': return { ico: 'globe', cat: 'web', sub: input.query };
    case 'Agent': case 'Task': return { ico: 'agent', cat: 'agent', sub: input.description || input.prompt };
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': return { ico: 'list', cat: 'todo', sub: input.subject || input.description || 'Updated tasks' };
    case 'Skill': return { ico: 'sparkle', cat: 'tool', sub: input.skill };
    case 'ToolSearch': return { ico: 'search', cat: 'tool', sub: input.query };
    default: {
      const first = Object.values(input).find(v => typeof v === 'string');
      return { ico: name.startsWith('mcp__') ? 'tool' : 'tool', cat: 'tool', sub: first || '' };
    }
  }
}

function groupLabel(counts) {
  const parts = [];
  const n = (k, one, many) => { if (counts[k]) parts.push(counts[k] === 1 ? one : many.replace('#', counts[k])); };
  n('think', 'thought', 'thought');
  n('cmd', 'ran a command', 'ran # commands');
  n('read', 'read a file', 'read # files');
  n('edit', 'edited a file', 'made # edits');
  n('write', 'wrote a file', 'wrote # files');
  n('search', 'searched', 'searched # times');
  n('web', 'browsed the web', 'browsed the web');
  n('agent', 'ran an agent', 'ran # agents');
  n('todo', 'updated tasks', 'updated tasks');
  n('tool', 'used a tool', 'used # tools');
  const s = parts.join(', ');
  return s ? s[0].toUpperCase() + s.slice(1) : 'Working';
}

function ensureGroup() {
  if (R.group) return R.group;
  const g = document.createElement('div');
  g.className = 'steps';
  g.innerHTML = `<button type="button" class="steps-head">${CHEV}<span class="lbl"></span><span class="cnt"></span></button><div class="steps-body"></div>`;
  g.counts = {};
  g.total = 0;
  $('.steps-head', g).onclick = () => g.classList.toggle('open');
  ensureTurn().appendChild(g);
  R.group = g;
  return g;
}

function bumpGroup(g, cat) {
  g.counts[cat] = (g.counts[cat] || 0) + 1;
  g.total++;
  $('.lbl', g).textContent = groupLabel(g.counts);
  $('.cnt', g).textContent = g.total > 1 ? `${g.total} steps` : '';
}

function addStep(g, { ico, name, sub, body, status }) {
  const st = document.createElement('div');
  st.className = 'step';
  st.innerHTML = `<button type="button" class="step-head"><span class="step-ico">${ICONS[ico] || ICONS.tool}</span><span class="step-name">${esc(name)}</span><span class="step-sub">${esc(String(sub || '').split('\n')[0])}</span><span class="step-stat ${status || ''}"></span>${CHEV}</button><div class="step-body"></div>`;
  $('.step-head', st).onclick = () => st.classList.toggle('open');
  if (body) $('.step-body', st).append(...body);
  $('.steps-body', g).appendChild(st);
  return st;
}

function pre(text, cls) {
  const p = document.createElement('pre');
  if (cls) p.className = cls;
  p.textContent = text;
  return p;
}

function miniLabel(t) { const d = document.createElement('div'); d.className = 'lbl-mini'; d.textContent = t; return d; }

function diffView(oldS, newS) {
  const d = document.createElement('div');
  d.className = 'diff';
  const lines = [];
  for (const l of String(oldS ?? '').split('\n')) lines.push(`<div class="del">- ${esc(l)}</div>`);
  for (const l of String(newS ?? '').split('\n')) lines.push(`<div class="add">+ ${esc(l)}</div>`);
  d.innerHTML = lines.join('');
  return d;
}

function toolBody(name, input = {}) {
  if (name === 'Bash') return [pre('$ ' + (input.command || ''))];
  if (name === 'Edit') return [diffView(input.old_string, input.new_string)];
  if (name === 'MultiEdit' && Array.isArray(input.edits)) return input.edits.map(e => diffView(e.old_string, e.new_string));
  if (name === 'Write') return [pre(input.content || '')];
  if (name === 'Read') return [];
  return [pre(JSON.stringify(input, null, 2))];
}

function renderItem(it) {
  const thread = $('#thread');
  switch (it.kind) {
    case 'user': {
      closeTurn();
      const el = userBubble(it.text);
      const txt = $('.user-text', el);
      if (it.images) txt.insertAdjacentHTML('afterend', `<span class="img-note">${it.images} image${it.images > 1 ? 's' : ''}</span>`);
      if (txt.textContent.split('\n').length > 9 || txt.textContent.length > 700) {
        txt.classList.add('clamped');
        const b = document.createElement('button');
        b.className = 'more-btn'; b.type = 'button'; b.textContent = 'Show more';
        b.onclick = () => { const c = txt.classList.toggle('clamped'); b.textContent = c ? 'Show more' : 'Show less'; };
        txt.after(b);
      }
      insertBeforeTail(el);
      break;
    }
    case 'text':
      R.group = null;
      ensureTurn().appendChild(md(it.text));
      break;
    case 'thinking': {
      const g = ensureGroup();
      const body = document.createElement('div');
      body.className = 'think';
      body.textContent = it.text;
      addStep(g, { ico: 'think', name: 'Thinking', sub: it.text.slice(0, 140), body: [body] });
      bumpGroup(g, 'think');
      break;
    }
    case 'tool': {
      const g = ensureGroup();
      const info = toolInfo(it.name, it.input);
      const label = it.name.startsWith('mcp__') ? it.name.split('__').slice(2).join(' ') || it.name : it.name;
      const st = addStep(g, { ico: info.ico, name: label, sub: info.sub, body: toolBody(it.name, it.input), status: 'run' });
      R.cards.set(it.id, st);
      bumpGroup(g, info.cat);
      break;
    }
    case 'tool_result': {
      const st = R.cards.get(it.id);
      if (!st) break;
      const stat = $('.step-stat', st);
      stat.className = 'step-stat' + (it.isError ? ' err' : '');
      if (it.text && it.text.trim()) {
        const body = $('.step-body', st);
        body.append(miniLabel(it.isError ? 'Error' : 'Output'), pre(it.text, it.isError ? 'err' : ''));
      }
      break;
    }
    case 'command': {
      closeTurn();
      const el = document.createElement('div');
      el.className = 'msg';
      el.innerHTML = `<span class="command">${esc(it.name.startsWith('/') || it.name === '!' ? it.name : '/' + it.name)} ${esc(it.args || '')}</span>`;
      insertBeforeTail(el);
      R.lastCmd = el;
      break;
    }
    case 'cmdout': {
      const el = document.createElement('div');
      el.className = 'cmdout';
      el.textContent = it.text;
      if (R.lastCmd) R.lastCmd.appendChild(el); else insertBeforeTail(el);
      break;
    }
    case 'recap': {
      const el = document.createElement('div');
      el.className = 'recap';
      el.innerHTML = `<span class="spark sm">${SPARK}</span><div><b>Recap · </b>${esc(it.text)}</div>`;
      ensureTurn().appendChild(el);
      R.group = null;
      break;
    }
    case 'divider': {
      closeTurn();
      const el = document.createElement('div');
      el.className = 'divider';
      el.textContent = it.text;
      insertBeforeTail(el);
      break;
    }
    case 'summary': {
      closeTurn();
      const el = document.createElement('details');
      el.className = 'summary';
      el.innerHTML = '<summary>Summary of the earlier conversation</summary>';
      el.appendChild(md(it.text));
      insertBeforeTail(el);
      break;
    }
    case 'note': {
      const el = document.createElement('div');
      el.className = 'note' + (it.level === 'error' ? ' error' : '');
      el.textContent = it.text;
      ensureTurn().appendChild(el);
      break;
    }
  }
  void thread;
}

function renderAll() {
  resetRender();
  const thread = $('#thread');
  const tail = document.createElement('div');
  tail.className = 'tail';
  thread.appendChild(tail);
  if (state.start > 0) {
    const b = document.createElement('button');
    b.className = 'ghost-btn load-earlier';
    b.type = 'button';
    b.textContent = `Load earlier messages (${state.start})`;
    b.onclick = loadEarlier;
    thread.prepend(b);
  }
  for (const it of state.items) renderItem(it);
  if (!state.items.length) {
    const e = document.createElement('div');
    e.className = 'empty-thread';
    e.textContent = 'No messages yet.';
    insertBeforeTail(e);
  }
  // keep the most recent work group open
  const groups = thread.querySelectorAll('.steps');
  if (groups.length && isBusy()) groups[groups.length - 1].classList.add('open');
  renderWorking();
}

function renderWorking() {
  const tail = $('#thread > .tail');
  if (!tail) return;
  let draft = $('.draft', tail);
  if (state.draft) {
    if (!draft) {
      draft = document.createElement('div');
      draft.className = 'turn draft';
      tail.prepend(draft);
    }
    const m = md(state.draft);
    const last = m.lastElementChild || m;
    last.classList.add('cursor');
    draft.replaceChildren(m);
  } else if (draft) draft.remove();

  let w = $('.working', tail);
  if (isBusy()) {
    if (!w) {
      w = document.createElement('div');
      w.className = 'working';
      w.innerHTML = `<span class="spark mid spin">${SPARK}</span><span class="wl"></span>`;
      tail.appendChild(w);
    }
    $('.wl', w).textContent = state.activity || (state.hostStatus ? 'Working…' : 'Working in terminal…');
  } else if (w) w.remove();
}

const scroller = $('#scroller');
const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140;
const toBottom = () => { scroller.scrollTop = scroller.scrollHeight; };

function appendItems(from, items) {
  const end = state.start + state.items.length;
  if (from > end) { loadSession(state.current, true); return; }
  const fresh = items.slice(end - from);
  if (!fresh.length) return;
  const stick = nearBottom();
  if (!state.items.length) $('#thread .empty-thread')?.remove();
  state.items.push(...fresh);
  for (const it of fresh) {
    renderItem(it);
    if (it.kind === 'user') document.querySelectorAll('.msg.user.optimistic').forEach(e => e.remove());
    if (it.kind === 'text') state.draft = '';
  }
  if (isBusy() && R.group) R.group.classList.add('open');
  renderWorking();
  if (stick) toBottom();
}

async function loadEarlier() {
  const prevH = scroller.scrollHeight;
  const data = await api(`/sessions/${state.current}/items?before=${state.start}`);
  state.items = data.items.concat(state.items);
  state.start = data.start;
  renderAll();
  scroller.scrollTop = scroller.scrollHeight - prevH;
}

// ------------------------------------------------------------------ live events

function connect(sessionId) {
  if (state.es) state.es.close();
  const es = new EventSource(`/api/events?token=${TOKEN}${sessionId ? `&session=${sessionId}` : ''}`);
  state.es = es;
  es.addEventListener('sessions', e => {
    state.sessions = JSON.parse(e.data);
    renderSidebar();
    if (state.current) {
      const s = currentSession();
      if (s && s.hosted && state.hostStatus !== s.hosted.status) state.hostStatus = s.hosted.status;
      if (s && !s.hosted && state.hostStatus && state.hostStatus !== 'exited') state.hostStatus = null;
      renderChrome();
    }
  });
  es.addEventListener('items', e => {
    if (es !== state.es) return;
    const d = JSON.parse(e.data);
    appendItems(d.from, d.items);
  });
  es.addEventListener('host', e => { if (es === state.es) onHost(JSON.parse(e.data)); });
}

// System notification when a reply finishes while the window isn't in front.
function notifyDone(evt) {
  if (!('Notification' in window) || document.hasFocus()) return;
  const s = currentSession();
  const show = () => {
    const n = new Notification(s ? s.title : 'Claude Hub', { body: evt.isError ? 'Claude hit an error' : 'Claude finished replying', icon: '/favicon.svg', silent: false });
    n.onclick = () => { window.focus(); n.close(); };
  };
  if (Notification.permission === 'granted') show();
  else if (Notification.permission !== 'denied') Notification.requestPermission().then(p => { if (p === 'granted') show(); });
}

let draftTimer = null;
function onHost(evt) {
  switch (evt.t) {
    case 'status':
      state.hostStatus = evt.state;
      if (evt.state !== 'busy' && evt.state !== 'starting') state.activity = '';
      if (evt.state === 'exited') { state.perms.clear(); renderPerms(); }
      renderChrome();
      break;
    case 'activity':
      state.activity = { thinking: 'Thinking…', writing: 'Writing…', requesting: 'Working…' }[evt.what] || (evt.what === 'tool' ? `Using ${evt.name}…` : 'Working…');
      if (evt.what === 'tool' || evt.what === 'thinking') state.draft = '';
      renderWorking();
      break;
    case 'delta': {
      const stick = nearBottom();
      state.draft += evt.text;
      if (!draftTimer) draftTimer = requestAnimationFrame(() => { draftTimer = null; renderWorking(); if (stick) toBottom(); });
      break;
    }
    case 'perm':
      state.perms.set(evt.requestId, evt);
      renderPerms();
      break;
    case 'perm_done':
      state.perms.delete(evt.requestId);
      renderPerms();
      break;
    case 'result':
      if (evt.isError && evt.text) toast(evt.text, true);
      notifyDone(evt);
      // drop a leftover draft if the transcript never delivered it
      setTimeout(() => { if (state.draft && state.hostStatus !== 'busy') { state.draft = ''; renderWorking(); } }, 6000);
      break;
    case 'error':
      toast(evt.message, true);
      break;
    case 'moved':
      location.hash = `#/s/${evt.to}`;
      break;
  }
}

// ------------------------------------------------------------------ permission prompts

function permPreview(p) {
  const i = p.input || {};
  if (p.tool === 'Bash') return pre('$ ' + (i.command || ''));
  if (p.tool === 'Edit') return diffView(i.old_string, i.new_string);
  if (p.tool === 'Write') { const e = pre(i.content || ''); e.title = i.file_path; return e; }
  if (i.file_path) return pre(home(i.file_path));
  if (i.url) return pre(i.url);
  return pre(JSON.stringify(i, null, 2));
}

function renderPerms() {
  const area = $('#perm-area');
  area.innerHTML = '';
  for (const p of state.perms.values()) {
    const card = document.createElement('div');
    card.className = 'perm-card';
    const respond = async (behavior, updatedInput) => {
      card.style.opacity = '.5';
      try { await api(`/sessions/${state.current}/permission`, { body: { requestId: p.requestId, behavior, updatedInput } }); }
      catch (e) { toast(e.message, true); card.style.opacity = ''; }
    };

    if (p.tool === 'AskUserQuestion' && Array.isArray(p.input && p.input.questions)) {
      card.innerHTML = `<div class="perm-title"><span class="ico">${ICONS.sparkle}</span>Claude has a question</div>`;
      const answers = {};
      p.input.questions.forEach(q => {
        const blk = document.createElement('div');
        blk.className = 'q-block';
        blk.innerHTML = `<div class="q-head">${esc(q.question)}</div><div class="q-opts"></div>`;
        const chosen = new Set();
        const sync = () => { answers[q.question] = [...chosen].join(', '); };
        (q.options || []).forEach(o => {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'q-opt';
          b.innerHTML = `<span>${esc(o.label)}</span>${o.description ? `<small>${esc(o.description)}</small>` : ''}`;
          b.onclick = () => {
            if (q.multiSelect) { chosen.has(o.label) ? chosen.delete(o.label) : chosen.add(o.label); b.classList.toggle('sel'); }
            else { chosen.clear(); chosen.add(o.label); blk.querySelectorAll('.q-opt').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); other.value = ''; }
            sync();
          };
          $('.q-opts', blk).appendChild(b);
        });
        const other = document.createElement('input');
        other.className = 'q-other'; other.placeholder = 'Other…';
        other.oninput = () => { if (other.value.trim()) { chosen.clear(); blk.querySelectorAll('.q-opt').forEach(x => x.classList.remove('sel')); answers[q.question] = other.value.trim(); } };
        blk.appendChild(other);
        card.appendChild(blk);
      });
      const act = document.createElement('div');
      act.className = 'perm-actions';
      act.innerHTML = '<button class="btn" data-a="deny">Skip</button><button class="btn primary" data-a="ok">Submit</button>';
      act.querySelector('[data-a=deny]').onclick = () => respond('deny');
      act.querySelector('[data-a=ok]').onclick = () => respond('allow', { ...p.input, answers });
      card.appendChild(act);
    } else if (p.tool === 'ExitPlanMode') {
      card.innerHTML = `<div class="perm-title"><span class="ico">${ICONS.list}</span>Ready to start on this plan?</div>`;
      const plan = md((p.input && p.input.plan) || '');
      plan.classList.add('plan-md');
      card.appendChild(plan);
      const act = document.createElement('div');
      act.className = 'perm-actions';
      act.innerHTML = '<button class="btn" data-a="deny">Keep planning</button><button class="btn primary" data-a="ok">Approve plan</button>';
      act.querySelector('[data-a=deny]').onclick = () => respond('deny');
      act.querySelector('[data-a=ok]').onclick = () => respond('allow');
      card.appendChild(act);
    } else {
      card.innerHTML = `<div class="perm-title"><span class="ico">${ICONS.shield}</span>Allow Claude to use ${esc(p.display || p.tool)}?</div>${p.description ? `<div class="perm-desc">${esc(p.description)}</div>` : ''}`;
      card.appendChild(permPreview(p));
      if (p.blockedPath) card.insertAdjacentHTML('beforeend', `<div class="perm-desc">Outside the working folder: ${esc(home(p.blockedPath))}</div>`);
      const act = document.createElement('div');
      act.className = 'perm-actions';
      act.innerHTML = `<button class="btn" data-a="deny">Deny</button>${p.suggestions && p.suggestions.length ? '<button class="btn" data-a="always">Always allow</button>' : ''}<button class="btn accent" data-a="allow">Allow once</button>`;
      act.querySelectorAll('button').forEach(b => { b.onclick = () => respond(b.dataset.a); });
      card.appendChild(act);
    }
    area.appendChild(card);
  }
}

// ------------------------------------------------------------------ navigation

async function loadSession(id, keepScroll) {
  const data = await api(`/sessions/${id}/items`);
  if (state.current !== id) return;
  state.tempEnded = !!data.gone && !currentSession();
  if (state.tempEnded) renderChrome();
  state.items = data.items;
  state.start = data.start;
  renderAll();
  if (!keepScroll) requestAnimationFrame(toBottom);
}

async function openSession(id) {
  const changed = state.current !== id;
  state.current = id;
  if (changed) {
    state.tempEnded = false;
    state.items = []; state.start = 0; state.draft = ''; state.activity = '';
    state.perms.clear(); renderPerms();
    const s = currentSession();
    state.hostStatus = s && s.hosted ? s.hosted.status : null;
    resetRender();
    const ps = (s && (s.hosted?.permissionMode || s.permissionMode)) || pref.get('perm', 'manual');
    setSelect('#perm-mode', ps);
    setSelect('#model', (s && s.hosted && s.hosted.model) || '');
    connect(id);
  }
  renderChrome();
  renderSidebar();
  try { await loadSession(id); } catch (e) { toast(e.message, true); }
  closeSidebarOnMobile();
  $('#input').focus();
}

function setSelect(sel, v) {
  const el = $(sel);
  if ([...el.options].some(o => o.value === v)) el.value = v;
}

function showNew() {
  state.current = null;
  state.items = []; state.draft = ''; state.hostStatus = null; state.perms.clear();
  renderPerms();
  resetRender();
  connect(null);
  state.temporary = false;
  state.tempEnded = false;
  setSelect('#perm-mode', pref.get('perm', 'manual'));
  setSelect('#model', pref.get('model', ''));
  renderChrome();
  renderSidebar();
  closeSidebarOnMobile();
  $('#input').focus();
}

function route() {
  const m = location.hash.match(/^#\/s\/([\w-]+)/);
  if (m) openSession(m[1]); else showNew();
}
window.addEventListener('hashchange', route);

// ------------------------------------------------------------------ composer

const input = $('#input');
function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, window.innerHeight * 0.4) + 'px'; }
input.addEventListener('input', () => { autosize(); updateSend(); });
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); }
});

function chooseMode() {
  const dlg = $('#choice');
  return new Promise(resolve => {
    dlg.querySelectorAll('button[data-mode]').forEach(b => { b.onclick = () => { dlg.close(); resolve(b.dataset.mode || null); }; });
    dlg.onclose = () => resolve(null);
    dlg.showModal();
  });
}

const ATTACH_RE = /^\[Attached file: (.+)\]$/gm;
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;
const fileUrl = p => `/api/upload-file?token=${TOKEN}&path=${encodeURIComponent(p)}`;
const fmtSize = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const FILE_ICON = '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M4 1.8h5l3 3v9.4H4z M9 1.8v3h3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';

// A user message bubble; "[Attached file: …]" lines become file chips / image thumbnails.
function userBubble(text) {
  const files = [...String(text).matchAll(ATTACH_RE)].map(m => m[1]);
  const body = String(text).replace(ATTACH_RE, '').trim();
  const el = document.createElement('div');
  el.className = 'msg user';
  el.innerHTML = '<div class="user-bubble"><span class="avatar">D</span><div class="user-col"><div class="user-files"></div><div class="user-text"></div></div></div>';
  $('.user-text', el).textContent = body;
  if (!body) $('.user-text', el).hidden = true;
  const box = $('.user-files', el);
  for (const p of files) {
    const name = p.split('/').pop();
    if (IMG_EXT.test(p) && p.includes('/claude-hub/uploads/')) {
      box.insertAdjacentHTML('beforeend', `<a class="file-thumb" href="${fileUrl(p)}" target="_blank" rel="noopener" title="${esc(name)}"><img src="${fileUrl(p)}" alt="${esc(name)}" loading="lazy"></a>`);
    } else {
      box.insertAdjacentHTML('beforeend', `<span class="file-chip" title="${esc(p)}">${FILE_ICON}<span>${esc(name)}</span></span>`);
    }
  }
  if (!files.length) box.remove();
  return el;
}

function optimisticUser(text) {
  const el = userBubble(text);
  el.classList.add('optimistic');
  $('#thread .empty-thread')?.remove();
  closeTurn();
  insertBeforeTail(el);
  toBottom();
}

$('#composer').addEventListener('submit', async e => {
  e.preventDefault();
  if (state.attachments.some(a => a.uploading)) { toast('Wait for the files to finish uploading'); return; }
  const files = state.attachments.filter(a => a.path);
  let text = input.value.trim();
  if (files.length) text = (text || 'Please look at the attached file' + (files.length > 1 ? 's.' : '.')) + '\n\n' + files.map(a => `[Attached file: ${a.path}]`).join('\n');
  const permissionMode = $('#perm-mode').value;
  const model = $('#model').value;
  if (!text) {
    if (state.current && (state.hostStatus === 'busy' || state.hostStatus === 'starting')) {
      try { await api(`/sessions/${state.current}/interrupt`, { body: {} }); state.activity = 'Stopping…'; renderWorking(); } catch (err) { toast(err.message, true); }
    }
    return;
  }
  if (!state.current) {
    const cwd = $('#cwd-input').value.trim() || $('#cwd-input').placeholder;
    try {
      const r = await api('/new', { body: { cwd, text, permissionMode, model, temporary: state.temporary } });
      pref.set('cwd', cwd);
      input.value = ''; clearAttachments(); autosize(); updateSend();
      location.hash = `#/s/${r.id}`;
      setTimeout(() => optimisticUser(text), 50);
    } catch (err) { toast(err.message, true); }
    return;
  }
  const id = state.current;
  const send = async mode => api(`/sessions/${id}/send`, { body: { text, mode, permissionMode, model } });
  const keptFiles = state.attachments.slice();
  input.value = ''; clearAttachments(); autosize();
  optimisticUser(text);
  state.hostStatus = state.hostStatus === 'idle' ? 'busy' : state.hostStatus || 'starting';
  renderChrome();
  try {
    let r;
    try { r = await send(); }
    catch (err) {
      if (!(err.data && err.data.needsChoice)) throw err;
      const mode = await chooseMode();
      if (!mode) {
        document.querySelectorAll('.msg.user.optimistic').forEach(x => x.remove());
        input.value = text.replace(ATTACH_RE, '').trim(); state.attachments = keptFiles; renderAttachments(); autosize();
        state.hostStatus = null; renderChrome();
        return;
      }
      if (mode === 'takeover') toast('Closing the terminal session…');
      r = await send(mode);
    }
    if (r.id && r.id !== id) location.hash = `#/s/${r.id}`;
  } catch (err) {
    toast(err.message, true);
    document.querySelectorAll('.msg.user.optimistic').forEach(x => x.remove());
    input.value = text.replace(ATTACH_RE, '').trim(); state.attachments = keptFiles; renderAttachments(); autosize();
    state.hostStatus = null; renderChrome();
  }
  updateSend();
});

$('#perm-mode').addEventListener('change', async e => {
  pref.set('perm', e.target.value);
  if (state.current && state.hostStatus && state.hostStatus !== 'exited') {
    try { await api(`/sessions/${state.current}/settings`, { body: { permissionMode: e.target.value } }); toast('Permission mode updated'); } catch (err) { toast(err.message, true); }
  }
});
$('#model').addEventListener('change', async e => {
  pref.set('model', e.target.value);
  if (state.current && state.hostStatus && state.hostStatus !== 'exited') {
    try { await api(`/sessions/${state.current}/settings`, { body: { model: e.target.value } }); toast('Model updated'); } catch (err) { toast(err.message, true); }
  }
});

// ------------------------------------------------------------------ header actions, sidebar, theme

$('#cwd-chip').onclick = () => { const s = currentSession(); if (s && s.cwd) copy(s.cwd, 'Path copied'); };
$('#resume-btn').onclick = () => {
  const s = currentSession();
  if (s) copy(`cd ${JSON.stringify(s.cwd || '.')} && claude --resume ${s.id}`, 'Resume command copied');
};
$('#release-btn').onclick = async () => {
  try { await api(`/sessions/${state.current}/release`, { body: {} }); toast('Disconnected — the conversation is saved'); } catch (e) { toast(e.message, true); }
};

const app = $('#app');
if (pref.get('sb', 'open') === 'closed' || window.innerWidth <= 820) app.classList.add('sb-hidden');
$('#sb-close').onclick = () => { app.classList.add('sb-hidden'); pref.set('sb', 'closed'); };
$('#sb-open').onclick = () => { app.classList.remove('sb-hidden'); pref.set('sb', 'open'); };
$('#scrim').onclick = () => app.classList.add('sb-hidden');
function closeSidebarOnMobile() { if (window.innerWidth <= 820) app.classList.add('sb-hidden'); }

$('#theme-btn').onclick = () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  pref.set('theme', root.dataset.theme);
};

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); app.classList.remove('sb-hidden'); $('#search').focus(); }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); location.hash = '#/new'; }
});

setInterval(() => { if (!$('#search').matches(':focus')) renderSidebar(); }, 60000);

// ------------------------------------------------------------------ rename / delete chats

const ICON_PEN = '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M10.5 2.5l3 3L6 13H3v-3z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 20 20" width="15" height="15"><path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 10h6.6L14 6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function chatMenu(anchor, id) {
  anchor.classList.add('open');
  Dropdown.open({
    anchor, align: 'end',
    items: [
      { value: 'rename', label: 'Rename', icon: ICON_PEN },
      { value: 'delete', label: 'Delete', icon: ICON_TRASH, danger: true },
    ],
    onPick: v => (v === 'rename' ? renameInSidebar(id) : deleteChat(id)),
    onClose: () => anchor.classList.remove('open'),
  });
}

// Inline text box in place of `el`; resolves with the new text, or null if cancelled.
function inlineEdit(el, value, cls) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.className = 'inline-edit ' + (cls || '');
    input.value = value;
    input.setAttribute('aria-label', 'Chat name');
    el.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = v => { if (done) return; done = true; input.replaceWith(el); resolve(v); };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); finish(input.value.trim()); }
      if (e.key === 'Escape') { e.preventDefault(); finish(null); }
    });
    input.addEventListener('blur', () => finish(input.value.trim()));
  });
}

async function renameChat(id, title) {
  const s = state.sessions.find(x => x.id === id);
  if (!title || !s || title === s.title) return;
  s.title = title; // show it right away; the server broadcast confirms
  try { await api(`/sessions/${id}/rename`, { body: { title } }); }
  catch (e) { toast(e.message, true); }
}

async function renameInSidebar(id) {
  const li = document.querySelector(`#nav .sess-li[data-id="${id}"]`);
  const s = state.sessions.find(x => x.id === id);
  if (!li || !s) return;
  state.renaming = id;
  const v = await inlineEdit(li.querySelector('.sess'), s.title, 'in-sidebar');
  state.renaming = null;
  await renameChat(id, v);
  state.sidebarStale = false;
  renderSidebar();
  if (id === state.current) renderChrome();
}

$('#title').addEventListener('click', async () => {
  const s = currentSession();
  if (!s || state.renaming) return;
  state.renaming = s.id;
  const v = await inlineEdit($('#title'), s.title, 'in-title');
  state.renaming = null;
  await renameChat(s.id, v);
  renderSidebar();
  renderChrome();
});

function confirmBox({ title, body, ok, danger }) {
  const dlg = $('#confirm');
  $('h3', dlg).textContent = title;
  $('p', dlg).textContent = body;
  const yes = $('[data-ok]', dlg);
  yes.textContent = ok;
  yes.className = 'btn ' + (danger ? 'danger' : 'accent');
  return new Promise(resolve => {
    yes.onclick = () => { dlg.close(); resolve(true); };
    $('[data-cancel]', dlg).onclick = () => dlg.close();
    dlg.onclose = () => resolve(false);
    dlg.showModal();
    yes.focus();
  });
}

async function deleteChat(id) {
  const s = state.sessions.find(x => x.id === id);
  if (!s) return;
  if (s.terminal) { toast('This chat is open in a terminal. Close it there first.', true); return; }
  const ok = await confirmBox({
    title: 'Delete chat?',
    body: s.hosted && s.hosted.temporary
      ? `"${s.title}" is a temporary chat. It will end and can't be recovered.`
      : `"${s.title}" will be moved to your Trash.${s.hosted ? ' It is running here and will be stopped.' : ''}`,
    ok: 'Delete', danger: true,
  });
  if (!ok) return;
  try {
    const r = await api(`/sessions/${id}/delete`, { body: {} });
    state.sessions = state.sessions.filter(x => x.id !== id);
    renderSidebar();
    if (state.current === id) location.hash = '#/new';
    toast(r.trashed ? 'Moved to Trash' : s.hosted && s.hosted.temporary ? 'Temporary chat ended' : 'Chat deleted');
  } catch (e) { toast(e.message, true); }
}

$('#nav').addEventListener('click', e => {
  const more = e.target.closest('.sess-more');
  if (!more) return;
  e.preventDefault();
  chatMenu(more, more.closest('.sess-li').dataset.id);
});

// right-click a chat for the same menu
$('#nav').addEventListener('contextmenu', e => {
  const li = e.target.closest('.sess-li');
  if (!li) return;
  e.preventDefault();
  chatMenu(li.querySelector('.sess-more'), li.dataset.id);
});

// ------------------------------------------------------------------ temporary chat toggle

$('#temp-btn').onclick = () => {
  state.temporary = !state.temporary;
  renderChrome();
  $('#input').focus();
};

// ------------------------------------------------------------------ file attachments

function renderAttachments() {
  const tray = $('#attach-tray');
  tray.hidden = !state.attachments.length;
  tray.innerHTML = '';
  for (const a of state.attachments) {
    const el = document.createElement('div');
    el.className = 'att' + (a.uploading ? ' uploading' : '') + (a.error ? ' failed' : '');
    el.title = a.error || a.path || a.name;
    el.innerHTML = (a.preview ? `<img src="${a.preview}" alt="">` : `<span class="att-ico">${FILE_ICON}</span>`) +
      `<span class="att-meta"><span class="att-name">${esc(a.name)}</span><span class="att-sub">${a.error ? esc(a.error) : a.uploading ? 'Uploading…' : fmtSize(a.size)}</span></span>` +
      '<button type="button" class="att-x" aria-label="Remove">✕</button>';
    $('.att-x', el).onclick = () => {
      state.attachments = state.attachments.filter(x => x !== a);
      if (a.preview) URL.revokeObjectURL(a.preview);
      renderAttachments();
    };
    tray.appendChild(el);
  }
  updateSend();
}

function clearAttachments() {
  for (const a of state.attachments) if (a.preview) URL.revokeObjectURL(a.preview);
  state.attachments = [];
  renderAttachments();
}

async function addFiles(fileList) {
  for (const f of [...fileList]) {
    if (f.size > 100 * 1024 * 1024) { toast(`${f.name} is larger than 100 MB`, true); continue; }
    const a = { name: f.name || 'pasted-file', size: f.size, uploading: true, preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : null };
    state.attachments.push(a);
    renderAttachments();
    try {
      const r = await fetch(`/api/upload?name=${encodeURIComponent(a.name)}`, { method: 'POST', headers: { 'x-hub-token': TOKEN, 'content-type': 'application/octet-stream' }, body: f });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Upload failed (${r.status})`);
      a.path = d.path;
    } catch (e) {
      a.error = e.message;
    }
    a.uploading = false;
    renderAttachments();
  }
}

$('#attach-btn').onclick = () => $('#file-input').click();
$('#file-input').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
input.addEventListener('paste', e => {
  const files = e.clipboardData && e.clipboardData.files;
  if (files && files.length) { e.preventDefault(); addFiles(files); }
});

// drag & drop anywhere over the chat area
let dragDepth = 0;
const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
$('#main').addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('#drop-overlay').hidden = false; });
$('#main').addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
$('#main').addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#drop-overlay').hidden = true; });
$('#main').addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('#drop-overlay').hidden = true;
  addFiles(e.dataTransfer.files);
  input.focus();
});

// ------------------------------------------------------------------ boot

(async () => {
  try {
    const [list, dirs] = await Promise.all([api('/sessions'), api('/dirs')]);
    state.sessions = list;
    state.home = dirs.home;
    state.dirs = dirs.dirs;
    $('#cwd-input').placeholder = dirs.dirs[0] || dirs.home;
    $('#cwd-input').value = pref.get('cwd', '');
  } catch (e) { toast('Could not reach the Claude Hub server', true); }
  route();
})();
