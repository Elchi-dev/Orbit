// The programs Orbit knows by name: the 100 a developer is most likely to have
// installed. For each one Orbit can find it, tell Claude it is there and how to
// drive it without a prompt, let its read-only commands through without asking,
// and refuse to widen its destructive commands into a pattern. Editors can also
// open a file at a line. docs/COMPATIBILITY.md is generated from this list.

import { existsSync } from "node:fs";
import { homedir } from "node:os";

export type Category =
  | "Editors and IDEs"
  | "Version control"
  | "Languages and runtimes"
  | "Package managers"
  | "Build tools"
  | "Tests and code quality"
  | "Containers and infrastructure"
  | "Cloud and deploy"
  | "Databases"
  | "Data, AI and mobile"
  | "Everyday tools";

export interface App {
  id: string;
  name: string;
  cat: Category;
  /** executables, the first one found on PATH wins */
  bin: string[];
  /** where a desktop app lives when its command is not on PATH ({home} is the home folder) */
  paths?: string[];
  /** subcommands that only look; they run without a rule, a judge or a question */
  readonly?: string[];
  /** subcommands that delete, deploy or reach other machines: never widened by "Always allow" */
  guard?: string[];
  /** flags or words that make an otherwise read-only subcommand write (`--fix`, `--output`) */
  unsafe?: string[];
  /** one line for Claude on driving it without a prompt */
  hint?: string;
  /** variables that keep it from waiting for input in Orbit's shell */
  env?: Record<string, string>;
  /** editors: argv to open a file at a line; {path} and {line} are filled in */
  open?: string[];
  /** editors: a link the browser can open directly; {path} and {line} are filled in */
  scheme?: string;
}

const MAC = "/Applications";
const vsc = (bin: string, app: string, scheme: string): Partial<App> => ({
  bin: [bin],
  paths: [`${MAC}/${app}.app`, `{home}/AppData/Local/Programs/${app}/${app}.exe`],
  open: [bin, "--goto", "{path}:{line}"],
  scheme: `${scheme}://file{path}:{line}`,
});
const jb = (bin: string, app: string): Partial<App> => ({
  bin: [bin, `${bin}.sh`],
  paths: [`${MAC}/${app}.app`],
  open: [bin, "--line", "{line}", "{path}"],
});

export const CATALOG: App[] = [
  // ---------- editors and IDEs ----------
  { id: "vscode", name: "Visual Studio Code", cat: "Editors and IDEs", ...vsc("code", "Visual Studio Code", "vscode") } as App,
  { id: "cursor", name: "Cursor", cat: "Editors and IDEs", ...vsc("cursor", "Cursor", "cursor") } as App,
  { id: "windsurf", name: "Windsurf", cat: "Editors and IDEs", ...vsc("windsurf", "Windsurf", "windsurf") } as App,
  { id: "vscodium", name: "VSCodium", cat: "Editors and IDEs", ...vsc("codium", "VSCodium", "vscodium") } as App,
  { id: "zed", name: "Zed", cat: "Editors and IDEs", bin: ["zed", "zeditor"], paths: [`${MAC}/Zed.app`], open: ["zed", "{path}:{line}"] },
  { id: "intellij", name: "IntelliJ IDEA", cat: "Editors and IDEs", ...jb("idea", "IntelliJ IDEA") } as App,
  { id: "pycharm", name: "PyCharm", cat: "Editors and IDEs", ...jb("pycharm", "PyCharm") } as App,
  { id: "webstorm", name: "WebStorm", cat: "Editors and IDEs", ...jb("webstorm", "WebStorm") } as App,
  { id: "goland", name: "GoLand", cat: "Editors and IDEs", ...jb("goland", "GoLand") } as App,
  { id: "android-studio", name: "Android Studio", cat: "Editors and IDEs", ...jb("studio", "Android Studio") } as App,
  { id: "xcode", name: "Xcode", cat: "Editors and IDEs", bin: ["xed"], paths: [`${MAC}/Xcode.app`], open: ["xed", "--line", "{line}", "{path}"], readonly: ["--version"] },
  { id: "sublime", name: "Sublime Text", cat: "Editors and IDEs", bin: ["subl"], paths: [`${MAC}/Sublime Text.app`], open: ["subl", "{path}:{line}"] },
  { id: "neovim", name: "Neovim", cat: "Editors and IDEs", bin: ["nvim"], hint: "Never start it interactively; edit files with Orbit's file tools. `nvim --headless` works for scripted runs." },
  { id: "vim", name: "Vim", cat: "Editors and IDEs", bin: ["vim"], hint: "Never start it interactively; edit files with Orbit's file tools." },
  { id: "emacs", name: "Emacs", cat: "Editors and IDEs", bin: ["emacsclient", "emacs"], open: ["emacsclient", "-n", "+{line}", "{path}"], hint: "Use `emacs --batch` for scripted runs, never the interactive editor." },

  // ---------- version control ----------
  {
    id: "git", name: "Git", cat: "Version control", bin: ["git"],
    readonly: ["status", "log", "diff", "show", "rev-parse", "ls-files", "blame", "describe", "remote -v", "config --get", "stash list", "shortlog", "reflog", "branch --list", "worktree list", "cat-file", "grep", "merge-base", "for-each-ref"],
    unsafe: ["--output", "--ext-diff", "--exec"],
    guard: ["push", "reset --hard", "clean", "branch -D", "checkout --", "restore", "rebase", "filter-branch", "filter-repo", "stash drop", "stash clear", "tag -d", "remote remove", "update-ref -d"],
    hint: "Commit with -m; never open an editor. Pages are off. Use `git --no-pager` if output looks cut.",
    env: { GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true", GIT_PAGER: "cat", GIT_ASKPASS: "true" },
  },
  {
    id: "gh", name: "GitHub CLI", cat: "Version control", bin: ["gh"],
    readonly: ["pr list", "pr view", "pr diff", "pr checks", "pr status", "issue list", "issue view", "issue status", "repo view", "run list", "run view", "release list", "release view", "auth status", "search", "workflow list", "label list"],
    guard: ["pr merge", "pr close", "repo delete", "repo create", "repo edit", "release create", "release delete", "issue close", "issue delete", "secret", "workflow run", "api"],
    hint: "Pass --title and --body (or --fill) so nothing prompts. `gh api` reaches the whole GitHub API.",
    env: { GH_PROMPT_DISABLED: "1", GH_PAGER: "cat", GH_NO_UPDATE_NOTIFIER: "1" },
  },
  {
    id: "glab", name: "GitLab CLI", cat: "Version control", bin: ["glab"],
    readonly: ["mr list", "mr view", "mr diff", "issue list", "issue view", "repo view", "ci list", "ci view", "ci status", "auth status"],
    guard: ["mr merge", "mr close", "repo delete", "release create", "release delete", "ci run", "api"],
    env: { GLAB_NO_PROMPT: "1", NO_PROMPT: "1" },
  },

  // ---------- languages and runtimes ----------
  { id: "node", name: "Node.js", cat: "Languages and runtimes", bin: ["node"], hint: "Check the lockfile to pick npm, pnpm, yarn or bun before installing anything." },
  { id: "bun", name: "Bun", cat: "Languages and runtimes", bin: ["bun"], readonly: ["pm ls", "outdated"], guard: ["publish"] },
  { id: "deno", name: "Deno", cat: "Languages and runtimes", bin: ["deno"], readonly: ["info", "doc", "check", "lint", "fmt --check"], unsafe: ["--fix"], guard: ["publish", "deploy"] },
  { id: "python", name: "Python", cat: "Languages and runtimes", bin: ["python3", "python", "py"], hint: "Use the project's virtual environment when there is one (.venv, uv, poetry); activate it once, the shell keeps it." },
  { id: "go", name: "Go", cat: "Languages and runtimes", bin: ["go"], readonly: ["env", "list", "version", "vet", "doc"], unsafe: ["-w", "-u"], hint: "`go test ./...` runs everything; add -run to narrow it." },
  { id: "rust", name: "Rust (cargo)", cat: "Languages and runtimes", bin: ["cargo"], readonly: ["tree", "metadata", "check", "clippy", "fmt --check", "search", "--list"], unsafe: ["--fix", "--allow-dirty"], guard: ["publish", "yank", "owner"], hint: "`cargo check` is the fast way to see compile errors." },
  { id: "java", name: "Java (JDK)", cat: "Languages and runtimes", bin: ["java", "javac"] },
  { id: "dotnet", name: ".NET", cat: "Languages and runtimes", bin: ["dotnet"], readonly: ["--info", "--list-sdks", "list", "nuget list"], guard: ["nuget push", "nuget delete"], env: { DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" } },
  { id: "ruby", name: "Ruby", cat: "Languages and runtimes", bin: ["ruby"] },
  { id: "php", name: "PHP", cat: "Languages and runtimes", bin: ["php"], readonly: ["-l", "-m", "-i"] },
  { id: "elixir", name: "Elixir", cat: "Languages and runtimes", bin: ["mix", "elixir"], readonly: ["deps", "help", "format --check-formatted"], guard: ["hex.publish", "ecto.drop", "ecto.reset"] },
  { id: "swift", name: "Swift", cat: "Languages and runtimes", bin: ["swift"], readonly: ["package describe", "package show-dependencies"] },
  { id: "cc", name: "C and C++ (gcc, clang)", cat: "Languages and runtimes", bin: ["clang", "gcc", "cc"] },

  // ---------- package managers ----------
  { id: "npm", name: "npm", cat: "Package managers", bin: ["npm"], readonly: ["ls", "list", "outdated", "view", "info", "explain", "why", "config get", "config list", "audit", "search", "pkg get", "root", "prefix"], unsafe: ["fix", "--fix"], guard: ["publish", "unpublish", "deprecate", "owner", "dist-tag", "token", "access"], env: { npm_config_yes: "true", npm_config_fund: "false", npm_config_update_notifier: "false" } },
  { id: "pnpm", name: "pnpm", cat: "Package managers", bin: ["pnpm"], readonly: ["ls", "list", "outdated", "why", "view", "info", "audit", "root"], unsafe: ["--fix", "fix"], guard: ["publish"] },
  { id: "yarn", name: "Yarn", cat: "Package managers", bin: ["yarn"], readonly: ["list", "info", "why", "outdated", "config get", "npm info"], guard: ["publish", "npm publish"], env: { YARN_ENABLE_INTERACTIVE: "0" } },
  { id: "pip", name: "pip", cat: "Package managers", bin: ["pip3", "pip"], readonly: ["list", "show", "freeze", "check", "config list", "index versions"], guard: ["uninstall"], env: { PIP_NO_INPUT: "1", PIP_DISABLE_PIP_VERSION_CHECK: "1" } },
  { id: "uv", name: "uv", cat: "Package managers", bin: ["uv"], readonly: ["pip list", "pip show", "pip freeze", "tree", "python list"], guard: ["publish", "cache clean"] },
  { id: "poetry", name: "Poetry", cat: "Package managers", bin: ["poetry"], readonly: ["show", "check", "env info", "config --list"], guard: ["publish", "env remove"], env: { POETRY_NO_INTERACTION: "1" } },
  { id: "conda", name: "Conda", cat: "Package managers", bin: ["conda", "mamba", "micromamba"], readonly: ["list", "info", "env list", "search", "config --show"], guard: ["remove", "env remove", "clean"], hint: "Pass -y to install and create." },
  { id: "brew", name: "Homebrew", cat: "Package managers", bin: ["brew"], readonly: ["list", "info", "search", "outdated", "deps", "config", "doctor", "leaves", "--prefix"], guard: ["uninstall", "untap", "cleanup", "services stop"], env: { HOMEBREW_NO_AUTO_UPDATE: "1", HOMEBREW_NO_ENV_HINTS: "1" } },
  { id: "apt", name: "APT", cat: "Package managers", bin: ["apt-get", "apt"], readonly: ["list", "show", "search", "policy", "depends", "rdepends"], guard: ["remove", "purge", "autoremove", "full-upgrade", "dist-upgrade"], env: { DEBIAN_FRONTEND: "noninteractive" }, hint: "Needs sudo, which Orbit always asks you about. Pass -y." },
  { id: "winget", name: "winget", cat: "Package managers", bin: ["winget"], readonly: ["list", "search", "show", "--info"], guard: ["uninstall"], hint: "Pass --accept-source-agreements --accept-package-agreements so nothing prompts." },
  { id: "composer", name: "Composer", cat: "Package managers", bin: ["composer"], readonly: ["show", "outdated", "validate", "why", "why-not", "licenses", "audit", "config --list"], guard: ["remove"], env: { COMPOSER_NO_INTERACTION: "1" } },
  { id: "bundler", name: "Bundler", cat: "Package managers", bin: ["bundle"], readonly: ["list", "info", "outdated", "check", "show", "config"], guard: ["clean"] },
  { id: "maven", name: "Maven", cat: "Package managers", bin: ["mvn"], readonly: ["dependency:tree", "help:effective-pom", "validate", "-v", "--version"], guard: ["deploy", "release:perform"], hint: "Add -B (batch mode) so Maven never waits for input." },
  { id: "gradle", name: "Gradle", cat: "Package managers", bin: ["gradle", "./gradlew"], readonly: ["--version"], guard: ["publish"], hint: "Prefer ./gradlew in the project, with --console=plain." },

  // ---------- build tools ----------
  { id: "make", name: "Make", cat: "Build tools", bin: ["make"], hint: "`make -n` shows what a target would run; lines marked + still run, so it is not treated as read-only." },
  { id: "cmake", name: "CMake", cat: "Build tools", bin: ["cmake"], readonly: ["--version", "--help", "-E capabilities"] },
  { id: "bazel", name: "Bazel", cat: "Build tools", bin: ["bazel", "bazelisk"], readonly: ["info", "version"], guard: ["clean --expunge"] },
  { id: "vite", name: "Vite", cat: "Build tools", bin: ["vite"], hint: "Dev servers never exit; start them in the background (`... &`) and read the port from the log." },
  { id: "turbo", name: "Turborepo", cat: "Build tools", bin: ["turbo"], readonly: ["ls", "query", "--version"], guard: ["prune"] },
  { id: "nx", name: "Nx", cat: "Build tools", bin: ["nx"], env: { NX_INTERACTIVE: "false", NX_NO_CLOUD: "true" } },

  // ---------- tests and code quality ----------
  { id: "tsc", name: "TypeScript", cat: "Tests and code quality", bin: ["tsc"], readonly: ["--noEmit", "--version", "--showConfig"] },
  { id: "eslint", name: "ESLint", cat: "Tests and code quality", bin: ["eslint"], readonly: ["--print-config", "--version"], unsafe: ["--fix", "--output-file", "-o"], hint: "Without --fix it only reports." },
  { id: "prettier", name: "Prettier", cat: "Tests and code quality", bin: ["prettier"], readonly: ["--check", "-c", "--list-different", "-l", "--version"], unsafe: ["--write", "-w"] },
  { id: "biome", name: "Biome", cat: "Tests and code quality", bin: ["biome"], readonly: ["check", "lint", "format", "ci", "version"], unsafe: ["--write", "--fix", "--apply", "--apply-unsafe", "--unsafe"], hint: "check, lint and format only report unless --write is passed." },
  { id: "ruff", name: "Ruff", cat: "Tests and code quality", bin: ["ruff"], readonly: ["check", "format --check", "format --diff", "version"], unsafe: ["--fix", "--unsafe-fixes", "--add-noqa"], hint: "Without --fix it only reports." },
  { id: "mypy", name: "mypy", cat: "Tests and code quality", bin: ["mypy"], readonly: [""] },
  { id: "pytest", name: "pytest", cat: "Tests and code quality", bin: ["pytest"], readonly: ["--version"], hint: "Add -x -q for short output, -k to pick tests." },
  { id: "vitest", name: "Vitest", cat: "Tests and code quality", bin: ["vitest"], hint: "Use `vitest run`; plain `vitest` watches and never exits." },
  { id: "jest", name: "Jest", cat: "Tests and code quality", bin: ["jest"], readonly: ["--listTests", "--showConfig"], hint: "Pass --watchAll=false in projects that default to watch mode.", env: { CI: "1" } },
  { id: "playwright", name: "Playwright", cat: "Tests and code quality", bin: ["playwright"], readonly: ["--version"], hint: "Use the line reporter (--reporter=line); never `show-report`, which serves until stopped." },
  { id: "cypress", name: "Cypress", cat: "Tests and code quality", bin: ["cypress"], readonly: ["verify", "info", "version"], hint: "Use `cypress run`, never `cypress open`." },
  { id: "shellcheck", name: "ShellCheck", cat: "Tests and code quality", bin: ["shellcheck"], readonly: [""] },
  { id: "golangci-lint", name: "golangci-lint", cat: "Tests and code quality", bin: ["golangci-lint"], readonly: ["run", "linters", "version"], unsafe: ["--fix"], hint: "Without --fix it only reports." },
  { id: "pre-commit", name: "pre-commit", cat: "Tests and code quality", bin: ["pre-commit"], readonly: ["--version", "validate-config"], guard: ["uninstall", "clean"] },

  // ---------- containers and infrastructure ----------
  {
    id: "docker", name: "Docker", cat: "Containers and infrastructure", bin: ["docker"],
    readonly: ["ps", "images", "image ls", "image inspect", "container ls", "inspect", "logs", "stats --no-stream", "version", "info", "network ls", "volume ls", "context ls", "compose ps", "compose logs", "compose config", "compose ls", "system df", "history", "top", "port", "diff"],
    guard: ["rm", "rmi", "system prune", "volume rm", "volume prune", "image prune", "container prune", "network rm", "compose down", "kill", "push", "login"],
    hint: "Use `logs --tail 100` (never -f) and `compose up -d`, so commands return.",
  },
  { id: "podman", name: "Podman", cat: "Containers and infrastructure", bin: ["podman"], readonly: ["ps", "images", "inspect", "logs", "version", "info", "pod ps"], guard: ["rm", "rmi", "system prune", "volume rm", "kill", "push", "system reset"] },
  {
    id: "kubectl", name: "kubectl", cat: "Containers and infrastructure", bin: ["kubectl"],
    readonly: ["get", "describe", "logs", "top", "explain", "api-resources", "api-versions", "version", "cluster-info", "config view", "config get-contexts", "config current-context", "auth can-i", "events", "diff"],
    guard: ["delete", "apply", "replace", "patch", "edit", "scale", "drain", "cordon", "taint", "rollout undo", "rollout restart", "exec", "cp", "config use-context", "port-forward"],
    hint: "Check `kubectl config current-context` before anything that changes a cluster. Never use `logs -f`.",
  },
  { id: "helm", name: "Helm", cat: "Containers and infrastructure", bin: ["helm"], readonly: ["list", "ls", "status", "get", "history", "show", "search", "template", "lint", "version", "repo list", "env"], unsafe: ["--output-dir"], guard: ["install", "upgrade", "uninstall", "delete", "rollback", "push"] },
  {
    id: "terraform", name: "Terraform", cat: "Containers and infrastructure", bin: ["terraform", "tofu"],
    readonly: ["validate", "show", "output", "version", "providers", "fmt -check", "state list", "state show", "graph", "workspace list", "workspace show"],
    guard: ["apply", "destroy", "import", "state rm", "state mv", "taint", "force-unlock", "workspace delete"],
    hint: "Run `plan -out=tfplan` and show the result before any apply. Plan and apply take -input=false.",
    env: { TF_INPUT: "0", TF_IN_AUTOMATION: "1" },
  },
  { id: "ansible", name: "Ansible", cat: "Containers and infrastructure", bin: ["ansible-playbook", "ansible"], readonly: ["--list-hosts", "--list-tasks", "--syntax-check", "--version"], guard: [""], hint: "Run playbooks with --check --diff first; that changes nothing." },
  { id: "pulumi", name: "Pulumi", cat: "Containers and infrastructure", bin: ["pulumi"], readonly: ["preview", "stack ls", "stack output", "config", "whoami", "version", "about"], guard: ["up", "destroy", "refresh", "stack rm", "state delete", "cancel"], env: { PULUMI_SKIP_UPDATE_CHECK: "1" }, hint: "Pass --yes to up and destroy only after the preview was shown." },
  { id: "systemd", name: "systemd (systemctl)", cat: "Containers and infrastructure", bin: ["systemctl"], readonly: ["status", "is-active", "is-enabled", "is-failed", "list-units", "list-unit-files", "list-timers", "cat", "show"], guard: ["stop", "restart", "disable", "mask", "kill", "reboot", "poweroff", "isolate"], env: { SYSTEMD_PAGER: "cat", SYSTEMD_COLORS: "0" }, hint: "Logs: `journalctl -u NAME -n 100 --no-pager`." },
  { id: "ssh", name: "OpenSSH", cat: "Containers and infrastructure", bin: ["ssh"], readonly: ["-V", "-G"], guard: [""], hint: "Pass the remote command inline with -o BatchMode=yes; an interactive login never returns." },
  { id: "rsync", name: "rsync", cat: "Containers and infrastructure", bin: ["rsync"], readonly: ["--version"], guard: ["--delete", ""], hint: "Use --dry-run first to show what would change." },

  // ---------- cloud and deploy ----------
  { id: "aws", name: "AWS CLI", cat: "Cloud and deploy", bin: ["aws"], readonly: ["sts get-caller-identity", "configure list", "s3 ls", "ec2 describe-", "logs describe-", "logs tail", "iam list-", "iam get-", "lambda list-", "lambda get-", "cloudformation describe-", "cloudformation list-"], guard: ["s3 rm", "s3 rb", "s3 sync", "ec2 terminate-instances", "delete-", "cloudformation deploy", "iam create-", "iam put-", "iam attach-"], env: { AWS_PAGER: "" } },
  { id: "gcloud", name: "Google Cloud CLI", cat: "Cloud and deploy", bin: ["gcloud"], readonly: ["config list", "auth list", "projects list", "projects describe", "info", "version"], guard: ["delete", "deploy", "app deploy", "run deploy", "functions deploy", "iam"], env: { CLOUDSDK_CORE_DISABLE_PROMPTS: "1" } },
  { id: "az", name: "Azure CLI", cat: "Cloud and deploy", bin: ["az"], readonly: ["account show", "account list", "group list", "resource list", "version"], guard: ["delete", "deployment create", "webapp deploy", "role assignment create"], env: { AZURE_CORE_ONLY_SHOW_ERRORS: "1", AZURE_CORE_NO_COLOR: "1" } },
  { id: "vercel", name: "Vercel CLI", cat: "Cloud and deploy", bin: ["vercel"], readonly: ["ls", "list", "inspect", "logs", "whoami", "env ls", "project ls", "domains ls"], guard: ["deploy", "--prod", "rm", "remove", "env rm", "domains rm", "alias", "promote", "rollback"], hint: "Pass --yes so it never asks." },
  { id: "netlify", name: "Netlify CLI", cat: "Cloud and deploy", bin: ["netlify", "ntl"], readonly: ["status", "sites:list", "env:list", "logs"], guard: ["deploy", "sites:delete", "env:unset"] },
  { id: "fly", name: "Fly.io", cat: "Cloud and deploy", bin: ["fly", "flyctl"], readonly: ["status", "logs --no-tail", "apps list", "machine list", "secrets list", "version", "config show"], guard: ["deploy", "destroy", "apps destroy", "machine destroy", "secrets set", "secrets unset", "scale"] },
  { id: "wrangler", name: "Cloudflare Wrangler", cat: "Cloud and deploy", bin: ["wrangler"], readonly: ["whoami", "deployments list", "kv namespace list", "d1 list", "r2 bucket list", "versions list"], guard: ["deploy", "publish", "delete", "rollback", "secret put", "secret delete", "kv key delete", "d1 execute --remote", "r2 object delete"], hint: "`wrangler dev` never exits; start it in the background." },
  { id: "firebase", name: "Firebase CLI", cat: "Cloud and deploy", bin: ["firebase"], readonly: ["projects:list", "apps:list", "use", "hosting:channel:list", "functions:list", "login:list"], guard: ["deploy", "hosting:disable", "functions:delete", "firestore:delete", "database:remove", "projects:delete"] },
  { id: "supabase", name: "Supabase CLI", cat: "Cloud and deploy", bin: ["supabase"], readonly: ["status", "projects list", "migration list", "db diff", "functions list", "secrets list"], guard: ["db push", "db reset", "functions deploy", "projects delete", "secrets set", "secrets unset", "migration repair"] },

  // ---------- databases ----------
  { id: "psql", name: "PostgreSQL (psql)", cat: "Databases", bin: ["psql"], readonly: ["--version", "-l", "--list"], guard: ["-c", "-f", ""], env: { PSQL_PAGER: "cat" }, hint: "Run one statement with -c and -X; an open psql session never returns." },
  { id: "mysql", name: "MySQL client", cat: "Databases", bin: ["mysql", "mariadb"], readonly: ["--version"], guard: ["-e", ""], hint: "Run statements with -e; an open session never returns." },
  { id: "sqlite", name: "SQLite", cat: "Databases", bin: ["sqlite3"], readonly: ["--version"], hint: "Pass the SQL as an argument: `sqlite3 -readonly db.sqlite '.tables'`." },
  { id: "redis", name: "Redis CLI", cat: "Databases", bin: ["redis-cli", "valkey-cli"], readonly: ["ping", "info", "--version", "dbsize", "get", "keys", "scan", "type", "ttl", "exists", "hgetall", "lrange", "smembers"], guard: ["flushall", "flushdb", "del", "config set", "shutdown"] },
  { id: "mongosh", name: "MongoDB Shell", cat: "Databases", bin: ["mongosh"], readonly: ["--version"], guard: ["--eval", ""], hint: "Use --quiet --eval for one command; an open shell never returns." },
  { id: "duckdb", name: "DuckDB", cat: "Databases", bin: ["duckdb"], readonly: ["--version"], hint: "Pass the SQL with -c so it answers and exits." },

  // ---------- data, AI and mobile ----------
  { id: "jupyter", name: "Jupyter", cat: "Data, AI and mobile", bin: ["jupyter"], readonly: ["--version", "kernelspec list", "nbconvert --to markdown --stdout"], unsafe: ["--execute", "--inplace", "--output"], hint: "Run notebooks with `jupyter nbconvert --to notebook --execute`; never start the server in the foreground." },
  { id: "ollama", name: "Ollama", cat: "Data, AI and mobile", bin: ["ollama"], readonly: ["list", "ls", "ps", "show", "--version"], guard: ["rm", "push"], hint: "Pass the prompt as an argument to `ollama run MODEL`, so it answers once and exits." },
  { id: "flutter", name: "Flutter", cat: "Data, AI and mobile", bin: ["flutter"], readonly: ["doctor", "devices", "analyze", "--version", "pub deps", "pub outdated"], guard: ["pub publish", "clean"] },
  { id: "adb", name: "Android Debug Bridge", cat: "Data, AI and mobile", bin: ["adb"], readonly: ["devices", "version", "get-state", "logcat -d"], guard: ["uninstall", "shell rm", "reboot", "root", "install"], hint: "Use `logcat -d` (dump), never plain logcat, which follows forever." },

  // ---------- everyday tools ----------
  { id: "curl", name: "curl", cat: "Everyday tools", bin: ["curl"], readonly: ["--version"], guard: [""], hint: "Add -sS and --max-time 30 so it fails fast and quietly." },
  { id: "jq", name: "jq", cat: "Everyday tools", bin: ["jq"], readonly: [""] },
  { id: "ripgrep", name: "ripgrep", cat: "Everyday tools", bin: ["rg"], readonly: [""], unsafe: ["--pre", "--pre-glob"] },
  { id: "ffmpeg", name: "FFmpeg", cat: "Everyday tools", bin: ["ffmpeg"], readonly: ["-version", "-formats", "-codecs"], hint: "Pass -y or -n so it never asks about overwriting, and -hide_banner for short output." },
  { id: "tmux", name: "tmux", cat: "Everyday tools", bin: ["tmux"], readonly: ["ls", "list-sessions", "list-windows", "capture-pane -p"], guard: ["kill-server", "kill-session"], hint: "Long-running servers can go in a detached session: `tmux new -d -s NAME 'cmd'`, then read it with `capture-pane -p`." },
  { id: "openssl", name: "OpenSSL", cat: "Everyday tools", bin: ["openssl"], readonly: ["version", "x509 -noout"], unsafe: ["-out"] },
];

// ---------- finding what is installed ----------
const IS_WIN = process.platform === "win32";
export interface Found {
  id: string;
  path: string | null;
}
let cache: Map<string, Found> | null = null;

function which(bin: string): string | null {
  if (bin.startsWith("./")) return null; // project-local wrappers are found per workspace, not globally
  try {
    return Bun.which(bin) ?? (IS_WIN ? Bun.which(`${bin}.cmd`) ?? Bun.which(`${bin}.exe`) : null);
  } catch {
    return null;
  }
}

export function detect(force = false): Map<string, Found> {
  if (cache && !force) return cache;
  const home = homedir();
  const out = new Map<string, Found>();
  for (const app of CATALOG) {
    let path: string | null = null;
    for (const b of app.bin) {
      path = which(b);
      if (path) break;
    }
    if (!path && app.paths) {
      for (const p of app.paths) {
        const full = p.replace("{home}", home);
        if (existsSync(full)) {
          path = full;
          break;
        }
      }
    }
    out.set(app.id, { id: app.id, path });
  }
  cache = out;
  return out;
}

export const installed = () => CATALOG.filter((a) => detect().get(a.id)?.path);
export const findApp = (id: string) => CATALOG.find((a) => a.id === id);

/** Variables that keep every known tool from waiting for input. Applied to every workspace shell. */
export function quietEnv(): Record<string, string> {
  const env: Record<string, string> = {
    TERM: "dumb",
    NO_COLOR: "1",
    PAGER: "cat",
    MANPAGER: "cat",
    EDITOR: "true",
    VISUAL: "true",
  };
  for (const app of CATALOG) Object.assign(env, app.env);
  delete env.CI; // CI changes how some tools behave; set it per command where a hint says so
  return env;
}

// ---------- reading a command ----------
const BIN_INDEX = new Map<string, App[]>();
for (const app of CATALOG)
  for (const b of app.bin) {
    const key = b.replace(/^\.\//, "");
    BIN_INDEX.set(key, [...(BIN_INDEX.get(key) ?? []), app]);
  }

function startsWithWords(rest: string, prefix: string) {
  if (prefix === "") return true;
  if (!rest.startsWith(prefix)) return false;
  const next = rest.charAt(prefix.length);
  // "ec2 describe-" is a prefix by design; everything else must end on a word
  return prefix.endsWith("-") || next === "" || next === " " || next === "=";
}

function split(segment: string) {
  const words = segment.trim().split(/\s+/);
  let bin = (words[0] ?? "").replace(/^\.\//, "");
  let rest = words.slice(1).join(" ");
  // npx/bunx/pnpm exec/uv run run another program: judge that program
  if (["npx", "bunx", "pnpx"].includes(bin) || (bin === "uv" && words[1] === "run") || (bin === "poetry" && words[1] === "run")) {
    const skip = bin === "uv" || bin === "poetry" ? 2 : 1;
    const inner = words.slice(skip).filter((w, i) => !(i === 0 && w.startsWith("-")));
    bin = inner[0] ?? "";
    rest = inner.slice(1).join(" ");
  }
  return { bin, rest };
}

/** True when a flag in this command makes the tool write (`--fix`, `--output`, `--pre`). */
export function catalogUnsafe(segment: string): boolean {
  const { bin, rest } = split(segment);
  const words = rest.split(/\s+/);
  return (BIN_INDEX.get(bin) ?? []).some((a) => a.unsafe?.some((u) => words.some((w) => w === u || w.startsWith(`${u}=`))));
}

/** True when the catalog knows this one command only looks. */
export function catalogReadOnly(segment: string): boolean {
  const { bin, rest } = split(segment);
  const apps = BIN_INDEX.get(bin);
  if (!apps) return false;
  const words = rest.split(/\s+/);
  return apps.some((a) => {
    if (a.unsafe?.some((u) => words.some((w) => w === u || w.startsWith(`${u}=`)))) return false;
    if (a.guard?.some((g) => g !== "" && startsWithWords(rest, g))) return false;
    if (a.guard?.includes("") && !a.readonly?.some((r) => r !== "" && startsWithWords(rest, r))) return false;
    return !!a.readonly?.some((r) => startsWithWords(rest, r));
  });
}

/** The tool and subcommand that make this command risky, if the catalog knows one. */
export function catalogGuard(command: string): string | null {
  for (const seg of command.split(/\s*(?:&&|\|\||;|\||\n)\s*/)) {
    const { bin, rest } = split(seg.replace(/^(\w+=\S*\s+)+/, ""));
    for (const a of BIN_INDEX.get(bin) ?? []) {
      const g = a.guard?.find((x) => startsWithWords(rest, x));
      if (g !== undefined) return `${a.name}${g ? `: ${bin} ${g}` : ""}`;
    }
  }
  return null;
}

/** True when "BIN SUB *" would also cover a guarded subcommand such as "compose down" or "pr merge". */
export function groupHasGuard(bin: string, sub: string): boolean {
  return (BIN_INDEX.get(bin) ?? []).some((a) => a.guard?.some((g) => g.startsWith(`${sub} `)));
}

/** A short block for the system prompt: what is installed, and how to drive it. */
export function briefing(): string {
  const found = installed();
  if (!found.length) return "";
  const byCat = new Map<string, string[]>();
  for (const a of found) byCat.set(a.cat, [...(byCat.get(a.cat) ?? []), a.name]);
  const lines = [...byCat].map(([c, names]) => `- ${c}: ${names.join(", ")}`);
  const hints = found.filter((a) => a.hint).map((a) => `- ${a.name}: ${a.hint}`);
  return [
    "Installed on this machine (found by Orbit, so you don't need to check):",
    ...lines,
    hints.length ? "\nHow to drive them without a prompt:" : "",
    ...hints,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Fill an editor's command or link with a file and line. */
export function fill(parts: string[], path: string, line = 1): string[] {
  return parts.map((p) => p.replace("{path}", path).replace("{line}", String(Math.max(1, line))));
}

export const editors = () => CATALOG.filter((a) => a.open || a.scheme);
export const EDITOR_ORDER = ["cursor", "vscode", "windsurf", "zed", "vscodium", "intellij", "webstorm", "pycharm", "goland", "sublime", "android-studio", "xcode", "emacs"];

export function defaultEditor(): App | undefined {
  const found = detect();
  for (const id of EDITOR_ORDER) if (found.get(id)?.path) return findApp(id);
  return undefined;
}

