// Tra thông tin game từ các trang công khai cho phép gọi thẳng từ trình duyệt (CORS):
//   PokéHarbor (WordPress REST), GameBrew (MediaWiki), Wikipedia (MediaWiki).
// Ảnh của PokéHarbor/GameBrew không có CORS → lấy qua wsrv.nl (proxy ảnh công khai, có CORS).
window.VHLookup = (() => {
  const UA_OK = { headers: { Accept: 'application/json' } };
  const getJson = async (url) => {
    const r = await fetch(url, UA_OK);
    if (!r.ok) throw new Error(new URL(url).hostname + ' trả về ' + r.status);
    return r.json();
  };
  const q = (o) => new URLSearchParams(o).toString();
  const clean = (s) => String(s || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  const strip = (html) => clean(new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body.textContent);

  // ---------- suy ra hệ máy / series / tag ----------
  const PLATFORMS = [
    [/\b(GBA|Game Boy Advance)\b/i, 'GBA'], [/\b(NDS|Nintendo DS|DS Rom)\b/i, 'NDS'], [/\b(SNES|Super Nintendo|Super Famicom|SFC)\b/i, 'SNES'],
    [/\b(GBC|Game Boy Color)\b/i, 'GBC'], [/\b(NES|Famicom|Nintendo Entertainment System)\b/i, 'NES'], [/\b(3DS)\b/i, '3DS'], [/\b(N64|Nintendo 64)\b/i, 'N64'],
  ];
  const platformOf = (...texts) => { const t = texts.filter(Boolean).join(' \n '); for (const [re, p] of PLATFORMS) if (re.test(t)) return p; return ''; };
  const seriesOf = (t) => (/pok[eé]mon/i.test(t) ? 'Pokémon' : /fire emblem|\bFE ?\d/i.test(t) ? 'Fire Emblem' : '');
  const BASES = [
    [/fire ?red/i, 'FireRed'], [/leaf ?green/i, 'LeafGreen'], [/emerald/i, 'Emerald'], [/ruby/i, 'Ruby'], [/sapphire/i, 'Sapphire'],
    [/crystal/i, 'Crystal'], [/heart ?gold/i, 'HeartGold'], [/soul ?silver/i, 'SoulSilver'], [/platinum/i, 'Platinum'],
    [/sacred stones|\bFE ?8\b/i, 'FE8'], [/blazing (blade|sword)|\bFE ?7\b/i, 'FE7'], [/binding blade|\bFE ?6\b/i, 'FE6'],
  ];
  const baseOf = (t) => { for (const [re, b] of BASES) if (re.test(t)) return b; return ''; };
  const tagsOf = (series, base) => [
    ...(series === 'Fire Emblem' ? ['SRPG', 'Chiến thuật'] : series === 'Pokémon' ? ['RPG'] : []),
    ...(base ? ['Hack ' + base] : []),
  ];
  const cleanTitle = (t) => clean(t).replace(/\s+(GBA|NDS|SNES|GBC|NES|3DS)$/i, '').replace(/\s+ROM Hack$/i, '').replace(/\bPokemon\b/g, 'Pokémon');
  const firstSentence = (t) => { const m = String(t || '').match(/^.{20,200}?[.!?](?=\s|$)/); return m ? m[0] : String(t || '').slice(0, 160); };
  const versionOf = (v) => { const m = String(v || '').match(/\d+(?:\.\d+)+[a-z]?|\d+/i); return m ? m[0] : ''; };
  // Gộp danh sách tính năng thành 1 đoạn (tiếng Anh, để viết lại)
  const featurePara = (list) => list.length ? 'Features: ' + list.map((x) => x.split(/\s+[-–:]\s+/)[0].replace(/\.$/, '')).slice(0, 14).join('; ') + '.' : '';

  // ---------- PokéHarbor ----------
  const PH = 'https://www.pokeharbor.com/wp-json/wp/v2/posts';
  async function searchPH(term) {
    const d = await getJson(`${PH}?${q({ search: term, per_page: 12, _fields: 'id,link,title,excerpt' })}`);
    return d.map((p) => ({ src: 'PokéHarbor', id: p.id, title: strip(p.title.rendered), url: p.link, snippet: strip(p.excerpt.rendered).slice(0, 180) }));
  }
  async function detailPH(r) {
    const p = await getJson(`${PH}/${r.id}?_embed=wp:featuredmedia,wp:term`);
    const doc = new DOMParser().parseFromString(p.content.rendered, 'text/html');
    doc.querySelectorAll('script, ins, style, noscript').forEach((e) => e.remove());
    const fields = {};
    const sections = [{ name: '', paras: [], items: [] }];
    const images = [];
    const featured = p._embedded?.['wp:featuredmedia']?.[0]?.source_url;
    if (featured) images.push(featured);
    for (const el of doc.body.querySelectorAll('h1, h2, h3, h4, p, li, img')) {
      if (el.tagName === 'IMG') { const s = el.getAttribute('data-src') || el.getAttribute('src'); if (s && /^https?:/.test(s) && !images.includes(s)) images.push(s); continue; }
      if (/^H\d$/.test(el.tagName)) { sections.push({ name: clean(el.textContent), paras: [], items: [] }); continue; }
      const strong = el.tagName === 'LI' && el.querySelector('strong');
      if (strong && /:\s*$/.test(strong.textContent.trim())) {
        fields[strong.textContent.replace(/:\s*$/, '').trim().toLowerCase()] = clean(el.textContent.slice(strong.textContent.length)).replace(/^:\s*/, '');
        continue;
      }
      const t = clean(el.textContent);
      if (!t) continue;
      const sec = sections[sections.length - 1];
      (el.tagName === 'LI' ? sec.items : sec.paras).push(t);
    }
    const find = (re) => sections.find((s) => re.test(s.name)) || { paras: [], items: [] };
    const boiler = /ROM Hack by|be sure to check out|available to download|last updated on/i;
    const intro = sections.flatMap((s) => (/download|screenshot|changelog|credit|cheat|walkthrough|faq/i.test(s.name) ? [] : s.paras)).filter((t) => !boiler.test(t));
    const story = find(/story|plot/i).paras;
    const features = find(/feature/i).items;
    const terms = (p._embedded?.['wp:term'] || []).flat().map((t) => t.name);
    const title = cleanTitle(strip(p.title.rendered));
    const base = baseOf(fields['hack of'] || '') || baseOf(terms.join(' '));
    const series = seriesOf(title + ' ' + (fields['hack of'] || ''));
    const about = [...new Set([...story, ...intro])].slice(0, 4);
    if (features.length) about.push(featurePara(features));
    return {
      src: r.src, url: p.link, title,
      version: versionOf(fields.version), versionRaw: fields.version || '',
      platform: platformOf(terms.join(' '), title, p.link), series, tags: tagsOf(series, base),
      author: fields.creator || '',
      blurb: firstSentence(about[0]), about, source: [p.link], images: images.slice(0, 8),
    };
  }

  // ---------- GameBrew ----------
  const GB = 'https://www.gamebrew.org/api.php';
  async function searchGB(term) {
    const d = await getJson(`${GB}?${q({ action: 'query', list: 'search', srsearch: term, srnamespace: 0, srlimit: 8, format: 'json', origin: '*' })}`);
    return d.query.search.filter((x) => !/^List of|Cheat|Database/i.test(x.title)).slice(0, 5)
      .map((x) => ({ src: 'GameBrew', id: x.title, title: x.title, url: 'https://www.gamebrew.org/wiki/' + encodeURIComponent(x.title.replace(/ /g, '_')), snippet: strip(x.snippet).slice(0, 180) }));
  }
  function wikiText(w) {
    let s = w, prev;
    do { prev = s; s = s.replace(/\{\{[^{}]*\}\}/g, ''); } while (s !== prev);
    return s.replace(/\{\|[\s\S]*?\|\}/g, '').replace(/<ref[^>]*\/>|<ref[\s\S]*?<\/ref>/g, '').replace(/<[^>]+>/g, '')
      .replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, '').replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1').replace(/\[\[([^\]]*)\]\]/g, '$1')
      .replace(/\[https?:\/\/\S+ ([^\]]*)\]/g, '$1').replace(/\[https?:\/\/\S+\]/g, '').replace(/'{2,}/g, '');
  }
  async function detailGB(r) {
    const d = await getJson(`${GB}?${q({ action: 'parse', page: r.id, prop: 'wikitext|images', format: 'json', origin: '*' })}`);
    const w = d.parse.wikitext['*'];
    const box = {};
    const bi = w.search(/\{\{Infobox/i);
    if (bi >= 0) for (const m of w.slice(bi, w.indexOf('\n}}', bi)).matchAll(/^\|\s*(\w+)\s*=\s*(.*)$/gm)) box[m[1].toLowerCase()] = m[2].trim();
    const tpl = (w.match(/\{\{Infobox (\w+)/i) || [])[1] || '';
    const parts = wikiText(w).split(/^(=+)\s*(.*?)\s*\1\s*$/m);
    const sections = [{ name: '', body: parts[0] }];
    for (let i = 1; i < parts.length; i += 3) sections.push({ name: parts[i + 1], body: parts[i + 2] || '' });
    const paras = (b) => b.split(/\n\s*\n/).map(clean).filter((t) => t && !/^[*#]/.test(t)).map((t) => t.replace(/\n/g, ' '));
    const items = (b) => b.split('\n').filter((l) => /^\s*\*/.test(l)).map((l) => clean(l.replace(/^\s*\*+/, '')));
    const sec = (re) => sections.find((s) => re.test(s.name))?.body || '';
    const story = paras(sec(/^story|plot/i));
    const intro = paras(sections[0].body);
    const features = items(sec(/feature/i));
    const about = [...intro, ...story].slice(0, 4);
    if (features.length) about.push(featurePara(features));
    // Ảnh: ảnh infobox trước, rồi ảnh khác trong trang
    const files = [...new Set([box.image, ...(d.parse.images || [])].filter(Boolean))].slice(0, 8);
    let images = [];
    if (files.length) {
      const ii = await getJson(`${GB}?${q({ action: 'query', titles: files.map((f) => 'File:' + f).join('|'), prop: 'imageinfo', iiprop: 'url', format: 'json', origin: '*' })}`);
      const byName = new Map(Object.values(ii.query.pages).filter((p) => p.imageinfo).map((p) => [p.title.replace(/^File:/, '').replace(/_/g, ' ').toLowerCase(), p.imageinfo[0].url]));
      images = files.map((f) => byName.get(f.replace(/_/g, ' ').toLowerCase())).filter(Boolean);
    }
    const title = cleanTitle(box.title || r.title);
    const all = [box.description, w.slice(0, 3000)].join(' ');
    const series = seriesOf(title + ' ' + all);
    const src = [r.url, box.website].filter((u) => u && /^https?:/.test(u));
    return {
      src: r.src, url: r.url, title,
      version: versionOf(box.version), versionRaw: box.version || '',
      platform: platformOf(tpl, r.title, w.slice(0, 1500)), series, tags: tagsOf(series, baseOf(all)),
      author: box.author || '',
      blurb: clean(box.description || ''), about, source: [...new Set(src)], images,
    };
  }

  // ---------- Wikipedia ----------
  const WP = 'https://en.wikipedia.org/w/api.php';
  async function searchWP(term) {
    const d = await getJson(`${WP}?${q({ action: 'query', list: 'search', srsearch: term + ' video game', srlimit: 8, format: 'json', origin: '*' })}`);
    return d.query.search.map((x) => ({ src: 'Wikipedia', id: x.title, title: x.title, url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(x.title.replace(/ /g, '_')), snippet: strip(x.snippet).slice(0, 180) }));
  }
  async function detailWP(r) {
    const d = await getJson(`${WP}?${q({ action: 'query', titles: r.id, prop: 'extracts|pageimages', exintro: 1, explaintext: 1, piprop: 'original', redirects: 1, format: 'json', origin: '*' })}`);
    const p = Object.values(d.query.pages)[0];
    const about = (p.extract || '').split(/\n+/).map(clean).filter(Boolean).slice(0, 4);
    const title = cleanTitle(p.title.replace(/\s*\((video )?game\)$/i, ''));
    const series = seriesOf(title + ' ' + about.join(' '));
    return {
      src: r.src, url: r.url, title, version: '', versionRaw: '',
      platform: platformOf(about.join(' ')), series, tags: tagsOf(series, ''),
      author: '', blurb: firstSentence(about[0]), about, source: [r.url],
      images: p.original ? [p.original.source] : [],
    };
  }

  // ---------- chung ----------
  async function search(term) {
    const jobs = [['PokéHarbor', searchPH], ['GameBrew', searchGB], ['Wikipedia', searchWP]];
    const res = await Promise.allSettled(jobs.map(([, f]) => f(term)));
    const out = [], errors = [];
    res.forEach((r, i) => (r.status === 'fulfilled' ? out.push(...r.value) : errors.push(jobs[i][0] + ': ' + r.reason.message)));
    // Xếp theo số từ khoá có trong tên; bỏ kết quả không khớp từ nào (trừ khi không còn gì).
    const norm = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const STOP = new Set(['pokemon', 'the', 'of', 'and', 'version', 'rom', 'hack', 'gba', 'fire', 'emblem']);
    const words = norm(term).split(/[^a-z0-9]+/).filter((w) => w.length > 1);
    const key = words.filter((w) => !STOP.has(w));
    const score = (r) => {
      const t = norm(r.title);
      const hit = (ws) => ws.filter((w) => new RegExp('\\b' + w).test(t)).length;
      return hit(key.length ? key : words) * 10 + hit(words) + (r.src === 'Wikipedia' ? -1 : 0);
    };
    const ranked = out.map((r) => ({ r, s: score(r) })).sort((a, b) => b.s - a.s);
    const good = ranked.filter((x) => x.s >= 10);
    return { results: (good.length ? good : ranked).slice(0, 12).map((x) => x.r), errors };
  }
  const details = (r) => (r.src === 'PokéHarbor' ? detailPH(r) : r.src === 'GameBrew' ? detailGB(r) : detailWP(r));

  // Ảnh qua proxy (đổi sang JPG, tối đa rộng 960) → bytes để commit vào repo.
  const proxied = (u) => `https://wsrv.nl/?${q({ url: u, w: 960, output: 'jpg', q: 85 })}`;
  async function image(u) {
    const r = await fetch(proxied(u));
    if (!r.ok) throw new Error('Không tải được ảnh (' + r.status + ')');
    return new Uint8Array(await r.arrayBuffer());
  }
  // 2 màu chủ đạo: trung bình các điểm ảnh rực nhất, màu 2 là bản tối hơn.
  async function accent(bytes) {
    const bmp = await createImageBitmap(new Blob([bytes]));
    const c = document.createElement('canvas');
    c.width = 48; c.height = 27;
    const x = c.getContext('2d');
    x.drawImage(bmp, 0, 0, c.width, c.height);
    const px = x.getImageData(0, 0, c.width, c.height).data;
    const list = [];
    for (let i = 0; i < px.length; i += 4) {
      const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      list.push({ r, g, b, s: mx ? (mx - mn) / mx : 0, v: mx });
    }
    list.sort((a, b) => b.s * b.v - a.s * a.v);
    const top = list.slice(0, Math.max(8, list.length >> 3));
    const avg = (k) => Math.round(top.reduce((n, p) => n + p[k], 0) / top.length);
    const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
    const [r, g, b] = [avg('r'), avg('g'), avg('b')];
    return [hex(r, g, b), hex(r * 0.42 | 0, g * 0.42 | 0, b * 0.42 | 0)];
  }
  return { search, details, image, accent, proxied };
})();
