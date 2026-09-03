import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import prettier from "prettier";

const extensionDir = path.dirname(fileURLToPath(import.meta.url));

const outfile = path.resolve(extensionDir, "page-contract.js");
const result = await build({
  entryPoints: [
    path.resolve(extensionDir, "../src/modules/webSummaryPageContract.ts"),
  ],
  outfile,
  write: false,
  bundle: true,
  format: "iife",
  globalName: "AiNotePageContract",
  target: ["chrome114"],
  legalComments: "none",
  banner: { js: "// Generated from src/modules/webSummaryPageContract.ts" },
});

const formatted = await prettier.format(result.outputFiles[0].text, {
  filepath: outfile,
});
await writeFile(outfile, formatted, "utf8");
