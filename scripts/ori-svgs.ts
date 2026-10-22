// Draws Ori's poses as standalone animated SVG files for the README and the docs, from the
// same component the app uses, so the pictures never drift from the real thing.
//   bun scripts/ori-svgs.ts      writes docs/images/ori/<pose>.svg
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const { Ori, ORI_POSES } = await import("../web/src/components/ori/Ori");
const css = readFileSync(join(import.meta.dir, "../web/src/components/ori/ori.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\[data-motion[^{]*\{[^}]*\}/g, "")
  .replace(/\s+/g, " ")
  .trim();

const out = join(import.meta.dir, "../docs/images/ori");
mkdirSync(out, { recursive: true });
for (const pose of ORI_POSES) {
  let svg = renderToStaticMarkup(createElement(Ori, { pose, size: 240 }));
  svg = svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ').replace(/<title>[^<]*<\/title>/, (t) => `${t}<style>${css}</style>`);
  writeFileSync(join(out, `${pose}.svg`), svg + "\n");
}
console.log(`${ORI_POSES.length} poses in docs/images/ori`);
