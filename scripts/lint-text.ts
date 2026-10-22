// Fails when a source or doc file contains an en or em dash. House rule: use a comma, colon or full stop.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const ROOTS = ["server", "web/src", "scripts", "docs", "integrations", ".github", "README.md", "CHANGELOG.md", "SECURITY.md", "CONTRIBUTING.md", "install.sh", "install.ps1", "orbit.example.toml"];
const EXT = new Set([".ts", ".tsx", ".css", ".md", ".sh", ".ps1", ".yml", ".toml", ".html"]);
const BAD = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

function files(p: string): string[] {
  try {
    if (!statSync(p).isDirectory()) return [p];
  } catch {
    return [];
  }
  return readdirSync(p).flatMap((n) => files(join(p, n)));
}

let found = 0;
for (const f of ROOTS.flatMap(files).filter((f) => EXT.has(extname(f)))) {
  readFileSync(f, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (BAD.test(line)) {
        console.log(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
        found++;
      }
    });
}
if (found) {
  console.error(`\n${found} line(s) with an en or em dash. Use a comma, a colon or a full stop.`);
  process.exit(1);
}
console.log("no dashes");
