import type { CapabilityProfile } from "./taxonomy";
import { mayRunCommands } from "./profiles";

/**
 * Command guard. Commands are argv arrays executed without a shell; the binary
 * must be on the cell's allowlist; interpreters cannot be handed inline code;
 * shell metacharacters are rejected outright. SAFE never runs commands.
 */
export class CommandViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandViolation";
  }
}

const SHELL_META = /[;&|`$<>(){}\n\r\\*?~!#]/;
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "fish", "ksh", "csh", "tcsh", "cmd", "cmd.exe", "powershell", "pwsh"]);
const INLINE_CODE_FLAGS: Record<string, string[]> = {
  python: ["-c"],
  python3: ["-c"],
  node: ["-e", "--eval", "-p", "--print"],
  ruby: ["-e"],
  perl: ["-e", "-E"],
  php: ["-r"],
  deno: ["eval"],
  bun: ["-e", "--eval"],
};
const DANGEROUS_ARGS: Record<string, RegExp> = {
  git: /^(-c|--config|--upload-pack|--receive-pack|--exec|-o\s*ProxyCommand|--output)/,
  find: /^(-exec|-execdir|-ok|-okdir|-delete|-fprint)/,
  tar: /^(--to-command|--checkpoint-action|--use-compress-program|-I)/,
  rsync: /^(-e|--rsh)/,
  npm: /^(exec|x|run-script|explore)$/,
  npx: /./,
};

export interface AuthorizedCommand {
  file: string;
  args: string[];
}

export function authorizeCommand(profile: CapabilityProfile, argv: readonly string[], allowlist: readonly string[]): AuthorizedCommand {
  if (!mayRunCommands(profile)) throw new CommandViolation(`${profile} profile cannot run commands`);
  if (!Array.isArray(argv) || argv.length === 0) throw new CommandViolation("empty command");
  const [bin, ...args] = argv as [string, ...string[]];
  if (bin.includes("/") || bin.includes("\\")) throw new CommandViolation("binary must be a bare allowlisted name");
  if (SHELLS.has(bin)) throw new CommandViolation("shells are never allowlisted");
  if (!allowlist.includes(bin)) throw new CommandViolation(`command ${bin} is not allowlisted`);
  if (args.length > 64) throw new CommandViolation("too many arguments");
  for (const a of args) {
    if (typeof a !== "string" || a.length > 4096) throw new CommandViolation("invalid argument");
    if (a.includes("\0")) throw new CommandViolation("NUL byte in argument");
    if (SHELL_META.test(a)) throw new CommandViolation("shell metacharacters are not allowed in arguments");
    if (INLINE_CODE_FLAGS[bin]?.some((f) => a === f || a.startsWith(`${f}=`)))
      throw new CommandViolation(`${bin} cannot run inline code`);
    if (DANGEROUS_ARGS[bin]?.test(a)) throw new CommandViolation(`argument not permitted for ${bin}`);
  }
  return { file: bin, args: [...args] };
}
