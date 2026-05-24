import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { extname } from "node:path";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const MAX_BYTES = 10 * 1024 * 1024;
const DRIVE_FILE_RE =
  /drive\.google\.com\/(?:file\/d\/|open\?id=)([a-zA-Z0-9_-]+)/i;
const DOCS_RE = /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/i;

export function extractGoogleDriveOrDocsUrl(text) {
  const t = (text ?? "").trim();
  const file = t.match(DRIVE_FILE_RE);
  if (file) return { kind: "drive_file", id: file[1], url: t };
  const doc = t.match(DOCS_RE);
  if (doc) return { kind: "google_doc", id: doc[1], url: t };
  return null;
}

function assertSafeUrl(url) {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  if (
    host === "drive.google.com" ||
    host === "docs.google.com" ||
    host === "drive.usercontent.google.com"
  ) {
    return u;
  }
  throw new Error("only Google Drive / Docs links are supported");
}

export function driveDownloadUrl(ref) {
  if (ref.kind === "google_doc") {
    return `https://docs.google.com/document/d/${ref.id}/export?format=txt`;
  }
  return `https://drive.google.com/uc?export=download&id=${ref.id}`;
}

export async function fetchUrlToBuffer(url, redirectCount = 0) {
  if (redirectCount > 5) throw new Error("too many redirects");
  const u = assertSafeUrl(url);
  const res = await fetch(u.href, {
    redirect: "manual",
    headers: { "User-Agent": "iMessageAgent/1.0" },
  });

  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (!loc) throw new Error(`redirect without location (${res.status})`);
    return fetchUrlToBuffer(new URL(loc, u).href, redirectCount + 1);
  }

  if (!res.ok) {
    throw new Error(`download failed (${res.status})`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("file too large (max 10MB)");
  return buf;
}

export async function fetchResumeFromGoogleLink(text) {
  const ref = extractGoogleDriveOrDocsUrl(text);
  if (!ref) throw new Error("no Google Drive or Docs link found");
  const downloadUrl = driveDownloadUrl(ref);
  const buf = await fetchUrlToBuffer(downloadUrl);
  const mime = ref.kind === "google_doc" ? "text/plain" : guessMimeFromBuffer(buf);
  return { buffer: buf, mime, source: ref.url, ref };
}

function guessMimeFromBuffer(buf) {
  if (buf.length >= 4 && buf.slice(0, 4).toString() === "%PDF") return "application/pdf";
  return "application/octet-stream";
}

export async function extractTextFromBuffer(buffer, mimeType, filename = "") {
  const ext = extname(filename).toLowerCase();
  const mime = (mimeType ?? "").toLowerCase();

  if (mime.includes("pdf") || ext === ".pdf") {
    const data = await pdfParse(buffer);
    return (data.text ?? "").trim();
  }

  if (
    mime.startsWith("text/") ||
    ext === ".txt" ||
    ext === ".md" ||
    mime.includes("json")
  ) {
    return buffer.toString("utf8").trim();
  }

  if (mime.includes("pdf") === false && ext === "") {
    const head = buffer.slice(0, 4).toString();
    if (head === "%PDF") {
      const data = await pdfParse(buffer);
      return (data.text ?? "").trim();
    }
  }

  throw new Error(
    "unsupported file type — send a PDF or paste a Google Drive/Docs link",
  );
}

export async function extractTextFromFilePath(filePath, attachment = {}) {
  if (!existsSync(filePath)) {
    throw new Error("attachment file missing on disk");
  }
  const buf = readFileSync(filePath);
  if (buf.length > MAX_BYTES) throw new Error("file too large (max 10MB)");
  const name = attachment.transfer_name ?? attachment.filename ?? filePath;
  const mime = attachment.converted_mime_type ?? attachment.mime_type ?? "";
  const usePath = attachment.converted_path ?? filePath;
  const data = readFileSync(usePath);
  return extractTextFromBuffer(data, mime, name);
}

export function pickResumeAttachment(attachments) {
  if (!Array.isArray(attachments) || !attachments.length) return null;

  const candidates = attachments.filter((a) => !a.is_sticker && !a.missing);
  const doc = candidates.find((a) => {
    const name = (a.transfer_name ?? a.filename ?? "").toLowerCase();
    const mime = (a.mime_type ?? a.converted_mime_type ?? "").toLowerCase();
    return (
      mime.includes("pdf") ||
      mime.startsWith("text/") ||
      name.endsWith(".pdf") ||
      name.endsWith(".txt")
    );
  });
  return doc ?? candidates[0] ?? null;
}
