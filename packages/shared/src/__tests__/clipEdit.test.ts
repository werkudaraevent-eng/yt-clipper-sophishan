import { describe, expect, it } from "vitest";
import valid from "../../../../fixtures/clip-edit.valid.json";
import invalid from "../../../../fixtures/clip-edit.invalid.json";
import { captionLines, countMatches, lineText, replaceAll, retimeLine } from "../captionEdit";
import { clipEditSchema, lookOf } from "../clipEdit";
import { jobOptionsSchema } from "../jobOptions";

describe("clipEditSchema", () => {
  it.each(valid.map((v, i) => [i, v]))("accepts valid fixture %i", (_, value) => {
    expect(clipEditSchema.safeParse(value).success).toBe(true);
  });

  it.each(invalid.map((v, i) => [i, v]))("rejects invalid fixture %i", (_, value) => {
    expect(clipEditSchema.safeParse(value).success).toBe(false);
  });
});

describe("lookOf", () => {
  const options = jobOptionsSchema.parse({
    youtubeUrl: "https://youtu.be/arj7oStGLkU",
    timeframe: { start: 0, end: 60 },
    captions: { template: "box" },
    coldOpen: false,
  });

  it("starts from the project's options for clips from before the editor", () => {
    expect(lookOf(null, options)).toEqual({
      template: "box",
      position: "bottom",
      wordsPerCaption: 3,
      layout: "auto",
      hookTitle: true,
      coldOpen: false,
      teaser: null,
    });
  });

  it("prefers what the clip was rendered with", () => {
    expect(lookOf({ template: "ali", coldOpen: true, teaser: [5, 8] }, options)).toMatchObject({
      template: "ali",
      coldOpen: true,
      teaser: [5, 8],
    });
  });
});

const w = (text: string, start: number, end = start + 0.4) => ({ text, start, end });

describe("caption lines", () => {
  it("breaks at sentence ends and pauses", () => {
    const words = [w("Halo", 0), w("semua.", 0.4), w("Ini", 1), w("dia", 1.4), w("lagi", 3)];
    expect(captionLines(words).map(lineText)).toEqual(["Halo semua.", "Ini dia", "lagi"]);
  });

  it("keeps each word's time when only spelling changes", () => {
    const line = [w("Mateus", 10), w("Kunya", 10.4)];
    expect(retimeLine(line, "Matheus  Cunha")).toEqual([w("Matheus", 10), w("Cunha", 10.4)]);
  });

  it("shares the line's time out by word length when the count changes", () => {
    const line = [w("abc", 0, 1), w("def", 1, 2)];
    expect(retimeLine(line, "ab c abc")).toEqual([
      { text: "ab", start: 0, end: 0.667 },
      { text: "c", start: 0.667, end: 1 },
      { text: "abc", start: 1, end: 2 },
    ]);
    expect(retimeLine(line, "   ")).toEqual([]);
  });
});

describe("find and replace", () => {
  const words = [w("Mateus", 0), w("Kunya,", 0.4), w("dan", 0.8), w("mateus", 1.2), w("kunya!", 1.6)];

  it("counts whole-word runs, case and punctuation aside", () => {
    expect(countMatches(words, "mateus kunya")).toBe(2);
    expect(countMatches(words, "Mateu")).toBe(0);
    expect(countMatches(words, "  ")).toBe(0);
  });

  it("replaces every run and keeps the punctuation around it", () => {
    expect(replaceAll(words, "Mateus Kunya", "Matheus Cunha").map((x) => x.text)).toEqual([
      "Matheus",
      "Cunha,",
      "dan",
      "Matheus",
      "Cunha!",
    ]);
  });

  it("spreads a different number of words over the same time", () => {
    const out = replaceAll([w("sofis", 1, 2)], "sofis", "So Fish");
    expect(out).toEqual([
      { text: "So", start: 1, end: 1.333 },
      { text: "Fish", start: 1.333, end: 2 },
    ]);
  });
});
