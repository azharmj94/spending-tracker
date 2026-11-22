(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null) e.setAttribute(k, v);
    }
    kids.flat().forEach((k) => k != null && e.append(k));
    return e;
  };
  const RM = (v, d = 2) => 'RM ' + Number(v || 0).toLocaleString('en-MY', { minimumFractionDigits: d, maximumFractionDigits: d });
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mLabel = (m) => MON[+m.slice(5) - 1] + ' ' + m.slice(2, 4);
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const tok = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* Line icons (lucide shapes), one size and stroke everywhere */
  const ICONS = {
    utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>',
    fuel: '<path d="M3 22h12"/><path d="M4 9h10"/><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0V9.83a2 2 0 0 0-.59-1.42L18 5"/>',
    house: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .71-1.53l7-6a2 2 0 0 1 2.58 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z"/>',
    bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    up: '<path d="m18 15-6-6-6 6"/>', down: '<path d="m6 9 6 6 6-6"/>'
  };
  const ico = (name) => { const s = document.createElement('span'); s.className = 'icw'; s.innerHTML = `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`; return s; };
  const DEFAULT_CATS = ['Groceries', 'Food & dining', 'Fuel & transport', 'Bills & subscriptions', 'Shopping & clothing', 'Hardware & home', 'Family', 'Health', 'Travel & leisure', 'E-wallet top-up', 'Instalments & BNPL', 'Interest & fees', 'Debt payments', 'Other'];
  const NOT_SPENDING = new Set(['Debt payments']);
  const GROUPS = [
    { name: 'Food & groceries', icon: 'utensils', cats: ['Groceries', 'Food & dining'] },
    { name: 'Transport', icon: 'fuel', cats: ['Fuel & transport'] },
    { name: 'Bills & home', icon: 'house', cats: ['Bills & subscriptions', 'Hardware & home'] },
    { name: 'Family & health', icon: 'heart', cats: ['Family', 'Health'] },
    { name: 'Shopping & other', icon: 'bag', cats: ['Shopping & clothing', 'Travel & leisure', 'E-wallet top-up', 'Other'] },
    { name: 'Debt & charges', icon: 'card', cats: ['Instalments & BNPL', 'Interest & fees', 'Debt payments'] }];
  const groupOf = (c) => (GROUPS.find((g) => g.cats.includes(c)) || GROUPS[4]).name;
  const DISCRETIONARY = new Set(['Food & dining', 'Shopping & clothing', 'Travel & leisure', 'E-wallet top-up', 'Hardware & home']);

  const S = { store: null, months: {}, debts: [], cats: DEFAULT_CATS.slice(), cur: null, view: 'month', open: {} };

  /* ---------- persistence: one write at a time per document ---------- */
  const queue = {};
  function persist(id, data) {
    const q = queue[id] || (queue[id] = { busy: false, next: null, t: null });
    q.next = JSON.parse(JSON.stringify(data));
    clearTimeout(q.t);
    q.t = setTimeout(() => flush(id), 500);
  }
  async function flush(id) {
    const q = queue[id]; if (!q || q.busy || !q.next) return;
    const data = q.next; q.next = null; q.busy = true;
    try { await S.store.save(id, data); } catch (e) { toast('Could not save. Check your connection.'); console.error(e); }
    q.busy = false; if (q.next) flush(id);
  }
  const saveMonth = (m) => { markLogged(); persist('m_' + m, S.months[m]); };

  /* ---------- 8-hourly reminder to log spending ---------- */
  const REMIND_MS = 8 * 3600 * 1000, LOG_KEY = 'ft-last-logged', REM_KEY = 'ft-last-reminded';
  const storeGet = (k) => { try { return +localStorage.getItem(k) || 0; } catch (e) { return 0; } };
  const storeSet = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (e) { /* storage blocked */ } };
  function markLogged() { storeSet(LOG_KEY, Date.now()); }
  const remindersSupported = () => 'Notification' in window && 'serviceWorker' in navigator;
  async function showReminder() {
    const body = 'It has been 8 hours since your last entry. Add any spending you have made since then.';
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) { await reg.showNotification('Log your spending', { body, tag: 'ft-reminder', icon: 'icon-192.png', badge: 'icon-192.png', data: { url: './#month' } }); return; }
    } catch (e) { /* fall through */ }
    new Notification('Log your spending', { body, tag: 'ft-reminder', icon: 'icon-192.png' });
  }
  function checkReminder() {
    if (!remindersSupported() || Notification.permission !== 'granted' || !storeGet('ft-reminders-on')) return;
    const now = Date.now(), last = storeGet(LOG_KEY) || now;
    if (!storeGet(LOG_KEY)) storeSet(LOG_KEY, now);
    if (now - last >= REMIND_MS && now - storeGet(REM_KEY) >= REMIND_MS) { storeSet(REM_KEY, now); showReminder(); }
  }
  function renderReminderCard() {
    const st = $('#remStatus'), btn = $('#remBtn'); if (!st || !btn) return;
    if (!remindersSupported()) { st.textContent = 'Reminders need the app opened from your own https address, on a browser that supports notifications.'; btn.hidden = true; return; }
    const on = Notification.permission === 'granted' && storeGet('ft-reminders-on');
    btn.hidden = false; btn.textContent = on ? 'Turn reminders off' : 'Turn on reminders';
    st.textContent = Notification.permission === 'denied' ? 'Notifications are blocked. Allow them in your browser settings for this site.'
      : on ? 'On. You will be reminded if 8 hours pass without an entry.' : 'Get a reminder every 8 hours if you have not logged any spending.';
  }
  $('#remBtn').addEventListener('click', async () => {
    if (!remindersSupported()) return;
    if (storeGet('ft-reminders-on')) { storeSet('ft-reminders-on', 0); renderReminderCard(); toast('Reminders off'); return; }
    const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (p !== 'granted') { renderReminderCard(); toast('Notifications were not allowed'); return; }
    storeSet('ft-reminders-on', 1); if (!storeGet(LOG_KEY)) markLogged(); renderReminderCard(); toast('Reminders on'); checkReminder();
  });
  setInterval(checkReminder, 30 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkReminder(); });
  renderReminderCard(); checkReminder();
  const saveDebts = () => persist('debts', { list: S.debts });

  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2200); }

  /* ---------- data helpers ---------- */
  function ensureMonth(m) {
    if (!S.months[m]) { S.months[m] = { month: m, income: null, incomeNote: '', items: [], planned: [] }; }
    return S.months[m];
  }
  const monthKeys = () => Object.keys(S.months).sort();
  function totals(m) {
    const M = S.months[m] || { items: [], planned: [] };
    const spent = M.items.filter((i) => !NOT_SPENDING.has(i.category)).reduce((a, i) => a + i.amount, 0);
    const debt = M.items.filter((i) => NOT_SPENDING.has(i.category)).reduce((a, i) => a + i.amount, 0);
    const planned = M.planned.reduce((a, i) => a + i.amount, 0);
    return { spent, debt, planned, income: M.income || 0, left: (M.income || 0) - spent - debt - planned };
  }
  function guessCat(desc) {
    const u = desc.toUpperCase();
    const rules = [['Debt payments', ['PAYMENT', 'FIN RPY', 'BAYARAN']], ['Interest & fees', ['FINANCE CHARGE', 'PROFIT', 'FEE', 'TA\'WIDH', 'LATE']], ['Instalments & BNPL', ['INSTL', 'FLEXI', 'CASHLITE', 'SPAYLATER', 'ATOME']],
      ['E-wallet top-up', ['TNG', 'TOUCH N GO', 'BOOST', 'SHOPEEPAY', 'GRABPAY']], ['Fuel & transport', ['PETRON', 'PETRONAS', 'SHELL', 'CALTEX', 'BHP', 'TOLL', 'PARKING', 'GRAB']],
      ['Groceries', ['LOTUS', 'AEON BIG', 'GIANT', 'MYDIN', 'SPEEDMART', '7-ELEVEN', 'FAMILYMART', 'ECONSAVE', 'SUPERMART', 'HERO']], ['Hardware & home', ['MR DIY', 'MR D.I.Y', 'HARDWARE', 'NINSO', 'IKEA', 'ECO-SHOP']],
      ['Food & dining', ['RESTORAN', 'CAFE', 'KOPI', 'MCD', 'KFC', 'BREAD', 'BAKERY', 'NASI', 'MARRYBROWN', 'TEALIVE', 'ZUS', 'FOOD', 'AYAM', 'GORENG', 'MEE', 'ROTI', 'TEH', 'MAKAN', 'SATAY', 'BURGER', 'PIZZA', 'LUNCH', 'DINNER', 'BREAKFAST', 'KEDAI MAKAN', 'WARUNG']], ['Shopping & clothing', ['SHOPEE', 'LAZADA', 'ZALORA', 'UNIQLO', 'FIFFY', 'PADINI']],
      ['Bills & subscriptions', ['TNB', 'UNIFI', 'MAXIS', 'CELCOM', 'DIGI', 'YTL', 'ASTRO', 'NETFLIX', 'SPOTIFY', 'APPLE', 'GOOGLE']], ['Health', ['PHARMACY', 'FARMASI', 'CLINIC', 'KLINIK', 'GUARDIAN', 'WATSON', 'PANADOL', 'UBAT', 'VITAMIN']], ['Travel & leisure', ['AGODA', 'AIRASIA', 'LEGOLAND', 'HOTEL']]];
    for (const [c, ks] of rules) if (ks.some((k) => u.includes(k))) return c;
    return 'Other';
  }

  /* ---------- rendering ---------- */
  function renderMonths() {
    const box = $('#months'); box.replaceChildren();
    monthKeys().forEach((m) => box.append(el('button', { class: 'mbtn' + (m === S.cur ? ' on' : ''), text: mLabel(m), onclick: () => { S.cur = m; render(); } })));
    const next = (() => { const ks = monthKeys(); const last = ks[ks.length - 1] || new Date().toISOString().slice(0, 7); const [y, mo] = last.split('-').map(Number); const d = new Date(Date.UTC(y, mo, 1)); return d.toISOString().slice(0, 7); })();
    box.append(el('button', { class: 'mbtn', text: '+ ' + mLabel(next), onclick: () => { ensureMonth(next); S.cur = next; saveMonth(next); render(); } }));
    requestAnimationFrame(() => { const on = $('.mbtn.on', box); if (on) on.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' }); });
  }

  function countTo(node, v, cls) {
    node.className = 'v ' + (cls || '');
    if (reduceMotion()) { node.textContent = RM(v, 0); return; }
    const t0 = performance.now(); const from = node._v || 0; node._v = v;
    const step = (t) => { const p = Math.min(1, (t - t0) / 700), e = 1 - Math.pow(1 - p, 3); node.textContent = RM(from + (v - from) * e, 0); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  function renderMonthView() {
    const M = ensureMonth(S.cur); const T = totals(S.cur);
    const inc = $('#incomeIn'); if (document.activeElement !== inc) inc.value = M.income != null ? M.income.toFixed(2) : '';
    $('#incomeNote').textContent = M.incomeNote || 'Type your take-home pay';
    countTo($('#sSpent'), T.spent);
    countTo($('#sDebt'), T.debt, 'warn');
    countTo($('#sLeft'), T.left, T.left < 0 ? 'bad' : 'ok');
    const used = T.income ? (T.spent + T.debt + T.planned) / T.income : 0;
    const bar = $('#useBar'); bar.classList.toggle('over', used > 1); requestAnimationFrame(() => { bar.style.width = Math.min(100, used * 100) + '%'; });
    $('#useTxt').textContent = T.income ? `${Math.round(used * 100)}% of income used, including RM ${Math.round(T.planned).toLocaleString()} still planned` : 'Add income to see how much is left.';

    const box = $('#buckets'); box.replaceChildren();
    const total = sum(M.items) || 1;
    const k = (v) => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v).toString();
    const grid = el('div', { class: 'gtiles', role: 'tablist' });
    GROUPS.forEach((g) => {
      const list = M.items.filter((i) => groupOf(i.category) === g.name); const gsum = sum(list); const on = S.openGroup === g.name;
      const pct = Math.round(gsum / total * 100);
      grid.append(el('button', { type: 'button', role: 'tab', class: 'gtile' + (on ? ' on' : '') + (gsum ? '' : ' zero') + (g.name === 'Debt & charges' ? ' debtg' : ''),
        'aria-label': `${g.name}: ${RM(gsum, 0)}`, 'aria-selected': on ? 'true' : 'false', title: g.name,
        onclick: () => { S.openGroup = on ? null : g.name; S.subFilter = null; renderMonthView(); } },
        el('span', { class: 'gti' }, ico(g.icon)), el('span', { class: 'gta', text: k(gsum) }),
        el('span', { class: 'gtb' }, el('i', { style: `width:${pct}%` }))));
    });
    box.append(grid);
    const g = GROUPS.find((x) => x.name === S.openGroup);
    if (!g) { box.append(el('div', { class: 'empty', style: 'text-align:center', text: 'Tap an icon to see its expenses.' })); return; }
    const list = M.items.filter((i) => groupOf(i.category) === g.name); const gsum = sum(list);
    const subs = g.cats.map((c) => ({ c, l: list.filter((i) => i.category === c) })).filter(({ l }) => l.length);
    const shown = (S.subFilter ? list.filter((i) => i.category === S.subFilter) : list).slice().sort((x, y) => y.amount - x.amount);
    const key = S.cur + g.name + (S.subFilter || ''); const all = S.open[key];
    const pick = S.pick || null; if (pick) { const ids = new Set(list.map((i) => i.id)); [...pick].forEach((id) => { if (!ids.has(id)) pick.delete(id); }); }
    const vis = all || pick ? shown : shown.slice(0, 8);
    const panel = el('div', { class: 'gpanel' },
      el('div', { class: 'gph' }, el('span', { class: 'gpn' }, ico(g.icon), g.name), el('span', { class: 'gpr' }, el('b', { text: RM(gsum, 0) }),
        list.length ? el('button', { type: 'button', class: 'trayx', text: pick ? 'Done' : 'Select', onclick: () => { S.pick = pick ? null : new Set(); S.bulkArm = false; renderMonthView(); } }) : null)),
      pick ? bulkBar(M, shown, pick) : null,
      subs.length > 1 ? el('div', { class: 'subs' },
        el('button', { type: 'button', class: 'spill' + (!S.subFilter ? ' on' : ''), text: 'All', onclick: () => { S.subFilter = null; renderMonthView(); } }),
        subs.map(({ c, l }) => el('button', { type: 'button', class: 'spill' + (S.subFilter === c ? ' on' : ''), text: `${c} · ${k(sum(l))}`, onclick: () => { S.subFilter = c; renderMonthView(); } }))) : null,
      el('div', { class: 'glist' }, vis.map((i) => el('button', { type: 'button', class: 'grow' + (pick && pick.has(i.id) ? ' picked' : ''), 'aria-pressed': pick ? String(pick.has(i.id)) : null,
        onclick: () => { if (!pick) { openEdit('item', i.id); return; } if (pick.has(i.id)) pick.delete(i.id); else pick.add(i.id); S.bulkArm = false; renderMonthView(); } },
        pick ? el('span', { class: 'pk', 'aria-hidden': 'true', text: pick.has(i.id) ? '✓' : '' }) : null,
        el('span', { class: 'gd' }, el('span', { text: i.desc }), el('span', { class: 'gsub', text: `${+i.date.slice(8)} ${MON[+i.date.slice(5, 7) - 1]} · ${i.category}` })), el('b', { text: RM(i.amount, 2) }))),
        shown.length ? null : el('div', { class: 'empty', text: 'Nothing here this month.' })),
      shown.length > 8 && !pick ? el('button', { class: 'more', type: 'button', text: all ? 'Show less' : `Show all ${shown.length}`, onclick: () => { S.open[key] = !all; renderMonthView(); } }) : null);
    box.append(panel);
  }
  const sum = (l) => l.reduce((a, i) => a + i.amount, 0);
  // Bulk actions on the ticked expenses: move to a category (one pick) or delete (tap twice).
  function bulkBar(M, shown, pick) {
    const n = pick.size; const chosen = () => M.items.filter((i) => pick.has(i.id));
    const allOn = shown.length > 0 && shown.every((i) => pick.has(i.id));
    const mv = catSelect(null); mv.prepend(new Option(n ? `Move ${n} to…` : 'Move to…', '', true, true)); mv.disabled = !n; mv.setAttribute('aria-label', 'Move selected to category');
    mv.onchange = () => { if (!mv.value) return; const l = chosen(); l.forEach((i) => { i.category = mv.value; }); saveMonth(S.cur); S.pick = new Set(); S.bulkArm = false; toast(`Moved ${l.length} to ${mv.value}`); render(); };
    const del = el('button', { type: 'button', class: 'btn danger', text: S.bulkArm && n ? `Tap again: delete ${n}` : 'Delete', disabled: n ? null : '', onclick: () => {
      if (!S.bulkArm) { S.bulkArm = true; clearTimeout(S.bulkT); S.bulkT = setTimeout(() => { if (S.bulkArm) { S.bulkArm = false; if (S.view === 'month') renderMonthView(); } }, 4000); renderMonthView(); return; }
      const l = chosen(); M.items = M.items.filter((i) => !pick.has(i.id)); saveMonth(S.cur); S.pick = new Set(); S.bulkArm = false; toast(`Deleted ${l.length} · ${RM(sum(l), 2)}`); render();
    } });
    return el('div', { class: 'bulk' },
      el('div', { class: 'bulkhd' }, el('span', { text: n ? `${n} selected · ${RM(sum(chosen()), 2)}` : 'Tap expenses to select them' }),
        el('button', { type: 'button', class: 'trayx', text: allOn ? 'None' : 'All', onclick: () => { if (allOn) pick.clear(); else shown.forEach((i) => pick.add(i.id)); S.bulkArm = false; renderMonthView(); } })),
      el('div', { class: 'row' }, mv, del));
  }

  function chip(i, kind) {
    const drg = kind === 'planned' ? { 'data-drag': kind + ':' + i.id } : {};
    const c = el('div', { class: 'chip' + (kind === 'planned' ? ' planned' : ' cat') + (S.sel === i.id ? ' selected' : ''), ...drg, title: i.desc + (i.date ? ' · ' + i.date : '') },
      el('span', { class: 't', text: i.desc }), el('b', { text: Math.round(i.amount).toLocaleString() }));
    c.addEventListener('click', () => {
      if (drag.justDropped) return;
      if (kind === 'planned' && !i.date && S.view === 'cal') { S.sel = S.sel === i.id ? null : i.id; renderCalendar(); return; }
      openEdit(kind, i.id);
    });
    return c;
  }

  function renderCalendar() {
    const M = ensureMonth(S.cur);
    if (S.sel && !M.planned.some((p) => p.id === S.sel && !p.date)) S.sel = null;
    const pool = $('#pool'); pool.replaceChildren();
    const floating = M.planned.filter((p) => !p.date);
    floating.forEach((p) => pool.append(chip(p, 'planned')));
    if (!floating.length) pool.append(el('span', { class: 'empty', text: 'Nothing floating. Add an expense with no date on the Month tab.' }));
    $('#poolTotal').textContent = RM(sum(floating), 0);
    $('#cancelSel').hidden = !S.sel;
    const selP = S.sel && M.planned.find((p) => p.id === S.sel);
    $('#calHint').textContent = selP ? `Now tap a day for “${selP.desc}”` : 'Drag a floating expense up onto a day, or tap it then tap a day. Tap a day to edit, move (⠿) or delete its items.';
    $('#calTitle').textContent = mLabel(S.cur).replace(' ', " '");
    const cal = $('#cal'); cal.replaceChildren(); cal.classList.toggle('placing', !!S.sel);
    ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach((d) => cal.append(el('div', { class: 'dow', text: d })));
    const [y, mo] = S.cur.split('-').map(Number);
    const first = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay(); const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    for (let k = 0; k < (first + 6) % 7; k++) cal.append(el('div', { class: 'day blank' }));
    const spentBy = {}; M.items.forEach((i) => { spentBy[i.date] = (spentBy[i.date] || 0) + i.amount; });
    const maxSpent = Math.max(1, ...Object.values(spentBy));
    const today = new Date().toISOString().slice(0, 10);
    if (!S.day || S.day.slice(0, 7) !== S.cur) S.day = today.slice(0, 7) === S.cur ? today : null;
    for (let d = 1; d <= days; d++) {
      const ds = `${S.cur}-${String(d).padStart(2, '0')}`;
      const pl = M.planned.filter((p) => p.date === ds);
      const due = sum(pl);
      const cell = el('div', { class: 'day' + (ds === today ? ' today' : '') + (ds === S.day ? ' sel' : ''), 'data-drop': 'day:' + ds, role: 'button', 'aria-label': `${d} ${MON[mo - 1]}` + (due ? `, RM ${Math.round(due)} planned` : '') },
        el('span', { class: 'n', text: d }), due ? el('span', { class: 'amt', text: due >= 1000 ? (due / 1000).toFixed(1) + 'k' : Math.round(due) }) : null);
      if (pl.length) cell.append(el('span', { class: 'dots' }, pl.slice(0, 4).map(() => el('i'))));
      if (spentBy[ds]) { const h = el('i', { class: 'heat' }); h.style.opacity = 0.25 + 0.75 * spentBy[ds] / maxSpent; cell.append(h); }
      cell.addEventListener('click', () => {
        if (drag.justDropped) return;
        if (S.sel) { drop('planned:' + S.sel, 'day:' + ds); S.sel = null; S.day = ds; renderCalendar(); return; }
        S.day = ds; renderCalendar();
      });
      cell.style.setProperty('--i', d); cal.append(cell);
    }
    const dp = $('#dayPanel'); dp.replaceChildren();
    if (!S.day) { dp.append(el('div', { class: 'empty', text: 'Tap a day to see what is planned and spent.' })); return; }
    const pl = M.planned.filter((p) => p.date === S.day); const sp = M.items.filter((i) => i.date === S.day);
    dp.append(el('div', { class: 'muted', style: 'margin:0 2px 2px', text: `${+S.day.slice(8)} ${MON[+S.day.slice(5, 7) - 1]} · planned ${RM(sum(pl), 0)} · spent ${RM(sum(sp), 0)}` }));
    const del = (kind, it) => () => {
      if (!confirmDel(it)) return;
      if (kind === 'item') M.items = M.items.filter((x) => x !== it); else M.planned = M.planned.filter((x) => x !== it);
      saveMonth(S.cur); toast('Deleted'); renderCalendar();
    };
    pl.forEach((p) => dp.append(el('div', { class: 'dprow planrow', 'data-drag': 'planned:' + p.id, title: 'Drag to another day, or down to Floating' },
      el('span', { class: 'handle', 'aria-hidden': 'true', text: '⠿' }),
      el('span', { class: 'dptxt', text: `${p.desc} · ${RM(p.amount, 0)}` }),
      el('span', { class: 'acts' }, el('button', { text: 'Edit', onclick: () => openEdit('planned', p.id) }), el('button', { text: 'Paid', onclick: () => markPaid(p) }), el('button', { class: 'x', text: 'Delete', onclick: del('planned', p) })))));
    sp.forEach((i) => dp.append(el('div', { class: 'dprow spentrow' }, el('span', { class: 'handle off', text: '✓' }), el('span', { class: 'dptxt', text: `${i.desc} · ${RM(i.amount, 0)}` }),
      el('span', { class: 'acts' }, el('button', { text: 'Edit', onclick: () => openEdit('item', i.id) }), el('button', { class: 'x', text: 'Delete', onclick: del('item', i) })))));
    if (!pl.length && !sp.length) dp.append(el('div', { class: 'empty', text: 'Nothing on this day.' }));
  }
  function confirmDel(it) {
    if (S.armed === it) { S.armed = null; return true; }
    S.armed = it; toast('Tap Delete again to confirm'); setTimeout(() => { if (S.armed === it) S.armed = null; }, 3000); return false;
  }
  function markPaid(p) {
    const M = ensureMonth(S.cur); M.planned = M.planned.filter((x) => x !== p);
    M.items.push({ id: uid('t'), date: p.date || new Date().toISOString().slice(0, 10), desc: p.desc, amount: p.amount, category: p.category, account: 'Manual' });
    saveMonth(S.cur); toast('Marked as paid'); render();
  }

  function renderDebts() {
    const box = $('#debts'); box.replaceChildren();
    S.debts.forEach((d, i) => {
      const mv = (dir) => (e) => { e.stopPropagation(); const j = i + dir; if (j < 0 || j >= S.debts.length) return; [S.debts[i], S.debts[j]] = [S.debts[j], S.debts[i]]; saveDebts(); renderDebts(); };
      box.append(el('div', { class: 'debt' + (/arrears/i.test(d.name + d.note) ? ' arrears' : ''), 'data-debt': d.id, onclick: () => openDebtEdit(d.id) },
        el('div', { class: 'rank', text: i + 1 }),
        el('div', { class: 'nm' }, el('div', { text: d.name }), el('div', { text: d.note || '' })),
        el('div', { class: 'amt' }, el('div', { text: d.balance != null ? RM(d.balance, 0) : 'Balance ?' }), el('div', { text: RM(d.monthly, 0) + '/mo' })),
        el('span', { class: 'mv' }, el('button', { 'aria-label': 'Move up', disabled: i === 0 ? '' : null, onclick: mv(-1) }, ico('up')), el('button', { 'aria-label': 'Move down', disabled: i === S.debts.length - 1 ? '' : null, onclick: mv(1) }, ico('down')))));
    });
    $('#debtTotal').textContent = RM(S.debts.reduce((a, d) => a + (d.balance || 0), 0), 0);
    box.append(el('button', { class: 'btn ghostbtn', text: '+ Add debt', style: 'margin-top:6px', onclick: () => openDebtEdit(null) }));
  }

  /* ---------- money profile (radar) ---------- */
  function profile() {
    const ks = monthKeys().filter((m) => S.months[m].items.length > 1 && S.months[m].income);
    const clamp = (v) => Math.max(0, Math.min(5, v));
    let inc = 0, out = 0, interest = 0, bnpl = 0, disc = 0;
    ks.forEach((m) => {
      const M = S.months[m]; inc += M.income;
      M.items.forEach((i) => {
        if (!NOT_SPENDING.has(i.category)) out += i.amount;
        if (i.category === 'Interest & fees') interest += i.amount;
        if (i.category === 'Instalments & BNPL') bnpl += i.amount;
        if (DISCRETIONARY.has(i.category)) disc += i.amount;
      });
    });
    const debtTotal = S.debts.reduce((a, d) => a + (d.balance || 0), 0);
    const avgInc = ks.length ? inc / ks.length : 0;
    const arrears = S.debts.some((d) => /arrears|overdue/i.test(d.name + ' ' + (d.note || '')));
    const pct = (x) => (inc ? x / inc : 0);
    const surplus = inc ? (inc - out) / inc : 0;
    const dti = avgInc ? debtTotal / avgInc : 0;
    const m = [
      { k: 'Cash flow', s: clamp(2.5 + surplus * 12.5), why: `${surplus >= 0 ? 'Kept' : 'Overspent by'} ${Math.abs(Math.round(surplus * 100))}% of income (spending incl. card purchases and commitments, before debt payments)` },
      { k: 'Debt load', s: clamp(5 - (dti - 1) * 1.25), why: `Debts are ${dti.toFixed(1)}× a month's take-home pay` },
      { k: 'On-time payments', short: 'On time', s: arrears ? 1 : 5, why: arrears ? 'At least one debt is in arrears' : 'No debt in arrears' },
      { k: 'Spending control', short: 'Control', s: clamp(5 - pct(disc) * 20), why: `Eating out, shopping, leisure and e-wallet top-ups take ${Math.round(pct(disc) * 100)}% of income` },
      { k: 'Interest cost', short: 'Interest', s: clamp(5 - pct(interest) * 125), why: `Interest and fees eat ${(pct(interest) * 100).toFixed(1)}% of income` },
      { k: 'Buy-now-pay-later', short: 'BNPL', s: clamp(5 - pct(bnpl) * 25), why: `Instalments and BNPL take ${Math.round(pct(bnpl) * 100)}% of income` }
    ];
    const avg = m.reduce((a, x) => a + x.s, 0) / m.length;
    const worst = m.slice().sort((a, b) => a.s - b.s)[0]; const best = m.slice().sort((a, b) => b.s - a.s)[0];
    let type, desc;
    if (avg >= 3.8) { type = 'The Steady Saver'; desc = 'Your money habits are healthy. Keep building your buffer and investing the surplus.'; }
    else if (avg >= 2.8) { type = 'The Balanced Spender'; desc = 'Mostly in control, with one or two weak spots to tighten.'; }
    else if (avg >= 1.8) { type = 'The Stretched Juggler'; desc = 'Income is decent, but debts and instalments are juggling the month. Small, consistent cuts will tip the balance.'; }
    else { type = 'The Debt Firefighter'; desc = 'Most of the month goes to putting out debt fires. Stop new borrowing first, then attack one debt at a time.'; }
    desc += ` Strongest: ${best.k}. Weakest: ${worst.k}.`;
    return { m, avg, type, desc, months: ks.length };
  }

  function renderProfile() {
    const P = profile();
    $('#ptype').textContent = P.type; $('#pdesc').textContent = P.desc;
    $('#profScope').textContent = P.months + ' months · avg ' + P.avg.toFixed(1) + '/5';
    const box = $('#radar'); box.replaceChildren();
    const W = Math.min(box.clientWidth || 340, 520), H = W * 0.92, cx = W / 2, cy = H / 2 + 8, R = Math.min(W, H) / 2 - (W < 420 ? 62 : 56);
    const ns = 'http://www.w3.org/2000/svg'; const sv = (t, a) => { const e = document.createElementNS(ns, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', class: 'radar', role: 'img', 'aria-label': 'Money profile radar chart' });
    const n = P.m.length, ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n, pt = (i, v) => [cx + Math.cos(ang(i)) * R * v / 5, cy + Math.sin(ang(i)) * R * v / 5];
    for (let lv = 1; lv <= 5; lv++) svg.append(sv('polygon', { points: P.m.map((_, i) => pt(i, lv).join(',')).join(' '), fill: 'none', stroke: tok('--line'), 'stroke-dasharray': '4 4' }));
    P.m.forEach((x, i) => { const [x2, y2] = pt(i, 5); svg.append(sv('line', { x1: cx, y1: cy, x2, y2, stroke: tok('--line'), 'stroke-dasharray': '4 4' })); });
    [1, 2, 3, 4, 5].forEach((v) => { const [x, y] = pt(0, v); const t = sv('text', { x: x + 6, y: y + 4, class: 'tick' }); t.textContent = v; svg.append(t); });
    const poly = sv('polygon', { points: P.m.map((x, i) => pt(i, Math.max(.15, x.s)).join(',')).join(' '), fill: tok('--glow'), stroke: tok('--accent'), 'stroke-width': 2, 'stroke-linejoin': 'round' });
    svg.append(poly);
    P.m.forEach((x, i) => {
      const [px, py] = pt(i, Math.max(.15, x.s)); svg.append(sv('circle', { cx: px, cy: py, r: 6, fill: tok('--panel'), stroke: tok('--accent'), 'stroke-width': 2 }));
      const [lx, ly] = pt(i, 6.05); const a = Math.cos(ang(i)); const t = sv('text', { x: lx, y: ly + 4, 'text-anchor': Math.abs(a) < .2 ? 'middle' : a > 0 ? 'start' : 'end' }); t.textContent = W < 420 ? (x.short || x.k) : x.k; svg.append(t);
    });
    box.append(svg);
    if (!reduceMotion()) {
      poly.style.transformOrigin = `${cx}px ${cy}px`; poly.animate([{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 900, easing: 'cubic-bezier(.2,.7,.2,1)' });
      $$('circle', svg).forEach((c, i) => c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: 600 + i * 70, fill: 'backwards' }));
    }
    const mb = $('#metrics'); mb.replaceChildren();
    P.m.forEach((x) => mb.append(el('div', { class: 'metric' }, el('div', {}, el('div', { text: x.k }), el('div', { class: 'why', text: x.why })),
      el('span', { class: 'score', text: x.s.toFixed(1) + '/5', style: `color:${x.s >= 3.5 ? 'var(--ok)' : x.s >= 2 ? 'var(--warn)' : 'var(--bad)'}` }))));
  }

  function render() {
    renderMonths();
    if (S.view === 'month') renderMonthView();
    if (S.view === 'cal') renderCalendar();
    if (S.view === 'profile') renderProfile();
    if (S.view === 'debts') renderDebts();
  }

  /* ---------- drag & drop (mouse + touch long-press) ---------- */
  const drag = { src: null, ghost: null, timer: null, start: null, active: false, hot: null, justDropped: false };
  function beginDrag(src, x, y) {
    drag.active = true; drag.src = src; src.classList.add('dragging');
    const g = src.cloneNode(true); g.classList.add('ghost'); g.classList.remove('dragging'); g.style.width = src.offsetWidth + 'px';
    document.body.append(g); drag.ghost = g; moveDrag(x, y);
    if (navigator.vibrate) try { navigator.vibrate(12); } catch (e) { /* not allowed */ }
  }
  function moveDrag(x, y) {
    drag.ghost.style.left = x + 'px'; drag.ghost.style.top = y + 'px';
    const under = document.elementFromPoint(x, y); const tgt = under && under.closest('[data-drop]');
    if (tgt !== drag.hot) { drag.hot && drag.hot.classList.remove('hot'); drag.hot = tgt; tgt && tgt.classList.add('hot'); }
    const edge = 70; if (y < edge) scrollBy(0, -12); else if (y > innerHeight - edge - 70) scrollBy(0, 12);
  }
  function endDrag() {
    clearTimeout(drag.timer); drag.timer = null;
    if (!drag.active) { drag.src && drag.src.classList.remove('press'); drag.src = null; return; }
    const src = drag.src, tgt = drag.hot;
    src.classList.remove('dragging'); drag.ghost.remove(); tgt && tgt.classList.remove('hot');
    drag.active = false; drag.src = null; drag.ghost = null; drag.hot = null;
    drag.justDropped = true; setTimeout(() => (drag.justDropped = false), 50);
    if (tgt) drop(src.dataset.drag, tgt.dataset.drop);
  }
  document.addEventListener('pointerdown', (e) => {
    const src = e.target.closest('[data-drag]'); if (!src || e.button > 0) return;
    if (e.target.closest('button')) return;
    drag.start = [e.clientX, e.clientY]; drag.src = src; drag.pointer = e.pointerType; drag.fromHandle = !!e.target.closest('.handle');
    if (e.pointerType !== 'mouse') { src.classList.add('press'); drag.timer = setTimeout(() => { src.classList.remove('press'); beginDrag(src, drag.start[0], drag.start[1]); }, 300); }
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag.src) return;
    if (drag.active) { moveDrag(e.clientX, e.clientY); return; }
    const dx = e.clientX - drag.start[0], dy = e.clientY - drag.start[1];
    if (drag.pointer === 'mouse' && Math.hypot(dx, dy) > 6) beginDrag(drag.src, e.clientX, e.clientY);
    else if (drag.pointer !== 'mouse' && drag.fromHandle && Math.hypot(dx, dy) > 6) { clearTimeout(drag.timer); drag.src.classList.remove('press'); beginDrag(drag.src, e.clientX, e.clientY); }
    else if (drag.pointer !== 'mouse' && !drag.src.classList.contains('planrow') && dy < -8 && Math.abs(dy) > Math.abs(dx) * 1.2) { clearTimeout(drag.timer); drag.src.classList.remove('press'); beginDrag(drag.src, e.clientX, e.clientY); }
    else if (drag.pointer !== 'mouse' && Math.hypot(dx, dy) > 10) { clearTimeout(drag.timer); drag.src.classList.remove('press'); drag.src = null; }
  });
  document.addEventListener('pointerup', () => endDrag());
  document.addEventListener('pointercancel', () => { if (!drag.active) endDrag(); });
  document.addEventListener('touchmove', (e) => { if (drag.active) { e.preventDefault(); const t = e.touches[0]; moveDrag(t.clientX, t.clientY); } }, { passive: false });
  document.addEventListener('touchend', () => { if (drag.active) endDrag(); });
  document.addEventListener('touchstart', (e) => { if (e.target.closest('[data-drag]') && drag.src) { /* keep */ } }, { passive: true });
  document.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-drag]')) e.preventDefault(); });

  function drop(srcKey, tgtKey) {
    const [kind, id] = srcKey.split(':'); const [tk, tv] = [tgtKey.slice(0, tgtKey.indexOf(':') < 0 ? tgtKey.length : tgtKey.indexOf(':')), tgtKey.slice(tgtKey.indexOf(':') + 1)];
    const M = ensureMonth(S.cur);
    if (kind === 'item' && tk === 'cat') {
      const it = M.items.find((i) => i.id === id); if (!it || it.category === tv) return;
      it.category = tv; saveMonth(S.cur); toast(`Moved to ${tv}`); render(); return;
    }
    if (kind === 'planned') {
      const p = M.planned.find((i) => i.id === id); if (!p) return;
      if (tk === 'day') { p.date = tv; S.day = tv; S.sel = null; toast(`Scheduled for ${+tv.slice(8)} ${MON[+tv.slice(5, 7) - 1]}`); }
      else if (tk === 'pool') { p.date = null; toast('Back to floating'); }
      else if (tk === 'cat') { p.category = tv; toast(`Moved to ${tv}`); }
      else return;
      saveMonth(S.cur); render(); return;
    }
    if (kind === 'debt' && tk === 'debt' && id !== tv) {
      const from = S.debts.findIndex((d) => d.id === id); const [d] = S.debts.splice(from, 1);
      const to = tv === '__end' ? S.debts.length : S.debts.findIndex((x) => x.id === tv);
      S.debts.splice(to, 0, d); saveDebts(); render();
    }
  }

  /* ---------- edit sheets ---------- */
  function sheet(title, body) {
    const sh = $('#sheet'); sh.replaceChildren(el('h3', { text: title }), ...body); $('#modal').classList.add('on');
    const first = $('input', sh); if (first) setTimeout(() => first.focus(), 50);
  }
  const closeSheet = () => $('#modal').classList.remove('on');
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeSheet(); });
  function fillCats(s, v) {
    s.replaceChildren();
    GROUPS.forEach((g) => { const og = el('optgroup', { label: g.name }); g.cats.forEach((c) => og.append(new Option(c, c, false, c === v))); s.append(og); });
    S.cats.filter((c) => !GROUPS.some((g) => g.cats.includes(c))).forEach((c) => s.append(new Option(c, c, false, c === v)));
    return s;
  }
  function catSelect(v) { return fillCats(el('select', { class: 'in' }), v); }

  function openEdit(kind, id) {
    const M = ensureMonth(S.cur); const list = kind === 'item' ? M.items : M.planned; const it = list.find((i) => i.id === id); if (!it) return;
    const d = el('input', { class: 'in', value: it.desc }); const a = el('input', { class: 'in', value: it.amount, inputmode: 'decimal' });
    const c = catSelect(it.category); const dt = el('input', { class: 'in', type: 'date', value: it.date || '' });
    const save = () => { it.desc = d.value.trim() || it.desc; it.amount = Math.abs(parseFloat(a.value) || it.amount); it.category = c.value; it.date = dt.value || (kind === 'item' ? it.date : null); saveMonth(S.cur); closeSheet(); render(); };
    const btns = [el('button', { class: 'btn', text: 'Save', onclick: save })];
    if (kind === 'planned') btns.push(el('button', { class: 'btn ghostbtn', text: 'Mark paid', onclick: () => { M.planned = M.planned.filter((x) => x !== it); M.items.push({ id: uid('t'), date: dt.value || new Date().toISOString().slice(0, 10), desc: d.value, amount: Math.abs(parseFloat(a.value) || it.amount), category: c.value, account: 'Manual' }); saveMonth(S.cur); closeSheet(); toast('Marked as paid'); render(); } }));
    btns.push(el('button', { class: 'btn danger', text: 'Delete', onclick: () => { if (kind === 'item') M.items = M.items.filter((x) => x !== it); else M.planned = M.planned.filter((x) => x !== it); saveMonth(S.cur); closeSheet(); render(); } }));
    sheet(kind === 'item' ? 'Edit expense' : 'Floating expense', [d, a, c, dt, el('div', { class: 'muted', text: it.account ? 'From: ' + it.account : '' }), el('div', { class: 'row', style: 'margin-top:8px' }, btns)]);
  }

  function openDebtEdit(id) {
    const dd = id ? S.debts.find((x) => x.id === id) : { id: uid('d'), name: '', balance: null, monthly: 0, note: '' };
    const n = el('input', { class: 'in', value: dd.name, placeholder: 'Name' }); const b = el('input', { class: 'in', value: dd.balance ?? '', placeholder: 'Balance (RM)', inputmode: 'decimal' });
    const mo = el('input', { class: 'in', value: dd.monthly || '', placeholder: 'Monthly payment (RM)', inputmode: 'decimal' }); const no = el('input', { class: 'in', value: dd.note || '', placeholder: 'Note' });
    const btns = [el('button', { class: 'btn', text: 'Save', onclick: () => { dd.name = n.value.trim() || 'Debt'; dd.balance = b.value === '' ? null : parseFloat(b.value); dd.monthly = parseFloat(mo.value) || 0; dd.note = no.value; if (!id) S.debts.push(dd); saveDebts(); closeSheet(); render(); } })];
    if (id) btns.push(el('button', { class: 'btn danger', text: 'Delete', onclick: () => { S.debts = S.debts.filter((x) => x !== dd); saveDebts(); closeSheet(); render(); } }));
    sheet(id ? 'Edit debt' : 'Add debt', [n, b, mo, no, el('div', { class: 'row', style: 'margin-top:8px' }, btns)]);
  }

  /* ---------- forms ---------- */
  $('#incomeIn').addEventListener('change', (e) => { const M = ensureMonth(S.cur); const v = parseFloat(e.target.value); M.income = isNaN(v) ? null : v; M.incomeNote = 'Entered by you'; saveMonth(S.cur); render(); });
  $('#addForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const desc = $('#aDesc').value.trim(); const amt = Math.abs(parseFloat($('#aAmt').value)); if (!desc || !amt) return;
    const date = $('#aDate').value; const m = date ? date.slice(0, 7) : S.cur; const M = ensureMonth(m);
    const rec = { id: uid(date ? 't' : 'p'), desc, amount: amt, category: $('#aCat').value, date: date || null };
    if (date) M.items.push({ ...rec, account: 'Manual' }); else M.planned.push(rec);
    saveMonth(m); e.target.reset(); catTouched = false; toast(date ? 'Added' : 'Added as floating expense: see Calendar'); render();
  });
  // Auto-pick the category from the description, until you choose one yourself.
  let catTouched = false;
  $('#aCat').addEventListener('change', () => { catTouched = true; });
  $('#aDesc').addEventListener('input', (e) => { if (catTouched) return; const g = guessCat(e.target.value); if (g !== 'Other') $('#aCat').value = g; });

  /* ---------- receipt scan ----------
   * 1. Inside Claude: Claude reads the photo.
   * 2. Anywhere else (or if Claude cannot be reached): an on-device text reader (Tesseract).
   *    It is loaded from vendor/ocr/ when those files sit beside the app, otherwise from the CDN once.
   * 3. If no reader can load: the check sheet opens with the photo so the details can be typed.
   */
  let sampler = null, samplerOff = false, scanCtl = null, lastPhoto = null;
  (async () => {
    try {
      if (!window.claude || typeof window.claude.use !== 'function') return;
      const s = await window.claude.use('sample'); if (!s) return;
      const lim = await s.limits().catch(() => null); if (!lim || !lim.images) return;
      sampler = s; $('#scanHelp').textContent = 'Claude reads the receipt, sorts each item into a category, and lets you check everything before it is added.';
    } catch (e) { /* Claude not available here: the on-device reader is used */ }
  })();
  async function toJpeg(file) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
      return blob || file;
    } catch (e) { return file; }
  }
  const scanBusy = (on, msg) => { $('#scanSt').hidden = !on; if (msg) $('#scanMsg').textContent = msg; $$('#scanBox input').forEach((i) => { i.disabled = on; }); };
  $('#scanStop').addEventListener('click', () => { if (scanCtl) scanCtl.abort(); });
  ['#scanCam', '#scanFile'].forEach((id) => $(id).addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) scanReceipt(f); }));

  async function claudeRead(img, signal) {
    const cats = S.cats.filter((c) => !NOT_SPENDING.has(c));
    const prompt = 'The image is a photo of a purchase receipt, most likely from Malaysia (amounts in RM, text in Malay or English). Read it and reply with only one JSON object in this shape:\n'
      + '{"merchant": string, "date": "YYYY-MM-DD" or null, "total": number, "category": string, "items": [{"desc": string, "amount": number, "category": string}]}\n'
      + 'Rules:\n- "items": every purchased line, with a short readable description (expand obvious abbreviations) and the final price of that line (quantity x unit price, after any line discount). Leave out subtotal, tax, service charge, rounding, payment and change lines.\n'
      + '- "total": the final amount paid, including tax, service charge and rounding.\n- "date": the purchase date printed on the receipt (Malaysian receipts print day before month), or null if none is visible.\n'
      + '- Every "category" must be exactly one of: ' + cats.map((c) => '"' + c + '"').join(', ') + '. Choose by what the item actually is (for example raw food and household consumables are Groceries, cooked meals and drinks are Food & dining, petrol and parking are Fuel & transport, medicine is Health). The top-level "category" is the one that best fits the receipt as a whole.\n'
      + '- If the image is not a receipt or cannot be read, reply {"error": "short reason"}.\nExample: {"merchant":"Kedai Makan Permas","date":"2026-11-14","total":18.5,"category":"Food & dining","items":[{"desc":"Ayam goreng","amount":12,"category":"Food & dining"},{"desc":"Teh ais","amount":6.5,"category":"Food & dining"}]}';
    const r = await sampler.json(prompt, { images: [img], signal });
    return r && typeof r === 'object' && !r.error ? r : null;
  }

  /* on-device reader */
  const OCR_LOCAL = 'vendor/ocr/';
  const OCR_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  let ocrOpts = null;
  const addScript = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => { s.remove(); rej(new Error('load ' + src)); }; document.head.append(s); });
  async function ocrReady() {
    if (ocrOpts) return ocrOpts;
    if (window.Tesseract) return (ocrOpts = window.__OCR_OPTS || {});
    try {
      await addScript(OCR_LOCAL + 'tesseract.min.js');
      const base = new URL(OCR_LOCAL, location.href).href;
      ocrOpts = { workerPath: base + 'worker.min.js', corePath: base.replace(/\/$/, ''), langPath: base.replace(/\/$/, '') };
    } catch (e) { await addScript(OCR_CDN); ocrOpts = {}; }
    return ocrOpts;
  }
  async function deviceRead(img, signal) {
    const stop = new Promise((_, rej) => signal.addEventListener('abort', () => rej({ code: 'cancelled' })));
    const limit = (p, ms) => Promise.race([p, stop, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
    const opts = await limit(ocrReady(), 30000);
    let worker = null;
    try {
      worker = await limit(window.Tesseract.createWorker('eng', 1, { ...opts, logger: (m) => { if (m && m.status) $('#scanMsg').textContent = m.status === 'recognizing text' ? `Reading receipt on this device… ${Math.round((m.progress || 0) * 100)}%` : 'Getting the text reader ready…'; } }), 120000);
      const out = await limit(worker.recognize(img), 120000);
      return parseReceiptText((out && out.data && out.data.text) || '');
    } finally { if (worker) try { worker.terminate(); } catch (e) { /* already gone */ } }
  }
  function parseReceiptText(text) {
    const lines = String(text).split(/\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (lines.length < 2) return null;
    const priceRe = /(?:RM\s*)?(-?\d{1,5}(?:,\d{3})*[.,]\s?\d{2})\s*[A-Z]{0,2}$/i;
    const price = (l) => { const m = l.match(priceRe); return m ? parseFloat(m[1].replace(/\s/g, '').replace(/,(\d{2})$/, '.$1').replace(/,/g, '')) : null; };
    const TOT = /TOTAL|JUMLAH|AMOUNT DUE|AMAUN|NETT?\b/i, NOTTOT = /SUB|ITEM|QTY|DISC|SAVING|TAX|SST|GST|EXCL/i;
    const SKIP = /TOTAL|JUMLAH|AMOUNT|AMAUN|TAX|SST|GST|SERVICE|SERV\.? ?CH|ROUND|CASH|TUNAI|CHANGE|BAKI|VISA|MASTER|DEBIT|CREDIT|CARD|KAD\b|WALLET|TNG|\bQR\b|DISC|DISKAUN|SAVING|PAYMENT|BAYAR|TENDER|BALANCE|\bNETT?\b/i;
    const cand = lines.filter((l) => TOT.test(l) && !NOTTOT.test(l) && price(l) > 0);
    const prices = lines.filter((l) => !/CASH|TUNAI|CHANGE|BAKI|TENDER/i.test(l)).map(price).filter((p) => p > 0);
    const total = cand.length ? price(cand[cand.length - 1]) : (prices.length ? Math.max(...prices) : 0);
    let end = lines.findIndex((l) => /SUB ?-?TOTAL|TOTAL|JUMLAH/i.test(l)); if (end < 0) end = lines.length;
    const merchant = (lines.slice(0, 6).find((l) => { const n = (l.match(/[A-Za-z]/g) || []).length; return n >= 4 && n / l.length > 0.6 && !/RECEIPT|RESIT|INVOICE|INVOIS|WELCOME|TAX/i.test(l); }) || '').slice(0, 60);
    let date = null;
    for (const l of lines) {
      const m = l.match(/\d{4}-\d{2}-\d{2}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{1,2}\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*\d{4}/i);
      const d = m && parseDate(m[0]); if (!d) continue;
      const [y, mo, dd] = d.split('-').map(Number);
      if (y >= 2015 && y <= new Date().getFullYear() + 1 && mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31) { date = d; break; }
    }
    const mCat = guessCat(merchant); const all = guessCat(lines.join(' '));
    const whole = mCat !== 'Other' ? mCat : all;
    const items = [];
    lines.slice(0, end).forEach((l) => {
      const p = price(l); if (!(p > 0) || SKIP.test(l)) return;
      const desc = l.replace(priceRe, '').replace(/\b\d{6,}\b/g, ' ').replace(/^\W*\d{1,3}\s*[xX@*]?\s+/, '').replace(/\s+\d{1,3}\s*[xX@]\s*[\d.,]+\s*$/, '').replace(/[^\w&%./' -]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!/[A-Za-z]{3}/.test(desc)) return;
      let c = guessCat(desc); if (c === 'Other' || (whole === 'Groceries' && c === 'Food & dining')) c = whole;
      items.push({ desc: desc.slice(0, 60), amount: p, category: c });
    });
    if (!total && !items.length) return null;
    return { merchant, date, total, category: whole, items };
  }

  async function scanReceipt(file) {
    if (scanCtl) return;
    scanCtl = new AbortController(); const signal = scanCtl.signal;
    let r = null, src = 'manual';
    try {
      const img = await toJpeg(file);
      if (lastPhoto) URL.revokeObjectURL(lastPhoto); lastPhoto = URL.createObjectURL(img);
      if (sampler && !samplerOff) {
        scanBusy(true, 'Claude is reading the receipt… this can take up to a minute');
        try { r = await claudeRead(img, signal); if (r) src = 'claude'; } catch (e) {
          const code = e && e.code; if (code === 'cancelled') return;
          if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'images_unavailable'].includes(code)) samplerOff = true;
          else console.warn('Claude could not read the receipt, trying on this device', e);
        }
      }
      if (!r) {
        scanBusy(true, 'Getting the text reader ready…');
        try { r = await deviceRead(img, signal); if (r) src = 'device'; } catch (e) { if (e && e.code === 'cancelled') return; console.warn('On-device reader unavailable', e); }
      }
      openReceipt(r || {}, src);
    } finally { scanCtl = null; scanBusy(false); }
  }
  function openReceipt(r, src) {
    const num = (v) => { const n = Math.abs(parseFloat(String(v).replace(/[^\d.-]/g, ''))); return isFinite(n) ? Math.round(n * 100) / 100 : 0; };
    const okCat = (c, desc) => (S.cats.includes(c) ? c : guessCat(String(desc || '')));
    const merchant = String(r.merchant || 'Receipt').slice(0, 60);
    const today = new Date().toISOString().slice(0, 10);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') ? r.date : today;
    const items = (Array.isArray(r.items) ? r.items : []).map((i) => ({ desc: String(i.desc || 'Item').slice(0, 60), amount: num(i.amount), category: okCat(i.category, i.desc), keep: true })).filter((i) => i.amount > 0);
    const itemSum = Math.round(items.reduce((a, i) => a + i.amount, 0) * 100) / 100;
    const total = num(r.total) || itemSum;
    const extra = Math.round((total - itemSum) * 100) / 100;
    const whole = [{ desc: merchant, amount: total, category: okCat(r.category, merchant), keep: true }];
    const split = items.slice(); if (items.length && extra > 0.004) split.push({ desc: 'Tax, service & rounding', amount: extra, category: whole[0].category, keep: true });
    let mode = 'one';
    const mIn = el('input', { class: 'in', value: merchant, placeholder: 'Shop' }); const dIn = el('input', { class: 'in', type: 'date', value: date });
    let wholeCatSet = src === 'claude';
    mIn.addEventListener('input', () => {
      if (mode !== 'one') return; whole[0].desc = mIn.value; const f = $('.rrow input[type=text]', rows); if (f) f.value = mIn.value;
      const g = guessCat(mIn.value); if (!wholeCatSet && g !== 'Other') { whole[0].category = g; const c = $('.rrow select', rows); if (c) c.value = g; }
    });
    const rows = el('div', { class: 'rrows' }); const tot = el('div', { class: 'rtot' }); const pills = el('div', { class: 'subs' });
    const cur = () => (mode === 'one' ? whole : split);
    const drawTot = () => { const l = cur().filter((x) => x.keep); tot.replaceChildren(el('span', { text: `Adding ${l.length} expense${l.length === 1 ? '' : 's'}` }), el('span', { text: RM(sum(l), 2) })); };
    const draw = () => {
      pills.hidden = !items.length;
      pills.replaceChildren(
        el('button', { type: 'button', class: 'spill' + (mode === 'one' ? ' on' : ''), text: 'One expense (total)', onclick: () => { mode = 'one'; draw(); } }),
        el('button', { type: 'button', class: 'spill' + (mode === 'split' ? ' on' : ''), text: `Split into ${split.length} items`, onclick: () => { mode = 'split'; draw(); } }));
      rows.replaceChildren(...cur().map((x) => {
        const row = el('div', { class: 'rrow' + (x.keep ? '' : ' off') });
        const cb = el('input', { type: 'checkbox', 'aria-label': 'Include' }); cb.checked = x.keep; cb.onchange = () => { x.keep = cb.checked; row.classList.toggle('off', !x.keep); drawTot(); };
        const d = el('input', { class: 'in', type: 'text', value: x.desc, 'aria-label': 'Description' }); d.oninput = () => { x.desc = d.value; };
        const a = el('input', { class: 'in', value: x.amount.toFixed(2), inputmode: 'decimal', 'aria-label': 'Amount in RM' }); a.oninput = () => { x.amount = num(a.value); drawTot(); };
        const c = catSelect(x.category); c.setAttribute('aria-label', 'Category'); c.onchange = () => { x.category = c.value; if (x === whole[0]) wholeCatSet = true; };
        row.append(cb, d, a, c); return row;
      }));
      drawTot();
    };
    const add = () => {
      const dt = dIn.value || today; const m = dt.slice(0, 7); const M = ensureMonth(m); const shop = mIn.value.trim();
      const list = cur().filter((x) => x.keep && x.amount > 0); if (!list.length) { toast('Nothing ticked to add'); return; }
      list.forEach((x) => M.items.push({ id: uid('t'), date: dt, desc: (x.desc.trim() || shop || 'Receipt').slice(0, 60), amount: x.amount, category: x.category, account: 'Receipt' + (mode === 'split' && shop ? ' · ' + shop : '') }));
      saveMonth(m); S.cur = m; S.openGroup = groupOf(list[0].category); S.subFilter = null; closeSheet(); render();
      toast(`Added ${list.length} expense${list.length === 1 ? '' : 's'} · ${RM(sum(list), 2)}`);
    };
    draw();
    const note = src === 'device' ? 'Read on this device. Text readers make mistakes, so check each amount against the photo.' : src === 'manual' ? 'The photo could not be read automatically here. Type the details from the photo; the category fills in as you type.' : null;
    sheet(src === 'manual' ? 'Add from receipt' : 'Check the receipt', [lastPhoto ? el('img', { class: 'rphoto', src: lastPhoto, alt: 'Receipt photo' }) : null, note ? el('div', { class: 'muted', style: 'margin-bottom:8px', text: note }) : null, mIn, dIn, pills, rows, tot,
      extra < -0.004 && items.length ? el('div', { class: 'muted', text: `Items add up to ${RM(itemSum, 2)} but the receipt total is ${RM(total, 2)} (discount or a missed line).` }) : null,
      el('div', { class: 'row', style: 'margin-top:8px' }, el('button', { class: 'btn', text: 'Add to spending', onclick: add }), el('button', { class: 'btn ghostbtn', text: 'Cancel', onclick: closeSheet }))].filter(Boolean));
    if (document.activeElement && document.activeElement.blur) setTimeout(() => document.activeElement.blur(), 80);
  }
  $('#cancelSel').addEventListener('click', () => { S.sel = null; renderCalendar(); });
  $$('#tabs button').forEach((b) => b.addEventListener('click', () => {
    S.view = b.dataset.v; document.body.classList.toggle('cal-on', S.view === 'cal'); $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
    $$('.view').forEach((v) => v.classList.toggle('on', v.id === 'v-' + S.view));
    movePill(); revealView();
    try { history.replaceState(null, '', '#' + S.view); } catch (err) { /* sandboxed */ }
    render(); scrollTo({ top: 0 });
  }));

  /* ---------- import ---------- */
  const dz = $('#dropZone');
  ['dragenter', 'dragover'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('hot'); }));
  ['dragleave', 'drop'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove('hot'); }));
  dz.addEventListener('drop', (e) => handleFiles([...e.dataTransfer.files]));
  $('#fileIn').addEventListener('change', (e) => { handleFiles([...e.target.files]); e.target.value = ''; });
  let pending = [];
  async function handleFiles(files) {
    for (const f of files) {
      if (/\.pdf$/i.test(f.name)) await importPdf(f); else importCsv(await f.text(), f.name);
    }
  }
  function parseDate(s) {
    s = s.trim(); let m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
    if ((m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/))) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
    if ((m = s.match(/^(\d{1,2})\s*([A-Za-z]{3})[a-z]*\s*(\d{4})?/))) { const mi = MON.findIndex((x) => x.toUpperCase() === m[2].toUpperCase()); if (mi >= 0) { const y = m[3] || S.cur.slice(0, 4); return `${y}-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`; } }
    return null;
  }
  function splitCsv(line) { const out = []; let cur = '', q = false; for (const ch of line) { if (ch === '"') q = !q; else if ((ch === ',' || ch === ';' || ch === '\t') && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()); }
  function importCsv(text, name) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim()); if (!lines.length) return;
    const head = splitCsv(lines[0]).map((h) => h.toLowerCase());
    const hasHead = head.some((h) => /date|desc|amount|amaun|tarikh/.test(h));
    const ix = (re, d) => { const i = head.findIndex((h) => re.test(h)); return i >= 0 ? i : d; };
    const iD = hasHead ? ix(/date|tarikh/, 0) : 0, iT = hasHead ? ix(/desc|detail|keterangan|merchant/, 1) : 1, iA = hasHead ? ix(/amount|amaun|debit/, 2) : 2, iC = hasHead ? ix(/categ/, -1) : -1;
    const rows = [];
    lines.slice(hasHead ? 1 : 0).forEach((l) => {
      const c = splitCsv(l); const date = parseDate(c[iD] || ''); const amt = parseFloat(String(c[iA] || '').replace(/[^\d.-]/g, ''));
      if (!date || !amt) return; const desc = c[iT] || 'Expense';
      rows.push({ date, desc, amount: Math.abs(amt), category: (iC >= 0 && S.cats.includes(c[iC])) ? c[iC] : guessCat(desc), credit: amt < 0 });
    });
    showPreview(rows, name);
  }
  async function importPdf(file, password) {
    try {
      if (!window.pdfjsLib) {
        await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'; s.onload = res; s.onerror = rej; document.head.append(s); });
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      }
      const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer(), password }).promise;
      const lines = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const tc = await (await doc.getPage(p)).getTextContent(); const byY = {};
        tc.items.forEach((t) => { const y = Math.round(t.transform[5]); (byY[y] = byY[y] || []).push(t); });
        Object.keys(byY).sort((a, b) => b - a).forEach((y) => lines.push(byY[y].sort((a, b) => a.transform[4] - b.transform[4]).map((t) => t.str).join(' ').replace(/\s+/g, ' ').trim()));
      }
      const rows = [];
      lines.forEach((l) => {
        const m = l.match(/^(\d{1,2}[\/ ][A-Za-z0-9]{2,3}(?:[\/ ]\d{2,4})?)\s+(?:\d{1,2}[\/ ][A-Za-z0-9]{2,3}(?:[\/ ]\d{2,4})?\s+)?(.+?)\s+([\d,]+\.\d{2})\s*(CR|-)?(?:\s+[\d,]+\.\d{2})?$/i);
        if (!m) return; const date = parseDate(m[1].replace(/\//g, '/')); if (!date) return;
        const desc = m[2].trim(); if (/BALANCE|BAKI|TOTAL|JUMLAH/i.test(desc)) return;
        rows.push({ date, desc, amount: parseFloat(m[3].replace(/,/g, '')), category: guessCat(desc), credit: !!m[4] || /PAYMENT|THANK/i.test(desc) });
      });
      $('#pdfPw').style.display = 'none';
      showPreview(rows, file.name);
    } catch (e) {
      if (e && e.name === 'PasswordException') {
        $('#pdfPw').style.display = 'flex'; $('#pwIn').value = '';
        $('#pwBtn').onclick = () => importPdf(file, $('#pwIn').value);
        toast(password ? 'Wrong password' : 'This PDF is locked: enter its password');
      } else { toast('Could not read that PDF. Try a CSV export instead.'); console.error(e); }
    }
  }
  function showPreview(rows, name) {
    const box = $('#importPrev'); box.replaceChildren();
    if (!rows.length) { box.append(el('p', { class: 'muted', text: `No transactions found in ${name}.` })); return; }
    pending = rows.map((r) => ({ ...r, keep: !r.credit }));
    const tb = el('table', { class: 'prev' });
    pending.forEach((r) => {
      const cb = el('input', { type: 'checkbox' }); cb.checked = r.keep; cb.onchange = () => (r.keep = cb.checked);
      const cs = catSelect(r.category); cs.style.padding = '4px'; cs.onchange = () => (r.category = cs.value);
      tb.append(el('tr', {}, el('td', {}, cb), el('td', { text: r.date.slice(5) }), el('td', { text: r.desc }), el('td', { text: (r.credit ? '−' : '') + r.amount.toFixed(2), style: 'text-align:right' }), el('td', {}, cs)));
    });
    box.append(el('p', { class: 'muted', text: `${rows.length} rows from ${name}. Payments and refunds are unticked. Untick anything you don't want.` }),
      el('div', { style: 'overflow-x:auto;max-height:50vh' }, tb),
      el('button', { class: 'btn', text: 'Add to months', style: 'margin-top:10px', onclick: commitImport }));
  }
  function commitImport() {
    const touched = new Set(); let n = 0;
    pending.filter((r) => r.keep).forEach((r) => {
      const m = r.date.slice(0, 7); const M = ensureMonth(m);
      if (M.items.some((i) => i.date === r.date && Math.abs(i.amount - r.amount) < .005 && i.desc.slice(0, 12).toUpperCase() === r.desc.slice(0, 12).toUpperCase())) return;
      M.items.push({ id: uid('t'), date: r.date, desc: r.desc.slice(0, 60), amount: r.amount, category: r.category, account: 'Imported' }); touched.add(m); n++;
    });
    touched.forEach(saveMonth); pending = []; $('#importPrev').replaceChildren(el('p', { class: 'muted', text: `Added ${n} expenses (duplicates skipped).` })); render(); toast(`Imported ${n}`);
  }

  /* ---------- PDF report ---------- */
  async function saveFile(bytes, filename) {
    let dl = null;
    try { if (window.claude && window.claude.use) dl = await window.claude.use('downloads'); } catch (e) { dl = null; }
    if (dl) { await dl.save({ filename, data: new Blob([bytes], { type: 'application/pdf' }) }); return; }
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = el('a', { href: url, download: filename }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  async function exportPdf() {
    const btn = $('#pdfBtn'); const M = ensureMonth(S.cur);
    if (!M.items.length && !M.planned.length) { toast('Nothing to export for this month yet'); return; }
    btn.disabled = true; btn.textContent = 'Building PDF…';
    try {
      const ks = monthKeys(); const pi = ks.indexOf(S.cur) - 1; const pm = pi >= 0 ? S.months[ks[pi]] : null;
      const bytes = await FTReport.build({ month: S.cur, label: mLabel(S.cur).replace(' ', " '"), income: M.income, incomeNote: M.incomeNote, items: M.items, planned: M.planned, debts: S.debts, groups: GROUPS,
        prev: pm && pm.items.length ? { label: mLabel(pm.month), total: sum(pm.items) } : null, profile: profile() });
      window.__lastPdf = bytes;
      await saveFile(bytes, `spending-report-${S.cur}.pdf`); toast('PDF ready');
    } catch (e) {
      if (e && e.code === 'declined') toast('Export cancelled'); else if (e && e.code === 'rate_limited') toast('Please wait a moment, then try again'); else { toast('Could not create the PDF'); console.error(e); }
    }
    btn.disabled = false; btn.textContent = 'Export PDF report';
  }
  $('#pdfBtn').addEventListener('click', exportPdf);

  /* ---------- backup ---------- */
  const dump = () => JSON.stringify({ months: S.months, debts: S.debts, categories: S.cats });
  $('#copyBtn').onclick = async () => { try { await navigator.clipboard.writeText(dump()); toast('Backup copied'); } catch (e) { const t = $('#restoreTxt'); t.style.display = 'block'; t.value = dump(); t.select(); toast('Select all and copy the text below'); } };
  $('#restoreBtn').onclick = () => {
    const t = $('#restoreTxt');
    if (t.style.display !== 'block' || !t.value.trim()) { t.style.display = 'block'; t.value = ''; t.focus(); toast('Paste the backup, then tap Restore again'); return; }
    try {
      const o = JSON.parse(t.value);
      Object.values(o.months || {}).forEach((M) => { S.months[M.month] = M; saveMonth(M.month); });
      if (o.debts) { S.debts = o.debts; saveDebts(); }
      if (o.categories) { S.cats = o.categories; persist('categories', { list: S.cats }); }
      t.value = ''; t.style.display = 'none'; toast('Restored'); S.cur = S.cur || monthKeys().pop(); render();
    } catch (e) { toast('That text is not a valid backup'); }
  };

  /* ---------- start ---------- */
  async function load() {
    const all = await S.store.loadAll();
    S.months = {}; Object.entries(all).forEach(([k, v]) => { if (k.startsWith('m_') && v && v.month) S.months[v.month] = { items: [], planned: [], ...v }; });
    S.debts = (all.debts && all.debts.list) || []; S.cats = (all.categories && all.categories.list) || DEFAULT_CATS.slice();
    if (!Object.keys(S.months).length && !S.debts.length && !(S.store.needsSignIn && S.store.needsSignIn())) await firstRunSeed();
    const nowM = new Date().toISOString().slice(0, 7); ensureMonth(nowM);
    S.cur = nowM;
    fillCats($('#aCat'), 'Groceries');
  }
  // First run only: if nothing is stored yet and a seed.json sits beside the app, copy it into storage.
  async function firstRunSeed() {
    try {
      const r = await fetch('seed.json', { cache: 'no-store' }); if (!r.ok) return;
      const o = await r.json();
      (o.months || []).forEach((M) => { S.months[M.month] = M; saveMonth(M.month); });
      if (o.debts) { S.debts = o.debts; saveDebts(); }
      if (o.categories) { S.cats = o.categories; persist('categories', { list: S.cats }); }
      toast('Loaded your past data');
    } catch (e) { /* no seed available */ }
  }
  async function start() {
    S.store = await FTStore.open();
    $('#storeBadge').textContent = S.store.label;
    const ab = $('#authBtn');
    if (S.store.mode === 'firebase') {
      ab.hidden = false; const upd = () => { ab.textContent = S.store.needsSignIn() ? 'Sign in with Google' : 'Sign out'; $('#storeBadge').textContent = S.store.label; };
      ab.onclick = async () => { try { if (S.store.needsSignIn()) await S.store.signIn(); else await S.store.signOut(); upd(); await load(); render(); } catch (e) { toast('Sign-in failed'); } }; upd();
    }
    try { await load(); } catch (e) { toast('Could not load your data yet. Try again shortly.'); console.error(e); ensureMonth(new Date().toISOString().slice(0, 7)); S.cur = monthKeys()[0]; }
    const h = (location.hash || '').slice(1); const tb = $(`#tabs button[data-v="${h}"]`);
    if (tb) tb.click(); else { render(); revealView(); }
    requestAnimationFrame(movePill);
  }
  addEventListener('resize', () => { if (S.view === 'profile') renderProfile(); movePill(); });
  /* ---------- motion: sliding tab pill, cards that rise in as they scroll into view ---------- */
  function movePill() {
    const on = $('#tabs button.on'), pill = $('#navPill'); if (!on || !pill) return;
    pill.style.width = on.offsetWidth + 'px'; pill.style.transform = `translateX(${on.offsetLeft}px)`;
  }
  const io = ('IntersectionObserver' in window) && !reduceMotion() ? new IntersectionObserver((es) => {
    let n = 0; es.forEach((e) => { if (e.isIntersecting && !e.target.classList.contains('in')) { e.target.style.transitionDelay = (n++ * 90) + 'ms'; e.target.classList.add('in'); } });
  }, { threshold: 0.06 }) : null;
  let lastView = null;
  function revealView() {
    if (!io || lastView === S.view) return; lastView = S.view;
    $$('.card, .calwrap').forEach((c) => c.classList.remove('in'));
    requestAnimationFrame(() => { let n = 0; $$('#v-' + S.view + ' .card, #v-' + S.view + ' .calwrap').forEach((c) => { const r = c.getBoundingClientRect(); if (r.top < innerHeight && r.bottom > 0) { c.style.transitionDelay = (n++ * 90) + 'ms'; c.classList.add('in'); } }); });
  }
  if (io) { document.documentElement.classList.add('reveal'); $$('.card, .calwrap').forEach((c) => io.observe(c)); }
  /* ---------- light / dark mode: follows the phone until you pick one, then remembers your choice ---------- */
  const root = document.documentElement; const mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  const isDark = () => { const t = root.getAttribute('data-theme'); return t ? t === 'dark' : !!(mq && mq.matches); };
  function syncTheme() {
    const d = isDark(); root.classList.toggle('is-dark', d); $('#themeBtn').setAttribute('aria-checked', String(d));
    $$('meta[name="theme-color"]').forEach((m) => { m.removeAttribute('media'); m.setAttribute('content', d ? '#121311' : '#f6f3ec'); });
    if (S.view === 'profile') renderProfile();
  }
  $('#themeBtn').addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    root.classList.add('theming'); root.setAttribute('data-theme', next); setTimeout(() => root.classList.remove('theming'), 500);
    try { localStorage.setItem('ft-theme', next); } catch (e) { /* choice lasts for this visit only */ }
    syncTheme(); toast(next === 'dark' ? 'Dark mode' : 'Light mode');
  });
  if (mq && mq.addEventListener) mq.addEventListener('change', syncTheme);
  syncTheme();
  $('#todayLine').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  /* ---------- add to home screen (own hosting) ---------- */
  let installEvt = null;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#installBtn').hidden = false; $('#installHelp').textContent = 'Install it to open full screen from your home screen, with its own icon, even with no internet.'; });
  $('#installBtn').addEventListener('click', async () => { if (!installEvt) return; installEvt.prompt(); try { await installEvt.userChoice; } catch (e) { /* dismissed */ } installEvt = null; $('#installBtn').hidden = true; });
  addEventListener('appinstalled', () => { $('#installCard').hidden = true; toast('Added to your home screen'); });
  (() => {
    const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
    if (standalone) { $('#installCard').hidden = true; return; }
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    $('#installHelp').textContent = window.claude ? 'Home-screen install works from your own hosted copy of the app (for example Firebase Hosting), not from inside Claude. Open that copy on your phone and come back to this card.'
      : ios ? 'In Safari, tap the Share button, then “Add to Home Screen”. The app then opens full screen with its own icon.'
        : 'In Chrome, open the ⋮ menu and tap “Add to Home screen” or “Install app”. The app then opens full screen with its own icon.';
  })();
  // Own hosting only: keep the app usable with no internet after the first visit.
  try { if (!window.claude && window.top === window && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) { /* not available */ }
  start();
})();
