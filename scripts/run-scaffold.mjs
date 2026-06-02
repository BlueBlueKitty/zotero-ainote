import { spawn } from "node:child_process";
import path from "node:path";
import { getScaffoldLayout, repoRoot } from "./scaffold-paths.mjs";

const command = process.argv[2];

if (!command) {
  console.error("Usage: node scripts/run-scaffold.mjs <serve|build|test|release>");
  process.exit(1);
}

const layout = getScaffoldLayout(command);
const cliPath =
  process.platform === "win32"
    ? path.join(repoRoot, "node_modules", ".bin", "zotero-plugin.cmd")
    : path.join(repoRoot, "node_modules", ".bin", "zotero-plugin");

const env = {
  ...process.env,
  AINOTE_SCAFFOLD_DIST: path.relative(repoRoot, layout.distDir).replace(/\\/g, "/"),
};

if (command === "serve") {
  if (layout.profileDir) {
    env.ZOTERO_PLUGIN_PROFILE_PATH = layout.profileDir;
  } else {
    delete env.ZOTERO_PLUGIN_PROFILE_PATH;
  }
  delete env.ZOTERO_PLUGIN_DATA_DIR;
}

const child =
  process.platform === "win32"
    ? spawn(cliPath, [command], {
        cwd: repoRoot,
        env,
        shell: true,
        stdio: "inherit",
      })
    : spawn(cliPath, [command], {
        cwd: repoRoot,
        env,
        stdio: "inherit",
      });

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
