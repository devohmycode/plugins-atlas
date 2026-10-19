/**
 * Turns scripts/gif/out/frames.json (written by frames.tsx) into docs/demo.gif.
 * A page served on 127.0.0.1 draws each ANSI frame on a canvas and posts it back as PNG,
 * then ffmpeg joins the PNGs with their durations. Open the printed URL in any browser.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { PALETTE } from '../../src/ui/palette.js';

const OUT = 'scripts/gif/out';
const data = JSON.parse(readFileSync(`${OUT}/frames.json`, 'utf8')) as { columns: number; rows: number; frames: { text: string; ms: number }[] };
rmSync(`${OUT}/png`, { recursive: true, force: true });
mkdirSync(`${OUT}/png`, { recursive: true });

const page = `<!doctype html><meta charset="utf-8"><title>gif</title>
<body style="margin:0;background:#222"><canvas id="c"></canvas><p id="s" style="color:#ccc;font:14px sans-serif"></p>
<script>
const BG = ${JSON.stringify(PALETTE.background)}, FG = ${JSON.stringify(PALETTE.foreground)};
const BASIC = ['#1c1b19','#F29A91','#A6D5B2','#E6BF68','#8BD5F5','#B69BFA','#8BD5F5','#EAE5D9'];
const BRIGHT = ['#7a7369','#F29A91','#A6D5B2','#E6BF68','#8BD5F5','#F09DDB','#8BD5F5','#ffffff'];
const FONT = '15px "Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace';
const CW = 9, CH = 19, PAD = 18;
const wide = (cp) => cp >= 0x1f000 || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3);
function color256(n) {
  if (n < 8) return BASIC[n];
  if (n < 16) return BRIGHT[n - 8];
  if (n >= 232) { const v = 8 + (n - 232) * 10; return 'rgb(' + v + ',' + v + ',' + v + ')'; }
  n -= 16; const l = [0, 95, 135, 175, 215, 255];
  return 'rgb(' + l[Math.floor(n / 36)] + ',' + l[Math.floor(n / 6) % 6] + ',' + l[n % 6] + ')';
}
function sgr(st, codes) {
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (c === 0) Object.assign(st, { fg: null, bg: null, bold: false, dim: false, inverse: false, underline: false });
    else if (c === 1) st.bold = true; else if (c === 2) st.dim = true; else if (c === 22) { st.bold = false; st.dim = false; }
    else if (c === 4) st.underline = true; else if (c === 24) st.underline = false;
    else if (c === 7) st.inverse = true; else if (c === 27) st.inverse = false;
    else if (c >= 30 && c <= 37) st.fg = BASIC[c - 30]; else if (c >= 90 && c <= 97) st.fg = BRIGHT[c - 90]; else if (c === 39) st.fg = null;
    else if (c >= 40 && c <= 47) st.bg = BASIC[c - 40]; else if (c >= 100 && c <= 107) st.bg = BRIGHT[c - 100]; else if (c === 49) st.bg = null;
    else if (c === 38 || c === 48) {
      let col;
      if (codes[i + 1] === 2) { col = 'rgb(' + codes[i + 2] + ',' + codes[i + 3] + ',' + codes[i + 4] + ')'; i += 4; }
      else if (codes[i + 1] === 5) { col = color256(codes[i + 2]); i += 2; }
      if (c === 38) st.fg = col; else st.bg = col;
    }
  }
}
async function main() {
  const { columns, rows, frames } = await (await fetch('/frames.json')).json();
  const cv = document.getElementById('c'), cx = cv.getContext('2d');
  cv.width = columns * CW + PAD * 2; cv.height = rows * CH + PAD * 2;
  for (let f = 0; f < frames.length; f++) {
    cx.fillStyle = BG; cx.fillRect(0, 0, cv.width, cv.height);
    cx.textBaseline = 'middle';
    const lines = frames[f].text.split('\\n').slice(0, rows);
    lines.forEach((line, row) => {
      const st = {}; sgr(st, [0]);
      let col = 0;
      for (const part of line.split(/(\\u001b\\[[0-9;]*m)/)) {
        const m = /^\\u001b\\[([0-9;]*)m$/.exec(part);
        if (m) { sgr(st, m[1] === '' ? [0] : m[1].split(';').map(Number)); continue; }
        for (const ch of part) {
          if (col >= columns) break;
          const w = wide(ch.codePointAt(0)) ? 2 : 1;
          const x = PAD + col * CW, y = PAD + row * CH;
          let fg = st.fg || FG, bg = st.bg;
          if (st.inverse) { const t = fg; fg = bg || BG; bg = t; }
          if (bg) { cx.fillStyle = bg; cx.fillRect(x, y, CW * w, CH); }
          cx.globalAlpha = st.dim ? 0.55 : 1;
          cx.fillStyle = fg;
          if (ch === '\\u2588') cx.fillRect(x, y, CW + 0.5, CH + 0.5);
          else if (ch !== ' ') { cx.font = (st.bold ? 'bold ' : '') + FONT; cx.fillText(ch, x, y + CH / 2 + 1, CW * w); }
          if (st.underline && ch !== ' ') cx.fillRect(x, y + CH - 2, CW * w, 1);
          cx.globalAlpha = 1;
          col += w;
        }
      }
    });
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    await fetch('/png/' + f, { method: 'POST', body: blob });
    document.getElementById('s').textContent = (f + 1) + ' / ' + frames.length;
  }
  await fetch('/done', { method: 'POST' });
  document.getElementById('s').textContent = 'done';
}
main();
</script>`;

let received = 0;
const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page);
  if (req.method === 'GET' && req.url === '/frames.json') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(data));
  const png = /^\/png\/(\d+)$/.exec(req.url ?? '');
  if (req.method === 'POST' && png) {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      writeFileSync(`${OUT}/png/${png[1]!.padStart(3, '0')}.png`, Buffer.concat(chunks));
      received += 1;
      res.end('ok');
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/done') {
    res.end('ok');
    const list = data.frames
      .map((frame, i) => `file 'png/${String(i).padStart(3, '0')}.png'\nduration ${(frame.ms / 1000).toFixed(3)}`)
      .join('\n');
    // The concat demuxer drops the last duration unless the last file is listed again.
    writeFileSync(`${OUT}/list.txt`, `${list}\nfile 'png/${String(data.frames.length - 1).padStart(3, '0')}.png'\n`);
    execFileSync(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${OUT}/list.txt`, '-vf', 'split[a][b];[a]palettegen=max_colors=96:stats_mode=full[p];[b][p]paletteuse=dither=none', '-loop', '0', 'docs/demo.gif'],
      { stdio: 'inherit' },
    );
    console.log(`docs/demo.gif from ${received} frames`);
    server.close();
    return;
  }
  res.writeHead(404).end();
});
server.listen(Number(process.env.PORT ?? 47400), '127.0.0.1', () => console.log(`Open http://127.0.0.1:${process.env.PORT ?? 47400}/`));
