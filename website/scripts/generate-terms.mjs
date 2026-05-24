import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const sourcePath = path.join(root, "legal", "terms-source.txt");
const outPath = path.join(root, "terms.html");

if (!fs.existsSync(sourcePath)) {
  console.error("Missing legal/terms-source.txt");
  process.exit(1);
}

let text = fs.readFileSync(sourcePath, "utf8");
const chromeIdx = text.indexOf("\nProduct\n");
if (chromeIdx !== -1) text = text.slice(0, chromeIdx);

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isSectionHeader(line) {
  if (line.startsWith("PLEASE READ")) return true;
  const m = line.match(/^(\d+(?:\.\d+)*)\s+(.+)$/);
  if (!m) return false;
  const rest = m[2];
  const bodyStart = rest.indexOf(". ");
  if (bodyStart === -1) return true;
  return false;
}

const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
const parts = [];

for (const line of lines) {
  if (line === "Terms of Service") {
    parts.push(`<h1>${escapeHtml(line)}</h1>`);
  } else if (line.startsWith("Last Modified:")) {
    parts.push(`<p class="terms-meta">${escapeHtml(line)}</p>`);
  } else if (isSectionHeader(line)) {
    parts.push(`<h2>${escapeHtml(line)}</h2>`);
  } else {
    parts.push(`<p>${escapeHtml(line)}</p>`);
  }
}

const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Terms of Service — ClosedKlaw</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600&family=Inter:wght@400;500;600&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="/styles.css" />
    <link rel="stylesheet" href="/terms.css" />
    <script src="/terms-gate.js"></script>
  </head>
  <body class="terms-page">
    <header class="terms-header">
      <a href="/" class="terms-back">← Back</a>
      <span class="terms-brand">ClosedKlaw</span>
    </header>
    <main class="terms-doc">
      ${parts.join("\n      ")}
    </main>
  </body>
</html>
`;

const fragmentPath = path.join(root, "terms-fragment.html");
const fragment = parts.join("\n");

fs.writeFileSync(outPath, html);
fs.writeFileSync(fragmentPath, fragment);
console.log("Wrote", outPath, "and", fragmentPath, `(${parts.length} blocks)`);
