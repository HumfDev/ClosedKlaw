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
    <title>Terms of Service, Kleo Labs Inc</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600&family=Inter:wght@400;500;600&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="/styles.css" />
    <link rel="stylesheet" href="/terms.css" />
  </head>
  <body class="terms-page">
    <header class="header">
      <div class="header-inner">
        <a href="/" class="logo">KleoKlaw</a>
        <nav class="header-nav" aria-label="Page sections">
          <a href="/">Home</a>
          <a href="/#how-it-works">How it works</a>
          <a href="/#features">Features</a>
          <a href="/#integrations">Integrations</a>
        </nav>
        <a href="/waitlist.html" class="btn-join btn-join--header">
          <svg class="imessage-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor"
              d="M12 2C6.48 2 2 6.02 2 10.88c0 2.74 1.44 5.18 3.7 6.74L5 22l4.38-2.41c.84.12 1.7.18 2.62.18 5.52 0 10-4.02 10-8.88S17.52 2 12 2z" />
          </svg>
          Join waitlist
        </a>
      </div>
    </header>
    <div class="terms-shell">
      <main class="terms-doc">
        <a href="/" class="terms-back">← Back</a>
        ${parts.join("\n        ")}
      </main>
    </div>
  </body>
</html>
`;

const fragmentPath = path.join(root, "terms-fragment.html");
const fragment = parts.join("\n");

fs.writeFileSync(outPath, html);
fs.writeFileSync(fragmentPath, fragment);
console.log("Wrote", outPath, "and", fragmentPath, `(${parts.length} blocks)`);
