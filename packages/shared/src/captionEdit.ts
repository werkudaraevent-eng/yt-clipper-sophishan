import type { CaptionWord } from "./clipEdit";

/**
 * Caption editing on word timings: lines to edit, retyped lines, and find and
 * replace. Matching follows the worker's name dictionary (apply_terms in
 * services/worker/clipper_worker/engine/transcript.py): case and edge
 * punctuation aside, and the punctuation around a replaced run is kept.
 */

const SENTENCE_END = /[.!?…]$/;
const PAUSE_SECONDS = 0.45;
const MAX_LINE_SECONDS = 8;
const MAX_WORD_LENGTH = 80;

/** When the word's sound likely stops; caption words often run on through silence. */
export function spokenEnd(w: CaptionWord): number {
  return w.start + Math.min(w.end - w.start, 0.2 + 0.07 * w.text.length);
}

/** Lines the way the speaker breaks them: sentence ends, pauses, or every few seconds. */
export function captionLines(words: CaptionWord[]): CaptionWord[][] {
  const lines: CaptionWord[][] = [];
  let line: CaptionWord[] = [];
  words.forEach((w, i) => {
    line.push(w);
    const next = words[i + 1];
    const pause = next ? next.start - spokenEnd(w) : Infinity;
    if (SENTENCE_END.test(w.text) || pause >= PAUSE_SECONDS || w.end - line[0].start >= MAX_LINE_SECONDS) {
      lines.push(line);
      line = [];
    }
  });
  if (line.length) lines.push(line);
  return lines;
}

export function lineText(line: CaptionWord[]): string {
  return line.map((w) => w.text).join(" ");
}

function tokens(text: string): string[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.slice(0, MAX_WORD_LENGTH));
}

/**
 * The line's words after retyping it. The same number of words keep their
 * own times; otherwise the line's time is shared out by word length.
 */
export function retimeLine(line: CaptionWord[], text: string): CaptionWord[] {
  const parts = tokens(text);
  if (!line.length || !parts.length) return [];
  if (parts.length === line.length) return line.map((w, i) => ({ ...w, text: parts[i] }));
  return spread(parts, parts, line[0].start, line[line.length - 1].end);
}

function spread(texts: string[], sizes: string[], start: number, end: number): CaptionWord[] {
  const total = sizes.reduce((n, t) => n + t.length, 0);
  let at = start;
  return texts.map((text, i) => {
    const span = ((end - start) * sizes[i].length) / total;
    const w = { text, start: round(at), end: round(at + span) };
    at += span;
    return w;
  });
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}

const LEAD = /^[\p{P}\p{S}]*/u;
const TRAIL = /[\p{P}\p{S}]*$/u;

/** A word as matched against a search: no edge punctuation, no case. */
function key(text: string): string {
  return text.replace(LEAD, "").replace(TRAIL, "").toLocaleLowerCase();
}

function pattern(find: string): string[] {
  return tokens(find).map(key).filter(Boolean);
}

function matchesAt(keys: string[], at: number, wanted: string[]): boolean {
  return wanted.every((k, j) => keys[at + j] === k);
}

/** How many times `find` occurs as whole words. */
export function countMatches(words: CaptionWord[], find: string): number {
  const wanted = pattern(find);
  if (!wanted.length) return 0;
  const keys = words.map((w) => key(w.text));
  let n = 0;
  for (let i = 0; i < words.length; ) {
    if (matchesAt(keys, i, wanted)) {
      n += 1;
      i += wanted.length;
    } else i += 1;
  }
  return n;
}

/** Every whole-word occurrence of `find` written as `replace` instead. */
export function replaceAll(words: CaptionWord[], find: string, replace: string): CaptionWord[] {
  const wanted = pattern(find);
  const parts = tokens(replace);
  if (!wanted.length || !parts.length) return words;
  const keys = words.map((w) => key(w.text));
  const out: CaptionWord[] = [];
  for (let i = 0; i < words.length; ) {
    if (!matchesAt(keys, i, wanted)) {
      out.push(words[i]);
      i += 1;
      continue;
    }
    const old = words.slice(i, i + wanted.length);
    out.push(...respell(old, parts));
    i += wanted.length;
  }
  return out;
}

function respell(old: CaptionWord[], parts: string[]): CaptionWord[] {
  const texts = [...parts];
  const lead = old[0].text.match(LEAD)?.[0] ?? "";
  const trail = old[old.length - 1].text.match(TRAIL)?.[0] ?? "";
  if (!texts[0].match(LEAD)?.[0]) texts[0] = lead + texts[0];
  if (!texts[texts.length - 1].match(TRAIL)?.[0]) texts[texts.length - 1] += trail;
  if (texts.length === old.length) return old.map((w, i) => ({ ...w, text: texts[i] }));
  return spread(texts, parts, old[0].start, old[old.length - 1].end);
}
