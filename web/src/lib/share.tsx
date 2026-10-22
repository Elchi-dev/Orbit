// "Save as a page": the whole workspace as one HTML file that opens anywhere,
// without Orbit and without a network. Tool calls and thinking are <details>,
// so the page needs no script to expand them.

import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../components/cockpit/Blocks";
import type { Detail, Workspace } from "./types";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function label(name: string, input: any): string {
  switch (name) {
    case "bash":
      return String(input?.command ?? "").split("\n")[0];
    case "read_file":
      return `Read ${input?.path}`;
    case "write_file":
      return `Wrote ${input?.path}`;
    case "edit_file":
      return `Edited ${input?.path}`;
    case "grep":
      return `Searched for ${input?.pattern}`;
    case "glob":
      return `Found files matching ${input?.pattern}`;
    case "list_dir":
      return `Looked in ${input?.path ?? "the folder"}`;
    case "fetch_url":
      return `Fetched ${input?.url}`;
    case "load_skill":
      return `Loaded the skill ${input?.name}`;
    default:
      return name.startsWith("mcp__") ? name.split("__").slice(1).join(" ") : name.replace(/^ui_/, "interface: ");
  }
}

const WHO: Record<string, string> = { readonly: "read-only", rule: "your rule", judge: "judge", user: "you", builtin: "interface" };

function Page({ ws, detail }: { ws: Workspace; detail: Detail }) {
  const turns: { role: string; blocks: any[] }[] = [];
  for (const m of detail.messages) {
    if (m.role === "user" && m.content.every((b) => b.type === "tool_result")) continue;
    const last = turns[turns.length - 1];
    if (m.role === "assistant" && last?.role === "assistant") last.blocks.push(...m.content);
    else turns.push({ role: m.role, blocks: [...m.content] });
  }
  return (
    <main className="share">
      <header className="share-head">
        <h1>{ws.title}</h1>
        <p>
          Saved from Orbit on {new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}. Claude worked in{" "}
          <code>{ws.cwd}</code>.
        </p>
      </header>
      {ws.summary && (
        <details className="share-tool">
          <summary>Summary of earlier work</summary>
          <Markdown text={ws.summary} />
        </details>
      )}
      {turns.map((t, i) =>
        t.role === "user" ? (
          <section key={i} className="turn you">
            <p className="user-text">
              {t.blocks
                .filter((b) => b.type === "text" && !b.text?.startsWith("<attachment"))
                .map((b) => b.text)
                .join("\n")}
            </p>
          </section>
        ) : (
          <section key={i} className="turn claude">
            {t.blocks.map((b, j) => {
              if (b.type === "text" && b.text) return <Markdown key={j} text={b.text} />;
              if (b.type === "thinking" && b.thinking)
                return (
                  <details key={j} className="share-tool thought">
                    <summary>Thought trail</summary>
                    <Markdown text={b.thinking} />
                  </details>
                );
              if (b.type === "server_tool_use") return <p key={j} className="share-note">Searched the web for “{b.input?.query}”</p>;
              if (b.type === "tool_use") {
                const call = detail.calls[b.id];
                const out = call?.output ?? "";
                return (
                  <details key={j} className={`share-tool ${call?.status ?? ""}`}>
                    <summary>
                      <span className="share-cmd">{label(b.name, b.input)}</span>
                      <span className="share-meta">{call?.status === "denied" ? "denied" : WHO[call?.decided_by ?? ""] ?? ""}</span>
                    </summary>
                    {b.name === "edit_file" ? (
                      <pre className="diff">
                        {String(b.input?.old_string ?? "")
                          .split("\n")
                          .map((l: string) => `- ${l}`)
                          .join("\n")}
                        {"\n"}
                        {String(b.input?.new_string ?? "")
                          .split("\n")
                          .map((l: string) => `+ ${l}`)
                          .join("\n")}
                      </pre>
                    ) : null}
                    {out ? <pre>{out.slice(0, 20_000)}</pre> : null}
                  </details>
                );
              }
              return null;
            })}
          </section>
        ),
      )}
      <footer className="share-foot">Made with Orbit</footer>
    </main>
  );
}

const SHARE_CSS = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: #0d0d18; color: #ecebf4; font: 15.5px/1.65 system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
.share { max-width: 760px; margin: 0 auto; padding: 48px 24px 80px; }
.share-head h1 { font-size: 26px; letter-spacing: -0.015em; margin: 0 0 6px; }
.share-head p { margin: 0 0 32px; color: rgba(236,235,244,.5); font-size: 14px; }
code, pre { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
.md code, .share-head code { font-size: .86em; background: rgba(255,255,255,.07); padding: .1em .38em; border-radius: 5px; }
.md pre { padding: 14px 16px; border-radius: 10px; background: #08080f; border: 1px solid rgba(255,255,255,.075); overflow-x: auto; font-size: 13px; }
.md pre code { background: none; padding: 0; }
.md a { color: #ffb199; }
.md table { border-collapse: collapse; } .md th, .md td { padding: 6px 12px; border-bottom: 1px solid rgba(255,255,255,.075); text-align: left; }
.turn.you { margin: 30px 0 12px; padding: 1px 0 1px 16px; border-left: 2px solid #ffb199; }
.user-text { margin: 0; font-size: 16px; font-weight: 500; white-space: pre-wrap; }
.turn.claude { padding-left: 18px; }
.share-tool { margin: 4px -8px; border-radius: 10px; }
.share-tool > summary { display: flex; gap: 12px; padding: 6px 8px; cursor: pointer; border-radius: 10px; list-style: none; color: rgba(236,235,244,.7); font-size: 14px; }
.share-tool > summary::-webkit-details-marker { display: none; }
.share-tool > summary:hover { background: rgba(255,255,255,.04); }
.share-tool[open] > summary { color: #ecebf4; }
.share-cmd { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, Menlo, monospace; font-size: 13px; }
.share-tool.thought .md, .share-tool > .md { padding: 0 8px 8px 22px; color: rgba(236,235,244,.7); font-size: 14px; }
.share-meta { flex: none; font-size: 12.5px; color: rgba(236,235,244,.48); }
.share-tool.denied .share-cmd { text-decoration: line-through; }
.share-tool pre { margin: 4px 8px 10px 30px; padding: 10px 12px; border-radius: 8px; background: #08080f; border: 1px solid rgba(255,255,255,.075); font-size: 12.5px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 420px; overflow: auto; color: #d8d7e3; }
.share-note { margin: 4px 0; color: rgba(236,235,244,.5); font-size: 14px; }
.code-copy { display: none; }
.share-foot { margin-top: 56px; color: rgba(236,235,244,.35); font-size: 12.5px; }
.cite { font-size: 11px; padding: 0 4px; border-radius: 4px; background: rgba(255,255,255,.08); color: rgba(236,235,244,.7); text-decoration: none; }
@media print { body { background: #fff; color: #111; } .share-tool pre, .md pre { background: #f5f5f7; color: #111; } }
`;

export function shareHtml(ws: Workspace, detail: Detail): string {
  const body = renderToStaticMarkup(<Page ws={ws} detail={detail} />);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(ws.title)}</title>
<style>${SHARE_CSS}</style></head>
<body>${body}</body></html>`;
}

export function downloadShare(ws: Workspace, detail: Detail) {
  const blob = new Blob([shareHtml(ws, detail)], { type: "text/html" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${ws.title.replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "") || "workspace"}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
