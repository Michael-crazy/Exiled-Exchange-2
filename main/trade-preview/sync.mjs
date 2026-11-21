// PoE2 assistant M09b: copy the trade-site page script from the browser
// extension (poe-trade2text, task/M09b or later) into this folder, unchanged,
// and record where it came from. Run from main/:
//   node trade-preview/sync.mjs <path to the poe-trade2text checkout>
// The files must not be edited here: change them in the extension and sync.
import { createHash } from "crypto";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const FILES = [
  "content.js",
  "styles.css",
  "assistant/preview.js",
  "assistant/preview.css",
  "LICENSE",
];

const here = path.dirname(fileURLToPath(import.meta.url));
const source = process.argv[2];
if (!source) {
  console.error("usage: node trade-preview/sync.mjs <poe-trade2text checkout>");
  process.exit(2);
}
const commit = execFileSync("git", ["-C", source, "rev-parse", "HEAD"])
  .toString()
  .trim();
const lines = [
  "# Trade window page script (M09b)",
  "",
  "Copied unchanged by `sync.mjs` from the browser extension repository",
  "`poe-trade2text` (Linux `~/git/poe-trade2text.git`, upstream",
  "`Michael-crazy/poe-trade2text`, MIT, see LICENSE), commit:",
  "",
  `    ${commit}`,
  "",
  "Do not edit these files here; change them in the extension and run",
  "`node trade-preview/sync.mjs <checkout>` again. The test",
  "`renderer/specs/web/assistant/trade-window.test.ts` checks the hashes.",
  "",
  "| file | sha256 |",
  "| --- | --- |",
];
for (const file of FILES) {
  const data = fs.readFileSync(path.join(source, file));
  fs.mkdirSync(path.dirname(path.join(here, file)), { recursive: true });
  fs.writeFileSync(path.join(here, file), data);
  lines.push(`| ${file} | ${createHash("sha256").update(data).digest("hex")} |`);
}
fs.writeFileSync(path.join(here, "SOURCE.md"), lines.join("\n") + "\n");
console.log(`synced ${FILES.length} files from ${commit}`);
