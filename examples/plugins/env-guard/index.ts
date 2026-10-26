// Every action passes here first. Anything that names a secrets file is sent to
// you (or refused), whatever the workspace's mode says.
import { plugin } from "./orbit-plugin";

const BUILT_IN = [/(^|[\s/"'=])\.env(\.[\w.-]+)?\b/, /\.ssh\//, /\.aws\/credentials/, /\.netrc\b/, /\.npmrc\b/, /\.docker\/config\.json/, /id_(rsa|ed25519|ecdsa)\b/, /\.pem\b/, /\.kube\/config/];

function patterns(): RegExp[] {
  const extra = String(plugin.settings.extra ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => new RegExp(p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")));
  return [...BUILT_IN, ...extra];
}

plugin.beforeTool(({ subject, tool }) => {
  const hit = patterns().find((p) => p.test(subject));
  if (!hit) return;
  const reason = `${tool} touches what looks like a secret (${subject.slice(0, 80)})`;
  return plugin.settings.block ? { decision: "deny", reason } : { decision: "ask", reason };
});

plugin.start();
