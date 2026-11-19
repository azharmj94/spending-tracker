/* Monthly PDF report. Uses pdf-lib (vendor/pdf-lib.min.js), loaded on first use.
 * FTReport.build(data) -> Uint8Array.  data = { month, label, income, incomeNote, items, planned, debts, groups, prev, profile } */
(function () {
  const A4 = [595.28, 841.89], M = 36;
  const C = {
    navy: [0.043, 0.063, 0.125], ink: [0.09, 0.12, 0.2], mute: [0.42, 0.47, 0.57], line: [0.86, 0.89, 0.93], soft: [0.955, 0.965, 0.98],
    blue: [0.2, 0.55, 0.92], ok: [0.1, 0.62, 0.42], warn: [0.93, 0.6, 0.1], bad: [0.86, 0.26, 0.26], white: [1, 1, 1]
  };
  const PAL = [[0.2, 0.55, 0.92], [0.1, 0.68, 0.62], [0.49, 0.45, 0.93], [0.93, 0.42, 0.6], [0.95, 0.66, 0.2], [0.86, 0.26, 0.26]];
  const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const clean = (s) => String(s == null ? '' : s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—−]/g, '-').replace(/…/g, '...').replace(/[^\x20-\x7E\xA0-\xFF]/g, '').trim();
  const rm = (v, d = 2) => 'RM ' + Number(v || 0).toLocaleString('en-MY', { minimumFractionDigits: d, maximumFractionDigits: d });
  const sum = (l) => l.reduce((a, i) => a + i.amount, 0);

  function loadLib() {
    if (window.PDFLib) return Promise.resolve();
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/pdf-lib.min.js'; s.onload = res; s.onerror = () => rej(new Error('PDF library failed to load')); document.head.append(s); });
  }
  function iconPng(emoji) {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 96; const x = c.getContext('2d');
      x.font = '72px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(emoji, 48, 52);
      const b = atob(c.toDataURL('image/png').split(',')[1]); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u;
    } catch (e) { return null; }
  }

  async function build(D) {
    await loadLib();
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const doc = await PDFDocument.create();
    doc.setTitle(`Spending report ${D.label}`); doc.setCreator('Spending Tracker');
    const F = await doc.embedFont(StandardFonts.Helvetica), B = await doc.embedFont(StandardFonts.HelveticaBold);
    const col = (c) => rgb(c[0], c[1], c[2]);
    let page, y; const W = A4[0], H = A4[1];
    // top-down helpers
    const T = (s, x, yy, o = {}) => { const f = o.bold ? B : F, size = o.size || 10; let t = clean(s);
      if (o.max) { while (t.length > 1 && f.widthOfTextAtSize(t, size) > o.max) t = t.slice(0, -2).trimEnd() + '.'; if (f.widthOfTextAtSize(t, size) > o.max) t = ''; else if (t !== clean(s)) t = t.slice(0, -1) + '...'; }
      const w = f.widthOfTextAtSize(t, size); const xx = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
      page.drawText(t, { x: xx, y: H - yy - size * 0.75, size, font: f, color: col(o.color || C.ink) }); return w; };
    const R = (x, yy, w, h, c, o = {}) => page.drawRectangle({ x, y: H - yy - h, width: w, height: h, color: c ? col(c) : undefined, borderColor: o.border ? col(o.border) : undefined, borderWidth: o.border ? 0.7 : 0, opacity: o.opacity });
    const L = (x1, y1, x2, y2, c = C.line, t = 0.7) => page.drawLine({ start: { x: x1, y: H - y1 }, end: { x: x2, y: H - y2 }, thickness: t, color: col(c) });
    const newPage = (title) => { page = doc.addPage(A4); y = M;
      if (title) { T(title, M, y, { bold: true, size: 9, color: C.mute }); T(D.label, W - M, y, { size: 9, color: C.mute, align: 'right' }); L(M, y + 14, W - M, y + 14); y += 26; } };
    const need = (h, title) => { if (y + h > H - M - 18) newPage(title); };
    const wrap = (s, f, size, max) => { const out = []; let cur = ''; clean(s).split(/\s+/).forEach((w) => { const t = cur ? cur + ' ' + w : w; if (f.widthOfTextAtSize(t, size) > max && cur) { out.push(cur); cur = w; } else cur = t; }); if (cur) out.push(cur); return out; };

    const icons = {}; for (const g of D.groups) { const p = iconPng(g.icon); if (p) try { icons[g.name] = await doc.embedPng(p); } catch (e) { /* skip icon */ } }
    const groupOf = (c) => (D.groups.find((g) => g.cats.includes(c)) || D.groups[4]).name;
    const items = D.items.slice().sort((a, b) => a.date.localeCompare(b.date));
    const spend = items.filter((i) => i.category !== 'Debt payments'), debtPay = items.filter((i) => i.category === 'Debt payments');
    const spent = sum(spend), debt = sum(debtPay), planned = sum(D.planned), income = D.income || 0, left = income - spent - debt - planned;
    const G = D.groups.map((g, i) => { const l = items.filter((x) => groupOf(x.category) === g.name); return { ...g, list: l, total: sum(l), color: PAL[i] }; });
    const total = sum(items) || 1;

    /* ================= PAGE 1: DASHBOARD ================= */
    page = doc.addPage(A4);
    R(0, 0, W, 104, C.navy); R(0, 104, W, 3, C.blue);
    T('MONTHLY SPENDING REPORT', M, 26, { size: 9, bold: true, color: [0.55, 0.75, 1] });
    const [yy, mm] = D.month.split('-').map(Number);
    T(`${MON[mm - 1]} ${yy}`, M, 42, { size: 28, bold: true, color: C.white });
    T(`Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}  |  ${items.length} expenses  |  ${D.planned.length} planned`, M, 80, { size: 9, color: [0.72, 0.78, 0.9] });
    T('Spending Tracker', W - M, 26, { size: 9, color: [0.72, 0.78, 0.9], align: 'right' });
    y = 124;
    // KPI tiles
    const kp = [['Income', rm(income, 0), C.ink, D.incomeNote || ''], ['Spent', rm(spent, 0), C.ink, `${spend.length} expenses`], ['Debt payments', rm(debt, 0), C.warn, `${debtPay.length} payments`], [left < 0 ? 'Short by' : 'Left over', rm(Math.abs(left), 0), left < 0 ? C.bad : C.ok, planned ? `after ${rm(planned, 0)} planned` : 'after everything']];
    const tw = (W - 2 * M - 3 * 10) / 4;
    kp.forEach(([l, v, c, n], i) => { const x = M + i * (tw + 10); R(x, y, tw, 62, C.soft, { border: C.line }); R(x, y, 3, 62, c === C.ink ? C.blue : c);
      T(l, x + 12, y + 10, { size: 8.5, color: C.mute }); T(v, x + 12, y + 24, { size: 16, bold: true, color: c }); T(n, x + 12, y + 46, { size: 7.5, color: C.mute, max: tw - 20 }); });
    y += 76;
    // usage bar
    const used = income ? (spent + debt + planned) / income : 0;
    T('Share of income used', M, y, { size: 9, bold: true }); T(income ? `${Math.round(used * 100)}%` : 'No income entered', W - M, y, { size: 9, bold: true, align: 'right', color: used > 1 ? C.bad : C.ink });
    y += 15; const bw = W - 2 * M; R(M, y, bw, 9, C.line);
    if (income) { const seg = [[spent, C.blue], [debt, C.warn], [planned, C.mute]]; let x = M; const scale = bw / Math.max(income, spent + debt + planned);
      seg.forEach(([v, c]) => { R(x, y, v * scale, 9, c); x += v * scale; });
      if (used > 1) { const ix = M + income * scale; L(ix, y - 3, ix, y + 12, C.bad, 1.2); T('income', ix, y + 13, { size: 7, color: C.bad, align: 'center' }); } }
    y += 22; let lx = M; [['Spending', C.blue], ['Debt payments', C.warn], ['Still planned', C.mute]].forEach(([n, c]) => { R(lx, y + 1, 7, 7, c); lx += 11; lx += T(n, lx, y, { size: 8, color: C.mute }) + 14; });
    y += 24;

    // donut + legend
    T('Where the money went', M, y, { size: 12, bold: true }); y += 20;
    const cx = M + 78, cy = y + 78, r1 = 78, r0 = 46; let a0 = -Math.PI / 2;
    G.filter((g) => g.total > 0).forEach((g) => {
      const frac = g.total / total; const a1 = a0 + Math.min(frac, 0.9999) * 2 * Math.PI; const big = a1 - a0 > Math.PI ? 1 : 0;
      const p = (r, a) => `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`;
      page.drawSvgPath(`M ${p(r1, a0)} A ${r1} ${r1} 0 ${big} 1 ${p(r1, a1)} L ${p(r0, a1)} A ${r0} ${r0} 0 ${big} 0 ${p(r0, a0)} Z`, { x: cx, y: H - cy, color: col(g.color), borderColor: col(C.white), borderWidth: 1.2 });
      a0 = a1;
    });
    if (!sum(items)) page.drawCircle({ x: cx, y: H - cy, size: r1, borderColor: col(C.line), borderWidth: 1 });
    T('Total out', cx, cy - 14, { size: 8, color: C.mute, align: 'center' }); T(rm(sum(items), 0), cx, cy - 3, { size: 13, bold: true, align: 'center' });
    const lgx = M + 180; let ly = y + 2; const lw = W - M - lgx;
    G.forEach((g) => {
      if (icons[g.name]) page.drawImage(icons[g.name], { x: lgx, y: H - ly - 19, width: 17, height: 17 }); else R(lgx + 3, ly + 5, 10, 10, g.color);
      T(g.name, lgx + 24, ly + 2, { size: 9.5, bold: true }); T(`${g.list.length} items`, lgx + 24, ly + 13, { size: 7.5, color: C.mute });
      const bx = lgx + 130, bwid = lw - 130 - 92; R(bx, ly + 8, bwid, 6, C.line); R(bx, ly + 8, bwid * g.total / total, 6, g.color);
      T(rm(g.total, 0), W - M - 30, ly + 5, { size: 9.5, bold: true, align: 'right' }); T(`${Math.round(g.total / total * 100)}%`, W - M, ly + 5, { size: 9, color: C.mute, align: 'right' });
      ly += 26;
    });
    y += 172;

    // daily chart
    T('Day by day', M, y, { size: 12, bold: true }); T('Money out per day (RM)', W - M, y + 2, { size: 8, color: C.mute, align: 'right' }); y += 18;
    const days = new Date(Date.UTC(yy, mm, 0)).getUTCDate(); const by = Array(days).fill(0); items.forEach((i) => { const d = +i.date.slice(8) - 1; if (d >= 0 && d < days) by[d] += i.amount; });
    const mx = Math.max(1, ...by), ch = 84, cw = W - 2 * M - 30, x0 = M + 30, slot = cw / days;
    if (!sum(items)) T('No spending recorded for this month yet.', x0 + cw / 2, y + ch / 2 - 4, { size: 9, color: C.mute, align: 'center' });
    (sum(items) ? [0, 0.5, 1] : [0]).forEach((f) => { const gy = y + ch - ch * f; L(x0, gy, W - M, gy, C.line, 0.5); T(Math.round(mx * f).toLocaleString(), x0 - 4, gy - 4, { size: 7, color: C.mute, align: 'right' }); });
    const peak = by.indexOf(Math.max(...by));
    by.forEach((v, d) => { const h = ch * v / mx; if (v) R(x0 + d * slot + 1.5, y + ch - h, slot - 3, h, d === peak ? C.bad : C.blue);
      if ((d + 1) % 5 === 0 || d === 0) T(d + 1, x0 + d * slot + slot / 2, y + ch + 4, { size: 7, color: C.mute, align: 'center' }); });
    y += ch + 24;

    // two columns: biggest expenses + highlights
    const colW = (W - 2 * M - 18) / 2; const top = spend.slice().sort((a, b) => b.amount - a.amount).slice(0, 6); const ty = y;
    T('Biggest expenses', M, y, { size: 12, bold: true }); y += 20;
    top.forEach((i, k) => { if (k % 2 === 0) R(M, y - 3, colW, 17, C.soft); T(`${+i.date.slice(8)} ${MON[mm - 1].slice(0, 3)}`, M + 5, y, { size: 8, color: C.mute }); T(i.desc, M + 44, y, { size: 8.5, max: colW - 120 }); T(rm(i.amount), M + colW - 5, y, { size: 8.5, bold: true, align: 'right' }); y += 17; });
    if (!top.length) T('No expenses recorded.', M, y, { size: 9, color: C.mute });
    // highlights
    const hx = M + colW + 18; let hy = ty; page.drawText('', { x: 0, y: 0, size: 1, font: F });
    T('Highlights', hx, hy, { size: 12, bold: true }); hy += 20;
    const hl = []; const bigG = G.slice().sort((a, b) => b.total - a.total)[0];
    if (bigG && bigG.total) hl.push(`${bigG.name} was the largest group at ${rm(bigG.total, 0)} (${Math.round(bigG.total / total * 100)}% of money out).`);
    const fee = sum(items.filter((i) => i.category === 'Interest & fees')); if (fee) hl.push(`${rm(fee, 0)} went to interest and fees.`);
    const bnpl = sum(items.filter((i) => i.category === 'Instalments & BNPL')); if (bnpl) hl.push(`${rm(bnpl, 0)} went to instalments and buy-now-pay-later.`);
    if (by[peak]) hl.push(`Highest-spending day: ${peak + 1} ${MON[mm - 1].slice(0, 3)} with ${rm(by[peak], 0)}.`);
    if (D.prev && D.prev.total) { const diff = sum(items) - D.prev.total; hl.push(`Money out was ${rm(Math.abs(diff), 0)} ${diff >= 0 ? 'more' : 'less'} than ${D.prev.label} (${rm(D.prev.total, 0)}).`); }
    if (planned) hl.push(`${D.planned.length} planned items worth ${rm(planned, 0)} are not yet paid.`);
    if (income) hl.push(left < 0 ? `The month is short by ${rm(-left, 0)} once planned items are counted.` : `${rm(left, 0)} is left after everything planned.`);
    if (D.profile) hl.push(`Money profile: ${D.profile.type} (${D.profile.avg.toFixed(1)} / 5).`);
    hl.slice(0, 7).forEach((s) => { const lines = wrap(s, F, 8.5, colW - 14); page.drawCircle({ x: hx + 3, y: H - hy - 4, size: 1.8, color: col(C.blue) }); lines.forEach((ln) => { T(ln, hx + 11, hy, { size: 8.5 }); hy += 11.5; }); hy += 4; });

    /* ================= DETAIL PAGES ================= */
    newPage('EXPENSE DETAILS');
    const cols = { date: M + 6, desc: M + 52, cat: M + 270, acc: M + 392, amt: W - M - 6 };
    G.filter((g) => g.list.length).forEach((g) => {
      need(64, 'EXPENSE DETAILS');
      R(M, y, W - 2 * M, 24, g.color); if (icons[g.name]) page.drawImage(icons[g.name], { x: M + 6, y: H - y - 20, width: 16, height: 16 });
      T(g.name, M + 28, y + 6, { size: 11, bold: true, color: C.white }); T(`${g.list.length} items   ${rm(g.total)}`, W - M - 8, y + 7, { size: 10, bold: true, color: C.white, align: 'right' }); y += 30;
      const head = () => { T('DATE', cols.date, y, { size: 7, bold: true, color: C.mute }); T('DESCRIPTION', cols.desc, y, { size: 7, bold: true, color: C.mute }); T('CATEGORY', cols.cat, y, { size: 7, bold: true, color: C.mute }); T('SOURCE', cols.acc, y, { size: 7, bold: true, color: C.mute }); T('AMOUNT', cols.amt, y, { size: 7, bold: true, color: C.mute, align: 'right' }); y += 11; L(M, y, W - M, y); y += 4; };
      head();
      g.list.forEach((i, k) => {
        if (y + 15 > H - M - 18) { newPage('EXPENSE DETAILS'); T(`${g.name} (continued)`, M, y, { size: 9, bold: true, color: g.color }); y += 16; head(); }
        if (k % 2) R(M, y - 3, W - 2 * M, 14.5, C.soft);
        T(`${i.date.slice(8)} ${MON[+i.date.slice(5, 7) - 1].slice(0, 3)}`, cols.date, y, { size: 8.5, color: C.mute }); T(i.desc, cols.desc, y, { size: 8.5, max: cols.cat - cols.desc - 8 });
        T(i.category, cols.cat, y, { size: 8, color: C.mute, max: cols.acc - cols.cat - 6 }); T(i.account || '', cols.acc, y, { size: 8, color: C.mute, max: 86 }); T(rm(i.amount), cols.amt, y, { size: 8.5, bold: true, align: 'right' }); y += 14.5;
      });
      // sub-category subtotals
      const subs = g.cats.map((c) => [c, sum(g.list.filter((i) => i.category === c))]).filter((s) => s[1]);
      if (subs.length > 1) { need(16, 'EXPENSE DETAILS'); L(M, y, W - M, y); y += 5; T(subs.map(([c, v]) => `${c}: ${rm(v, 0)}`).join('    '), W - M - 6, y, { size: 8, color: C.mute, align: 'right', max: W - 2 * M - 12 }); y += 12; }
      y += 12;
    });
    need(30, 'EXPENSE DETAILS'); R(M, y, W - 2 * M, 22, C.navy); T('TOTAL MONEY OUT', M + 10, y + 6, { size: 10, bold: true, color: C.white }); T(rm(sum(items)), W - M - 8, y + 6, { size: 11, bold: true, color: C.white, align: 'right' }); y += 36;

    const table = (title, heads, rows, widths, note) => {
      if (!rows.length) return; need(60, 'EXPENSE DETAILS'); T(title, M, y, { size: 12, bold: true }); y += 18; if (note) { T(note, M, y - 2, { size: 8, color: C.mute }); y += 12; }
      const xs = []; let x = M + 6; widths.forEach((w) => { xs.push(x); x += w; });
      const hd = () => { heads.forEach((h, i) => T(h, i === heads.length - 1 ? W - M - 6 : xs[i], y, { size: 7, bold: true, color: C.mute, align: i === heads.length - 1 ? 'right' : 'left' })); y += 11; L(M, y, W - M, y); y += 4; }; hd();
      rows.forEach((r, k) => { if (y + 15 > H - M - 18) { newPage('EXPENSE DETAILS'); hd(); } if (k % 2) R(M, y - 3, W - 2 * M, 14.5, C.soft);
        r.forEach((c, i) => T(c, i === r.length - 1 ? W - M - 6 : xs[i], y, { size: 8.5, bold: i === r.length - 1, align: i === r.length - 1 ? 'right' : 'left', max: i === r.length - 1 ? 110 : widths[i] - 8, color: i && i < r.length - 1 ? C.mute : C.ink })); y += 14.5; });
      y += 16;
    };
    table('Planned and floating expenses', ['WHEN', 'DESCRIPTION', 'CATEGORY', 'AMOUNT'],
      D.planned.slice().sort((a, b) => (a.date || 'z').localeCompare(b.date || 'z')).map((p) => [p.date ? `${p.date.slice(8)} ${MON[+p.date.slice(5, 7) - 1].slice(0, 3)}` : 'Floating', p.desc, p.category, rm(p.amount)]), [60, 250, 140, 70], `Not yet paid. Total ${rm(planned)}.`);
    table('Debts (payoff order)', ['#', 'DEBT', 'NOTE', 'MONTHLY', 'BALANCE'],
      D.debts.map((d, i) => [String(i + 1), d.name, d.note || '', rm(d.monthly, 0), d.balance != null ? rm(d.balance, 0) : 'unknown']), [22, 190, 150, 70, 80], `Total known balance ${rm(D.debts.reduce((a, d) => a + (d.balance || 0), 0), 0)}.`);
    if (D.profile) table('Money profile scores (0 to 5)', ['HABIT', 'HOW IT IS WORKED OUT', 'SCORE'], D.profile.m.map((m) => [m.k, m.why, m.s.toFixed(1)]), [120, 360, 40], `${D.profile.type}. Based on all tracked months, not only this one.`);

    // footers
    const pages = doc.getPages(); pages.forEach((p, i) => { page = p; L(M, H - M - 2, W - M, H - M - 2, C.line, 0.5); T(`Spending Tracker  |  ${D.label}`, M, H - M + 3, { size: 7.5, color: C.mute }); T(`Page ${i + 1} of ${pages.length}`, W - M, H - M + 3, { size: 7.5, color: C.mute, align: 'right' }); });
    return doc.save();
  }
  window.FTReport = { build };
})();
