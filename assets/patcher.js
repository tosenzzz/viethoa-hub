// Vá ROM ngay trên trình duyệt: chọn ROM -> nhận diện bằng CRC32 -> tải đúng patch BPS -> áp -> tải về.
(() => {
  const box = document.getElementById('patcher');
  if (!box) return;
  const patches = JSON.parse(box.dataset.patches);
  const output = box.dataset.output;
  const input = box.querySelector('input[type=file]');
  const drop = box.querySelector('.drop');
  const status = box.querySelector('.status');
  const bar = box.querySelector('.bar > i');

  const TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    TABLE[n] = c >>> 0;
  }
  const crc32 = (u8, end = u8.length) => {
    let c = 0xffffffff;
    for (let i = 0; i < end; i++) c = TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const hex = (n) => n.toString(16).padStart(8, '0');

  function applyBps(src, patch) {
    if (String.fromCharCode(...patch.subarray(0, 4)) !== 'BPS1') throw new Error('File patch không phải BPS.');
    const end = patch.length - 12;
    const dv = new DataView(patch.buffer, patch.byteOffset, patch.byteLength);
    if (crc32(patch, patch.length - 4) !== dv.getUint32(patch.length - 4, true)) throw new Error('File patch tải về bị hỏng, thử lại.');
    let p = 4;
    const num = () => {
      let data = 0, shift = 1;
      for (;;) {
        const x = patch[p++];
        data += (x & 0x7f) * shift;
        if (x & 0x80) return data;
        shift *= 128;
        data += shift;
      }
    };
    const srcSize = num(), dstSize = num(), metaSize = num();
    p += metaSize;
    if (src.length !== srcSize) throw new Error('Kích thước ROM không khớp patch.');
    const dst = new Uint8Array(dstSize);
    let out = 0, srcRel = 0, dstRel = 0;
    while (p < end) {
      const d = num(), cmd = d % 4;
      let len = Math.floor(d / 4) + 1;
      if (cmd === 0) { dst.set(src.subarray(out, out + len), out); out += len; }
      else if (cmd === 1) { dst.set(patch.subarray(p, p + len), out); out += len; p += len; }
      else {
        const o = num();
        const delta = (o & 1 ? -1 : 1) * Math.floor(o / 2);
        if (cmd === 2) { srcRel += delta; dst.set(src.subarray(srcRel, srcRel + len), out); out += len; srcRel += len; }
        else { dstRel += delta; while (len--) dst[out++] = dst[dstRel++]; }
      }
    }
    if (crc32(dst) !== dv.getUint32(end + 4, true)) throw new Error('ROM sau khi vá không đúng checksum.');
    return dst;
  }

  async function fetchWithProgress(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Không tải được patch (' + res.status + ').');
    const total = +res.headers.get('content-length') || 0;
    if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());
    const reader = res.body.getReader();
    const buf = new Uint8Array(total);
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf.set(value, got);
      got += value.length;
      bar.style.width = Math.round((got / total) * 90) + '%';
    }
    return got === total ? buf : buf.subarray(0, got);
  }

  const say = (html, cls = '') => { status.className = 'status ' + cls; status.innerHTML = html; };
  const tick = () => new Promise((r) => setTimeout(r, 30));

  async function handle(file) {
    if (!file) return;
    box.classList.add('busy');
    bar.style.width = '0';
    try {
      say('Đang đọc <b>' + escape(file.name) + '</b>…');
      await tick();
      let rom = new Uint8Array(await file.arrayBuffer());
      let crc = crc32(rom);
      let match = patches.find((x) => x.srcCrc === hex(crc));
      if (!match && rom.length % 1024 === 512) {
        rom = rom.subarray(512);
        crc = crc32(rom);
        match = patches.find((x) => x.srcCrc === hex(crc));
      }
      if (!match) {
        say('ROM này không khớp (CRC32 <code>' + hex(crc) + '</code>). Cần một trong các bản:<br>' +
          patches.map((x) => '• ' + escape(x.base) + ' — CRC32 <code>' + x.srcCrc + '</code>').join('<br>'), 'err');
        return;
      }
      say('Nhận ra: <b>' + escape(match.base) + '</b>. Đang tải patch ' + match.sizeText + '…');
      const patch = await fetchWithProgress(match.url);
      say('Đang vá…');
      await tick();
      const result = applyBps(rom, patch);
      bar.style.width = '100%';
      const blob = new Blob([result], { type: 'application/octet-stream' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = output;
      a.textContent = 'Tải lại ' + output;
      a.className = 'btn';
      say('Xong! Trình duyệt đang tải <b>' + escape(output) + '</b>. ', 'ok');
      status.appendChild(a);
      a.click();
    } catch (e) {
      say(escape(e.message || String(e)), 'err');
    } finally {
      box.classList.remove('busy');
    }
  }

  function escape(s) {
    return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  input.addEventListener('change', () => handle(input.files[0]));
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => handle(e.dataTransfer.files[0]));
})();
