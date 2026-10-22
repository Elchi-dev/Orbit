// Writes docs/COMPATIBILITY.md from server/catalog.ts. `--check` fails when the file is out of date.
import { readFileSync, writeFileSync } from "node:fs";
import { CATALOG, quietEnv } from "../server/catalog";

const code = (s: string) => "`" + s + "`";
const list = (xs: string[] | undefined, bin: string, n = 5) => {
  if (!xs?.length) return "";
  if (xs.includes("")) return xs.length === 1 ? "everything" : "everything not listed as read-only";
  const shown = xs.slice(0, n).map((x) => code(`${bin} ${x}`));
  return shown.join(", ") + (xs.length > n ? `, ${xs.length - n} more` : "");
};
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

const cats = [...new Set(CATALOG.map((a) => a.cat))];
let md = `# Compatibility

Orbit knows the 100 programs below by name. The list lives in
[\`server/catalog.ts\`](../server/catalog.ts); this page is generated from it
(\`bun scripts/gen-compat.ts\`), so the two never disagree.

## What "known" means

For every program on the list that is installed, Orbit does five things:

1. **Finds it.** On your PATH, or where the desktop app usually lives. Settings,
   Integrations shows what was found and which version.
2. **Tells Claude.** A short list of what is installed goes with every request,
   with a line on how to drive each tool without a prompt (\`vitest run\`, not
   \`vitest\`; \`docker logs --tail\`, never \`-f\`). Claude stops spending turns on
   \`which\` and \`--version\`. You can switch this off.
3. **Lets looking through.** Subcommands that only read (\`docker ps\`,
   \`kubectl get\`, \`terraform validate\`, \`gh pr list\`) run without a rule, a
   judge or a question, like \`ls\` and \`git status\` already did. Flags that
   turn a read into a write are caught (\`npm audit fix\`, \`prettier --check --write\`,
   \`ruff check --fix\`, \`git diff --output=\`), and so is anything piped or
   redirected.
4. **Guards the rest.** Subcommands that delete, deploy or reach other machines
   (\`kubectl delete\`, \`terraform apply\`, \`vercel deploy\`, \`docker compose down\`)
   are named to the judge as destructive, and "Always allow" saves exactly that
   command instead of a pattern. A pattern for a group like \`docker compose\` goes
   one word deeper, so allowing \`docker compose up\` never allows \`down\`.
5. **Keeps it from waiting.** Every workspace shell starts with variables that
   switch off prompts, pagers and editors for these tools:

\`\`\`
${Object.entries(quietEnv())
  .map(([k, v]) => `${k}=${v}`)
  .join("\n")}
\`\`\`

Editors also **open files**: paths in the conversation and the Files panel open in
your editor at the right line (Settings, Integrations, "Open files in").

## Deeper integrations

| What | How |
| --- | --- |
| VS Code, Cursor, Windsurf, VSCodium | The [Orbit extension](../integrations/vscode) sends a selection, a file or a folder to Orbit (\`Ctrl Alt O\`). Orbit opens files back in the editor at the line. |
| Any terminal | \`orbit .\` opens the current folder as a workspace, starting Orbit if it isn't running, or handing the folder to the one that is. |
| JetBrains IDEs | Settings, Tools, External Tools: program \`orbit\`, arguments \`$ProjectFileDir$\`. Give it a shortcut. Orbit opens files back with \`idea --line\`. |
| Neovim and Vim | \`:silent !orbit %:p:h\` hands the file's folder to the Orbit that is running; map it to a key. |
| Emacs | \`(shell-command (concat "orbit " default-directory))\`; Orbit opens files back through \`emacsclient\`. |
| Links | \`http://localhost:7777/#/open?path=/abs/folder&file=src/a.ts&line=12&text=...\` does the same from anything that can open a URL. Text lands in the composer and is never sent on its own. |

## The 100
`;

let n = 0;
for (const cat of cats) {
  const apps = CATALOG.filter((a) => a.cat === cat);
  md += `\n### ${cat}\n\n| | Program | Looks for | Read-only without asking | Never widened | Notes |\n| --- | --- | --- | --- | --- | --- |\n`;
  for (const a of apps) {
    n++;
    const bin = a.bin[0].replace(/^\.\//, "");
    const notes = [a.open || a.scheme ? "Opens files at a line." : "", a.hint ?? ""].filter(Boolean).join(" ");
    md += `| ${n} | ${a.name} | ${a.bin.map(code).join(", ")} | ${cell(list(a.readonly, bin))} | ${cell(list(a.guard, bin))} | ${cell(notes)} |\n`;
  }
}

md += `
## Not on the list

Anything else still works: Claude can run any command in the shell, and the
gate treats it like any other command (your rules, then the mode). Being on the
list only adds the five things above. To add a program, add an entry to
\`server/catalog.ts\` and run \`bun scripts/gen-compat.ts\`.
`;

const out = "docs/COMPATIBILITY.md";
if (process.argv.includes("--check")) {
  const now = readFileSync(out, "utf8");
  if (now !== md) {
    console.error(`${out} is out of date: run bun scripts/gen-compat.ts`);
    process.exit(1);
  }
  console.log(`${out} is current`);
} else {
  writeFileSync(out, md);
  console.log(`wrote ${out} (${n} programs)`);
}
