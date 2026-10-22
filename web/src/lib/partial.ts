/**
 * Read one string field out of JSON that is still arriving, like a tool call's input
 * while Claude streams it: `{"path":"index.html","content":"<html><bo` gives
 * "<html><bo" for "content". An escape cut in half at the end is left out.
 */
export function partialField(json: string, key: string): string | null {
  const m = new RegExp(`"${key}"\\s*:\\s*"`).exec(json);
  if (!m) return null;
  let out = "";
  for (let i = m.index + m[0].length; i < json.length; i++) {
    const c = json[i];
    if (c === '"') return out;
    if (c !== "\\") {
      out += c;
      continue;
    }
    const n = json[i + 1];
    if (n === undefined) break;
    i++;
    if (n === "n") out += "\n";
    else if (n === "t") out += "\t";
    else if (n === "r") out += "\r";
    else if (n === "b") out += "\b";
    else if (n === "f") out += "\f";
    else if (n === "u") {
      const hex = json.slice(i + 1, i + 5);
      if (hex.length < 4) break;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 4;
    } else out += n;
  }
  return out;
}
