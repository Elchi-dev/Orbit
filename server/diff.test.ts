import { describe, expect, test } from "bun:test";
import { unifiedDiff } from "./diff";

const lines = (n: number, f = (i: number) => `line ${i}`) => Array.from({ length: n }, (_, i) => f(i + 1)).join("\n");

describe("unifiedDiff", () => {
  test("no change, no hunks", () => {
    expect(unifiedDiff("a\nb", "a\nb")).toEqual({ text: "", added: 0, removed: 0 });
  });
  test("one changed line gets three lines of context on each side", () => {
    const before = lines(20);
    const after = lines(20, (i) => (i === 10 ? "changed" : `line ${i}`));
    const d = unifiedDiff(before, after);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.text.split("\n")).toEqual(["@@ -7,7 +7,7 @@", " line 7", " line 8", " line 9", "-line 10", "+changed", " line 11", " line 12", " line 13"]);
  });
  test("changes far apart are separate hunks", () => {
    const after = lines(40, (i) => (i === 3 || i === 35 ? `x${i}` : `line ${i}`));
    const d = unifiedDiff(lines(40), after);
    expect(d.text.split("\n").filter((l) => l.startsWith("@@"))).toHaveLength(2);
  });
  test("a new file is all additions", () => {
    const d = unifiedDiff("", "one\ntwo");
    expect(d).toMatchObject({ added: 2, removed: 0 });
    expect(d.text).toBe("@@ -0,0 +1,2 @@\n+one\n+two");
  });
  test("lines added at the end", () => {
    const d = unifiedDiff("a\nb", "a\nb\nc");
    expect(d.text).toBe("@@ -1,2 +1,3 @@\n a\n b\n+c");
  });
});
