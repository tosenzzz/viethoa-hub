// Lọc theo nền tảng + tìm kiếm trên trang chủ.
(() => {
  const cards = [...document.querySelectorAll('.card')];
  const tabs = [...document.querySelectorAll('.tab')];
  const q = document.getElementById('q');
  const empty = document.getElementById('empty');
  const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();
  let filter = 'all';
  try { filter = sessionStorage.getItem('filter') || 'all'; } catch {}

  function render() {
    const term = fold(q.value.trim());
    let shown = 0;
    for (const c of cards) {
      const ok = (filter === 'all' || c.dataset.group.split(' ').includes(filter)) && (!term || fold(c.dataset.search).includes(term));
      c.hidden = !ok;
      if (ok) shown++;
    }
    tabs.forEach((t) => t.setAttribute('aria-selected', t.dataset.filter === filter));
    empty.hidden = shown > 0;
  }
  tabs.forEach((t) => t.addEventListener('click', () => {
    filter = t.dataset.filter;
    try { sessionStorage.setItem('filter', filter); } catch {}
    render();
  }));
  q.addEventListener('input', render);
  render();
})();
