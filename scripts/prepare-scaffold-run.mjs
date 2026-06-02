import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getScaffoldLayout, repoRoot } from "./scaffold-paths.mjs";

const command = process.argv[2];

if (!command) {
  console.error("Usage: node scripts/prepare-scaffold-run.mjs <serve|build|test|release>");
  process.exit(1);
}

const layout = getScaffoldLayout(command);

function toWindowsPath(inputPath) {
  return path.resolve(inputPath).replace(/\//g, "\\").toLowerCase();
}

function escapePowerShellSingleQuotes(text) {
  return text.replace(/'/g, "''");
}

async function removeDirIfPresent(targetDir) {
  await fs.rm(targetDir, { recursive: true, force: true });
}

function getRepoOwnedZoteroProcesses(markerPaths) {
  if (process.platform !== "win32") {
    return [];
  }

  const normalizedMarkers = markerPaths.map((marker) =>
    escapePowerShellSingleQuotes(toWindowsPath(marker)),
  );

  if (normalizedMarkers.length === 0) {
    return [];
  }

  const psScript = [
    "$markers = @(",
    normalizedMarkers.map((marker) => `'${marker}'`).join(", "),
    ")",
    "$procs = Get-CimInstance Win32_Process -Filter \"name = 'zotero.exe'\" | Select-Object ProcessId, CommandLine",
    "$matches = @()",
    "foreach ($proc in $procs) {",
    "  $cmd = [string]$proc.CommandLine",
    "  if ([string]::IsNullOrWhiteSpace($cmd)) { continue }",
    "  $cmdNorm = $cmd.ToLowerInvariant()",
    "  foreach ($marker in $markers) {",
    "    if ($cmdNorm.Contains($marker)) {",
    "      $matches += [PSCustomObject]@{ ProcessId = $proc.ProcessId; CommandLine = $proc.CommandLine }",
    "      break",
    "    }",
    "  }",
    "}",
    "$matches | ConvertTo-Json -Compress",
  ].join("; ");

  const output = execFileSync(
    "powershell",
    ["-NoProfile", "-Command", psScript],
    { cwd: repoRoot, encoding: "utf8" },
  ).trim();

  if (!output) {
    return [];
  }

  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function killProcessTree(pid) {
  if (process.platform === "win32") {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    return;
  }

  process.kill(pid, "SIGKILL");
}

async function ensureDirUnlocked(targetDir) {
  try {
    await removeDirIfPresent(targetDir);
  } catch (error) {
    throw new Error(
      `Failed to remove ${targetDir}. A Zotero process may still be holding this directory.\n${error}`,
    );
  }
}

async function main() {
  const repoOwnedProcesses = getRepoOwnedZoteroProcesses(layout.killMarkers ?? []);

  for (const proc of repoOwnedProcesses) {
    try {
      killProcessTree(proc.ProcessId);
    } catch (error) {
      console.warn(
        `[prepare-scaffold-run] Failed to stop Zotero PID ${proc.ProcessId}: ${error}`,
      );
    }
  }

  if (layout.distDir) {
    await ensureDirUnlocked(layout.distDir);
  }

  if (command === "serve") {
    await fs.mkdir(path.dirname(layout.distDir), { recursive: true });
  }
}

await main();
