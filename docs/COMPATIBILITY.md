# Compatibility

Orbit knows the 100 programs below by name. The list lives in
[`server/catalog.ts`](../server/catalog.ts); this page is generated from it
(`bun scripts/gen-compat.ts`), so the two never disagree.

## What "known" means

For every program on the list that is installed, Orbit does five things:

1. **Finds it.** On your PATH, or where the desktop app usually lives. Settings,
   Integrations shows what was found and which version.
2. **Tells Claude.** A short list of what is installed goes with every request,
   with a line on how to drive each tool without a prompt (`vitest run`, not
   `vitest`; `docker logs --tail`, never `-f`). Claude stops spending turns on
   `which` and `--version`. You can switch this off.
3. **Lets looking through.** Subcommands that only read (`docker ps`,
   `kubectl get`, `terraform validate`, `gh pr list`) run without a rule, a
   judge or a question, like `ls` and `git status` already did. Flags that
   turn a read into a write are caught (`npm audit fix`, `prettier --check --write`,
   `ruff check --fix`, `git diff --output=`), and so is anything piped or
   redirected.
4. **Guards the rest.** Subcommands that delete, deploy or reach other machines
   (`kubectl delete`, `terraform apply`, `vercel deploy`, `docker compose down`)
   are named to the judge as destructive, and "Always allow" saves exactly that
   command instead of a pattern. A pattern for a group like `docker compose` goes
   one word deeper, so allowing `docker compose up` never allows `down`.
5. **Keeps it from waiting.** Every workspace shell starts with variables that
   switch off prompts, pagers and editors for these tools:

```
TERM=dumb
NO_COLOR=1
PAGER=cat
MANPAGER=cat
EDITOR=true
VISUAL=true
GIT_TERMINAL_PROMPT=0
GIT_EDITOR=true
GIT_PAGER=cat
GIT_ASKPASS=true
GH_PROMPT_DISABLED=1
GH_PAGER=cat
GH_NO_UPDATE_NOTIFIER=1
GLAB_NO_PROMPT=1
NO_PROMPT=1
DOTNET_CLI_TELEMETRY_OPTOUT=1
DOTNET_NOLOGO=1
npm_config_yes=true
npm_config_fund=false
npm_config_update_notifier=false
YARN_ENABLE_INTERACTIVE=0
PIP_NO_INPUT=1
PIP_DISABLE_PIP_VERSION_CHECK=1
POETRY_NO_INTERACTION=1
HOMEBREW_NO_AUTO_UPDATE=1
HOMEBREW_NO_ENV_HINTS=1
DEBIAN_FRONTEND=noninteractive
COMPOSER_NO_INTERACTION=1
NX_INTERACTIVE=false
NX_NO_CLOUD=true
TF_INPUT=0
TF_IN_AUTOMATION=1
PULUMI_SKIP_UPDATE_CHECK=1
SYSTEMD_PAGER=cat
SYSTEMD_COLORS=0
AWS_PAGER=
CLOUDSDK_CORE_DISABLE_PROMPTS=1
AZURE_CORE_ONLY_SHOW_ERRORS=1
AZURE_CORE_NO_COLOR=1
PSQL_PAGER=cat
```

Editors also **open files**: paths in the conversation and the Files panel open in
your editor at the right line (Settings, Integrations, "Open files in").

## Deeper integrations

| What | How |
| --- | --- |
| VS Code, Cursor, Windsurf, VSCodium | The [Orbit extension](../integrations/vscode) sends a selection, a file or a folder to Orbit (`Ctrl Alt O`). Orbit opens files back in the editor at the line. |
| Any terminal | `orbit .` opens the current folder as a workspace, starting Orbit if it isn't running, or handing the folder to the one that is. |
| JetBrains IDEs | Settings, Tools, External Tools: program `orbit`, arguments `$ProjectFileDir$`. Give it a shortcut. Orbit opens files back with `idea --line`. |
| Neovim and Vim | `:silent !orbit %:p:h` hands the file's folder to the Orbit that is running; map it to a key. |
| Emacs | `(shell-command (concat "orbit " default-directory))`; Orbit opens files back through `emacsclient`. |
| Links | `http://localhost:7777/#/open?path=/abs/folder&file=src/a.ts&line=12&text=...` does the same from anything that can open a URL. Text lands in the composer and is never sent on its own. |

## The 100

### Editors and IDEs

| | Program | Looks for | Read-only without asking | Never widened | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Visual Studio Code | `code` |  |  | Opens files at a line. |
| 2 | Cursor | `cursor` |  |  | Opens files at a line. |
| 3 | Windsurf | `windsurf` |  |  | Opens files at a line. |
| 4 | VSCodium | `codium` |  |  | Opens files at a line. |
| 5 | Zed | `zed`, `zeditor` |  |  | Opens files at a line. |
| 6 | IntelliJ IDEA | `idea`, `idea.sh` |  |  | Opens files at a line. |
| 7 | PyCharm | `pycharm`, `pycharm.sh` |  |  | Opens files at a line. |
| 8 | WebStorm | `webstorm`, `webstorm.sh` |  |  | Opens files at a line. |
| 9 | GoLand | `goland`, `goland.sh` |  |  | Opens files at a line. |
| 10 | Android Studio | `studio`, `studio.sh` |  |  | Opens files at a line. |
| 11 | Xcode | `xed` | `xed --version` |  | Opens files at a line. |
| 12 | Sublime Text | `subl` |  |  | Opens files at a line. |
| 13 | Neovim | `nvim` |  |  | Never start it interactively; edit files with Orbit's file tools. `nvim --headless` works for scripted runs. |
| 14 | Vim | `vim` |  |  | Never start it interactively; edit files with Orbit's file tools. |
| 15 | Emacs | `emacsclient`, `emacs` |  |  | Opens files at a line. Use `emacs --batch` for scripted runs, never the interactive editor. |

### Version control

| | Program | Looks for | Read-only without asking | Never widened | Notes |
| --- | --- | --- | --- | --- | --- |
| 16 | Git | `git` | `git status`, `git log`, `git diff`, `git show`, `git rev-parse`, 14 more | `git push`, `git reset --hard`, `git clean`, `git branch -D`, `git checkout --`, 9 more | Commit with -m; never open an editor. Pages are off. Use `git --no-pager` if output looks cut. |
| 17 | GitHub CLI | `gh` | `gh pr list`, `gh pr view`, `gh pr diff`, `gh pr checks`, `gh pr status`, 12 more | `gh pr merge`, `gh pr close`, `gh repo delete`, `gh repo create`, `gh repo edit`, 7 more | Pass --title and --body (or --fill) so nothing prompts. `gh api` reaches the whole GitHub API. |
| 18 | GitLab CLI | `glab` | `glab mr list`, `glab mr view`, `glab mr diff`, `glab issue list`, `glab issue view`, 5 more | `glab mr merge`, `glab mr close`, `glab repo delete`, `glab release create`, `glab release delete`, 2 more |  |

### Languages and runtimes

| | Program | Looks for | Read-only without asking | Never widened | Notes |
| --- | --- | --- | --- | --- | --- |
| 19 | Node.js | `node` |  |  | Check the lockfile to pick npm, pnpm, yarn or bun before installing anything. |
| 20 | Bun | `bun` | `bun pm ls`, `bun outdated` | `bun publish` |  |
| 21 | Deno | `deno` | `deno info`, `deno doc`, `deno check`, `deno lint`, `deno fmt --check` | `deno publish`, `deno deploy` |  |
| 22 | Python | `python3`, `python`, `py` |  |  | Use the project's virtual environment when there is one (.venv, uv, poetry); activate it once, the shell keeps it. |
| 23 | Go | `go` | `go env`, `go list`, `go version`, `go vet`, `go doc` |  | `go test ./...` runs everything; add -run to narrow it. |
| 24 | Rust (cargo) | `cargo` | `cargo tree`, `cargo metadata`, `cargo check`, `cargo clippy`, `cargo fmt --check`, 2 more | `cargo publish`, `cargo yank`, `cargo owner` | `cargo check` is the fast way to see compile errors. |
| 25 | Java (JDK) | `java`, `javac` |  |  |  |
| 26 | .NET | `dotnet` | `dotnet --info`, `dotnet --list-sdks`, `dotnet list`, `dotnet nuget list` | `dotnet nuget push`, `dotnet nuget delete` |  |
| 27 | Ruby | `ruby` |  |  |  |
| 28 | PHP | `php` | `php -l`, `php -m`, `php -i` |  |  |
| 29 | Elixir | `mix`, `elixir` | `mix deps`, `mix help`, `mix format --check-formatted` | `mix hex.publish`, `mix ecto.drop`, `mix ecto.reset` |  |
| 30 | Swift | `swift` | `swift package describe`, `swift package show-dependencies` |  |  |
| 31 | C and C++ (gcc, clang) | `clang`, `gcc`, `cc` |  |  |  |

### Package managers

| | Program | Looks for | Read-only without asking | Never widened | Notes |
| --- | --- | --- | --- | --- | --- |
| 32 | npm | `npm` | `npm ls`, `npm list`, `npm outdated`, `npm view`, `npm info`, 9 more | `npm publish`, `npm unpublish`, `npm deprecate`, `npm owner`, `npm dist-tag`, 2 more |  |
| 33 | pnpm | `pnpm` | `pnpm ls`, `pnpm list`, `pnpm outdated`, `pnpm why`, `pnpm view`, 3 more | `pnpm publish` |  |
| 34 | Yarn | `yarn` | `yarn list`, `yarn info`, `yarn why`, `yarn outdated`, `yarn config get`, 1 more | `yarn publish`, `yarn npm publish` |  |
| 35 | pip | `pip3`, `pip` | `pip3 list`, `pip3 show`, `pip3 freeze`, `pip3 check`, `pip3 config list`, 1 more | `pip3 uninstall` |  |
| 36 | uv | `uv` | `uv pip list`, `uv pip show`, `uv pip freeze`, `uv tree`, `uv python list` | `uv publish`, `uv cache clean` |  |
| 37 | Poetry | `poetry` | `poetry show`, `poetry check`, `poetry env info`, `poetry config --list` | `poetry publish`, `poetry env remove` |  |
| 38 | Conda | `conda`, `mamba`, `micromamba` | `conda list`, `conda info`, `conda env list`, `conda search`, `conda config --show` | `conda remove`, `conda env remove`, `conda clean` | Pass -y to install and create. |
| 39 | Homebrew | `brew` | `brew list`, `brew info`, `brew search`, `brew outdated`, `brew deps`, 4 more | `brew uninstall`, `brew untap`, `brew cleanup`, `brew services stop` |  |
| 40 | APT | `apt-get`, `apt` | `apt-get list`, `apt-get show`, `apt-get search`, `apt-get policy`, `apt-get depends`, 1 more | `apt-get remove`, `apt-get purge`, `apt-get autoremove`, `apt-get full-upgrade`, `apt-get dist-upgrade` | Needs sudo, which Orbit always asks you about. Pass -y. |
| 41 | winget | `winget` | `winget list`, `winget search`, `winget show`, `winget --info` | `winget uninstall` | Pass --accept-source-agreements --accept-package-agreements so nothing prompts. |
| 42 | Composer | `composer` | `composer show`, `composer outdated`, `composer validate`, `composer why`, `composer why-not`, 3 more | `composer remove` |  |
| 43 | Bundler | `bundle` | `bundle list`, `bundle info`, `bundle outdated`, `bundle check`, `bundle show`, 1 more | `bundle clean` |  |
| 44 | Maven | `mvn` | `mvn dependency:tree`, `mvn help:effective-pom`, `mvn validate`, `mvn -v`, `mvn --version` | `mvn deploy`, `mvn release:perform` | Add -B (batch mode) so Maven never waits for input. |
| 45 | Gradle | `gradle`, `./gradlew` | `gradle --version` | `gradle publish` | Prefer ./gradlew in the project, with --console=plain. |

### Build tools

| | Program | Looks for | Read-only without asking | Never widened | Notes |
| --- | --- | --- | --- | --- | --- |
| 46 | Make | `make` |  |  | `make -n` shows what a target would run; lines marked + still run, so it is not treated as read-only. |
| 47 | CMake | `cmake` | `cmake --version`, `cmake --help`, `cmake -E capabilities` |  |  |
| 48 | Bazel | `bazel`, `bazelisk` | `bazel info`, `bazel version` | `bazel clean --expunge` |  |
| 49 | Vite | `vite` |  |  | Dev servers never exit; start them in the background (`... &`) and read the port from the log. |
| 50 | Turborepo | `turbo` | `turbo ls`, `turbo query`, `turbo --version` | `turbo prune` |  |
| 51 | Nx | `nx` |  |  |  |

### Tests and code quality

| | Program | Looks for | Read-only without asking | Never widened | Notes |
| --- | --- | --- | --- | --- | --- |
| 52 | TypeScript | `tsc` | `tsc --noEmit`, `tsc --version`, `tsc --showConfig` |  |  |
| 53 | ESLint | `eslint` | `eslint --print-config`, `eslint --version` |  | Without --fix it only reports. |
| 54 | Prettier | `prettier` | `prettier --check`, `prettier -c`, `prettier --list-different`, `prettier -l`, `prettier --version` |  |  |
| 55 | Biome | `biome` | `biome check`, `biome lint`, `biome format`, `biome ci`, `biome version` |  | check, lint and format only report unless --write is passed. |
| 56 | Ruff | `ruff` | `ruff check`, `ruff format --check`, `ruff format --diff`, `ruff version` |  | Without --fix it only reports. |
| 57 | mypy | `mypy` | everything |  |  |
| 58 | pytest | `pytest` | `pytest --version` |  | Add -x -q for short output, -k to pick tests. |
| 59 | Vitest | `vitest` |  |  | Use `vitest run`; plain `vitest` watches and never exits. |
| 60 | Jest | `jest` | `jest --listTests`, `jest --showConfig` |  | Pass --watchAll=false in projects that default to watch mode. |
| 61 | Playwright | `playwright` | `playwright --version` |  | Use the line reporter (--reporter=line); never `show-report`, which serves until stopped. |
| 62 | Cypress | `cypress` | `cypress verify`, `cypress info`, `cypress version` |  | Use `cypress run`, never `cypress open`. |
| 63 | ShellCheck | `shellcheck` | everything |  |  |
| 64 | golangci-lint | `golangci-lint` | `golangci-lint run`, `golangci-lint linters`, `golangci-lint version` |  | Without --fix it only reports. |
| 65 | pre-commit | `pre-commit` | `pre-commit --version`, `pre-commit validate-config` | `pre-commit uninstall`, `pre-commit clean` |  |

### Containers and infrastructure

| | Program | Looks for | Read-only without asking | Never widened | Notes |
| --- | --- | --- | --- | --- | --- |
| 66 | Docker | `docker` | `docker ps`, `docker images`, `docker image ls`, `docker image inspect`, `docker container ls`, 17 more | `docker rm`, `docker rmi`, `docker system prune`, `docker volume rm`, `docker volume prune`, 7 more | Use `logs --tail 100` (never -f) and `compose up -d`, so commands return. |
| 67 | Podman | `podman` | `podman ps`, `podman images`, `podman inspect`, `podman logs`, `podman version`, 2 more | `podman rm`, `podman rmi`, `podman system prune`, `podman volume rm`, `podman kill`, 2 more |  |
| 68 | kubectl | `kubectl` | `kubectl get`, `kubectl describe`, `kubectl logs`, `kubectl top`, `kubectl explain`, 10 more | `kubectl delete`, `kubectl apply`, `kubectl replace`, `kubectl patch`, `kubectl edit`, 10 more | Check `kubectl config current-context` before anything that changes a cluster. Never use `logs -f`. |
| 69 | Helm | `helm` | `helm list`, `helm ls`, `helm status`, `helm get`, `helm history`, 7 more | `helm install`, `helm upgrade`, `helm uninstall`, `helm delete`, `helm rollback`, 1 more |  |
| 70 | Terraform | `terraform`, `tofu` | `terraform validate`, `terraform show`, `terraform output`, `terraform version`, `terraform providers`, 6 more | `terraform apply`, `terraform destroy`, `terraform import`, `terraform state rm`, `terraform state mv`, 3 more | Run `plan -out=tfplan` and show the result before any apply. Plan and apply take -input=false. |
| 71 | Ansible | `ansible-playbook`, `ansible` | `ansible-playbook --list-hosts`, `ansible-playbook --list-tasks`, `ansible-playbook --syntax-check`, `ansible-playbook --version` | everything | Run playbooks with --check --diff first; that changes nothing. |
| 72 | Pulumi | `pulumi` | `pulumi preview`, `pulumi stack ls`, `pulumi stack output`, `pulumi config`, `pulumi whoami`, 2 more | `pulumi up`, `pulumi destroy`, `pulumi refresh`, `pulumi stack rm`, `pulumi state delete`, 1 more | Pass --yes to up and destroy only after the preview was shown. |
| 73 | systemd (systemctl) | `systemctl` | `systemctl status`, `systemctl is-active`, `systemctl is-enabled`, `systemctl is-failed`, `systemctl list-units`, 4 more | `systemctl stop`, `systemctl restart`, `systemctl disable`, `systemctl mask`, `systemctl kill`, 3 more | Logs: `journalctl -u NAME -n 100 --no-pager`. |
| 74 | OpenSSH | `ssh` | `ssh -V`, `ssh -G` | everything | Pass the remote command inline with -o BatchMode=yes; an interactive login never returns. |
| 75 | rsync | `rsync` | `rsync --version` | everything not listed as read-only | Use --dry-run first to show what would change. |

### Cloud and deploy

| | Program | Looks for | Read-only without asking | Never widened | Notes |
| --- | --- | --- | --- | --- | --- |
| 76 | AWS CLI | `aws` | `aws sts get-caller-identity`, `aws configure list`, `aws s3 ls`, `aws ec2 describe-`, `aws logs describe-`, 7 more | `aws s3 rm`, `aws s3 rb`, `aws s3 sync`, `aws ec2 terminate-instances`, `aws delete-`, 4 more |  |
| 77 | Google Cloud CLI | `gcloud` | `gcloud config list`, `gcloud auth list`, `gcloud projects list`, `gcloud projects describe`, `gcloud info`, 1 more | `gcloud delete`, `gcloud deploy`, `gcloud app deploy`, `gcloud run deploy`, `gcloud functions deploy`, 1 more |  |
| 78 | Azure CLI | `az` | `az account show`, `az account list`, `az group list`, `az resource list`, `az version` | `az delete`, `az deployment create`, `az webapp deploy`, `az role assignment create` |  |
| 79 | Vercel CLI | `vercel` | `vercel ls`, `vercel list`, `vercel inspect`, `vercel logs`, `vercel whoami`, 3 more | `vercel deploy`, `vercel --prod`, `vercel rm`, `vercel remove`, `vercel env rm`, 4 more | Pass --yes so it never asks. |
| 80 | Netlify CLI | `netlify`, `ntl` | `netlify status`, `netlify sites:list`, `netlify env:list`, `netlify logs` | `netlify deploy`, `netlify sites:delete`, `netlify env:unset` |  |
| 81 | Fly.io | `fly`, `flyctl` | `fly status`, `fly logs --no-tail`, `fly apps list`, `fly machine list`, `fly secrets list`, 2 more | `fly deploy`, `fly destroy`, `fly apps destroy`, `fly machine destroy`, `fly secrets set`, 2 more |  |
| 82 | Cloudflare Wrangler | `wrangler` | `wrangler whoami`, `wrangler deployments list`, `wrangler kv namespace list`, `wrangler d1 list`, `wrangler r2 bucket list`, 1 more | `wrangler deploy`, `wrangler publish`, `wrangler delete`, `wrangler rollback`, `wrangler secret put`, 4 more | `wrangler dev` never exits; start it in the background. |
| 83 | Firebase CLI | `firebase` | `firebase projects:list`, `firebase apps:list`, `firebase use`, `firebase hosting:channel:list`, `firebase functions:list`, 1 more | `firebase deploy`, `firebase hosting:disable`, `firebase functions:delete`, `firebase firestore:delete`, `firebase database:remove`, 1 more |  |
| 84 | Supabase CLI | `supabase` | `supabase status`, `supabase projects list`, `supabase migration list`, `supabase db diff`, `supabase functions list`, 1 more | `supabase db push`, `supabase db reset`, `supabase functions deploy`, `supabase projects delete`, `supabase secrets set`, 2 more |  |

### Databases

| | Program | Looks for | Read-only without asking | Never widened | Notes |
| --- | --- | --- | --- | --- | --- |
| 85 | PostgreSQL (psql) | `psql` | `psql --version`, `psql -l`, `psql --list` | everything not listed as read-only | Run one statement with -c and -X; an open psql session never returns. |
| 86 | MySQL client | `mysql`, `mariadb` | `mysql --version` | everything not listed as read-only | Run statements with -e; an open session never returns. |
| 87 | SQLite | `sqlite3` | `sqlite3 --version` |  | Pass the SQL as an argument: `sqlite3 -readonly db.sqlite '.tables'`. |
| 88 | Redis CLI | `redis-cli`, `valkey-cli` | `redis-cli ping`, `redis-cli info`, `redis-cli --version`, `redis-cli dbsize`, `redis-cli get`, 8 more | `redis-cli flushall`, `redis-cli flushdb`, `redis-cli del`, `redis-cli config set`, `redis-cli shutdown` |  |
| 89 | MongoDB Shell | `mongosh` | `mongosh --version` | everything not listed as read-only | Use --quiet --eval for one command; an open shell never returns. |
| 90 | DuckDB | `duckdb` | `duckdb --version` |  | Pass the SQL with -c so it answers and exits. |

### Data, AI and mobile

| | Program | Looks for | Read-only without asking | Never widened | Notes |
| --- | --- | --- | --- | --- | --- |
| 91 | Jupyter | `jupyter` | `jupyter --version`, `jupyter kernelspec list`, `jupyter nbconvert --to markdown --stdout` |  | Run notebooks with `jupyter nbconvert --to notebook --execute`; never start the server in the foreground. |
| 92 | Ollama | `ollama` | `ollama list`, `ollama ls`, `ollama ps`, `ollama show`, `ollama --version` | `ollama rm`, `ollama push` | Pass the prompt as an argument to `ollama run MODEL`, so it answers once and exits. |
| 93 | Flutter | `flutter` | `flutter doctor`, `flutter devices`, `flutter analyze`, `flutter --version`, `flutter pub deps`, 1 more | `flutter pub publish`, `flutter clean` |  |
| 94 | Android Debug Bridge | `adb` | `adb devices`, `adb version`, `adb get-state`, `adb logcat -d` | `adb uninstall`, `adb shell rm`, `adb reboot`, `adb root`, `adb install` | Use `logcat -d` (dump), never plain logcat, which follows forever. |

### Everyday tools

| | Program | Looks for | Read-only without asking | Never widened | Notes |
| --- | --- | --- | --- | --- | --- |
| 95 | curl | `curl` | `curl --version` | everything | Add -sS and --max-time 30 so it fails fast and quietly. |
| 96 | jq | `jq` | everything |  |  |
| 97 | ripgrep | `rg` | everything |  |  |
| 98 | FFmpeg | `ffmpeg` | `ffmpeg -version`, `ffmpeg -formats`, `ffmpeg -codecs` |  | Pass -y or -n so it never asks about overwriting, and -hide_banner for short output. |
| 99 | tmux | `tmux` | `tmux ls`, `tmux list-sessions`, `tmux list-windows`, `tmux capture-pane -p` | `tmux kill-server`, `tmux kill-session` | Long-running servers can go in a detached session: `tmux new -d -s NAME 'cmd'`, then read it with `capture-pane -p`. |
| 100 | OpenSSL | `openssl` | `openssl version`, `openssl x509 -noout` |  |  |

## Not on the list

Anything else still works: Claude can run any command in the shell, and the
gate treats it like any other command (your rules, then the mode). Being on the
list only adds the five things above. To add a program, add an entry to
`server/catalog.ts` and run `bun scripts/gen-compat.ts`.
