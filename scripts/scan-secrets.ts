/**
 * Repository secrets scan (release gate: secrets_scan).
 * Scans every git-tracked and untracked-but-not-ignored file. Exits 1 on findings.
 * Allowlisted paths contain deliberate fake secrets used by RED CLAW tests.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { findSecrets } from "../src/security/secrets";

const ALLOWLIST = [/^tests\/redclaw\//, /^tests\/security\//, /^src\/security\/secrets\.ts$/, /^package-lock\.json$/];
const MAX_BYTES = 2_000_000;

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

let findings = 0;
for (const file of files) {
  if (ALLOWLIST.some((re) => re.test(file))) continue;
  let text: string;
  try {
    if (statSync(file).size > MAX_BYTES) continue;
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (text.includes("\u0000")) continue; // binary
  for (const f of findSecrets(text)) {
    const line = text.slice(0, f.index).split("\n").length;
    console.error(`${file}:${line}  ${f.label} (${f.patternId})`);
    findings++;
  }
}

if (findings > 0) {
  console.error(`\nsecrets scan: ${findings} finding(s). Move secrets to a secret reference; never commit them.`);
  process.exit(1);
}
console.log(`secrets scan: ${files.length} files, no findings.`);
