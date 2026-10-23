#!/usr/bin/env node
// Claude Hub — browse and drive every local Claude Code session from one window.
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');


const PORT = Number(process.env.PORT) || 4777;
const HOST = '127.0.0.1';
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const REGISTRY_DIR = path.join(CLAUDE_DIR, 'sessions');
const PUBLIC_DIR = path.join(__dirname, 'public');

const CLAUDE_BIN = process.env.CLAUDE_BIN || findClaude();
const HOST_IDLE_MS = 30 * 60 * 1000;
const CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'claude-hub');
const CONNECTIONS_FILE = path.join(CONFIG_DIR, 'connections.json');
const TITLES_FILE = path.join(CONFIG_DIR, 'titles.json');
const UPLOAD_DIR = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'claude-hub', 'uploads');
const UPLOAD_MAX = 100 * 1024 * 1024;

// Chat names set from the hub. Also written into the transcript, but kept here so a rename
// survives even when that line scrolls out of the part of a big transcript we read.
let titles = {};
try { titles = JSON.parse(fs.readFileSync(TITLES_FILE, 'utf8')); } catch { titles = {}; }
function saveTitles() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(TITLES_FILE, JSON.stringify(titles, null, 2), { mode: 0o600 });
}

// Pinned chats, newest pin first.
const PINS_FILE = path.join(CONFIG_DIR, 'pins.json');
let pins = [];
try { pins = JSON.parse(fs.readFileSync(PINS_FILE, 'utf8')); if (!Array.isArray(pins)) pins = []; } catch { pins = []; }
function savePins() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(PINS_FILE, JSON.stringify(pins), { mode: 0o600 });
}
// The page token is kept on disk so restarting the server doesn't break open pages.
const TOKEN = (() => {
  const file = path.join(CONFIG_DIR, 'token');
  try { const t = fs.readFileSync(file, 'utf8').trim(); if (t) return t; } catch { /* first run */ }
  const t = crypto.randomBytes(24).toString('hex');
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, t, { mode: 0o600 });
  return t;
})();
const PAGE = 400;

function findClaude() {
  try {
    return execFileSync('bash', ['-lc', 'command -v claude'], { encoding: 'utf8' }).trim() || 'claude';
  } catch {
    const local = path.join(os.homedir(), '.local/bin/claude');
    return fs.existsSync(local) ? local : 'claude';
  }
}

// ---------------------------------------------------------------- utilities

const trunc = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, n) + `\n… (${s.length - n} more characters)` : s);

function shrinkInput(input) {
  if (!input || typeof input !== 'object') return input;
  const out = Array.isArray(input) ? [] : {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string') out[k] = trunc(v, 4000);
    else if (v && typeof v === 'object') out[k] = JSON.stringify(v).length > 6000 ? trunc(JSON.stringify(v, null, 1), 4000) : v;
    else out[k] = v;
  }
  return out;
}

function flattenResult(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(b => (b.type === 'text' ? b.text : b.type === 'image' ? '[image]' : '')).join('\n');
}

function cleanPrompt(s) {
  return String(s || '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<pasted_content[^>]*>([\s\S]*?)<\/pasted_content[^>]*>/g, '$1')
    .trim();
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// ---------------------------------------------------------------- token pricing

// USD per million tokens: [input, output, cache read]. Cache writes are 1.25x input (5-minute
// cache) and 2x input (1-hour cache). First-party API list prices; on a Claude subscription
// these are "API-equivalent" figures, not what you're billed.
const PRICES = [
  ['claude-fable-5-1', 10, 50, 0.25], ['claude-mythos-5-1', 10, 50, 0.25],
  ['claude-fable-5', 10, 50, 1.0], ['claude-mythos-5', 10, 50, 1.0],
  ['claude-opus-5-5', 4, 20, 0.20], ['claude-opus-5', 5, 25, 0.5],
  ['claude-opus-4-8', 5, 25, 0.5], ['claude-opus-4-7', 5, 25, 0.5], ['claude-opus-4-6', 5, 25, 0.5], ['claude-opus-4-5', 5, 25, 0.5],
  ['claude-opus-4', 15, 75, 1.5], ['claude-3-opus', 15, 75, 1.5],
  ['claude-sonnet-5-5', 2, 10, 0.20], ['claude-sonnet-5', 2, 10, 0.2],
  ['claude-sonnet-4', 3, 15, 0.3], ['claude-3-7-sonnet', 3, 15, 0.3], ['claude-3-5-sonnet', 3, 15, 0.3],
  ['claude-haiku-4-5', 1, 5, 0.1], ['claude-3-5-haiku', 0.8, 4, 0.08], ['claude-3-haiku', 0.25, 1.25, 0.03],
];

function priceFor(model) {
  const m = String(model || '').toLowerCase();
  for (const row of PRICES) if (m === row[0] || m.startsWith(row[0] + '-') || m.startsWith(row[0] + '[')) return row;
  if (m.includes('fable') || m.includes('mythos')) return PRICES[0];
  if (m.includes('opus')) return PRICES[5];
  if (m.includes('sonnet')) return PRICES[12];
  if (m.includes('haiku')) return PRICES[17];
  return null;
}

// Returns { cost, tokens: { input, cacheWrite, cacheRead, output } } or null for unknown models.
function costOf(model, u) {
  const p = priceFor(model);
  if (!p || !u) return null;
  const [, inp, out, read] = p;
  const cw = u.cache_creation || {};
  const w1h = cw.ephemeral_1h_input_tokens || 0;
  const w5m = cw.ephemeral_5m_input_tokens != null ? cw.ephemeral_5m_input_tokens : Math.max(0, (u.cache_creation_input_tokens || 0) - w1h);
  const tokens = { input: u.input_tokens || 0, cacheWrite: w5m + w1h, cacheRead: u.cache_read_input_tokens || 0, output: u.output_tokens || 0 };
  const fast = u.speed === 'fast' ? 2 : 1;
  const cost = fast * (tokens.input * inp + w5m * inp * 1.25 + w1h * inp * 2 + tokens.cacheRead * read + tokens.output * out) / 1e6;
  return { cost, tokens };
}

// ---------------------------------------------------------------- transcript parsing

function tagValue(s, tag) {
  const m = s.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : '';
}

// Turn one transcript line into zero or more display items.
function entryToItems(o) {
  const items = [];
  if (!o || o.isSidechain) return items;
  const base = { uuid: o.uuid, ts: o.timestamp };
  const pushUserString = (text) => {
    if (text.startsWith('<command-name>') || text.includes('<command-name>')) {
      items.push({ ...base, kind: 'command', name: tagValue(text, 'command-name'), args: tagValue(text, 'command-args') });
    } else if (text.startsWith('<local-command-stdout>') || text.startsWith('<bash-stdout>')) {
      const body = tagValue(text, 'local-command-stdout') || tagValue(text, 'bash-stdout') || tagValue(text, 'bash-stderr');
      if (body) items.push({ ...base, kind: 'cmdout', text: trunc(body.replace(/\x1b\[[0-9;]*m/g, ''), 3000) });
    } else if (text.startsWith('<bash-input>')) {
      items.push({ ...base, kind: 'command', name: '!', args: tagValue(text, 'bash-input') });
    } else if (text.startsWith('<task-notification>')) {
      items.push({ ...base, kind: 'note', text: tagValue(text, 'summary') || 'Background task finished' });
    } else if (text.startsWith('<')) {
      // other harness-injected messages are not shown
    } else {
      const t = cleanPrompt(text);
      if (t) items.push({ ...base, kind: 'user', text: t });
    }
  };

  if (o.type === 'user') {
    const c = o.message && o.message.content;
    if (o.isCompactSummary) {
      items.push({ ...base, kind: 'summary', text: trunc(typeof c === 'string' ? c : flattenResult(c), 20000) });
    } else if (typeof c === 'string') {
      if (!o.isMeta) pushUserString(c);
    } else if (Array.isArray(c)) {
      const texts = [];
      let images = 0;
      for (const b of c) {
        if (b.type === 'tool_result') {
          items.push({ ...base, kind: 'tool_result', id: b.tool_use_id, isError: !!b.is_error, text: trunc(flattenResult(b.content), 3000) });
        } else if (b.type === 'text' && !o.isMeta) {
          texts.push(b.text);
        } else if (b.type === 'image' && !o.isMeta) {
          images++;
        }
      }
      const joined = texts.join('\n');
      if (joined && !joined.startsWith('<')) {
        const t = cleanPrompt(joined);
        if (t || images) items.push({ ...base, kind: 'user', text: t, images });
      } else if (joined) pushUserString(joined);
      else if (images) items.push({ ...base, kind: 'user', text: '', images });
    }
  } else if (o.type === 'assistant') {
    const c = (o.message && o.message.content) || [];
    for (const b of c) {
      if (b.type === 'text' && b.text && b.text.trim()) items.push({ ...base, kind: 'text', text: b.text });
      else if (b.type === 'thinking' && b.thinking && b.thinking.trim()) items.push({ ...base, kind: 'thinking', text: trunc(b.thinking, 8000) });
      else if (b.type === 'tool_use') items.push({ ...base, kind: 'tool', id: b.id, name: b.name, input: shrinkInput(b.input) });
    }
    if (o.isApiErrorMessage) items.push({ ...base, kind: 'note', level: 'error', text: 'API error' });
    // Token usage for the turn's cost; a reply is split over several entries sharing one message id.
    const msg = o.message || {};
    if (msg.usage && msg.id && msg.model && msg.model !== '<synthetic>') {
      const c2 = costOf(msg.model, msg.usage);
      if (c2) items.push({ ...base, kind: 'usage', msg: msg.id, model: msg.model, cost: c2.cost, tokens: c2.tokens });
    }
  } else if (o.type === 'attachment' && o.attachment) {
    const a = o.attachment;
    if (a.type === 'queued_command' && typeof a.prompt === 'string') pushUserString(a.prompt);
  } else if (o.type === 'system') {
    if (o.subtype === 'away_summary') items.push({ ...base, kind: 'recap', text: o.content });
    else if (o.subtype === 'compact_boundary') items.push({ ...base, kind: 'divider', text: 'Conversation compacted' });
    else if (o.subtype === 'local_command' && typeof o.content === 'string') pushUserString(o.content);
    else if (o.subtype === 'api_error') items.push({ ...base, kind: 'note', level: 'error', text: 'API error — retrying' });
  }
  return items;
}

// Parsed transcripts, read incrementally. LRU-capped.
const transcripts = new Map(); // id -> { file, offset, partial, items }

async function loadTranscript(id) {
  const m = sessions.get(id);
  if (!m) return null;
  let t = transcripts.get(id);
  if (!t || t.file !== m.file) {
    t = { file: m.file, offset: 0, partial: '', items: [] };
    transcripts.set(id, t);
  }
  transcripts.delete(id); transcripts.set(id, t); // LRU touch
  while (transcripts.size > 10) {
    const oldest = transcripts.keys().next().value;
    if (subscribersOf(oldest).length) break;
    transcripts.delete(oldest);
  }
  await advanceTranscript(t);
  return t;
}

// Returns newly appended items.
async function advanceTranscript(t) {
  let st;
  try { st = await fsp.stat(t.file); } catch { return []; }
  if (st.size < t.offset) { t.offset = 0; t.partial = ''; t.items = []; }
  if (st.size === t.offset) return [];
  const fh = await fsp.open(t.file, 'r');
  try {
    const len = st.size - t.offset;
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, t.offset);
    t.offset = st.size;
    const text = t.partial + buf.toString('utf8');
    const lines = text.split('\n');
    t.partial = lines.pop();
    const added = [];
    for (const line of lines) {
      if (!line) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      for (const it of entryToItems(o)) added.push(it);
    }
    t.items.push(...added);
    return added;
  } finally {
    await fh.close();
  }
}

// ---------------------------------------------------------------- session index

const sessions = new Map(); // id -> meta

async function readChunk(file, start, len) {
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, start);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally { await fh.close(); }
}

function parseLines(text, dropFirst) {
  const lines = text.split('\n');
  if (dropFirst) lines.shift();
  const out = [];
  for (const l of lines) {
    if (!l || l[0] !== '{') continue;
    try { out.push(JSON.parse(l)); } catch { /* partial line */ }
  }
  return out;
}

function firstHumanPrompt(objs) {
  for (const o of objs) {
    if (o.isSidechain || o.isMeta || o.isCompactSummary) continue;
    if (o.type === 'user') {
      const c = o.message && o.message.content;
      const s = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join('\n') : '';
      if (s && !s.startsWith('<')) return cleanPrompt(s);
    }
  }
  return '';
}

async function readMeta(id, file, st, prev) {
  const HEAD = 256 * 1024, TAIL = 256 * 1024;
  const m = { id, file, size: st.size, mtimeMs: st.mtimeMs };
  let head = prev && prev.headComplete ? prev : null;
  if (!head) {
    const objs = parseLines(await readChunk(file, 0, Math.min(HEAD, st.size)), false);
    const withCwd = objs.find(o => o.cwd);
    const firstTs = objs.find(o => o.timestamp);
    head = { cwd: withCwd ? withCwd.cwd : null, firstPrompt: firstHumanPrompt(objs), headComplete: st.size > HEAD || !!firstHumanPrompt(objs), created: firstTs ? Date.parse(firstTs.timestamp) : null };
    head.headTitle = null;
    for (const o of objs) if (o.type === 'ai-title' || o.type === 'custom-title' || o.type === 'summary') head.headTitle = o.customTitle || o.aiTitle || o.summary || head.headTitle;
  }
  Object.assign(m, { cwd: head.cwd, firstPrompt: head.firstPrompt, headComplete: head.headComplete, headTitle: head.headTitle, created: head.created || (prev && prev.created) || st.birthtimeMs || st.mtimeMs });

  const tailStart = Math.max(0, st.size - TAIL);
  const tail = parseLines(await readChunk(file, tailStart, st.size - tailStart), tailStart > 0);
  let aiTitle = null, customTitle = null, mode = null, lastPrompt = null, lastTs = null, model = null;
  for (const o of tail) {
    if (o.type === 'custom-title') customTitle = o.customTitle;
    else if (o.type === 'ai-title') aiTitle = o.aiTitle;
    else if (o.type === 'summary' && !aiTitle) aiTitle = o.summary;
    else if (o.type === 'permission-mode') mode = o.permissionMode;
    else if (o.type === 'last-prompt') lastPrompt = o.lastPrompt;
    if (o.timestamp) lastTs = o.timestamp;
    if (o.type === 'assistant' && o.message && o.message.model && o.message.model !== '<synthetic>') model = o.message.model;
    if (!m.cwd && o.cwd) m.cwd = o.cwd;
  }
  m.title = customTitle || aiTitle || (prev && prev.title !== prev.firstPrompt ? prev.title : null) || head.headTitle || m.firstPrompt || lastPrompt || '';
  m.title = m.title.replace(/\s+/g, ' ').slice(0, 120);
  m.permissionMode = mode || (prev && prev.permissionMode) || null;
  m.model = model || (prev && prev.model) || null;
  m.lastTs = lastTs || (prev && prev.lastTs) || null;
  if (!m.cwd) m.cwd = (prev && prev.cwd) || null;
  return m;
}

async function scanSessions() {
  let dirs = [];
  try { dirs = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true }); } catch { return; }
  const seen = new Set();
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(PROJECTS_DIR, d.name);
    let files;
    try { files = await fsp.readdir(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const id = f.slice(0, -6);
      const file = path.join(dir, f);
      let st;
      try { st = await fsp.stat(file); } catch { continue; }
      if (!st.size) continue;
      seen.add(id);
      const prev = sessions.get(id);
      if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs && prev.file === file) continue;
      try { sessions.set(id, await readMeta(id, file, st, prev && prev.file === file ? prev : null)); } catch { /* unreadable */ }
    }
  }
  for (const id of [...sessions.keys()]) if (!seen.has(id)) sessions.delete(id);
}

async function readRegistry() {
  const live = new Map();
  let files = [];
  try { files = await fsp.readdir(REGISTRY_DIR); } catch { return live; }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const r = JSON.parse(await fsp.readFile(path.join(REGISTRY_DIR, f), 'utf8'));
      if (!r.sessionId || !r.pid || !isAlive(r.pid)) continue;
      if ([...hosts.values()].some(h => h.proc && h.proc.pid === r.pid)) continue;
      live.set(r.sessionId, { pid: r.pid, status: r.status || 'idle', name: r.name, kind: r.kind, cwd: r.cwd, startedAt: r.startedAt });
    } catch { /* being rewritten */ }
  }
  return live;
}

let terminalLive = new Map();

function sessionList() {
  const list = [];
  const ids = new Set([...sessions.keys(), ...terminalLive.keys(), ...hosts.keys()]);
  for (const id of ids) {
    const m = sessions.get(id) || {};
    const term = terminalLive.get(id);
    const host = hosts.get(id);
    if (!m.title && !term && !host) continue;
    list.push({
      id,
      title: (host && host.temp && (titles[id] || host.title)) || titles[id] || m.title || (term && term.name) || 'New conversation',
      pinned: pins.includes(id) ? pins.length - pins.indexOf(id) : 0,
      cwd: m.cwd || (term && term.cwd) || (host && host.cwd) || null,
      mtime: m.mtimeMs || (term && term.startedAt) || Date.now(),
      created: m.created || (host && host.createdAt) || (term && term.startedAt) || m.mtimeMs || Date.now(),
      permissionMode: m.permissionMode,
      model: m.model,
      terminal: term ? { pid: term.pid, status: term.status, name: term.name } : null,
      hosted: host ? { status: host.status, permissionMode: host.permissionMode, model: host.model, temporary: host.temp } : null,
    });
  }
  list.sort((a, b) => b.mtime - a.mtime);
  return list;
}

// ---------------------------------------------------------------- connections (apps Claude can use)

// A connection is { id, name, items: [{ key, value }] }. Each item becomes an env var
// <NAME>_<KEY> in hosted sessions. Values whose key looks secret are never sent to the browser
// or put in the prompt.

let connections = [];
let configVersion = 0;

function loadConnections() {
  try {
    connections = (JSON.parse(fs.readFileSync(CONNECTIONS_FILE, 'utf8')).connections || [])
      .filter(Boolean)
      .map(c => ({ id: c.id || crypto.randomUUID(), name: c.name, items: Array.isArray(c.items) ? c.items : [] }));
  } catch { connections = []; }
}

function saveConnections() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const tmp = CONNECTIONS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ connections }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, CONNECTIONS_FILE);
  configVersion++;
}

const isSecret = key => /key|token|secret|pass|auth|cred|cookie|session/i.test(key);
const mask = v => (v ? '••••' + String(v).slice(-4) : '');
const envPart = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const envName = (app, key) => {
  const e = [envPart(app), envPart(key)].filter(Boolean).join('_');
  return /^[A-Z]/.test(e) ? e : 'APP_' + e;
};

function publicConnection(c) {
  return { id: c.id, name: c.name, items: c.items };
}

// Stores exactly what was typed: no required fields, no duplicate checks.
function upsertConnection(input) {
  const prev = input.id ? connections.find(c => c.id === input.id) : null;
  const items = (Array.isArray(input.items) ? input.items : []).map(i => ({ key: String((i && i.key) ?? ''), value: String((i && i.value) ?? '') }));
  const c = { id: prev ? prev.id : crypto.randomUUID(), name: String(input.name ?? ''), items };
  if (prev) connections[connections.indexOf(prev)] = c; else connections.push(c);
  saveConnections();
  return c;
}

// Env vars and prompt text for a hosted claude process.
function launchConfig() {
  const env = {};
  const lines = [];
  for (const c of connections) {
    const rows = c.items.filter(i => i.key.trim());
    if (!rows.length) continue;
    const parts = rows.map(i => {
      const E = envName(c.name || 'app', i.key);
      env[E] = i.value;
      return isSecret(i.key) ? `$${E} (secret)` : `$${E} = ${i.value.replace(/\s+/g, ' ').slice(0, 300)}`;
    });
    lines.push(`- ${c.name || 'Unnamed app'}: ${parts.join(', ')}`);
  }
  const args = [];
  if (lines.length) {
    args.push('--append-system-prompt', [
      '# Connected apps',
      'The user added these apps in Claude Hub. Their details are environment variables already set in your shell.',
      'Use them when relevant (for example with curl). Never print, echo or write secret values; reference the variable instead.',
      ...lines,
    ].join('\n'));
  }
  return { args, env };
}

// ---------------------------------------------------------------- hosted claude processes

const hosts = new Map(); // sessionId -> Host

class Host {
  constructor({ id, cwd, resume, fork, permissionMode, model, temporary }) {
    this.id = id;
    // Temporary chats are never written to disk; their transcript lives only in this.items.
    this.temp = !!temporary;
    this.items = [];
    this.title = '';
    this.createdAt = Date.now();
    this.cwd = cwd;
    this.permissionMode = permissionMode || 'manual';
    this.model = model || null;
    this.status = 'starting';
    this.pending = new Map(); // permission requests
    this.lastActive = Date.now();
    this.stderr = '';
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--include-partial-messages', '--permission-prompt-tool', 'stdio', '--permission-mode', this.permissionMode];
    if (resume) args.push('--resume', resume);
    else args.push('--session-id', id);
    if (fork) args.push('--fork-session');
    if (this.temp) args.push('--no-session-persistence');
    // uploaded files live outside the project; let Claude read them without a prompt
    args.push('--add-dir', UPLOAD_DIR);
    if (model) args.push('--model', model);
    const extra = launchConfig();
    args.push(...extra.args);
    this.configVersion = configVersion;
    this.forking = !!fork;
    this.proc = spawn(CLAUDE_BIN, args, { cwd, env: { ...process.env, ...extra.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.exited = new Promise(r => this.proc.on('exit', r));
    let buf = '';
    this.proc.stdout.on('data', d => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let evt;
        try { evt = JSON.parse(line); } catch { continue; }
        try { this.handle(evt); } catch (e) { console.error('host event error', e); }
      }
    });
    this.proc.stderr.on('data', d => { this.stderr = (this.stderr + d.toString()).slice(-4000); });
    this.proc.on('error', e => this.emit({ t: 'error', message: `Could not start claude: ${e.message}` }));
    this.proc.on('exit', code => {
      this.status = 'exited';
      if (code && code !== 0 && code !== 143) this.emit({ t: 'error', message: `claude exited (code ${code}). ${this.stderr.trim().split('\n').slice(-3).join(' ')}` });
      for (const id of this.pending.keys()) this.emit({ t: 'perm_done', requestId: id });
      this.pending.clear();
      this.emit({ t: 'status', state: 'exited' });
      if (hosts.get(this.id) === this) hosts.delete(this.id);
      broadcastSessions(true);
    });
  }

  emit(evt) { publish(this.id, evt); }

  write(obj) {
    if (this.proc.stdin.writable) this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  pushItems(items) {
    if (!items.length) return;
    const from = this.items.length;
    this.items.push(...items);
    for (const c of subscribersOf(this.id)) sse(c.res, 'items', { from, items });
  }

  send(text) {
    if (this.temp) {
      if (!this.title) this.title = text.replace(/\[Attached file: [^\]]*\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Temporary chat';
      this.pushItems([{ uuid: crypto.randomUUID(), ts: new Date().toISOString(), kind: 'user', text }]);
    }
    this.lastActive = Date.now();
    this.setStatus('busy');
    this.write({ type: 'user', message: { role: 'user', content: text } });
  }

  control(request) {
    this.write({ type: 'control_request', request_id: crypto.randomUUID(), request });
  }

  setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    this.emit({ t: 'status', state: s });
    broadcastSessions(true);
  }

  handle(evt) {
    this.lastActive = Date.now();
    if (this.temp && (evt.type === 'assistant' || evt.type === 'user') && !evt.parent_tool_use_id && evt.message) {
      this.pushItems(entryToItems({ type: evt.type, message: evt.message, uuid: evt.uuid || crypto.randomUUID(), timestamp: new Date().toISOString() }));
    }
    if (evt.type === 'system' && evt.subtype === 'init') {
      if (evt.session_id && evt.session_id !== this.id) {
        const old = this.id;
        hosts.delete(old);
        this.id = evt.session_id;
        hosts.set(this.id, this);
        publish(old, { t: 'moved', to: this.id });
      }
      if (this.status === 'starting') this.setStatus('busy');
      return;
    }
    if (evt.type === 'stream_event' && !evt.parent_tool_use_id) {
      const e = evt.event || {};
      if (e.type === 'content_block_start' && e.content_block) {
        if (e.content_block.type === 'thinking') this.emit({ t: 'activity', what: 'thinking' });
        else if (e.content_block.type === 'tool_use') this.emit({ t: 'activity', what: 'tool', name: e.content_block.name });
        else if (e.content_block.type === 'text') this.emit({ t: 'activity', what: 'writing' });
      } else if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta') {
        this.emit({ t: 'delta', text: e.delta.text });
      }
      return;
    }
    if (evt.type === 'control_request') {
      const r = evt.request || {};
      if (r.subtype === 'can_use_tool') {
        const p = {
          requestId: evt.request_id, tool: r.tool_name, display: r.display_name || r.tool_name,
          input: r.input, description: r.description, blockedPath: r.blocked_path,
          suggestions: r.permission_suggestions || [], toolUseId: r.tool_use_id,
        };
        this.pending.set(evt.request_id, p);
        this.emit({ t: 'perm', ...p, input: shrinkInput(r.input) });
      } else {
        this.write({ type: 'control_response', response: { subtype: 'error', request_id: evt.request_id, error: `Unsupported request: ${r.subtype}` } });
      }
      return;
    }
    if (evt.type === 'control_cancel_request') {
      this.pending.delete(evt.request_id);
      this.emit({ t: 'perm_done', requestId: evt.request_id });
      return;
    }
    if (evt.type === 'result') {
      this.setStatus('idle');
      this.emit({ t: 'result', isError: !!evt.is_error, cost: evt.total_cost_usd, durationMs: evt.duration_ms, text: evt.is_error ? evt.result : undefined });
      return;
    }
    if (evt.type === 'system' && evt.subtype === 'status' && evt.status === 'requesting') this.emit({ t: 'activity', what: 'requesting' });
  }

  answer(requestId, behavior, extra = {}) {
    const p = this.pending.get(requestId);
    if (!p) return false;
    this.pending.delete(requestId);
    let response;
    if (behavior === 'deny') {
      response = { behavior: 'deny', message: extra.message || 'The user denied this action from Claude Hub.' };
    } else {
      response = { behavior: 'allow', updatedInput: extra.updatedInput || p.input };
      if (behavior === 'always' && p.suggestions.length) response.updatedPermissions = p.suggestions;
    }
    this.write({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } });
    this.emit({ t: 'perm_done', requestId });
    return true;
  }

  stop() {
    try { this.proc.stdin.end(); } catch { /* closed */ }
    setTimeout(() => { if (this.status !== 'exited') this.proc.kill('SIGTERM'); }, 3000);
  }
}

setInterval(() => {
  for (const h of hosts.values()) {
    if (h.status === 'idle' && !h.pending.size && Date.now() - h.lastActive > HOST_IDLE_MS) h.stop();
  }
}, 60 * 1000).unref();

async function waitForExit(pid, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!isAlive(pid)) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return !isAlive(pid);
}

// ---------------------------------------------------------------- server-sent events

const clients = new Set(); // { res, session }

function subscribersOf(id) { return [...clients].filter(c => c.session === id); }

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function publish(id, evt) {
  for (const c of clients) if (c.session === id) sse(c.res, 'host', evt);
}

let lastListSig = '';
function broadcastSessions(force) {
  const list = sessionList();
  const sig = JSON.stringify(list.map(s => [s.id, s.title, s.mtime, s.pinned, s.terminal && s.terminal.status, s.hosted && s.hosted.status]));
  if (!force && sig === lastListSig) return;
  lastListSig = sig;
  for (const c of clients) sse(c.res, 'sessions', list);
}

async function tickTranscripts() {
  const watched = new Set([...clients].map(c => c.session).filter(Boolean));
  for (const id of watched) {
    const t = transcripts.get(id);
    if (!t) continue;
    const from = t.items.length;
    const added = await advanceTranscript(t);
    if (added.length) for (const c of subscribersOf(id)) sse(c.res, 'items', { from, items: added });
  }
}

async function tickIndex() {
  await scanSessions();
  terminalLive = await readRegistry();
  // A watched session may have been created or moved after the subscriber connected.
  // Start at offset 0 so tickTranscripts streams its existing items to the subscriber.
  for (const c of clients) {
    const m = c.session && sessions.get(c.session);
    if (m && !transcripts.has(c.session)) transcripts.set(c.session, { file: m.file, offset: 0, partial: '', items: [] });
  }
  broadcastSessions(false);
}

let busyT = false, busyI = false;
setInterval(async () => { if (busyT) return; busyT = true; try { await tickTranscripts(); } finally { busyT = false; } }, 600);
setInterval(async () => { if (busyI) return; busyI = true; try { await tickIndex(); } finally { busyI = false; } }, 2000);
setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 20000);

// ---------------------------------------------------------------- HTTP

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function json(res, code, data) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function body(req) {
  let s = '';
  for await (const chunk of req) { s += chunk; if (s.length > 5e6) throw new Error('too large'); }
  return s ? JSON.parse(s) : {};
}

function allowedHost(req) {
  const h = req.headers.host || '';
  return h === `127.0.0.1:${PORT}` || h === `localhost:${PORT}`;
}

async function startHost(id, { text, mode, permissionMode, model, cwd }) {
  const m = sessions.get(id);
  const term = terminalLive.get(id);
  const workdir = cwd || (m && m.cwd) || (term && term.cwd) || os.homedir();
  if (term) {
    if (mode === 'takeover') {
      try { process.kill(term.pid, 'SIGTERM'); } catch { /* gone */ }
      if (!(await waitForExit(term.pid, 6000))) throw Object.assign(new Error('The terminal session did not exit. Close it manually and try again.'), { code: 409 });
      terminalLive.delete(id);
    } else if (mode !== 'fork') {
      throw Object.assign(new Error('Session is running in a terminal'), { code: 409, needsChoice: true });
    }
  }
  const host = new Host({ id, cwd: workdir, resume: id, fork: mode === 'fork', permissionMode, model });
  if (!host.forking) hosts.set(id, host);
  else hosts.set(`fork:${crypto.randomUUID()}`, host);
  host.send(text);
  if (host.forking) {
    // wait for the new session id
    const newId = await new Promise(resolve => {
      const t = setInterval(() => { if (!host.id.startsWith('fork:') && host.id !== id) { clearInterval(t); resolve(host.id); } else if (host.status === 'exited') { clearInterval(t); resolve(null); } }, 100);
      setTimeout(() => { clearInterval(t); resolve(host.id !== id ? host.id : null); }, 30000);
    });
    if (!newId) throw new Error('Fork failed to start');
    for (const [k, v] of hosts) if (v === host && k !== newId) hosts.delete(k);
    hosts.set(newId, host);
    return newId;
  }
  return id;
}

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const method = req.method;

  if (method === 'GET' && parts[1] === 'events') {
    const session = url.searchParams.get('session') || null;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    const client = { res, session };
    clients.add(client);
    sse(res, 'sessions', sessionList());
    if (session) {
      const h = hosts.get(session);
      if (h) {
        sse(res, 'host', { t: 'status', state: h.status });
        for (const p of h.pending.values()) sse(res, 'host', { t: 'perm', ...p, input: shrinkInput(p.input) });
      }
    }
    req.on('close', () => clients.delete(client));
    return;
  }

  if (method === 'GET' && parts[1] === 'sessions' && parts.length === 2) return json(res, 200, sessionList());

  if (method === 'GET' && parts[1] === 'dirs') {
    const counts = new Map();
    for (const m of sessions.values()) if (m.cwd) counts.set(m.cwd, Math.max(counts.get(m.cwd) || 0, m.mtimeMs));
    const dirs = [...counts.entries()].filter(([d]) => fs.existsSync(d)).sort((a, b) => b[1] - a[1]).map(([d]) => d);
    return json(res, 200, { home: os.homedir(), dirs });
  }

  if (parts[1] === 'connections') {
    const id = parts[2];
    if (method === 'GET' && !id) return json(res, 200, { connections: connections.map(publicConnection) });
    if (method === 'POST' && !id) {
      try { return json(res, 200, publicConnection(upsertConnection(await body(req)))); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (method === 'DELETE' && id) {
      connections = connections.filter(x => x.id !== id);
      saveConnections();
      return json(res, 200, { ok: true });
    }
  }

  if (method === 'POST' && parts[1] === 'upload') {
    // raw body upload: /api/upload?name=<file name>
    const raw = path.basename(String(url.searchParams.get('name') || 'file')).replace(/[\x00-\x1f/\\]/g, '_').slice(-120) || 'file';
    const dir = path.join(UPLOAD_DIR, new Date().toISOString().slice(0, 10), crypto.randomBytes(4).toString('hex'));
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const dest = path.join(dir, raw);
    let size = 0;
    try {
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(dest, { mode: 0o600 });
        req.on('data', chunk => {
          size += chunk.length;
          if (size > UPLOAD_MAX) { req.destroy(); out.destroy(); reject(new Error('File is larger than 100 MB')); }
        });
        req.pipe(out);
        out.on('finish', resolve);
        out.on('error', reject);
        req.on('error', reject);
      });
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true });
      return json(res, 413, { error: e.message });
    }
    return json(res, 200, { path: dest, name: raw, size });
  }

  if (method === 'GET' && parts[1] === 'upload-file') {
    // serves only files inside the uploads folder (for image previews)
    let real;
    try { real = fs.realpathSync(String(url.searchParams.get('path') || '')); } catch { return json(res, 404, { error: 'Not found' }); }
    const root = fs.existsSync(UPLOAD_DIR) ? fs.realpathSync(UPLOAD_DIR) : UPLOAD_DIR;
    if (!real.startsWith(root + path.sep)) return json(res, 403, { error: 'Forbidden' });
    const ext = path.extname(real).toLowerCase();
    const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'private, max-age=86400', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'x-content-type-options': 'nosniff' });
    fs.createReadStream(real).pipe(res);
    return;
  }

  if (method === 'POST' && parts[1] === 'new') {
    const b = await body(req);
    const cwd = path.resolve((b.cwd || os.homedir()).replace(/^~(?=$|\/)/, os.homedir()));
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return json(res, 400, { error: `Folder not found: ${cwd}` });
    if (!b.text || !b.text.trim()) return json(res, 400, { error: 'Empty message' });
    const id = crypto.randomUUID();
    const host = new Host({ id, cwd, permissionMode: b.permissionMode, model: b.model, temporary: !!b.temporary });
    hosts.set(id, host);
    host.send(b.text);
    broadcastSessions(true);
    return json(res, 200, { id });
  }

  if (parts[1] === 'sessions' && parts[2]) {
    const id = parts[2];
    const action = parts[3];

    if (method === 'GET' && action === 'items') {
      const th = hosts.get(id);
      if (th && th.temp) return json(res, 200, { items: th.items, start: 0, total: th.items.length, temporary: true });
      if (!sessions.has(id)) await scanSessions();
      if (!sessions.has(id) && !hosts.has(id) && !terminalLive.has(id)) return json(res, 200, { items: [], start: 0, total: 0, gone: true });
      const t = await loadTranscript(id);
      if (!t) return json(res, 200, { items: [], start: 0, total: 0 });
      const before = url.searchParams.has('before') ? Number(url.searchParams.get('before')) : t.items.length;
      const start = Math.max(0, before - PAGE);
      return json(res, 200, { items: t.items.slice(start, before), start, total: t.items.length });
    }

    if (method === 'POST' && action === 'send') {
      const b = await body(req);
      if (!b.text || !b.text.trim()) return json(res, 400, { error: 'Empty message' });
      if (!hosts.has(id) && !sessions.has(id) && !terminalLive.has(id)) return json(res, 410, { error: 'This temporary chat has ended. Start a new one.' });
      let h = hosts.get(id);
      // Connections changed since this process started: restart it (same session) so it sees them.
      if (h && h.status === 'idle' && !h.pending.size && h.configVersion !== configVersion) {
        h.stop();
        await Promise.race([h.exited, new Promise(r => setTimeout(r, 5000))]);
        if (hosts.get(id) === h) hosts.delete(id);
        h = null;
      }
      if (h && h.status !== 'exited') {
        if (b.permissionMode && b.permissionMode !== h.permissionMode) { h.permissionMode = b.permissionMode; h.control({ subtype: 'set_permission_mode', mode: b.permissionMode }); }
        if (b.model !== undefined && (b.model || null) !== h.model) { h.model = b.model || null; h.control({ subtype: 'set_model', model: b.model || undefined }); }
        h.send(b.text);
        return json(res, 200, { id });
      }
      try {
        const newId = await startHost(id, b);
        broadcastSessions(true);
        return json(res, 200, { id: newId });
      } catch (e) {
        return json(res, e.code || 500, { error: e.message, needsChoice: !!e.needsChoice });
      }
    }

    if (method === 'POST' && action === 'interrupt') {
      const h = hosts.get(id);
      if (!h) return json(res, 404, { error: 'Not running here' });
      h.control({ subtype: 'interrupt' });
      return json(res, 200, { ok: true });
    }

    if (method === 'POST' && action === 'permission') {
      const b = await body(req);
      const h = hosts.get(id);
      if (!h || !h.answer(b.requestId, b.behavior, { updatedInput: b.updatedInput, message: b.message })) return json(res, 404, { error: 'No such request' });
      return json(res, 200, { ok: true });
    }

    if (method === 'POST' && action === 'settings') {
      const b = await body(req);
      const h = hosts.get(id);
      if (h) {
        if (b.permissionMode && b.permissionMode !== h.permissionMode) { h.permissionMode = b.permissionMode; h.control({ subtype: 'set_permission_mode', mode: b.permissionMode }); }
        if (b.model !== undefined && (b.model || null) !== h.model) { h.model = b.model || null; h.control({ subtype: 'set_model', model: b.model || undefined }); }
      }
      return json(res, 200, { ok: true });
    }

    if (method === 'POST' && action === 'pin') {
      const on = !!(await body(req)).pinned;
      pins = pins.filter(x => x !== id);
      if (on) pins.unshift(id);
      savePins();
      broadcastSessions(true);
      return json(res, 200, { ok: true, pinned: on });
    }

    if (method === 'POST' && action === 'rename') {
      const title = String((await body(req)).title || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      const th = hosts.get(id);
      if (th && th.temp) { th.title = title || th.title; broadcastSessions(true); return json(res, 200, { ok: true, title: th.title }); }
      if (title) titles[id] = title; else delete titles[id];
      saveTitles();
      const m = sessions.get(id);
      if (m && title) {
        // same entry Claude Code writes for /rename, so terminals see the new name too
        await fsp.appendFile(m.file, JSON.stringify({ type: 'custom-title', customTitle: title, sessionId: id }) + '\n');
      }
      broadcastSessions(true);
      return json(res, 200, { ok: true, title: titles[id] || (m && m.title) || '' });
    }

    if (method === 'POST' && action === 'delete') {
      const th = hosts.get(id);
      if (th && th.temp) { th.stop(); hosts.delete(id); broadcastSessions(true); return json(res, 200, { ok: true, trashed: false }); }
      const term = terminalLive.get(id);
      if (term) return json(res, 409, { error: 'This chat is open in a terminal. Close it there first.' });
      const h = hosts.get(id);
      if (h) {
        h.stop();
        await Promise.race([h.exited, new Promise(r => setTimeout(r, 5000))]);
        hosts.delete(id);
      }
      const m = sessions.get(id);
      if (!m) return json(res, 404, { error: 'Chat not found' });
      const targets = [m.file, m.file.replace(/\.jsonl$/, '')].filter(f => fs.existsSync(f));
      let trashed = true;
      for (const f of targets) {
        try { execFileSync('gio', ['trash', '--', f], { stdio: 'pipe' }); }
        catch { trashed = false; await fsp.rm(f, { recursive: true, force: true }); }
      }
      sessions.delete(id);
      transcripts.delete(id);
      if (titles[id]) { delete titles[id]; saveTitles(); }
      if (pins.includes(id)) { pins = pins.filter(x => x !== id); savePins(); }
      broadcastSessions(true);
      return json(res, 200, { ok: true, trashed });
    }

    if (method === 'POST' && action === 'release') {
      const h = hosts.get(id);
      if (h) h.stop();
      return json(res, 200, { ok: true });
    }
  }

  json(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  try {
    if (!allowedHost(req)) { res.writeHead(403); return res.end('Forbidden host'); }
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      const tok = req.headers['x-hub-token'] || url.searchParams.get('token');
      if (tok !== TOKEN) return json(res, 401, { error: 'Bad token' });
      return await api(req, res, url);
    }
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.join(PUBLIC_DIR, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
    let data;
    try { data = await fsp.readFile(file); } catch { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file);
    if (ext === '.html') data = Buffer.from(data.toString('utf8').replace('__HUB_TOKEN__', TOKEN));
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: e.message });
  }
});

function stopHosts() {
  for (const h of hosts.values()) { try { h.proc.kill('SIGTERM'); } catch { /* gone */ } }
}

function shutdown() {
  stopHosts();
  process.exit(0);
}

// Resolves once the server is listening; rejects if the port can't be used.
async function start() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o700 });
  loadConnections();
  await scanSessions();
  terminalLive = await readRegistry();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, () => {
      console.log(`Claude Hub running at http://localhost:${PORT}`);
      console.log(`Using claude at ${CLAUDE_BIN} · ${sessions.size} sessions found`);
      resolve();
    });
  });
}

module.exports = { start, stopHosts, PORT };

// `node server.js` runs standalone; the desktop app requires this file and calls start().
if (require.main === module) {
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  start().catch(e => { console.error(e.message); process.exit(1); });
}
