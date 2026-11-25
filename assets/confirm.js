// Hộp xác nhận khi vào trang. Câu trả lời (cùng câu hỏi) lưu trong localStorage nên lần sau không hỏi lại.
// Chọn đúng dòng "đáp án sai" (data-w, số thứ tự từ 1): khoá vá trên web, bỏ link tải patch, hiện thông báo lỗi.
(() => {
  const me = document.currentScript;
  const q = me.dataset.q;
  const opts = JSON.parse(me.dataset.o || '[]');
  const wrong = +me.dataset.w || 0;
  const error = me.dataset.e || 'Bạn không dùng được patch.';
  const KEY = 'vh-confirm';

  function lock() {
    const msg = () => { const p = document.createElement('p'); p.className = 'lock-msg'; p.textContent = error; return p; };
    const patcher = document.getElementById('patcher');
    if (patcher) {
      const h = patcher.querySelector('h2');
      patcher.removeAttribute('data-patches');
      patcher.replaceChildren(...(h ? [h] : []), msg());
    }
    const files = document.querySelector('.patch-files');
    if (files) {
      const h = files.querySelector('h2');
      files.replaceChildren(...(h ? [h] : []), msg());
    }
    document.querySelector('.patch-manual')?.remove();
  }
  const check = (i) => { if (wrong && i + 1 === wrong) lock(); };

  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
  if (saved && saved.q === q) {
    const i = Number.isInteger(saved.i) ? saved.i : opts.indexOf(saved.a);
    return check(i);
  }

  const wrap = document.createElement('div');
  wrap.className = 'vh-confirm';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.innerHTML = '<div class="box"><p class="q"></p><div class="opts"></div></div>';
  wrap.querySelector('.q').textContent = q;
  const box = wrap.querySelector('.opts');
  opts.forEach((o, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn' + (i ? ' ghost' : '');
    b.textContent = o;
    b.addEventListener('click', () => {
      try { localStorage.setItem(KEY, JSON.stringify({ q, i, a: o, at: new Date().toISOString() })); } catch {}
      wrap.remove();
      document.documentElement.classList.remove('vh-lock');
      check(i);
    });
    box.appendChild(b);
  });
  document.documentElement.classList.add('vh-lock');
  document.body.appendChild(wrap);
  box.querySelector('button')?.focus();
})();
