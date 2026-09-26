import { realpathSync, existsSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";

/**
 * Bounded workspace file access (OPERATOR profile). Blocks traversal, absolute
 * paths, NUL bytes, and symlink escapes by resolving the real path of the
 * target (or its nearest existing ancestor, for files about to be created).
 */
export class PathViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathViolation";
  }
}

function within(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function nearestExistingRealpath(p: string): { real: string; rest: string } {
  let cur = p;
  const tail: string[] = [];
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) break;
    tail.unshift(cur.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    cur = parent;
  }
  return { real: realpathSync(cur), rest: tail.join(sep) };
}

export function resolveWorkspacePath(workspaceRoot: string, requested: string): string {
  if (typeof requested !== "string" || requested.length === 0) throw new PathViolation("empty path");
  if (requested.includes("\0")) throw new PathViolation("NUL byte in path");
  if (requested.length > 1024) throw new PathViolation("path too long");
  if (isAbsolute(requested) || /^[a-zA-Z]:[\\/]/.test(requested) || requested.startsWith("\\\\"))
    throw new PathViolation("absolute paths are not allowed");
  // Treat backslashes as separators too, so "..\\" cannot slip through on POSIX.
  const normalizedInput = normalize(requested.replaceAll("\\", "/"));
  if (normalizedInput.split("/").includes("..")) throw new PathViolation("path traversal is not allowed");

  const root = realpathSync(resolve(workspaceRoot));
  const lexical = resolve(root, normalizedInput);
  if (!within(root, lexical)) throw new PathViolation("path escapes the workspace");

  // Symlink check: the real location must also be inside the workspace.
  const { real, rest } = nearestExistingRealpath(lexical);
  const finalReal = rest ? join(real, rest) : real;
  if (!within(root, finalReal)) throw new PathViolation("path resolves outside the workspace (symlink escape)");
  return finalReal;
}
