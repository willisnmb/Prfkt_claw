import type { UntrustedContent } from "./untrusted";

/**
 * Attachment inspection. Attachments are untrusted: executables, macro
 * documents, active PDFs, archives with suspicious ratios, spoofed types and
 * disguised names are rejected. Accepted text becomes UntrustedContent.
 */

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

const BLOCKED_EXTENSIONS = new Set([
  "exe", "dll", "com", "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "hta", "scr", "pif", "cpl",
  "msi", "msp", "jar", "sh", "bash", "zsh", "command", "app", "dmg", "pkg", "iso", "img", "lnk", "reg", "scf", "url",
  "docm", "xlsm", "pptm", "dotm", "xltm", "xlam", "ppam", "sldm", "apk", "ipa", "elf", "so", "dylib",
]);

const ALLOWED_TYPES = {
  "application/pdf": ["pdf"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/gif": ["gif"],
  "image/webp": ["webp"],
  "text/plain": ["txt", "md", "log"],
  "text/csv": ["csv"],
  "application/json": ["json"],
  "application/zip": ["zip"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
} as const satisfies Record<string, readonly string[]>;
type AllowedMime = keyof typeof ALLOWED_TYPES;

type Sniffed = "pdf" | "png" | "jpeg" | "gif" | "webp" | "zip" | "pe" | "elf" | "macho" | "shebang" | "text" | "unknown";

export function sniff(bytes: Uint8Array): Sniffed {
  const b = (i: number) => bytes[i] ?? -1;
  const ascii = (s: string, at = 0) => [...s].every((c, i) => b(at + i) === c.charCodeAt(0));
  if (ascii("%PDF-")) return "pdf";
  if (b(0) === 0x89 && ascii("PNG", 1)) return "png";
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "jpeg";
  if (ascii("GIF87a") || ascii("GIF89a")) return "gif";
  if (ascii("RIFF") && ascii("WEBP", 8)) return "webp";
  if (ascii("PK\u0003\u0004") || ascii("PK\u0005\u0006")) return "zip";
  if (ascii("MZ")) return "pe";
  if (b(0) === 0x7f && ascii("ELF", 1)) return "elf";
  const magic = ((b(0) << 24) | (b(1) << 16) | (b(2) << 8) | b(3)) >>> 0;
  if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(magic)) return "macho";
  if (ascii("#!")) return "shebang";
  const sample = bytes.subarray(0, 4096);
  if (sample.length && sample.every((x) => x === 9 || x === 10 || x === 13 || (x >= 32 && x !== 127))) return "text";
  // UTF-8 multibyte text
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    if (!sample.includes(0)) return "text";
  } catch {
    /* not utf-8 */
  }
  return "unknown";
}

const SNIFF_FOR_MIME: Record<AllowedMime, Sniffed[]> = {
  "application/pdf": ["pdf"],
  "image/png": ["png"],
  "image/jpeg": ["jpeg"],
  "image/gif": ["gif"],
  "image/webp": ["webp"],
  "text/plain": ["text"],
  "text/csv": ["text"],
  "application/json": ["text"],
  "application/zip": ["zip"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["zip"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["zip"],
};

export type AttachmentVerdict =
  | { ok: true; kind: Sniffed; content?: UntrustedContent }
  | { ok: false; reason: string };

/** Minimal ZIP central-directory walk: entry names and sizes, for bomb / nested-executable checks. */
function zipEntries(bytes: Uint8Array): { name: string; compressed: number; uncompressed: number }[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  let off = view.getUint32(eocd + 16, true);
  const out: { name: string; compressed: number; uncompressed: number }[] = [];
  for (let n = 0; n < count; n++) {
    if (off + 46 > bytes.length || view.getUint32(off, true) !== 0x02014b50) return null;
    const compressed = view.getUint32(off + 20, true);
    const uncompressed = view.getUint32(off + 24, true);
    const nameLen = view.getUint16(off + 28, true);
    const extraLen = view.getUint16(off + 30, true);
    const commentLen = view.getUint16(off + 32, true);
    const name = new TextDecoder().decode(bytes.subarray(off + 46, off + 46 + nameLen));
    out.push({ name, compressed, uncompressed });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export function inspectAttachment(file: { filename: string; declaredMime: string; bytes: Uint8Array }): AttachmentVerdict {
  const { filename, bytes } = file;
  const mime = file.declaredMime.split(";")[0]!.trim().toLowerCase();
  if (bytes.byteLength === 0) return { ok: false, reason: "empty file" };
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) return { ok: false, reason: "file too large" };
  if (/[‪-‮⁦-⁩​-‏]/.test(filename)) return { ok: false, reason: "filename contains hidden direction/format characters" };
  if (/[\\/\0]/.test(filename) || filename.startsWith(".")) return { ok: false, reason: "invalid filename" };

  const parts = filename.toLowerCase().split(".");
  if (parts.length < 2) return { ok: false, reason: "missing file extension" };
  if (parts.slice(1).some((ext) => BLOCKED_EXTENSIONS.has(ext.trim()))) return { ok: false, reason: "blocked file type" };
  const ext = parts.at(-1)!;

  if (!(mime in ALLOWED_TYPES)) return { ok: false, reason: `type ${mime} not accepted` };
  const allowedMime = mime as AllowedMime;
  if (!(ALLOWED_TYPES[allowedMime] as readonly string[]).includes(ext)) return { ok: false, reason: "extension does not match declared type" };

  const kind = sniff(bytes);
  if (["pe", "elf", "macho", "shebang"].includes(kind)) return { ok: false, reason: "executable content" };
  if (!SNIFF_FOR_MIME[allowedMime].includes(kind)) return { ok: false, reason: "content does not match declared type" };

  if (kind === "pdf") {
    const text = new TextDecoder("latin1").decode(bytes);
    if (/\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA|RichMedia|XFA)\b/.test(text))
      return { ok: false, reason: "PDF contains active content" };
  }

  if (kind === "zip") {
    const entries = zipEntries(bytes);
    if (!entries) return { ok: false, reason: "malformed archive" };
    if (entries.length > 1000) return { ok: false, reason: "archive has too many entries" };
    const total = entries.reduce((s, e) => s + e.uncompressed, 0);
    if (total > 200 * 1024 * 1024) return { ok: false, reason: "archive expands too large" };
    if (entries.some((e) => e.compressed > 0 && e.uncompressed / e.compressed > 100))
      return { ok: false, reason: "archive compression ratio indicates a zip bomb" };
    if (entries.some((e) => e.name.includes("..") || e.name.startsWith("/")))
      return { ok: false, reason: "archive entry path traversal" };
    const inner = entries.find((e) => e.name.toLowerCase().split(".").slice(1).some((x) => BLOCKED_EXTENSIONS.has(x)) || /vbaProject\.bin$/i.test(e.name));
    if (inner) return { ok: false, reason: "archive contains executable or macro content" };
  }

  if (kind === "text") {
    const text = new TextDecoder().decode(bytes);
    return { ok: true, kind, content: { source: "attachment", ref: filename, text } };
  }
  return { ok: true, kind };
}
