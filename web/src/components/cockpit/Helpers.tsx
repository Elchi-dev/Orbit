import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  Compass,
  Eye,
  FlaskConical,
  GitBranch,
  GitMerge,
  Hammer,
  Loader2,
  Square,
  Trash2,
} from "lucide-react";
import { useStore } from "../../lib/store";
import { api } from "../../lib/api";
import { partialField } from "../../lib/partial";
import { agentLabel, stateLabel } from "../../lib/helpers";
import { modelName, money } from "../../lib/format";
import type { Helper, ToolCall } from "../../lib/types";
import { Markdown, toolLabel } from "./Blocks";

const AGENT_ICON: Record<string, typeof Bot> = {
  explorer: Compass,
  builder: Hammer,
  reviewer: Eye,
  tester: FlaskConical,
};
export const AgentIcon = ({
  agent,
  size = 15,
}: {
  agent?: string | null;
  size?: number;
}) => {
  const I = AGENT_ICON[agent ?? ""] ?? Bot;
  return <I size={size} />;
};

/** What a running helper is doing right now: its current tool, or the end of what it's writing. */
function useActivity(id?: string) {
  const stream = useStore((s) => (id ? s.streams[id] : undefined));
  const last = useRef<React.ReactNode>("");
  const blocks = stream?.blocks ?? [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b: any = blocks[i];
    if (!b) continue;
    if (b.type === "tool_use") {
      let input: any = {};
      for (const k of ["command", "path", "pattern", "url", "target", "name"]) {
        const v = partialField(b.text ?? "", k);
        if (v) input[k] = v;
      }
      // until the input arrives there's nothing to label but the kind of tool
      last.current =
        b.name === "plan"
          ? "Planning"
          : Object.keys(input).length
            ? toolLabel(b.name ?? "", input)
            : b.name === "bash"
              ? "Running a command"
              : `Using ${b.name}`;
      break;
    }
    if (b.type === "text" && b.text?.trim()) {
      last.current = b.text
        .trim()
        .split("\n")
        .filter(Boolean)
        .pop()!
        .slice(-140);
      break;
    }
    if (b.type === "thinking") {
      last.current = "thinking";
      break;
    }
  }
  return last.current;
}

const fmtDuration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60
    ? `${s}s`
    : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};

function Elapsed({ from, running }: { from: number; running: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  return <span>{fmtDuration(Date.now() - from)}</span>;
}

function Lane({
  block,
  call,
  helper,
  parentId,
}: {
  block: any;
  call?: ToolCall;
  helper?: Helper;
  parentId: string;
}) {
  const setView = useStore((s) => s.setView);
  const send = useStore((s) => s.send);
  const toast = useStore((s) => s.toast);
  const child = useStore((s) => (helper ? s.workspaces[helper.id] : undefined));
  const activity = useActivity(helper?.id);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"" | "merge" | "discard">("");
  const input =
    block.input ??
    (() => {
      try {
        return call ? JSON.parse(call.input) : {};
      } catch {
        return {};
      }
    })();
  const agent =
    helper?.agent ??
    input.agent ??
    partialField(block.text ?? "", "agent") ??
    "builder";
  const name =
    helper?.title ??
    input.name ??
    partialField(block.text ?? "", "name") ??
    input.task?.split("\n")[0] ??
    "Helper";
  const task: string =
    input.task ?? partialField(block.text ?? "", "task") ?? "";
  const running =
    !!helper &&
    (helper.running || helper.state === "running") &&
    call?.status !== "done" &&
    call?.status !== "error";
  const state = helper
    ? stateLabel({ ...helper, running })
    : call?.status === "denied"
      ? "denied"
      : "starting";
  const tone = helper?.pending
    ? "need"
    : running
      ? "busy"
      : helper?.state === "done"
        ? "good"
        : helper?.state === "failed" ||
            helper?.state === "stopped" ||
            call?.status === "denied"
          ? "bad"
          : helper?.state === "merged"
            ? "good"
            : "quiet";
  const report = helper?.report?.trim() ?? "";
  const canMerge = !!helper?.branch && helper.state === "done";

  async function act(kind: "merge" | "discard") {
    if (!helper) return;
    setBusy(kind);
    try {
      await api.post(`/api/helpers/${helper.id}/${kind}`, {});
      toast(
        kind === "merge"
          ? {
              title: "Changes brought in",
              body: `${helper.branch} is staged in your folder. Look it over in Git, then commit.`,
              tone: "good",
              workspaceId: parentId,
            }
          : {
              title: "Helper's branch removed",
              body: helper.branch,
              tone: "info",
              workspaceId: parentId,
            },
      );
    } catch (e) {
      toast({
        title: kind === "merge" ? "Couldn't merge" : "Couldn't remove it",
        body: (e as Error).message,
        tone: "warn",
      });
    } finally {
      setBusy("");
    }
  }

  return (
    <motion.article
      layout
      className={`lane ${tone}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      aria-label={`${agentLabel(agent)}: ${name}`}
    >
      <header className="lane-head">
        <span className="lane-icon">
          <AgentIcon agent={agent} />
        </span>
        <span className="lane-title">
          <span className="lane-agent">{agentLabel(agent)}</span>
          <span className="lane-name">{name}</span>
        </span>
        <span className={`lane-state ${tone}`}>
          {running ? (
            <Loader2 size={12} className="spin" />
          ) : tone === "good" ? (
            <Check size={12} />
          ) : (
            <i />
          )}
          {state}
        </span>
      </header>

      {running ? (
        <p className="lane-now mono" aria-live="polite">
          {activity || "starting"}
        </p>
      ) : report ? (
        <div className={`lane-report ${open ? "open" : ""}`}>
          <Markdown
            text={
              open
                ? report
                : report.split("\n").filter(Boolean).slice(0, 3).join("\n")
            }
          />
        </div>
      ) : null}

      <AnimatePresence initial={false}>
        {open && task && (
          <motion.div
            className="lane-task"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
          >
            <span className="eyebrow">Task</span>
            <p>{task}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="lane-foot">
        <span className="lane-meta">
          {helper?.model && <span>{modelName(helper.model)}</span>}
          {child?.stats && <span>{money(child.stats.cost)}</span>}
          {running && call ? (
            <Elapsed from={call.created_at} running />
          ) : call?.duration_ms != null ? (
            <span>{fmtDuration(call.duration_ms)}</span>
          ) : null}
        </span>
        <span className="lane-actions">
          {helper?.branch && !canMerge && (
            <span className="lane-branch mono" title="Works on its own branch">
              <GitBranch size={12} /> {helper.branch}
            </span>
          )}
          {canMerge && (
            <>
              <button
                className="btn b-outline sz-s"
                disabled={!!busy}
                onClick={() => act("merge")}
                data-tip={`Bring ${helper!.branch} into your folder, staged`}
              >
                {busy === "merge" ? (
                  <Loader2 size={13} className="spin" />
                ) : (
                  <GitMerge size={13} />
                )}{" "}
                Merge
              </button>
              <button
                className="btn b-ghost icon-btn sm"
                disabled={!!busy}
                onClick={() => act("discard")}
                aria-label="Discard the branch"
                data-tip="Discard the branch"
              >
                {busy === "discard" ? (
                  <Loader2 size={13} className="spin" />
                ) : (
                  <Trash2 size={13} />
                )}
              </button>
            </>
          )}
          <span className="lane-right">
            {running && (
              <button
                className="btn b-ghost icon-btn sm"
                onClick={() => send({ type: "stop", workspaceId: helper!.id })}
                aria-label="Stop this helper"
                data-tip="Stop"
              >
                <Square size={12} />
              </button>
            )}
            {(report || task) && (
              <button
                className="btn b-ghost icon-btn sm"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                aria-label={open ? "Less" : "More"}
                data-tip={open ? "Less" : "Task and full report"}
              >
                <ChevronDown size={14} className={`chev ${open ? "up" : ""}`} />
              </button>
            )}
            {helper && (
              <button
                className="btn b-ghost sz-s lane-open"
                onClick={() => setView({ kind: "ws", id: helper.id })}
              >
                Open <ArrowUpRight size={13} />
              </button>
            )}
          </span>
        </span>
      </footer>
      {running && <span className="lane-progress" aria-hidden="true" />}
    </motion.article>
  );
}

const NONE: Helper[] = [];

/** Helpers started together, side by side, each showing what it's doing and then what it found. */
export function HelperLanes({
  blocks,
  calls,
  parentId,
}: {
  blocks: any[];
  calls: Record<string, ToolCall>;
  parentId: string;
}) {
  const helpers = useStore((s) => s.workspaces[parentId]?.helpers) ?? NONE;
  return (
    <div className={`lanes n${Math.min(blocks.length, 3)}`}>
      {blocks.map((b) => {
        const input = b.input ?? {};
        const helper =
          helpers.find((h) => h.call_id === b.id) ??
          (input.helper
            ? helpers.find((h) => h.id === input.helper)
            : undefined);
        return (
          <Lane
            key={b.id}
            block={b}
            call={b.id ? calls[b.id] : undefined}
            helper={helper}
            parentId={parentId}
          />
        );
      })}
    </div>
  );
}

/** Above a helper's composer: what it is, where its work goes, and the way back. */
export function HelperBar({ ws }: { ws: import("../../lib/types").Workspace }) {
  const parent = useStore((s) =>
    ws.parent_id ? s.workspaces[ws.parent_id] : undefined,
  );
  const helper = parent?.helpers?.find((h) => h.id === ws.id);
  const setView = useStore((s) => s.setView);
  const toast = useStore((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const state = ws.helper_state ?? helper?.state ?? "";
  const branch = ws.branch || helper?.branch;
  async function act(kind: "merge" | "discard") {
    setBusy(true);
    try {
      await api.post(`/api/helpers/${ws.id}/${kind}`, {});
      toast({
        title:
          kind === "merge" ? "Changes brought in, staged" : "Branch removed",
        tone: "good",
      });
    } catch (e) {
      toast({
        title: "That didn't work",
        body: (e as Error).message,
        tone: "warn",
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="helper-bar" role="note">
      <span className="grow">
        {ws.running
          ? "Working for "
          : state === "done"
            ? "Reported back to "
            : state === "merged"
              ? "Merged into "
              : "Helper for "}
        <button
          className="btn b-link"
          onClick={() => parent && setView({ kind: "ws", id: parent.id })}
        >
          {parent?.title ?? "its workspace"}
        </button>
        {ws.running
          ? ". Anything you send joins its next step."
          : ". Send a message to give it more to do; its parent can follow up too."}
      </span>
      {branch && (
        <span className="lane-branch mono">
          <GitBranch size={12} /> {branch}
        </span>
      )}
      {branch && state === "done" && !ws.running && (
        <>
          <button
            className="btn b-outline sz-s"
            disabled={busy}
            onClick={() => act("merge")}
          >
            <GitMerge size={13} /> Merge
          </button>
          <button
            className="btn b-ghost sz-s"
            disabled={busy}
            onClick={() => act("discard")}
          >
            <Trash2 size={13} /> Discard
          </button>
        </>
      )}
    </div>
  );
}
