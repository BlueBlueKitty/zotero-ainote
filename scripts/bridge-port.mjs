import { execFileSync } from "node:child_process";

export const WEB_SUMMARY_BRIDGE_PORT = 23123;

export function parseListeningProcessIds(
  output,
  port = WEB_SUMMARY_BRIDGE_PORT,
) {
  const portPattern = new RegExp(`:${port}\\s+`, "i");
  const processIds = new Set();
  for (const line of String(output || "").split(/\r?\n/)) {
    if (!/LISTENING\s+\d+\s*$/i.test(line) || !portPattern.test(line)) {
      continue;
    }
    const match = line.match(/LISTENING\s+(\d+)\s*$/i);
    if (match) processIds.add(Number(match[1]));
  }
  return [...processIds];
}

export function getListeningProcessIds(
  port = WEB_SUMMARY_BRIDGE_PORT,
  platform = process.platform,
) {
  if (platform !== "win32") return [];
  try {
    const output = execFileSync("netstat", ["-ano", "-p", "tcp"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseListeningProcessIds(output, port);
  } catch {
    return [];
  }
}

export function assertBridgePortAvailable(
  port = WEB_SUMMARY_BRIDGE_PORT,
  platform = process.platform,
) {
  const conflicts = getListeningProcessIds(port, platform);
  assertListeningProcessIdsAvailable(conflicts, port);
}

export function assertListeningProcessIdsAvailable(
  processIds,
  port = WEB_SUMMARY_BRIDGE_PORT,
) {
  if (!processIds?.length) return;
  const powershellStop = processIds
    .map((processId) => `Stop-Process -Id ${processId}`)
    .join("\n");
  const powershellForceStop = processIds
    .map((processId) => `Stop-Process -Id ${processId} -Force`)
    .join("\n");
  const cmdStop = processIds
    .map((processId) => `taskkill /PID ${processId} /T`)
    .join("\n");
  const cmdForceStop = processIds
    .map((processId) => `taskkill /PID ${processId} /T /F`)
    .join("\n");
  throw new Error(
    [
      `Bridge port ${port} is already in use by another process.`,
      `Conflicting PID(s): ${processIds.join(", ")}.`,
      "After saving your Zotero work, stop the listed process(es), then run npm start again.",
      "PowerShell (normal stop):",
      powershellStop,
      "PowerShell (force only if still running):",
      powershellForceStop,
      "Command Prompt (normal stop):",
      cmdStop,
      "Command Prompt (force only if still running):",
      cmdForceStop,
    ].join("\n"),
  );
}
