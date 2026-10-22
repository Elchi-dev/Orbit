// Compiles Orbit into single-file binaries for every platform (UI embedded), then restores the dev stub.
// Usage: bun run build            (all targets)
//        bun run build -- linux-x64 (one target)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const ALL = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "windows-x64"];
const wanted = process.argv.slice(2).filter((a) => ALL.includes(a));
const targets = wanted.length ? wanted : ALL;
const version = (await Bun.file(join(ROOT, "package.json")).json()).version;

mkdirSync(join(ROOT, "release"), { recursive: true });
let failed = false;
for (const t of targets) {
  const out = join(ROOT, "release", `orbit-${t}${t.startsWith("windows") ? ".exe" : ""}`);
  const proc = Bun.spawnSync(
    ["bun", "build", "--compile", "--minify", "--sourcemap=none", `--target=bun-${t}`, `--define`, `ORBIT_VERSION="${version}"`, join(ROOT, "server/index.ts"), "--outfile", out],
    { cwd: ROOT, stdout: "inherit", stderr: "inherit" },
  );
  if (proc.exitCode !== 0) {
    console.error(`✗ ${t}`);
    failed = true;
  } else console.log(`✓ ${out}`);
}

// keep the repo clean: the big generated file is only needed while compiling
writeFileSync(
  join(ROOT, "server/embedded.ts"),
  `// Replaced at build time by scripts/embed.ts with the built web UI (base64), so the binary is self-contained.\nexport const assets: Record<string, { type: string; data: string }> = {};\n`,
);
process.exit(failed ? 1 : 0);
