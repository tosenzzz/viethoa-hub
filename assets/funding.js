// Điểm quyên góp cho bản dịch chưa phát hành (API ts_api /v1/viethoa/<slug>/points).
// Admin: mở trang với ?key=<key>. Key được nhớ trong tab (sessionStorage) để chuyển trang vẫn giữ.
(() => {
  const boxes = [...document.querySelectorAll('[data-fund]')];
  const forms = [...document.querySelectorAll('[data-fund-admin]')];
  if (!boxes.length && !forms.length) return;

  let key = null;
  try {
    key = new URLSearchParams(location.search).get('key');
    if (key) sessionStorage.setItem('vh-key', key);
    else key = sessionStorage.getItem('vh-key');
  } catch {}

  const fmt = (n) => Number(n).toLocaleString('vi-VN');
  const pad = (n) => String(n).padStart(2, '0');
  const eta = (d) => {
    if (d.done) return 'Đã đủ điểm!';
    const t = new Date(Date.now() + (d.target - d.current) * 864e5);
    return `${pad(t.getDate())}/${pad(t.getMonth() + 1)}/${t.getFullYear()}`;
  };

  function render(url, d) {
    const pct = Math.min(100, (d.current / d.target) * 100);
    for (const el of boxes.filter((b) => b.dataset.fund === url)) {
      el.classList.remove('loading');
      el.classList.toggle('done', !!d.done);
      const bar = el.querySelector('.fbar i');
      if (bar) bar.style.width = pct.toFixed(2) + '%';
      el.querySelectorAll('[data-f]').forEach((n) => {
        const k = n.dataset.f;
        n.textContent =
          k === 'left' ? fmt(Math.max(0, d.target - d.current)) :
          k === 'pct' ? Math.floor(pct) + '%' :
          k === 'eta' ? eta(d) :
          fmt(d[k] ?? 0);
      });
    }
  }

  const urls = [...new Set(boxes.map((b) => b.dataset.fund))];
  for (const url of urls) {
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => render(url, d))
      .catch(() => boxes.filter((b) => b.dataset.fund === url).forEach((b) => {
        b.classList.remove('loading');
        b.classList.add('error');
        const s = b.querySelector('[data-f="current"]');
        if (s) s.textContent = '?';
      }));
  }

  if (!key) return;
  document.querySelectorAll('.admin-only').forEach((el) => (el.hidden = false));
  for (const form of forms) {
    form.hidden = false;
    const url = form.dataset.fundAdmin;
    const input = form.querySelector('input');
    const msg = form.querySelector('.msg');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const add = Number(input.value);
      if (!Number.isInteger(add) || add === 0) {
        msg.textContent = 'Nhập số nguyên khác 0 (âm để trừ).';
        msg.className = 'msg err';
        return;
      }
      form.classList.add('busy');
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: key },
          body: JSON.stringify({ add }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(r.status === 401 ? 'Sai key.' : d.error || 'Lỗi ' + r.status);
        render(url, d);
        msg.textContent = `Đã ${add > 0 ? 'cộng' : 'trừ'} ${fmt(Math.abs(add))} điểm → ${fmt(d.current)}/${fmt(d.target)} (cộng thêm tổng ${fmt(d.bonus)}).`;
        msg.className = 'msg ok';
        input.value = '';
      } catch (err) {
        msg.textContent = err.message || 'Không gọi được API.';
        msg.className = 'msg err';
      } finally {
        form.classList.remove('busy');
      }
    });
  }
  document.querySelectorAll('[data-admin-logout]').forEach((b) => b.addEventListener('click', () => {
    try { sessionStorage.removeItem('vh-key'); } catch {}
    location.href = location.pathname;
  }));
})();
