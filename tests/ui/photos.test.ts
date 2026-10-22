import { describe, expect, it } from "vitest";
import {
  containSize,
  groupPhotos,
  JOB_PHOTO_GROUPS,
  photoAlt,
} from "@/ui/components/photos";

const ph = (id: string, tag: string | null) => ({ id, tag });

describe("groupPhotos (job photo grid by tag)", () => {
  it("groups Before / During / After / Problem / Other in that order", () => {
    const groups = groupPhotos([
      ph("a1", "after"),
      ph("b1", "before"),
      ph("p1", "problem"),
      ph("o1", "other"),
      ph("b2", "before"),
      ph("d1", "during"),
    ]);
    expect(groups.map((g) => g.key)).toEqual([
      "before",
      "during",
      "after",
      "problem",
      "other",
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      "Before",
      "During",
      "After",
      "Problem",
      "Other",
    ]);
    // Order inside a group is kept (capture order from the query).
    expect(groups[0]?.photos.map((p) => p.id)).toEqual(["b1", "b2"]);
  });

  it("puts untagged and unknown tags under Other", () => {
    const groups = groupPhotos([
      ph("x", null),
      ph("r", "receipt"),
      ph("b", "before"),
    ]);
    expect(groups.map((g) => [g.key, g.photos.map((p) => p.id)])).toEqual([
      ["before", ["b"]],
      ["other", ["x", "r"]],
    ]);
  });

  it("drops empty groups and gives each group its offset in the viewer order", () => {
    const groups = groupPhotos([
      ph("p1", "problem"),
      ph("b1", "before"),
      ph("b2", "before"),
      ph("a1", "after"),
    ]);
    expect(groups.map((g) => [g.key, g.start, g.photos.length])).toEqual([
      ["before", 0, 2],
      ["after", 2, 1],
      ["problem", 3, 1],
    ]);
    // Concatenated groups = the order the viewer swipes through.
    const flat = groups.flatMap((g) => g.photos.map((p) => p.id));
    expect(flat).toEqual(["b1", "b2", "a1", "p1"]);
    for (const g of groups)
      expect(flat.slice(g.start, g.start + g.photos.length)).toEqual(
        g.photos.map((p) => p.id),
      );
  });

  it("adds an Other group when the specs have no fallback, and honors tag aliases", () => {
    const groups = groupPhotos(
      [ph("1", "before"), ph("2", "odometer"), ph("3", "receipt")],
      [
        { key: "work", label: "Work", tags: ["before", "after"] },
        { key: "paper", label: "Paperwork", tags: ["receipt", "document"] },
      ],
    );
    expect(groups.map((g) => [g.label, g.photos.map((p) => p.id)])).toEqual([
      ["Work", ["1"]],
      ["Paperwork", ["3"]],
      ["Other", ["2"]],
    ]);
  });

  it("returns nothing for no photos", () => {
    expect(groupPhotos([], JOB_PHOTO_GROUPS)).toEqual([]);
  });
});

describe("photo helpers", () => {
  it("photoAlt prefers alt, then caption, then the tag", () => {
    const label = (t: string) => t.toUpperCase();
    expect(photoAlt({ alt: "A", caption: "C", tag: "before" }, label)).toBe(
      "A",
    );
    expect(photoAlt({ caption: "C", tag: "before" }, label)).toBe("C");
    expect(photoAlt({ tag: "before" }, label)).toBe("BEFORE photo");
    expect(photoAlt({}, label)).toBe("Photo");
  });

  it("containSize fits like object-fit: contain", () => {
    expect(containSize({ w: 4000, h: 3000 }, { w: 390, h: 844 })).toEqual({
      w: 390,
      h: 292.5,
    });
    expect(containSize({ w: 3000, h: 4000 }, { w: 1024, h: 768 })).toEqual({
      w: 576,
      h: 768,
    });
    expect(containSize({ w: 0, h: 0 }, { w: 10, h: 20 })).toEqual({
      w: 10,
      h: 20,
    });
  });
});
