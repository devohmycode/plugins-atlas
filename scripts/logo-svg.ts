/**
 * Writes docs/logo.svg: the terminal logo, same glyphs and same sky blue → lavender → pink gradient
 * as skills-atlas and mcp-atlas, read back from its truecolor ANSI so that both never drift.
 * Cells are drawn as shapes, not text, so the logo looks the same whatever fonts the viewer has.
 * Run with `npx tsx scripts/logo-svg.ts`.
 */
import { writeFileSync } from 'node:fs';
import { logo } from '../src/ui/logo.js';
import { PALETTE } from '../src/ui/palette.js';

/** A terminal cell is about twice as tall as wide. */
const W = 10;
const H = 20;
const PAD = 28;
/** Half the gap between the two strokes of a double line. */
const DX = 2.5;
const DY = 3;

const lines = logo(400, 'truecolor').split('\n');
const cells: { col: number; row: number; char: string; color: string }[] = [];
let columns = 0;
lines.forEach((line, row) => {
  let color = PALETTE.foreground as string;
  let col = 0;
  for (const part of line.split(/(\u001b\[[0-9;]*m)/)) {
    const sgr = /^\u001b\[([0-9;]*)m$/.exec(part);
    if (sgr) {
      const rgb = /^38;2;(\d+);(\d+);(\d+)$/.exec(sgr[1] ?? '');
      if (rgb) color = `rgb(${rgb[1]},${rgb[2]},${rgb[3]})`;
      continue;
    }
    for (const char of part) {
      if (char !== ' ') cells.push({ col, row, char, color });
      col += 1;
    }
  }
  columns = Math.max(columns, col);
});

/** The strokes of a box-drawing double line, as SVG path data. */
function strokes(char: string, x: number, y: number): string | undefined {
  const cx = x + W / 2;
  const cy = y + H / 2;
  const [l, r, t, b] = [x, x + W, y, y + H];
  switch (char) {
    case '═':
      return `M${l} ${cy - DY}H${r}M${l} ${cy + DY}H${r}`;
    case '║':
      return `M${cx - DX} ${t}V${b}M${cx + DX} ${t}V${b}`;
    case '╔':
      return `M${r} ${cy - DY}H${cx - DX}V${b}M${r} ${cy + DY}H${cx + DX}V${b}`;
    case '╗':
      return `M${l} ${cy - DY}H${cx + DX}V${b}M${l} ${cy + DY}H${cx - DX}V${b}`;
    case '╚':
      return `M${cx - DX} ${t}V${cy + DY}H${r}M${cx + DX} ${t}V${cy - DY}H${r}`;
    case '╝':
      return `M${cx + DX} ${t}V${cy + DY}H${l}M${cx - DX} ${t}V${cy - DY}H${l}`;
    default:
      return undefined;
  }
}

const shapes = cells.map(({ col, row, char, color }) => {
  const x = PAD + col * W;
  const y = PAD + row * H;
  if (char === '█') return `<rect x="${x}" y="${y}" width="${W + 0.4}" height="${H + 0.4}" fill="${color}"/>`;
  const d = strokes(char, x, y);
  if (!d) throw new Error(`No shape for ${JSON.stringify(char)}`);
  return `<path d="${d}" stroke="${color}"/>`;
});

const width = columns * W + PAD * 2;
const height = lines.length * H + PAD * 2;
writeFileSync(
  'docs/logo.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="PLUGINS ATLAS">
<rect width="100%" height="100%" rx="14" fill="${PALETTE.background}"/>
<g fill="none" stroke-width="1.6" stroke-linecap="square">
${shapes.join('\n')}
</g>
</svg>
`,
);
console.log(`docs/logo.svg: ${columns} columns, ${lines.length} rows, ${cells.length} cells`);
