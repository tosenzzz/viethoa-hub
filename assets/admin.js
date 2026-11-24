// Trang admin: sửa games.json, ảnh bìa, patch, QR trong repo source qua GitHub API.
// Mỗi lần "Lưu & Deploy" = 1 commit (Git Data API) → GitHub Actions build lại site.
(() => {
  const CFG = JSON.parse(document.body.dataset.config || '{}');
  const qs = new URLSearchParams(location.search);
  const GH = (qs.get('gh') || 'https://api.github.com').replace(/\/$/, ''); // ?gh= để test với API giả
  const BRANCH = CFG.branch || 'main';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const mb = (n) => (n >= 1 << 20 ? (n / (1 << 20)).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const today = () => { const d = new Date(); return [d.getDate(), d.getMonth() + 1].map((x) => String(x).padStart(2, '0')).join('.') + '.' + d.getFullYear(); };
  const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const MANAGED = (p) => p === 'qr.png' || p.startsWith('covers/') || p.startsWith('patches/');
  const DEFAULT_NOTE = 'Mỗi ngày sẽ tăng lên 1 điểm, khi đạt 500 điểm sẽ phát hành bản dịch. Nếu bạn ủng hộ người dịch 1k sẽ tăng lên 1 điểm.';

  let token = null;
  let S = null; // { headSha, treeSha, tree: Map<path, sha>, sizes: Map<path, size>, data: {site, games}, qr, loadedSig }
  let sel = 0; // chỉ số game đang sửa, hoặc 'site'
  let saving = false;

  // ---------- GitHub API ----------
  async function gh(p, opt = {}) {
    const url = /^https?:/.test(p) ? p : `${GH}/repos/${CFG.repo}/${p}`;
    const r = await fetch(url, {
      method: opt.method || 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...(opt.body ? { 'Content-Type': 'application/json' } : {}) },
      body: opt.body ? JSON.stringify(opt.body) : undefined,
      cache: 'no-store',
    });
    const d = r.status === 204 ? null : await r.json().catch(() => null);
    if (!r.ok) {
      const e = new Error((d && d.message) || 'HTTP ' + r.status);
      e.status = r.status;
      throw e;
    }
    return d;
  }
  const utf8 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
  const toB64 = (bytes) => new Promise((ok, bad) => {
    const fr = new FileReader();
    fr.onload = () => ok(fr.result.slice(fr.result.indexOf(',') + 1));
    fr.onerror = () => bad(fr.error);
    fr.readAsDataURL(new Blob([bytes]));
  });

  async function load() {
    const ref = await gh(`git/ref/heads/${BRANCH}`);
    const commit = await gh(`git/commits/${ref.object.sha}`);
    const tr = await gh(`git/trees/${commit.tree.sha}?recursive=1`);
    const tree = new Map(), sizes = new Map();
    for (const e of tr.tree) if (e.type === 'blob') { tree.set(e.path, e.sha); sizes.set(e.path, e.size); }
    if (!tree.has('games.json')) throw new Error('Repo không có games.json');
    const data = JSON.parse(utf8((await gh(`git/blobs/${tree.get('games.json')}`)).content));
    for (const g of data.games) {
      const c = ['png', 'jpg', 'webp'].map((e) => `covers/${g.slug}.${e}`).find((p) => tree.has(p));
      g._cover = c ? { origin: c } : null;
      for (const p of g.patches || []) p._origin = `patches/${g.slug}/${p.file}`;
    }
    S = { headSha: ref.object.sha, treeSha: commit.tree.sha, tree, sizes, data, qr: tree.has('qr.png') ? { origin: 'qr.png' } : null };
    S.loadedSig = sig();
    if (sel !== 'site' && !(sel < data.games.length)) sel = 0;
  }

  // Chữ ký để biết có thay đổi chưa lưu (bytes mới tính theo độ dài).
  const sig = () => JSON.stringify({ d: S.data, q: S.qr }, (k, v) => (k === 'bytes' ? 'new:' + v.length : k === 'url' || k === '_autoSlug' ? undefined : v));
  const dirty = () => S && sig() !== S.loadedSig;

  // ---------- Đăng nhập ----------
  $('#repoName').textContent = CFG.repo;
  try { token = localStorage.getItem('vh-gh') || sessionStorage.getItem('vh-gh'); } catch {}

  async function enter() {
    const msg = $('#loginMsg');
    msg.className = 'msg';
    msg.textContent = 'Đang kiểm tra…';
    try {
      const repo = await gh(`${GH}/repos/${CFG.repo}`);
      if (repo.permissions && !repo.permissions.push) throw new Error('Token chỉ có quyền đọc. Cần Contents: Read and write.');
      await load();
      gh(`${GH}/user`).then((u) => ($('#who').textContent = '@' + u.login)).catch(() => {});
      $('#login').hidden = true;
      $('#main').hidden = false;
      $('#savebar').hidden = false;
      $('#logout').hidden = false;
      render();
    } catch (e) {
      msg.className = 'msg err';
      msg.textContent = e.status === 401 ? 'Token sai hoặc đã hết hạn.' : e.status === 404 ? 'Token không truy cập được repo ' + CFG.repo + '.' : e.message;
      $('#login').hidden = false;
    }
  }
  $('#loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    token = $('#token').value.trim();
    try {
      ($('#remember').checked ? localStorage : sessionStorage).setItem('vh-gh', token);
    } catch {}
    enter();
  });
  $('#logout').addEventListener('click', () => {
    if (dirty() && !confirm('Còn thay đổi chưa lưu. Vẫn đăng xuất?')) return;
    try { localStorage.removeItem('vh-gh'); sessionStorage.removeItem('vh-gh'); } catch {}
    S = null;
    location.reload();
  });
  addEventListener('beforeunload', (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });
  if (token) enter();

  // ---------- Danh sách ----------
  const coverSrc = (c) => (!c ? '' : c.url || '../assets/' + c.origin);
  function renderList() {
    const games = S.data.games;
    $('#count').textContent = games.length;
    $('#glist').innerHTML = games.map((g, i) => `<li class="${sel === i ? 'on' : ''}" data-i="${i}">
      <span class="thumb" style="--c1:${esc(g.accent?.[0] || '#6366f1')};--c2:${esc(g.accent?.[1] || '#a855f7')}">${g._cover ? `<img src="${esc(coverSrc(g._cover))}" alt="">` : ''}</span>
      <span class="gt"><b>${esc(g.title || '(chưa đặt tên)')}</b><small>${esc(g.platform || '')} · ${g.funding ? esc(g.status || 'Đang dịch') : 'v' + esc(g.version || '?')}</small></span>
      <span class="ord"><button type="button" data-move="-1" title="Lên" ${i === 0 ? 'disabled' : ''}>▲</button><button type="button" data-move="1" title="Xuống" ${i === games.length - 1 ? 'disabled' : ''}>▼</button></span>
    </li>`).join('');
    $('#siteBtn').classList.toggle('on', sel === 'site');
    updateBar();
  }
  $('#glist').addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const i = +li.dataset.i;
    const mv = e.target.closest('[data-move]');
    if (mv) {
      const j = i + +mv.dataset.move;
      const g = S.data.games;
      [g[i], g[j]] = [g[j], g[i]];
      if (sel === i) sel = j; else if (sel === j) sel = i;
      renderList();
      return;
    }
    sel = i;
    render();
  });
  $('#siteBtn').addEventListener('click', () => { sel = 'site'; render(); });
  $('#addGame').addEventListener('click', () => {
    S.data.games.unshift({
      slug: '', title: '', version: '', platform: 'GBA', series: '', tags: [], accent: ['#6366f1', '#a855f7'],
      blurb: '', about: [], source: [], patches: [], output: '', notes: [], vn: '', date: today(),
      _cover: null, _autoSlug: true,
    });
    sel = 0;
    render();
    $('#editor [data-k="title"]')?.focus();
  });

  // ---------- Form ----------
  const platforms = () => [...new Set(['GBA', 'SNES', 'NES', 'NDS', ...S.data.games.map((g) => g.platform).filter(Boolean)])];
  const seriesList = () => [...new Set(['Pokémon', 'Fire Emblem', ...S.data.games.map((g) => g.series).filter(Boolean)])];
  const field = (label, k, { type = 'text', val, hint = '', ph = '', list = '', attrs = '' } = {}) => `<label class="f"><span>${label}</span>
    ${type === 'textarea'
      ? `<textarea data-k="${k}" placeholder="${esc(ph)}" ${attrs}>${esc(val)}</textarea>`
      : `<input type="${type}" data-k="${k}" value="${esc(val)}" placeholder="${esc(ph)}" ${list ? `list="${list}"` : ''} ${attrs}>`}
    ${hint ? `<small>${hint}</small>` : ''}</label>`;

  function render() {
    renderList();
    const ed = $('#editor');
    if (sel === 'site') return renderSite(ed);
    const g = S.data.games[sel];
    if (!g) { ed.innerHTML = '<div class="panel"><p>Chưa có game nào. Bấm “+ Thêm”.</p></div>'; return; }
    const funding = !!g.funding;
    const liveUrl = `../game/${encodeURIComponent(g.slug)}/`;
    ed.innerHTML = `
<div class="panel">
  <div class="ed-head">
    <h2>${esc(g.title || 'Game mới')}</h2>
    <a class="btn ghost sm" href="${liveUrl}" target="_blank" rel="noopener">Xem trên site</a>
    <button class="btn danger sm" type="button" data-act="delete">Xoá game</button>
  </div>
  <div class="mode" role="radiogroup">
    <label><input type="radio" name="mode" value="released" ${funding ? '' : 'checked'}> Đã phát hành <small>có patch, vá trên web</small></label>
    <label><input type="radio" name="mode" value="funding" ${funding ? 'checked' : ''}> Đang dịch <small>hiện điểm quyên góp</small></label>
  </div>
  <div class="grid2">
    ${field('Tên game', 'title', { val: g.title, ph: 'Pokémon …' })}
    ${field('Slug (đường dẫn)', 'slug', { val: g.slug, hint: `…/game/<b>${esc(g.slug || '…')}</b>/${funding ? ' · đổi slug là mất điểm đã cộng' : ''}`, attrs: 'pattern="[a-z0-9-]+" spellcheck="false"' })}
    ${field('Phiên bản', 'version', { val: g.version, ph: '1.0' })}
    ${field('Ngày cập nhật', 'date', { val: g.date, ph: 'dd.mm.yyyy', hint: '<button type="button" class="link" data-act="today">Hôm nay</button>' })}
    ${field('Hệ máy', 'platform', { val: g.platform, list: 'dl-platform' })}
    ${field('Series', 'series', { val: g.series, list: 'dl-series' })}
  </div>
  ${field('Tag', 'tags', { val: (g.tags || []).join(', '), hint: 'Cách nhau bằng dấu phẩy', attrs: 'data-split=","' })}
  ${funding ? `<div class="grid2">
    ${field('Chữ trạng thái', 'status', { val: g.status, ph: 'Đang dịch...' })}
  </div>
  ${field('Ghi chú quyên góp', 'funding.note', { type: 'textarea', val: g.funding.note, attrs: 'rows="3"' })}` : ''}
  <datalist id="dl-platform">${platforms().map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
  <datalist id="dl-series">${seriesList().map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
</div>

<div class="panel">
  <h2>Ảnh bìa &amp; màu</h2>
  <div class="cover-row">
    <div class="cover-prev" style="--c1:${esc(g.accent?.[0])};--c2:${esc(g.accent?.[1])}">
      ${g._cover ? `<img src="${esc(coverSrc(g._cover))}" alt="">` : ''}<span>${esc(g.title)}</span>
    </div>
    <div class="cover-ctl">
      <label class="btn ghost sm file"><input type="file" accept="image/png,image/jpeg,image/webp" data-act="cover"> ${g._cover ? 'Đổi ảnh' : 'Chọn ảnh'}</label>
      ${g._cover ? '<button class="btn ghost sm" type="button" data-act="nocover">Bỏ ảnh</button>' : ''}
      <small>PNG/JPG/WebP, ngang ~16:9. Không có ảnh thì dùng nền màu.</small>
      <div class="colors">
        <label>Màu 1 <input type="color" data-k="accent.0" value="${esc(g.accent?.[0] || '#6366f1')}"></label>
        <label>Màu 2 <input type="color" data-k="accent.1" value="${esc(g.accent?.[1] || '#a855f7')}"></label>
      </div>
    </div>
  </div>
</div>

<div class="panel">
  <h2>Nội dung</h2>
  ${field('Mô tả ngắn (thẻ ở trang chủ)', 'blurb', { type: 'textarea', val: g.blurb, attrs: 'rows="2"' })}
  ${field('Giới thiệu', 'about', { type: 'textarea', val: [].concat(g.about || []).join('\n\n'), hint: 'Mỗi đoạn cách nhau một dòng trống', attrs: 'rows="9" data-split="para"' })}
  ${field('Nguồn', 'source', { type: 'textarea', val: [].concat(g.source || []).join('\n'), hint: 'Mỗi dòng một URL', attrs: 'rows="2" data-split="line" spellcheck="false"' })}
  ${field('Bản Việt hóa', 'vn', { type: 'textarea', val: g.vn, attrs: 'rows="2"', ph: 'Dịch hội thoại, menu…' })}
  ${field('Ghi chú thêm', 'notes', { type: 'textarea', val: (g.notes || []).join('\n'), hint: 'Mỗi dòng một ý', attrs: 'rows="2" data-split="line"' })}
</div>

<div class="panel">
  <h2>Patch ${funding ? '<small class="muted">(chưa cần khi đang dịch)</small>' : ''}</h2>
  <div class="patches">${(g.patches || []).map((p, j) => patchRow(p, j)).join('') || '<p class="muted">Chưa có patch.</p>'}</div>
  <label class="btn ghost sm file"><input type="file" accept=".bps" multiple data-act="patch"> + Thêm patch (.bps)</label>
  <small class="muted block">Thả file cùng tên để thay patch cũ. Tên có <code>VN_ONLY</code> được hiểu là vá lên bản tiếng Anh.</small>
  ${field('Tên file ra', 'output', { val: g.output, ph: 'Tên game v1.0.vn.gba', hint: 'Tên file trình duyệt lưu sau khi vá' })}
</div>

${funding && CFG.api ? `<div class="panel" id="points">
  <h2>Điểm quyên góp</h2>
  <p class="pts"><b data-p="current">…</b> / <span data-p="target">…</span> điểm · mỗi ngày <span data-p="daily">…</span> · ủng hộ <span data-p="bonus">…</span></p>
  <form class="pts-form" data-act-form="points">
    <input type="password" name="key" placeholder="API key" autocomplete="off" value="${esc(apiKey())}">
    <input type="number" name="add" step="1" placeholder="Cộng (âm để trừ)" required>
    <button class="btn sm" type="submit">Cộng điểm</button>
  </form>
  <p class="msg" data-p="msg"></p>
</div>` : ''}`;
    if (funding && CFG.api) loadPoints(g);
  }

  function patchRow(p, j) {
    const size = p._bytes ? p._bytes.length : S.sizes.get(p._origin);
    return `<div class="prow" data-j="${j}">
      <div class="pname"><b>${esc(p.file)}</b> ${p._bytes ? '<em class="new">mới</em>' : ''}<small>${size ? mb(size) : ''}${p._crc ? ` · cần ROM CRC32 <code>${p._crc}</code>` : ''}</small></div>
      <select data-pk="kind"><option value="full" ${p.kind === 'full' ? 'selected' : ''}>Vá lên ROM gốc</option><option value="vn" ${p.kind === 'vn' ? 'selected' : ''}>Vá lên bản tiếng Anh</option></select>
      <input data-pk="base" value="${esc(p.base)}" placeholder="Tên ROM cần dùng, VD: Pokemon - FireRed Version (USA).gba">
      <input data-pk="baseSha1" value="${esc(p.baseSha1)}" placeholder="SHA-1 của ROM đó (tuỳ chọn)" spellcheck="false">
      <button type="button" class="x" data-act="rmpatch" title="Xoá patch">✕</button>
    </div>`;
  }

  function renderSite(ed) {
    const s = S.data.site;
    ed.innerHTML = `<div class="panel">
  <h2>Cài đặt site</h2>
  <div class="grid2">
    ${field('Tên site', 'name', { val: s.name })}
    ${field('API điểm (ts_api)', 'api', { val: s.api, attrs: 'spellcheck="false"' })}
    ${field('Email liên hệ', 'email', { val: s.email, type: 'email' })}
    ${field('Telegram', 'telegram', { val: s.telegram, hint: 'Không có @' })}
  </div>
  ${field('Khẩu hiệu', 'tagline', { type: 'textarea', val: s.tagline, attrs: 'rows="2"' })}
  ${field('Câu ủng hộ', 'donate', { type: 'textarea', val: s.donate, attrs: 'rows="2"' })}
</div>
<div class="panel">
  <h2>Mã QR ủng hộ</h2>
  <div class="cover-row">
    ${S.qr ? `<img class="qr-prev" src="${esc(S.qr.url || '../assets/qr.png')}" alt="QR">` : '<p class="muted">Chưa có QR.</p>'}
    <div class="cover-ctl">
      <label class="btn ghost sm file"><input type="file" accept="image/png,image/jpeg" data-act="qr"> ${S.qr ? 'Đổi ảnh QR' : 'Chọn ảnh QR'}</label>
      ${S.qr ? '<button class="btn ghost sm" type="button" data-act="noqr">Bỏ QR</button>' : ''}
    </div>
  </div>
</div>`;
  }

  // Gán giá trị form vào object
  function setVal(obj, k, el) {
    let v = el.value;
    const split = el.dataset.split;
    if (split === ',') v = v.split(',').map((x) => x.trim()).filter(Boolean);
    else if (split === 'line') v = v.split('\n').map((x) => x.trim()).filter(Boolean);
    else if (split === 'para') v = v.split(/\n\s*\n/).map((x) => x.trim().replace(/\s*\n\s*/g, ' ')).filter(Boolean);
    const path = k.split('.');
    let o = obj;
    while (path.length > 1) { const p = path.shift(); o = o[p] ??= {}; }
    o[path[0]] = v;
  }

  const ed = $('#editor');
  ed.addEventListener('input', (e) => {
    const el = e.target;
    if (sel === 'site') {
      if (el.dataset.k) { setVal(S.data.site, el.dataset.k, el); updateBar(); }
      return;
    }
    const g = S.data.games[sel];
    if (el.dataset.k) {
      if (el.dataset.k === 'slug') { el.value = slugify(el.value.replace(/-$/, ' ')) + (el.value.endsWith('-') ? '-' : ''); g._autoSlug = false; }
      setVal(g, el.dataset.k, el);
      if (el.dataset.k === 'title' && g._autoSlug) {
        g.slug = slugify(g.title);
        const s = $('[data-k="slug"]', ed);
        if (s) s.value = g.slug;
      }
      if (el.dataset.k === 'slug' || el.dataset.k === 'title') {
        const h = $('[data-k="slug"]', ed)?.parentElement.querySelector('small b');
        if (h) h.textContent = g.slug || '…';
        $('.ed-head h2', ed).textContent = g.title || 'Game mới';
        $('.cover-prev span', ed).textContent = g.title;
      }
      if (el.dataset.k.startsWith('accent')) {
        $('.cover-prev', ed).style.setProperty('--c' + (+el.dataset.k.slice(-1) + 1), el.value);
      }
      renderList();
    } else if (el.dataset.pk) {
      const p = g.patches[+el.closest('.prow').dataset.j];
      p[el.dataset.pk] = el.value.trim();
      if (el.dataset.pk === 'baseSha1' && !p.baseSha1) delete p.baseSha1;
      updateBar();
    }
  });

  ed.addEventListener('change', async (e) => {
    const el = e.target;
    if (el.name === 'mode') {
      const g = S.data.games[sel];
      if (el.value === 'funding') { g.status ||= 'Đang dịch...'; g.funding ||= { note: DEFAULT_NOTE }; }
      else { delete g.funding; delete g.status; }
      return render();
    }
    const act = el.dataset.act;
    if (!act || !el.files?.length) return;
    try {
      if (act === 'cover') {
        const f = el.files[0];
        const g = S.data.games[sel];
        const ext = f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : 'jpg';
        g._cover = { bytes: new Uint8Array(await f.arrayBuffer()), ext, url: URL.createObjectURL(f) };
      } else if (act === 'qr') {
        const f = el.files[0];
        S.qr = { bytes: new Uint8Array(await f.arrayBuffer()), url: URL.createObjectURL(f) };
      } else if (act === 'patch') {
        const g = S.data.games[sel];
        for (const f of el.files) await addPatch(g, f);
      }
      render();
    } catch (err) {
      alert(err.message);
    }
  });

  async function addPatch(g, f) {
    if (!/\.bps$/i.test(f.name)) throw new Error(f.name + ': chỉ nhận file .bps');
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'BPS1') throw new Error(f.name + ': không phải BPS.');
    const crc = new DataView(bytes.buffer).getUint32(bytes.length - 12, true).toString(16).padStart(8, '0');
    g.patches ||= [];
    let p = g.patches.find((x) => x.file === f.name);
    const vn = /VN_ONLY/i.test(f.name);
    if (!p) {
      const same = g.patches.find((x) => x.kind === (vn ? 'vn' : 'full'));
      p = { file: f.name, base: same ? same.base : '', kind: vn ? 'vn' : 'full' };
      if (same?.baseSha1 && !vn) p.baseSha1 = same.baseSha1;
      g.patches.push(p);
      g.patches.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'full' ? -1 : 1));
    }
    p._bytes = bytes;
    p._crc = crc;
    g.date = today();
    if (!vn && !g.output) g.output = f.name.replace(/\.bps$/i, g.platform === 'SNES' ? '.sfc' : g.platform === 'NES' ? '.nes' : g.platform === 'NDS' ? '.nds' : '.gba');
  }

  ed.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.tagName === 'INPUT') return;
    const g = S.data.games[sel];
    switch (b.dataset.act) {
      case 'delete':
        if (!confirm(`Xoá "${g.title || 'game mới'}" khỏi site? Patch và ảnh bìa của game cũng bị xoá khỏi repo khi bấm Lưu.`)) return;
        S.data.games.splice(sel, 1);
        sel = Math.min(sel, S.data.games.length - 1);
        return render();
      case 'today':
        g.date = today();
        $('[data-k="date"]', ed).value = g.date;
        return updateBar();
      case 'nocover': g._cover = null; return render();
      case 'noqr': S.qr = null; return render();
      case 'rmpatch': g.patches.splice(+b.closest('.prow').dataset.j, 1); return render();
    }
  });

  // ---------- Điểm quyên góp (ts_api) ----------
  function apiKey() { try { return sessionStorage.getItem('vh-key') || ''; } catch { return ''; } }
  const ptsUrl = (g) => `${CFG.api}/v1/viethoa/${encodeURIComponent(g.slug)}/points`;
  function showPoints(d) {
    for (const k of ['current', 'target', 'daily', 'bonus']) { const n = $(`#points [data-p="${k}"]`); if (n) n.textContent = d[k]; }
  }
  function loadPoints(g) {
    fetch(ptsUrl(g)).then((r) => r.json()).then(showPoints).catch(() => { const n = $('#points [data-p="current"]'); if (n) n.textContent = '?'; });
  }
  ed.addEventListener('submit', async (e) => {
    if (!e.target.matches('[data-act-form="points"]')) return;
    e.preventDefault();
    const f = e.target, g = S.data.games[sel], msg = $('#points [data-p="msg"]');
    const key = f.key.value.trim(), add = Number(f.add.value);
    try { sessionStorage.setItem('vh-key', key); } catch {}
    try {
      if (!Number.isInteger(add) || add === 0) throw new Error('Nhập số nguyên khác 0.');
      const r = await fetch(ptsUrl(g), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: key }, body: JSON.stringify({ add }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(r.status === 401 ? 'Sai API key.' : d.error || 'Lỗi ' + r.status);
      showPoints(d);
      msg.className = 'msg ok';
      msg.textContent = `Đã ${add > 0 ? 'cộng' : 'trừ'} ${Math.abs(add)} điểm → ${d.current}/${d.target}. Điểm cập nhật ngay, không cần Lưu.`;
      f.add.value = '';
    } catch (err) {
      msg.className = 'msg err';
      msg.textContent = err.message;
    }
  });

  // ---------- Lưu ----------
  function updateBar() {
    if (!S || saving) return;
    const d = dirty();
    $('#dirty').textContent = d ? 'Có thay đổi chưa lưu' : 'Đã lưu hết';
    $('#dirty').className = d ? 'warn' : '';
    $('#save').disabled = !d;
    $('#discard').disabled = !d;
  }

  function validate() {
    const errs = [], seen = new Set();
    S.data.games.forEach((g, i) => {
      const name = g.title || `Game #${i + 1}`;
      if (!g.title) errs.push(`${name}: chưa có tên.`);
      if (!/^[a-z0-9-]+$/.test(g.slug || '')) errs.push(`${name}: slug chỉ gồm a-z, 0-9, dấu gạch.`);
      else if (seen.has(g.slug)) errs.push(`${name}: slug "${g.slug}" bị trùng.`);
      seen.add(g.slug);
      if (!g.funding) {
        if (!g.patches?.length) errs.push(`${name}: game đã phát hành cần ít nhất 1 patch (hoặc chuyển sang "Đang dịch").`);
        if (!g.output) errs.push(`${name}: chưa có tên file ra.`);
      }
      const files = new Set();
      for (const p of g.patches || []) {
        if (files.has(p.file)) errs.push(`${name}: trùng patch ${p.file}.`);
        files.add(p.file);
        if (!p.base) errs.push(`${name}: patch ${p.file} chưa ghi ROM cần dùng.`);
      }
    });
    return errs;
  }

  $('#discard').addEventListener('click', async () => {
    if (!confirm('Bỏ mọi thay đổi chưa lưu?')) return;
    await load();
    render();
  });

  $('#save').addEventListener('click', async () => {
    const msg = $('#saveMsg');
    const errs = validate();
    if (errs.length) { msg.className = 'msg err'; msg.innerHTML = errs.map(esc).join('<br>'); return; }
    saving = true;
    $('#save').disabled = $('#discard').disabled = true;
    const say = (t, cls = '') => { msg.className = 'msg ' + cls; msg.innerHTML = t; };
    try {
      say('Kiểm tra repo…');
      const ref = await gh(`git/ref/heads/${BRANCH}`);
      if (ref.object.sha !== S.headSha) throw new Error('Repo vừa có commit khác (từ máy khác hoặc tab khác). Bấm "Bỏ thay đổi" để tải lại rồi sửa lại.');

      const want = new Map(); // path -> {sha} | {bytes, name}
      if (S.qr) want.set('qr.png', S.qr.bytes ? { bytes: S.qr.bytes, name: 'QR' } : { sha: S.tree.get(S.qr.origin) });
      for (const g of S.data.games) {
        if (g._cover) {
          const ext = g._cover.bytes ? g._cover.ext : g._cover.origin.split('.').pop();
          want.set(`covers/${g.slug}.${ext}`, g._cover.bytes ? { bytes: g._cover.bytes, name: 'ảnh bìa ' + g.title } : { sha: S.tree.get(g._cover.origin) });
        }
        for (const p of g.patches || []) {
          want.set(`patches/${g.slug}/${p.file}`, p._bytes ? { bytes: p._bytes, name: p.file } : { sha: S.tree.get(p._origin) });
        }
      }
      const entries = [];
      for (const [path, w] of want) {
        let sha = w.sha;
        if (w.bytes) {
          say(`Đang tải lên ${esc(w.name)} (${mb(w.bytes.length)})…`);
          sha = (await gh('git/blobs', { method: 'POST', body: { content: await toB64(w.bytes), encoding: 'base64' } })).sha;
        }
        if (!sha) throw new Error('Không tìm thấy file cũ cho ' + path);
        if (S.tree.get(path) !== sha) entries.push({ path, mode: '100644', type: 'blob', sha });
      }
      for (const path of S.tree.keys()) if (MANAGED(path) && !want.has(path)) entries.push({ path, mode: '100644', type: 'blob', sha: null });
      const json = JSON.stringify(S.data, (k, v) => (k.startsWith('_') ? undefined : v), 2) + '\n';
      entries.push({ path: 'games.json', mode: '100644', type: 'blob', content: json });

      say('Đang tạo commit…');
      const tree = await gh('git/trees', { method: 'POST', body: { base_tree: S.treeSha, tree: entries } });
      const message = $('#commitMsg').value.trim() || 'Admin: cập nhật site';
      const commit = await gh('git/commits', { method: 'POST', body: { message, tree: tree.sha, parents: [S.headSha] } });
      await gh(`git/refs/heads/${BRANCH}`, { method: 'PATCH', body: { sha: commit.sha } });
      $('#commitMsg').value = '';
      await load();
      saving = false;
      render();
      say(`Đã lưu (commit <code>${commit.sha.slice(0, 7)}</code>). Đang chờ GitHub Actions build…`, 'ok');
      watchBuild(commit.sha, say);
    } catch (err) {
      say(esc(err.message), 'err');
    } finally {
      saving = false;
      updateBar();
    }
  });

  async function watchBuild(sha, say) {
    const actions = `https://github.com/${CFG.repo}/actions`;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      let run;
      try { run = (await gh(`actions/runs?head_sha=${sha}&per_page=1`)).workflow_runs[0]; }
      catch (e) {
        if (e.status === 403 || e.status === 404) return say(`Đã lưu. Token không có quyền Actions nên không theo dõi được build, xem ở <a href="${actions}" target="_blank" rel="noopener">GitHub Actions</a>. Site cập nhật sau 1–2 phút.`, 'ok');
        continue;
      }
      if (!run) continue;
      const link = `<a href="${esc(run.html_url)}" target="_blank" rel="noopener">xem log</a>`;
      if (run.status !== 'completed') { say(`Đang build site (${esc(run.status)})… ${link}`, 'ok'); continue; }
      if (run.conclusion === 'success') return say(`Build xong. GitHub Pages cần thêm khoảng 1 phút để site mới hiện ra. ${link}`, 'ok');
      return say(`Build lỗi (${esc(run.conclusion)}). ${link}`, 'err');
    }
    say(`Chưa thấy build xong, xem ở <a href="${actions}" target="_blank" rel="noopener">GitHub Actions</a>.`, 'err');
  }
})();
