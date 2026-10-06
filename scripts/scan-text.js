// Run in the page (debug view, `/?debug`). Returns the text rectangles on screen with their
// colours, and where the Hiker is and what it overlaps. Used by scan.py.
(() => {
  const vw = innerWidth, vh = innerHeight;
  const texts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || el.closest('[data-testid="scene"]') || el.closest('pre') || el.closest('script,style')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
      texts.push({
        r: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)],
        color: cs.color,
        size: parseFloat(cs.fontSize),
        weight: +cs.fontWeight,
        el,
        text: n.textContent.trim().slice(0, 24),
      });
    }
  }
  // Fixed bars (the bottom meter on phones) paint over the text scrolling under them: that text
  // is not seen, so it is left out of the contrast scan.
  const fixed = [];
  for (const el of document.querySelectorAll('nav,header,div')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' || el.closest('[data-testid="scene"]')) continue;
    const bg = cs.backgroundColor;
    if (bg === 'rgba(0, 0, 0, 0)' || +(bg.split(',')[3] ?? 1) < 0.6) continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height < 0.5 * vw * vh) fixed.push({ el, r });
  }
  for (const t of texts) {
    t.covered = fixed.some(({ el, r }) => {
      const cx = (t.r[0] + t.r[2]) / 2, cy = (t.r[1] + t.r[3]) / 2;
      return (cx > r.left && cx < r.right && cy > r.top && cy < r.bottom && !el.contains(t.el));
    });
    delete t.el;
  }
  // Boxes that hide what is behind them: cards, inputs, buttons, the bottom bar.
  const boxes = [];
  for (const el of document.querySelectorAll('div,section,form,nav,header,li,a,button,input,textarea,figure,video,img')) {
    if (el.closest('[data-testid="scene"]') || el.closest('pre')) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width < 20 || r.height < 8 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
    if (r.width * r.height > 0.5 * vw * vh) continue;
    const bg = cs.backgroundColor;
    const filled = bg !== 'rgba(0, 0, 0, 0)' && +(bg.split(',')[3] ?? 1) !== 0;
    const bordered = parseFloat(cs.borderTopWidth) > 0;
    if (filled || bordered || ['VIDEO', 'IMG', 'INPUT', 'TEXTAREA', 'BUTTON'].includes(el.tagName))
      boxes.push({ r: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)], tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().slice(0, 20) });
  }
  const p = window.probeHiker && window.probeHiker().hiker;
  let hiker = null;
  if (p) {
    const h = p.screen.height, x = p.screen.x, fy = p.screen.footY;
    const box = [x - h * 0.3, fy - h, x + h * 0.3, fy];
    const hits = [];
    const margin = 4;
    for (const t of texts) if (t.r[2] > box[0] - margin && t.r[0] < box[2] + margin && t.r[3] > box[1] - margin && t.r[1] < box[3] + margin) hits.push('text:' + t.text);
    for (const b of boxes) if (b.r[2] > box[0] && b.r[0] < box[2] && b.r[3] > box[1] && b.r[1] < box[3]) hits.push(b.tag + ':' + b.text);
    const inside = box[0] >= 0 && box[2] <= vw && box[1] >= 0 && box[3] <= vh;
    const outside = box[2] < 0 || box[0] > vw || box[3] < 0 || box[1] > vh;
    hiker = { x: Math.round(x), footY: Math.round(fy), height: Math.round(h), hits, visibility: +(p.visibility ?? 1).toFixed(2), state: (p.visibility ?? 1) < 0.5 ? 'faded behind ' + (hits[0] || 'content') : outside ? 'out of frame' : !inside ? 'half out of frame' : hits.length ? 'overlaps ' + hits.slice(0, 2).join(', ') : 'clear', journey: +p.journey.toFixed(3), walking: +p.walking.toFixed(2) };
  }
  return JSON.stringify({ vw, vh, scrollY: Math.round(scrollY), texts, hiker });
})()
