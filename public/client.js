// ── Clip web UI client ─────────────────────────────────────────────────────
const clips = [];
let searchQuery = '';
let LOCAL_NAME = '';
const PAGE_SIZE = 9;
let currentPage = 1;
let modalClipId = null;
let PEER_ADDR = '';
let loadFailed = false;

// ── WebSocket ──
function connectUI() {
  const ws = new WebSocket((location.protocol==='https:'?'wss':'ws')+'://'+location.host+'/ui');
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'new-clip') {
      clips.unshift(msg.clip);
      if (clips.length > 200) clips.pop();
      if (!searchQuery) { currentPage = 1; render(msg.clip.id); }
      flash(); confetti(); playClick();
      document.getElementById('sClips').textContent = clips.length;
      setTimeout(() => {
        const el = document.getElementById('c-' + msg.clip.id);
        if (el) { el.classList.remove('new'); el.classList.add('blink'); }
      }, 500);
    }
    if (msg.type === 'bump') {
      const idx = clips.findIndex(c => c.id === msg.clip.id);
      if (idx !== -1) clips.splice(idx, 1);
      clips.unshift(msg.clip);
      currentPage = 1;
      render(msg.clip.id);
      flash(); playClick();
    }
    if (msg.type === 'updated') {
      const c = clips.find(x => x.id === msg.id);
      if (c) { c.text = msg.text; c.preview = msg.text.slice(0,2000); render(); }
    }
    if (msg.type === 'delete') {
      const idx = clips.findIndex(c => c.id === msg.id);
      if (idx !== -1) clips.splice(idx, 1);
      favorited.delete(msg.id);
      document.getElementById('sClips').textContent = clips.length;
      playClick();
      const el = document.getElementById('c-' + msg.id);
      if (el) {
        el.classList.add('del-red');
        setTimeout(() => {
          el.classList.remove('del-red');
          el.classList.add('del-fade');
          setTimeout(() => { el.style.display = 'none'; }, 500);
        }, 1000);
      }
    }
    if (msg.type === 'dedup') loadClips();
    if (msg.type === 'peer') {
      document.getElementById('peerDot').className = 'dot ' + (msg.connected ? 'on' : 'off');
      document.getElementById('peerDot2').className = 'dot ' + (msg.connected ? 'on' : 'off');
      document.getElementById('peerName').textContent = msg.connected ? (PEER_ADDR || '') : '';
      document.getElementById('sPeerIp').style.opacity = msg.connected ? '1' : '.4';
    }
    if (msg.type === 'state') {
      document.getElementById('peerDot').className = 'dot ' + (msg.peerConnected ? 'on' : 'off');
      document.getElementById('peerDot2').className = 'dot ' + (msg.peerConnected ? 'on' : 'off');
      document.getElementById('peerName').textContent = msg.peerConnected ? (msg.peer || '') : '';
      PEER_ADDR = msg.peer || '';
      if (msg.localIp) document.getElementById('sLocalIp').textContent = msg.localIp;
      document.getElementById('sPeerIp').textContent = msg.peer || '-';
      document.getElementById('sPeerIp').style.opacity = msg.peerConnected ? '1' : '.4';
      document.getElementById('sPeerIp').title = msg.peerConnected ? 'Connected' : 'Offline - set CLIP_PEER=' + (msg.localIp || 'THIS_IP') + ' and the same CLIP_TOKEN on the other machine, then npm start';
    }
  };
  ws.onclose = () => setTimeout(connectUI, 2000);
  ws.onerror = () => ws.close();
}

// ── Load initial clips ──
async function loadClips() {
  setLoading();
  try {
    const r = await fetch('/api/clips');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    clips.length = 0;
    clips.push(...d.clips);
    loadFailed = false;
    render();
    document.getElementById('sClips').textContent = clips.length;
  } catch {
    loadFailed = true;
    render();
    toast('Could not load clips', 'red');
  }
}

function setLoading() {
  const empty = document.getElementById('emptyState');
  const msg = document.getElementById('emptyStateMsg');
  empty.classList.remove('is-error');
  msg.textContent = 'Loading...';
  empty.style.display = clips.length ? 'none' : 'block';
}

// ── Render ──
function render(newId, pageChange) {
  const list = document.getElementById('clipList');
  const empty = document.getElementById('emptyState');
  const emptyMsg = document.getElementById('emptyStateMsg');
  let items = clips;
  if (searchQuery) items = items.filter(c => c.text.toLowerCase().includes(searchQuery.toLowerCase()));

  if (loadFailed && !clips.length) {
    empty.classList.add('is-error');
    emptyMsg.innerHTML = 'Could not load clips <button class="retry" onclick="loadClips()">Retry</button>';
    empty.style.display = 'block';
    list.innerHTML = '';
    document.getElementById('pagBar').style.display = 'none';
    return;
  }
  empty.classList.remove('is-error');
  emptyMsg.textContent = 'Copy something to get started';
  empty.style.display = items.length ? 'none' : 'block';

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = items.slice(start, start + PAGE_SIZE);

  const pageColors = [
    [59,130,246], [6,182,212], [34,197,94], [168,85,247],
    [236,72,153], [245,158,11], [239,68,68], [99,102,241],
  ];
  const pc = pageColors[(currentPage - 1) % pageColors.length];
  const pcRgb = pc[0] + ',' + pc[1] + ',' + pc[2];
  list.style.setProperty('--page-color-border', 'rgba(' + pcRgb + ',.2)');
  list.style.setProperty('--page-color-hover', 'rgba(' + pcRgb + ',.12)');
  list.style.setProperty('--page-color-shadow', 'rgba(' + pcRgb + ',.15)');
  list.style.setProperty('--page-color-blink', 'rgba(' + pcRgb + ',.7)');
  list.style.setProperty('--page-color-blink-glow', 'rgba(' + pcRgb + ',.3)');
  list.style.setProperty('--pc', 'rgb(' + pcRgb + ')');
  document.querySelector('.root').style.background = 'radial-gradient(ellipse at 20% 50%,rgba(' + pcRgb + ',.15) 0%,transparent 60%),radial-gradient(ellipse at 80% 10%,rgba(' + pcRgb + ',.1) 0%,transparent 55%),#020203';
  list.style.setProperty('--glow-color', 'rgba(' + pcRgb + ',.4)');
  document.querySelectorAll('.logo-stroke.s2,.logo-stroke.s3,.logo-stroke.s4').forEach(el => { el.style.stroke = 'rgb(' + pcRgb + ')'; el.style.transition = 'stroke .4s'; });
  document.querySelector('.logo-icon rect:first-child').style.fill = 'rgba(' + pcRgb + ',.15)';
  document.querySelector('.logo-icon rect:first-child').style.transition = 'fill .4s';
  if (pageChange) {
    document.querySelectorAll('.logo-stroke').forEach(el => {
      el.style.animation = 'none';
      el.style.strokeDashoffset = '200';
      void el.getBoundingClientRect();
    });
    requestAnimationFrame(() => {
      document.querySelectorAll('.logo-stroke').forEach(el => {
        el.style.animation = '';
        el.style.strokeDashoffset = '';
      });
    });
  }

  list.innerHTML = pageItems.map((c, i) => {
    const isLocal = c.source === LOCAL_NAME;
    const mClass = isLocal ? 'm-local' : 'm-peer';
    const preview = searchQuery ? highlight(esc(c.preview), searchQuery) : esc(c.preview);
    const bgAlpha = Math.max(0, 0.18 - i * 0.015);
    const bgStyle = 'background:rgba(' + pc[0] + ',' + pc[1] + ',' + pc[2] + ',' + bgAlpha.toFixed(3) + ')';
    const lenLabel = c.length > 999 ? (c.length/1000).toFixed(1)+'k' : c.length;
    return '<div class="clip ' + mClass + (c.id === newId ? ' new' : '') + '" id="c-' + c.id + '" style="' + bgStyle + '" onclick="openModal(\''+c.id+'\')"><div class="meta"><div class="clip-actions"><button class="act-btn" aria-label="Copy clip" onclick="event.stopPropagation();quickCopy(\''+c.id+'\')" title="Copy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button><button class="act-btn del" aria-label="Delete clip" onclick="event.stopPropagation();delClip(\''+c.id+'\')" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button></div></div><div class="text">' + preview + '</div><div style="display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding-top:8px"><span style="font-size:8px;color:rgba(255,255,255,.2)">' + lenLabel + ' chars</span><span style="font-size:8px;color:rgba(255,255,255,.2)">' + ago(c.time) + '</span></div></div>';
  }).join('');

  const pagBar = document.getElementById('pagBar');
  if (totalPages > 1) {
    const pCol = 'rgba(' + pc[0] + ',' + pc[1] + ',' + pc[2];
    let pagHtml = '';
    pagHtml += '<button aria-label="Previous page" onclick="goPage(-1)" style="width:32px;height:32px;border-radius:50%;background:' + pCol + ',.06);border:1px solid ' + pCol + ',.15);color:' + pCol + ',.6);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center' + (currentPage<=1?';opacity:.25;pointer-events:none':'') + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></button>';
    for (let p = 1; p <= totalPages; p++) {
      const isActive = p === currentPage;
      const btnPc = pageColors[(p - 1) % pageColors.length];
      const btnCol = 'rgba(' + btnPc[0] + ',' + btnPc[1] + ',' + btnPc[2];
      pagHtml += '<button aria-label="Page ' + p + '" aria-current="' + (isActive ? 'true' : 'false') + '" onclick="currentPage='+p+';render(null,true)" style="width:32px;height:32px;border-radius:50%;font-size:11px;font-weight:600;cursor:pointer;border:' + (isActive ? '1px solid ' + btnCol + ',.8)' : '1px solid ' + btnCol + ',.15)') + ';background:' + (isActive ? 'rgb(' + btnPc[0] + ',' + btnPc[1] + ',' + btnPc[2] + ')' : btnCol + ',.06)') + ';color:' + (isActive ? '#fff' : btnCol + ',.5)') + '">' + p + '</button>';
    }
    pagHtml += '<button aria-label="Next page" onclick="goPage(1)" style="width:32px;height:32px;border-radius:50%;background:' + pCol + ',.06);border:1px solid ' + pCol + ',.15);color:' + pCol + ',.6);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center' + (currentPage>=totalPages?';opacity:.25;pointer-events:none':'') + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg></button>';
    pagBar.innerHTML = pagHtml;
    pagBar.style.display = 'flex';
  } else {
    pagBar.style.display = 'none';
  }

  if (pageChange) {
    const cards = list.querySelectorAll('.clip');
    cards.forEach((card, i) => {
      card.classList.add('page-in');
      card.style.animationDelay = (i * 0.08) + 's';
    });
  }
}

function goPage(dir) { currentPage += dir; render(null, true); }

// ── Modal ──
function openModal(id) {
  const c = clips.find(x => x.id === id);
  if (!c) return;
  modalClipId = id;
  const isLocal = c.source === LOCAL_NAME;
  document.getElementById('modalSource').innerHTML = '<svg style="width:12px;height:10px;opacity:.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg> ' + esc(c.source);
  document.getElementById('modalSource').style.color = isLocal ? 'rgba(255,255,255,.55)' : 'rgba(59,130,246,.7)';
  document.getElementById('modalTime').textContent = ago(c.time);
  document.getElementById('modalText').value = c.text;
  const openBtn = document.getElementById('modalOpen');
  const isUrl = /^https?:\/\//i.test(c.text.trim());
  openBtn.style.display = isUrl ? 'flex' : 'none';
  openBtn.onclick = () => window.open(c.text.trim(), '_blank');
  document.getElementById('modalStickies').style.display = c.text.length > 150 ? 'flex' : 'none';
  paintModalHeart(id);
  document.getElementById('clipModal').classList.add('show');
}

function closeModal() {
  document.getElementById('clipModal').classList.remove('show');
  modalClipId = null;
}

async function modalCopy() {
  const text = document.getElementById('modalText').value;
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied', 'green');
    closeModal();
  } catch { toast('Copy failed', 'red'); }
}

async function modalSave() {
  const text = document.getElementById('modalText').value;
  if (!text.trim()) return;
  try {
    await fetch('/api/clips/' + modalClipId, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ text }) });
    const c = clips.find(x => x.id === modalClipId);
    if (c) { c.text = text.trim(); c.preview = text.trim().slice(0,2000); }
    render();
    toast('Saved', 'blue');
  } catch { toast('Save failed', 'red'); }
}

function highlight(html, q) {
  if (!q) return html;
  const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi');
  return html.replace(re, '<mark>$1</mark>');
}

function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function ago(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s/60) + 'm';
  if (s < 86400) return Math.floor(s/3600) + 'h';
  return Math.floor(s/86400) + 'd';
}

// ── Quick actions ──
async function quickCopy(id) {
  const c = clips.find(x => x.id === id);
  if (!c) return;
  try { await navigator.clipboard.writeText(c.text); toast('Copied', 'green'); } catch { toast('Failed', 'red'); }
}

// Session-only, per-clip (not persisted server-side) - scoped by clip id so
// favoriting one clip never bleeds into another clip's modal.
const favorited = new Set();

function paintModalHeart(id) {
  const on = favorited.has(id);
  const btn = document.getElementById('modalHeart');
  btn.querySelector('svg path').setAttribute('fill', on ? 'currentColor' : 'none');
  btn.style.background = on ? 'rgba(244,114,182,.25)' : 'rgba(244,114,182,.1)';
}

function toggleModalHeart() {
  if (!modalClipId) return;
  const on = favorited.has(modalClipId);
  if (on) favorited.delete(modalClipId); else favorited.add(modalClipId);
  paintModalHeart(modalClipId);
  toast(on ? 'Unfavorited' : 'Favorited', '#ec4899');
}

async function sendToStickies() {
  const text = document.getElementById('modalText').value.trim();
  if (!text) return;
  const btn = document.getElementById('modalStickies');
  if (btn.dataset.busy) return;
  const original = btn.innerHTML;
  btn.dataset.busy = '1';
  btn.style.pointerEvents = 'none';
  btn.style.opacity = '.65';
  btn.innerHTML = '<svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
  toast('Sending to Stickies...', '#FFB300', false);
  const started = Date.now();
  try {
    const res = await fetch('/api/stickies', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ text }) });
    const data = await res.json();
    const wait = 500 - (Date.now() - started);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    if (data.ok) toast('Sent to Stickies', '#FFB300'); else toast('Stickies failed', 'red');
  } catch { toast('Stickies failed', 'red'); }
  finally {
    btn.innerHTML = original;
    btn.style.pointerEvents = '';
    btn.style.opacity = '';
    delete btn.dataset.busy;
  }
}

async function delClip(id) {
  try { await fetch('/api/clips/' + id, { method: 'DELETE' }); toast('Deleted', 'red'); } catch {}
}

async function dedupClips() {
  try {
    const r = await fetch('/api/dedup', { method: 'POST' });
    const d = await r.json();
    if (d.removed > 0) { toast(d.removed + ' dupes removed', 'blue'); loadClips(); }
    else toast('No dupes', 'blue');
  } catch { toast('Dedup failed', 'red'); }
}

async function modalDelete() {
  if (!modalClipId) return;
  await delClip(modalClipId);
  closeModal();
}

// ── QR ──
async function showQR() {
  try {
    const r = await fetch('/api/qr');
    const d = await r.json();
    document.getElementById('qrImg').src = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(d.url);
    document.getElementById('qrUrl').textContent = d.url;
    document.getElementById('qrOverlay').classList.add('show');
  } catch {}
}

// ── Sound ──
function playClick() {
  try {
    const ctx = new AudioContext();
    const g = ctx.createGain(); g.gain.setValueAtTime(0.08, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(1200, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.08);
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.08);
  } catch {}
}

// ── Flash ──
function flash() {
  const el = document.getElementById('flash');
  el.style.display = 'block';
  el.classList.remove('on'); el.offsetHeight; el.classList.add('on');
  setTimeout(() => { el.style.display = 'none'; el.classList.remove('on'); }, 750);
}

// ── Confetti ──
function confetti() {
  const canvas = document.getElementById('confetti');
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  canvas.style.display = 'block';
  const colors = ['#2563eb','#60a5fa','#93c5fd','#fff','#fbbf24','#a3e635','#bfdbfe'];
  const ps = Array.from({length:60}, () => ({
    x: Math.random()*canvas.width, y: -Math.random()*100,
    vx: (Math.random()-.5)*5, vy: Math.random()*6+4,
    w: Math.random()*10+4, h: Math.random()*5+3,
    color: colors[Math.floor(Math.random()*colors.length)],
    rot: Math.random()*360, rotV: (Math.random()-.5)*14,
  }));
  const start = Date.now();
  function tick() {
    const t = Date.now() - start;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    for (const p of ps) {
      p.x+=p.vx; p.y+=p.vy; p.vy+=0.15; p.rot+=p.rotV;
      ctx.save(); ctx.globalAlpha=Math.max(0,1-t/2400);
      ctx.translate(p.x,p.y); ctx.rotate(p.rot*Math.PI/180);
      ctx.fillStyle=p.color; ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);
      ctx.restore();
    }
    if (t < 2600) requestAnimationFrame(tick);
    else { ctx.clearRect(0,0,canvas.width,canvas.height); canvas.style.display='none'; }
  }
  requestAnimationFrame(tick);
}

// ── Toast — Stickies Dynamic Island style ──
const TOAST_COLORS = { green: '#34C759', red: '#FF3B30', blue: '#2563eb', orange: '#FF9500' };
const CONFETTI_COLORS = ['#fff','#FFD700','#a78bfa','#34d399','#f472b6','#60a5fa'];
const TOAST_ICONS = {
  green: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>',
  red: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><path d="M6 18L18 6M6 6l12 12"/></svg>',
  blue: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
};

function toast(msg, type, withConfetti) {
  type = type || 'blue';
  const color = TOAST_COLORS[type] || type;
  const el = document.getElementById('toast');
  const pill = document.getElementById('toastPill');
  const icon = document.getElementById('toastIcon');
  const msgEl = document.getElementById('toastMsg');

  pill.querySelectorAll('.confetti-dot').forEach(d => d.remove());

  msgEl.textContent = msg;
  icon.innerHTML = TOAST_ICONS[type] || TOAST_ICONS.blue;
  pill.style.background = color;
  pill.style.border = '1px solid ' + color + '99';
  pill.style.boxShadow = '0 8px 26px ' + color + '66';

  if (withConfetti !== false) {
    const count = withConfetti === 'big' ? 18 : 10;
    for (let i = 0; i < count; i++) {
      const dot = document.createElement('span');
      dot.className = 'confetti-dot';
      const angle = (360 / count) * i;
      const dist = (withConfetti === 'big' ? 44 : 24) + (i % 4) * 7;
      const rad = angle * Math.PI / 180;
      dot.style.cssText = '--cx:' + Math.cos(rad)*dist + 'px;--cy:' + Math.sin(rad)*dist + 'px;width:' + (2+(i%3)) + 'px;height:' + (2+(i%3)) + 'px;background:' + CONFETTI_COLORS[i%CONFETTI_COLORS.length] + ';animation-delay:' + (i*45) + 'ms';
      pill.appendChild(dot);
    }
  }

  el.classList.remove('show');
  el.offsetHeight;
  el.classList.add('show');
  clearTimeout(window.__toastT);
  window.__toastT = setTimeout(() => { el.classList.remove('show'); }, 3000);
}

// ── Search Modal (Cmd+K) ──
let searchModalIdx = 0;
let searchModalItems = [];

function openSearchModal() {
  document.getElementById('searchModal').classList.add('show');
  const input = document.getElementById('searchModalInput');
  input.value = '';
  searchModalIdx = 0;
  renderSearchModal(clips);
  input.focus();
}

function closeSearchModal() {
  document.getElementById('searchModal').classList.remove('show');
}

function onSearchModal(q) {
  const filtered = q ? clips.filter(c => c.text.toLowerCase().includes(q.toLowerCase())) : clips;
  searchModalIdx = 0;
  renderSearchModal(filtered);
}

function renderSearchModal(items) {
  searchModalItems = items;
  const container = document.getElementById('searchModalResults');
  if (!items.length) { container.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(255,255,255,.15);font-size:12px">No results</div>'; return; }
  container.innerHTML = items.slice(0, 20).map((c, i) =>
    '<div class="search-modal-item' + (i === searchModalIdx ? ' active' : '') + '" onclick="selectSearchItem(\''+c.id+'\')"><span class="sk-time">' + ago(c.time) + '</span>' + esc(c.preview.slice(0, 100)) + '</div>'
  ).join('');
}

function searchModalKey(e) {
  const max = Math.min(searchModalItems.length, 20);
  if (e.key === 'ArrowDown') { e.preventDefault(); searchModalIdx = (searchModalIdx + 1) % max; renderSearchModal(searchModalItems); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); searchModalIdx = (searchModalIdx - 1 + max) % max; renderSearchModal(searchModalItems); }
  else if (e.key === 'Enter' && searchModalItems[searchModalIdx]) { e.preventDefault(); selectSearchItem(searchModalItems[searchModalIdx].id); }
  else if (e.key === 'Escape') { closeSearchModal(); }
}

function selectSearchItem(id) {
  closeSearchModal();
  openModal(id);
}

// ── Keyboard ──
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('searchModal').classList.contains('show')) { closeSearchModal(); return; }
    document.getElementById('qrOverlay').classList.remove('show');
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    openSearchModal();
  }
});

// ── Init ──
async function init() {
  try {
    const r = await fetch('/api/config');
    const d = await r.json();
    LOCAL_NAME = d.name || '';
  } catch {}
  await loadClips();
  connectUI();
}
init();
setInterval(() => { if (!searchQuery) render(); }, 30000); // refresh ages
