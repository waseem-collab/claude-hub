'use strict';
// Custom dropdowns. A native <select> stays in the DOM as the source of truth (value + change
// events), so app code keeps using select.value; this only replaces what you see and click.

const Dropdown = (() => {
  const CHECK = '<svg class="dd-check" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const CARET = '<svg class="dd-caret" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let current = null;

  // Opens a menu next to `anchor`. Returns a controller the caller feeds key events to.
  function open({ anchor, title, items, selected, onPick, onClose, align, empty }) {
    if (current) current.close();
    const menu = document.createElement('div');
    menu.className = 'dd-menu';
    menu.setAttribute('role', 'listbox');
    let active = -1;
    let list = [];

    const render = newItems => {
      list = newItems;
      menu.innerHTML = (title ? `<div class="dd-title">${escH(title)}</div>` : '') +
        (list.length ? list.map((it, i) => `
          <div class="dd-item${it.value === selected ? ' sel' : ''}${it.danger ? ' danger' : ''}" role="option" data-i="${i}" aria-selected="${it.value === selected}">
            ${it.icon ? `<span class="dd-ico">${it.icon}</span>` : ''}
            <span class="dd-text"><span class="dd-label">${escH(it.label)}</span>${it.desc ? `<span class="dd-desc">${escH(it.desc)}</span>` : ''}</span>
            ${it.value === selected ? CHECK : ''}
          </div>`).join('') : `<div class="dd-empty">${escH(empty || 'Nothing here')}</div>`);
      active = Math.max(0, list.findIndex(it => it.value === selected));
      if (!list.length) active = -1;
      highlight(false);
      place();
    };

    const highlight = scroll => {
      menu.querySelectorAll('.dd-item').forEach(el => el.classList.toggle('active', Number(el.dataset.i) === active));
      const el = menu.querySelector('.dd-item.active');
      if (el && scroll) el.scrollIntoView({ block: 'nearest' });
    };

    const place = () => {
      const r = anchor.getBoundingClientRect();
      menu.style.maxHeight = '';
      const mh = Math.min(menu.scrollHeight, 360);
      const mw = menu.offsetWidth;
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const up = below < mh && above > below;
      let left = align === 'end' ? r.right - mw : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
      menu.style.left = `${left}px`;
      menu.style.top = up ? `${Math.max(8, r.top - Math.min(mh, above) - 6)}px` : `${r.bottom + 6}px`;
      menu.style.maxHeight = `${Math.min(360, up ? above : below)}px`;
      menu.classList.toggle('up', up);
    };

    const pick = i => {
      const it = list[i];
      if (!it) return;
      ctl.close();
      onPick(it.value, it);
    };

    const outside = e => { if (!menu.contains(e.target) && !anchor.contains(e.target)) ctl.close(); };
    const onScroll = e => { if (!menu.contains(e.target)) ctl.close(); };

    const ctl = {
      el: menu,
      get isOpen() { return current === ctl; },
      setItems: render,
      close() {
        if (current !== ctl) return;
        current = null;
        menu.remove();
        document.removeEventListener('mousedown', outside, true);
        window.removeEventListener('resize', ctl.close);
        window.removeEventListener('scroll', onScroll, true);
        if (onClose) onClose();
      },
      // returns true when the key was handled
      key(e) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          if (!list.length) return true;
          active = (active + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
          highlight(true);
          return true;
        }
        if (e.key === 'Home' || e.key === 'End') { active = e.key === 'Home' ? 0 : list.length - 1; highlight(true); return true; }
        if (e.key === 'Enter') { if (active >= 0) pick(active); else ctl.close(); return true; }
        if (e.key === 'Escape') { ctl.close(); return true; }
        if (e.key === 'Tab') { ctl.close(); return false; }
        return false;
      },
    };

    menu.addEventListener('mousedown', e => e.preventDefault()); // keep focus on the trigger/input
    menu.addEventListener('mousemove', e => {
      const el = e.target.closest('.dd-item');
      if (el && Number(el.dataset.i) !== active) { active = Number(el.dataset.i); highlight(false); }
    });
    menu.addEventListener('click', e => { const el = e.target.closest('.dd-item'); if (el) pick(Number(el.dataset.i)); });

    document.body.appendChild(menu);
    current = ctl;
    render(items);
    highlight(true);
    document.addEventListener('mousedown', outside, true);
    window.addEventListener('resize', ctl.close);
    window.addEventListener('scroll', onScroll, true);
    return ctl;
  }

  // Replace a <select>'s look with a button + custom menu.
  function enhanceSelect(sel, { align } = {}) {
    let wrap = sel.closest('.chip-select, .group-pick') || sel.parentElement;
    if (wrap.tagName === 'LABEL') {
      // a <label> would forward clicks to the hidden select; use a div instead
      const div = document.createElement('div');
      for (const a of wrap.attributes) div.setAttribute(a.name, a.value);
      while (wrap.firstChild) div.appendChild(wrap.firstChild);
      wrap.replaceWith(div);
      wrap = div;
    }
    wrap.classList.add('dd-wrap');
    sel.classList.add('dd-native');
    sel.tabIndex = -1;
    sel.setAttribute('aria-hidden', 'true');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dd-trigger';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', sel.getAttribute('aria-label') || sel.dataset.title || '');
    btn.innerHTML = `<span class="dd-value"></span>${CARET}`;
    sel.after(btn);

    const refresh = () => {
      const o = sel.options[sel.selectedIndex];
      btn.querySelector('.dd-value').textContent = o ? o.text : '';
    };
    // keep the label in sync when code sets select.value directly
    const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(sel, 'value', { configurable: true, get() { return proto.get.call(this); }, set(v) { proto.set.call(this, v); refresh(); } });
    sel.addEventListener('change', refresh);
    refresh();

    let ctl = null;
    const show = () => {
      ctl = open({
        anchor: wrap, align, title: sel.dataset.title, selected: sel.value,
        items: [...sel.options].map(o => ({ value: o.value, label: o.text, desc: o.dataset.desc })),
        onPick: v => {
          if (v !== sel.value) { sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); }
          btn.focus();
        },
        onClose: () => { wrap.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); ctl = null; },
      });
      wrap.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
    };
    wrap.addEventListener('click', e => {
      if (e.target.closest('.dd-menu')) return;
      if (ctl && ctl.isOpen) ctl.close(); else { show(); btn.focus(); }
    });
    btn.addEventListener('keydown', e => {
      if (ctl && ctl.isOpen) { if (ctl.key(e)) e.preventDefault(); return; }
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(); }
    });
    return { refresh };
  }

  // Text input with a filterable suggestions menu (used for the folder picker).
  function combo(input, { title, getItems, empty, align, onPick }) {
    const anchor = input.closest('.chip-select') || input;
    let ctl = null;
    const items = () => getItems(input.value.trim());
    const show = () => {
      const list = items();
      if (ctl && ctl.isOpen) { ctl.setItems(list); return; }
      ctl = open({
        anchor, title, align, items: list, selected: input.value, empty,
        onPick: v => { input.value = v; if (onPick) onPick(v); },
        onClose: () => { anchor.classList.remove('open'); ctl = null; },
      });
      anchor.classList.add('open');
    };
    input.addEventListener('focus', show);
    input.addEventListener('click', () => { if (!ctl) show(); });
    input.addEventListener('input', show);
    input.addEventListener('blur', () => setTimeout(() => { if (ctl && document.activeElement !== input) ctl.close(); }, 120));
    input.addEventListener('keydown', e => {
      // Enter here must never submit the surrounding form
      if (e.key === 'Enter') e.preventDefault();
      if (ctl && ctl.isOpen) { if (ctl.key(e)) e.preventDefault(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); show(); }
      else if (e.key === 'Enter' && onPick) onPick(input.value);
    });
  }

  return { open, enhanceSelect, combo };
})();

Dropdown.enhanceSelect(document.getElementById('group-by'), { align: 'end' });
Dropdown.enhanceSelect(document.getElementById('sort-by'), { align: 'end' });
Dropdown.enhanceSelect(document.getElementById('perm-mode'));
Dropdown.enhanceSelect(document.getElementById('model'), { align: 'end' });

const FOLDER_ICON = '<svg viewBox="0 0 20 20" width="15" height="15"><path d="M2.5 6a1.5 1.5 0 0 1 1.5-1.5h3.6l1.6 1.8H16A1.5 1.5 0 0 1 17.5 7.8v6.7A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
Dropdown.combo(document.getElementById('cwd-input'), {
  title: 'Recent folders',
  empty: 'No matching folders: press Enter to use this path',
  getItems: q => {
    const dirs = typeof state !== 'undefined' ? state.dirs : [];
    const homeDir = typeof state !== 'undefined' ? state.home : '';
    const short = p => (homeDir && p.startsWith(homeDir) ? '~' + p.slice(homeDir.length) : p);
    const ql = q.toLowerCase();
    return dirs
      .filter(d => !ql || d.toLowerCase().includes(ql) || short(d).toLowerCase().includes(ql))
      .slice(0, 40)
      .map(d => ({ value: d, label: d.split('/').filter(Boolean).pop() || '/', desc: short(d), icon: FOLDER_ICON }));
  },
  onPick: () => document.getElementById('input').focus(),
});
