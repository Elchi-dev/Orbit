import { describe, expect, test } from "bun:test";
import { CATALOG, briefing, catalogGuard, fill, quietEnv } from "./catalog";
import { isReadOnlyCommand } from "./tools";
import { suggestPattern } from "./gate";

describe("the catalog", () => {
  test("has exactly 100 programs with unique ids", () => {
    expect(CATALOG.length).toBe(100);
    expect(new Set(CATALOG.map((a) => a.id)).size).toBe(100);
  });

  test("every editor that opens files fills in the path and line", () => {
    for (const a of CATALOG.filter((x) => x.open)) {
      const argv = fill(a.open!, "/p/a.ts", 12).join(" ");
      expect(argv).toContain("/p/a.ts");
      expect(argv).not.toContain("{");
    }
  });

  test("keeps every known tool from waiting for input", () => {
    const env = quietEnv();
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.DEBIAN_FRONTEND).toBe("noninteractive");
    expect(env.TF_INPUT).toBe("0");
    expect(env.CI).toBeUndefined();
  });

  test("the briefing is plain text without placeholders", () => {
    expect(briefing()).not.toContain("undefined");
  });
});

describe("read-only commands the catalog knows", () => {
  const ro = [
    "docker ps -a",
    "docker compose logs --tail 50",
    "kubectl get pods -o yaml",
    "kubectl -n prod get pods".replace("-n prod ", ""),
    "npm audit",
    "npm ls --depth 0",
    "prettier --check .",
    "terraform validate",
    "gh pr list",
    "aws ec2 describe-instances",
    "helm list -A",
    "systemctl status nginx",
    "cargo clippy",
    "npx prettier --check src",
    "ruff check .",
  ];
  const writes = [
    "docker rm web",
    "docker compose down",
    "kubectl delete pod web-1",
    "kubectl apply -f k8s.yaml",
    "npm audit fix",
    "prettier --check --write .",
    "git diff --output=patch.txt",
    "rg --pre ./x.sh foo",
    "terraform apply",
    "gh api repos/a/b -X DELETE",
    "make -n",
    "psql -c 'drop table users'",
    "aws s3 rm s3://b/k",
    "cargo clippy --fix",
    "ruff check --fix .",
    "npx eslint --fix .",
    "helm template . --output-dir out",
    "go env -w GOFLAGS=-mod=mod",
    "openssl rand -out key 32",
  ];
  for (const c of ro) test(`lets "${c}" through`, () => expect(isReadOnlyCommand(c)).toBe(true));
  for (const c of writes) test(`stops "${c}"`, () => expect(isReadOnlyCommand(c)).toBe(false));
});

describe("guarded commands", () => {
  test("are named for the judge", () => {
    expect(catalogGuard("kubectl delete pod web-1")).toContain("kubectl delete");
    expect(catalogGuard("cd infra && terraform destroy")).toContain("terraform destroy");
    expect(catalogGuard("kubectl get pods")).toBeNull();
  });
  test("are never widened by Always allow", () => {
    expect(suggestPattern("bash", "kubectl delete pod web-1 -n prod")).toBe("kubectl delete pod web-1 -n prod");
    expect(suggestPattern("bash", "vercel deploy --prod --yes")).toBe("vercel deploy --prod --yes");
  });
  test("a group with a guarded member is widened one word deeper", () => {
    expect(suggestPattern("bash", "docker compose up -d web")).toBe("docker compose up *");
    expect(suggestPattern("bash", "gh pr create --fill --draft")).toBe("gh pr create *");
    expect(suggestPattern("bash", "npm install lodash")).toBe("npm install *");
  });
});
