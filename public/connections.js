'use strict';
// Apps: a name plus free-form name/value rows that hosted Claude sessions get as env vars.
// Relies on $, esc, api, toast from app.js.

const conn = { list: [] };

async function loadConnections() {
  try { conn.list = (await api('/connections')).connections; } catch (e) { toast(e.message, true); }
  const n = conn.list.length;
  $('#apps-count').textContent = n ? `${n} app${n > 1 ? 's' : ''}` : 'Apps';
  $('#apps-chip').classList.toggle('on', n > 0);
}

function openConnections() {
  renderAppList();
  if (!$('#conn-dialog').open) $('#conn-dialog').showModal();
}

$('#conn-btn').onclick = openConnections;
$('#apps-chip').onclick = openConnections;
$('#cd-close').onclick = () => $('#conn-dialog').close();
$('#conn-dialog').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });

function renderAppList() {
  $('#cd-title').textContent = 'Apps';
  $('#cd-sub').textContent = 'Claude can use these in chats you run from here.';
  const body = $('#cd-body');
  body.innerHTML = `<div class="app-list"></div><button type="button" class="btn accent add-app">+ Add app</button>`;
  const list = $('.app-list', body);
  if (!conn.list.length) list.innerHTML = '<p class="app-empty">No apps yet.</p>';
  for (const c of conn.list) {
    const row = document.createElement('div');
    row.className = 'app-row';
    row.innerHTML = `<div class="app-main"><b>${esc(c.name || 'Untitled')}</b><span>${c.items.map(i => esc(i.key)).filter(Boolean).join(' · ') || 'No items'}</span></div>
      <button type="button" class="ghost-btn sm" data-a="edit">Edit</button>
      <button type="button" class="icon-btn" data-a="del" title="Delete" aria-label="Delete ${esc(c.name)}"><svg viewBox="0 0 20 20" width="15" height="15"><path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 10h6.6L14 6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
    $('[data-a=edit]', row).onclick = () => renderAppForm(c);
    $('[data-a=del]', row).onclick = async () => {
      if (!confirm(`Delete ${c.name || 'this app'}?`)) return;
      try { await api(`/connections/${c.id}`, { method: 'DELETE' }); await loadConnections(); renderAppList(); }
      catch (e) { toast(e.message, true); }
    };
    list.appendChild(row);
  }
  $('.add-app', body).onclick = () => renderAppForm({ name: '', items: [] });
}

function renderAppForm(c) {
  $('#cd-title').textContent = c.id ? (c.name || 'Untitled') : 'Add app';
  $('#cd-sub').textContent = 'Add whatever details Claude needs: URL, API key, account ID…';
  const body = $('#cd-body');
  body.innerHTML = `
    <form class="app-form" autocomplete="off">
      <input class="fi app-name" placeholder="App name">
      <div class="kv"></div>
      <button type="button" class="link-btn add-row">+ Add row</button>
      <div class="form-err" hidden></div>
      <div class="form-actions">
        <button type="button" class="btn" data-a="cancel">Cancel</button>
        <button type="submit" class="btn accent">Save</button>
      </div>
    </form>`;
  const f = $('.app-form', body);
  const kv = $('.kv', f);
  const addRow = (key = '', value = '') => {
    const r = document.createElement('div');
    r.className = 'kv-row';
    r.innerHTML = `<input class="fi k" placeholder="Name" spellcheck="false"><input class="fi v" placeholder="Value" spellcheck="false"><button type="button" class="icon-btn" aria-label="Remove row">✕</button>`;
    $('.k', r).value = key;
    $('.v', r).value = value;
    $('button', r).onclick = () => { r.remove(); if (!kv.children.length) addRow(); };
    kv.appendChild(r);
    return r;
  };
  $('.app-name', f).value = c.name;
  (c.items.length ? c.items : [{}, {}]).forEach(i => addRow(i.key, i.value));
  $('.add-row', f).onclick = () => $('.k', addRow()).focus();
  $('[data-a=cancel]', f).onclick = renderAppList;
  setTimeout(() => $('.app-name', f).focus(), 30);

  f.onsubmit = async e => {
    e.preventDefault();
    const items = [...kv.children].map(r => ({ key: $('.k', r).value, value: $('.v', r).value }));
    try {
      await api('/connections', { body: { id: c.id, name: $('.app-name', f).value, items } });
      await loadConnections();
      renderAppList();
    } catch (ex) {
      const err = $('.form-err', f);
      err.textContent = ex.message;
      err.hidden = false;
    }
  };
}

loadConnections();
