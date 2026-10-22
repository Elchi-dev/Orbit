// Tests run against a fresh in-memory database and a throwaway data folder, never ~/.orbit.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ORBIT_HOME = mkdtempSync(join(tmpdir(), "orbit-test-"));
process.env.ORBIT_DB = ":memory:";
delete process.env.ANTHROPIC_API_KEY;
