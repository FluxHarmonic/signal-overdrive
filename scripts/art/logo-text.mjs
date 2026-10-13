// logo-text.mjs - reading the logo's hand-drawn text sources.
//
// Two kinds of file live in assets/src/logo/:
//
// An ALPHABET (NAME.txt) is letters drawn as text, one character a pixel
// of the game's 480x270 frame: █ (or #) is ink, · (or . or a space) is
// ground. It starts with a header line `height N`, the cap height in rows.
// Each glyph starts with `= X` (one character) and is followed by exactly
// N rows, every row the same width (the glyph's width). Rows
// are not padded: a miscounted row is a refusal, not a silently shifted
// edge. Lines starting with # outside a glyph are comments.
//
// A PICTURE (marks/*.txt) is a pixel map with its own legend: a header of
// `key ROLE` lines, where ROLE is a palette hex, `#AAAAAA/#BBBBBB P` (a
// Bayer mix with P percent of the second colour), or `none` (transparent).
// The header may also name the ground (`ground K`), the colour a border
// around the picture takes. Then a line `---`, then the rows, one
// character a pixel, every row the same length.
//
// Both readers refuse anything they don't understand, with the file and
// line, so a typo in a drawing is a refusal and never a silent pixel.

import fs from "node:fs";

const INK = new Set(["█", "#"]);
const GROUND = new Set(["·", ".", " "]);

function fail(file, line, msg) {
  throw new Error(`${file}:${line}: ${msg}`);
}

function readLines(file) {
  return fs.readFileSync(file, "utf8").split("\n").map((l) => l.replace(/\r$/, ""));
}

export function readAlphabet(file) {
  const lines = readLines(file);
  let height = null;
  const glyphs = new Map();
  let cur = null;
  const close = (ln) => {
    if (!cur) return;
    const want = height;
    if (cur.raw.length !== want) fail(file, ln, `glyph ${cur.ch}: ${cur.raw.length} rows, wants ${want}`);
    const w = cur.raw[0].length;
    if (w === 0) fail(file, cur.line + 1, `glyph ${cur.ch}: row 0 is empty`);
    cur.raw.forEach((r, k) => {
      if (r.length !== w) fail(file, cur.line + 1 + k, `glyph ${cur.ch}: row ${k} is ${r.length} wide, row 0 is ${w}`);
    });
    cur.w = w;
    cur.h = want;
    cur.rows = cur.raw;
    delete cur.raw;
    glyphs.set(cur.ch, cur);
    cur = null;
  };
  lines.forEach((text, i) => {
    const ln = i + 1;
    if (height === null) {
      if (text.startsWith("#") || text.trim() === "") return;
      const m = text.match(/^height (\d+)$/);
      if (!m) fail(file, ln, "the first line that is not a comment must be `height N`");
      height = parseInt(m[1], 10);
      if (height < 1) fail(file, ln, "the cap height must be at least 1");
      return;
    }
    const g = text.match(/^= (\S)\s*$/);
    if (g) {
      close(ln);
      if (glyphs.has(g[1])) fail(file, ln, `glyph ${g[1]} drawn twice`);
      cur = { ch: g[1], raw: [], line: ln };
      return;
    }
    if (!cur) {
      if (text.startsWith("#") || text.trim() === "") return;
      fail(file, ln, "a row outside a glyph");
    }
    if (text.trim() === "") {
      if (cur.raw.length >= height) { close(ln); return; }
      fail(file, ln, `glyph ${cur.ch}: a blank line after ${cur.raw.length} of its ${height} rows (draw ground as ·)`);
    }
    const row = [...text].map((c) => {
      if (INK.has(c)) return 1;
      if (GROUND.has(c)) return 0;
      fail(file, ln, `unknown character ${JSON.stringify(c)} in glyph ${cur.ch}`);
    });
    cur.raw.push(row);
  });
  close(lines.length);
  if (height === null) fail(file, 1, "no `height N` line");
  return { file, height, glyphs };
}

export function readPicture(file) {
  const lines = readLines(file);
  const legend = new Map();
  let ground = null;
  let groundLine = 0;
  let i = 0;
  for (; i < lines.length; i++) {
    const text = lines[i];
    if (text === "---") break;
    if (/^# (none|#[0-9A-Fa-f]{6})/.test(text)) fail(file, i + 1, "# can't be a legend key (a line starting with # is a comment)");
    if (text.startsWith("# ") || text === "#" || text.trim() === "") continue;
    const g = text.match(/^ground (\S)$/u);
    if (g) {
      if (ground !== null) fail(file, i + 1, "a second ground line");
      ground = g[1];
      groundLine = i + 1;
      continue;
    }
    const m = text.match(/^(\S) (none|#[0-9A-Fa-f]{6}(?:\/#[0-9A-Fa-f]{6} \d+)?)$/u);
    if (!m) fail(file, i + 1, `a legend line is \`K ROLE\`: ${JSON.stringify(text)}`);
    if (legend.has(m[1])) fail(file, i + 1, `key ${m[1]} defined twice`);
    const role = parseRole(m[2]);
    if (role && role.t > 1) fail(file, i + 1, `a mix of ${Math.round(role.t * 100)} percent`);
    legend.set(m[1], role);
  }
  if (i >= lines.length) fail(file, lines.length, "no `---` line before the rows");
  const rows = [];
  for (i = i + 1; i < lines.length; i++) {
    const text = lines[i];
    if (text === "") continue;
    const row = [...text].map((c) => {
      if (!legend.has(c)) fail(file, i + 1, `key ${JSON.stringify(c)} is not in the legend`);
      return legend.get(c);
    });
    if (rows.length && row.length !== rows[0].length) fail(file, i + 1, `row is ${row.length} wide, the first is ${rows[0].length}`);
    rows.push(row);
  }
  if (!rows.length) fail(file, lines.length, "no rows");
  if (ground !== null && !legend.has(ground)) fail(file, groundLine, `ground ${ground} is not in the legend`);
  return { file, w: rows[0].length, h: rows.length, rows, ground: ground && legend.get(ground) };
}

function parseRole(s) {
  if (s === "none") return null;
  const m = s.match(/^(#[0-9A-Fa-f]{6})(?:\/(#[0-9A-Fa-f]{6}) (\d+))?$/);
  if (!m[2]) return { a: m[1].toUpperCase() };
  return { a: m[1].toUpperCase(), b: m[2].toUpperCase(), t: parseInt(m[3], 10) / 100 };
}
