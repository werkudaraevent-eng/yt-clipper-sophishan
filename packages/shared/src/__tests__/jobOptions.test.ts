import { describe, expect, it } from "vitest";
import valid from "../../../../fixtures/job-options.valid.json";
import invalid from "../../../../fixtures/job-options.invalid.json";
import { jobOptionsSchema } from "../jobOptions";

describe("jobOptionsSchema", () => {
  it.each(valid.map((v, i) => [i, v]))("accepts valid fixture %i", (_, value) => {
    expect(jobOptionsSchema.safeParse(value).success).toBe(true);
  });

  it.each(invalid.map((v, i) => [i, v]))("rejects invalid fixture %i", (_, value) => {
    expect(jobOptionsSchema.safeParse(value).success).toBe(false);
  });

  it("fills defaults", () => {
    const parsed = jobOptionsSchema.parse(valid[0]);
    expect(parsed.clipLength).toBe("30to60");
    expect(parsed.captions).toEqual({
      enabled: true,
      template: "karaoke",
      position: "bottom",
      wordsPerCaption: 3,
    });
    expect(parsed.layout).toBe("auto");
  });
});
