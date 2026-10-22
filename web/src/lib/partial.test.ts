import { describe, expect, test } from "bun:test";
import { partialField } from "./partial";

describe("partialField", () => {
  test("reads a string that is still arriving", () => {
    expect(partialField('{"path":"index.html","content":"<h1>Hi', "content")).toBe("<h1>Hi");
    expect(partialField('{"path":"a.html"', "path")).toBe("a.html");
    expect(partialField('{"path":"a.html","content":"', "content")).toBe("");
    expect(partialField('{"path":"a.html"', "content")).toBeNull();
  });
  test("decodes escapes and drops one cut in half", () => {
    expect(partialField('{"content":"a\\nb \\"q\\" \\u00e9"}', "content")).toBe('a\nb "q" é');
    expect(partialField('{"content":"a\\', "content")).toBe("a");
    expect(partialField('{"content":"a\\u00', "content")).toBe("a");
  });
});
