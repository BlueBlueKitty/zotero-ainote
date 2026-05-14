import { version as pluginVersion } from "../../package.json";
import {
  BridgeErrorCode,
  CompatibilityReport,
  CompatibilityWarning,
  ExtensionHandshakePayload,
  ExtensionRuntimeStatus,
  UpdateVersionInfo,
  WebSummaryVersionInfoFile,
  WEB_SUMMARY_EXTENSION_HEARTBEAT_TTL_MS,
  WEB_SUMMARY_PROTOCOL_VERSION,
  WEB_SUMMARY_REQUIRED_CAPABILITIES,
  WEB_SUMMARY_REQUIRED_PERMISSIONS,
  WEB_SUMMARY_TASK_CONTRACT_VERSION,
  WEB_SUMMARY_UPDATE_CHECK_TTL_MS,
  WEB_SUMMARY_VERSION_INFO_URL,
} from "./webSummaryTypes";

declare let ztoolkit: ZToolkit;

interface HandshakeState {
  payload: ExtensionHandshakePayload;
  receivedAt: string;
}

interface UpdateCacheState {
  fetchedAtMs: number;
  remote?: WebSummaryVersionInfoFile;
}

function parseVersion(value: string): number[] {
  return String(value || "")
    .trim()
    .replace(/^v/i, "")
    .split(".")
    .map((part) => parseInt(part, 10))
    .map((num) => (Number.isFinite(num) ? num : 0));
}

function compareVersion(a: string, b: string): number {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  const maxLen = Math.max(av.length, bv.length, 3);
  for (let i = 0; i < maxLen; i += 1) {
    const ai = av[i] ?? 0;
    const bi = bv[i] ?? 0;
    if (ai > bi) return 1;
    if (ai < bi) return -1;
  }
  return 0;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isCompatibleProtocol(localVersion: string, remoteVersion: string): boolean {
  const [localMajor] = parseVersion(localVersion);
  const [remoteMajor] = parseVersion(remoteVersion);
  return localMajor === remoteMajor;
}

export class WebSummaryCompatibilityManager {
  private handshakeState: HandshakeState | null = null;
  private updateCache: UpdateCacheState | null = null;

  public buildHealth(): {
    status: string;
    pluginVersion: string;
    protocolVersion: string;
    taskContractVersion: string;
    requiredCapabilities: string[];
    requiredPermissions: string[];
    runtimeStatus: ExtensionRuntimeStatus;
    compatibilityWarnings?: CompatibilityWarning[];
    updatedAt: string;
  } {
    const report = this.evaluate("summarize");
    return {
      status: "ok",
      pluginVersion,
      protocolVersion: WEB_SUMMARY_PROTOCOL_VERSION,
      taskContractVersion: WEB_SUMMARY_TASK_CONTRACT_VERSION,
      requiredCapabilities: [...WEB_SUMMARY_REQUIRED_CAPABILITIES],
      requiredPermissions: [...WEB_SUMMARY_REQUIRED_PERMISSIONS],
      runtimeStatus: this.getRuntimeStatus(),
      compatibilityWarnings: report.warnings,
      updatedAt: nowIso(),
    };
  }

  public recordHandshake(payload: ExtensionHandshakePayload): CompatibilityReport {
    this.handshakeState = {
      payload,
      receivedAt: nowIso(),
    };
    return this.evaluate("summarize");
  }

  public evaluate(actionType: "summarize" | "open_conversation"): CompatibilityReport {
    const blockingReasons: Array<{ code: BridgeErrorCode; message: string }> = [];
    const warnings: CompatibilityWarning[] = [];
    const handshake = this.handshakeState?.payload;
    const runtimeStatus = this.getRuntimeStatus();

    if (!runtimeStatus.online) {
      if (actionType === "summarize") {
        blockingReasons.push({
          code: "EXTENSION_OFFLINE",
          message:
            "浏览器扩展未在线或心跳已过期。请确保 Chrome 已启动、扩展已启用，并保持与 Zotero 的 Bridge 连接。",
        });
      } else {
        warnings.push({
          code: "EXTENSION_OFFLINE",
          message: "浏览器扩展离线，网页相关操作可能失败。",
        });
      }
    }

    if (handshake) {
      if (
        !isCompatibleProtocol(
          WEB_SUMMARY_PROTOCOL_VERSION,
          handshake.protocolVersion,
        )
      ) {
        blockingReasons.push({
          code: "PROTOCOL_MISMATCH",
          message: `协议版本不兼容：插件 ${WEB_SUMMARY_PROTOCOL_VERSION} / 扩展 ${handshake.protocolVersion}。请更新插件或扩展。`,
        });
      }

      if (
        !isCompatibleProtocol(
          WEB_SUMMARY_TASK_CONTRACT_VERSION,
          handshake.taskContractVersion,
        )
      ) {
        blockingReasons.push({
          code: "PROTOCOL_MISMATCH",
          message: `任务契约版本不兼容：插件 ${WEB_SUMMARY_TASK_CONTRACT_VERSION} / 扩展 ${handshake.taskContractVersion}。`,
        });
      }

      const missingCapabilities = WEB_SUMMARY_REQUIRED_CAPABILITIES.filter(
        (cap) => !handshake.capabilities.includes(cap),
      );
      if (missingCapabilities.length > 0) {
        blockingReasons.push({
          code: "REQUIRED_CAPABILITY_MISSING",
          message: `扩展缺少必要能力：${missingCapabilities.join(", ")}`,
        });
      }

      const grantedPermissions = new Set(
        handshake.permissions
          .filter((entry) => entry.granted)
          .map((entry) => entry.permission),
      );
      const missingPermissions = WEB_SUMMARY_REQUIRED_PERMISSIONS.filter(
        (perm) => !grantedPermissions.has(perm),
      );
      if (missingPermissions.length > 0) {
        blockingReasons.push({
          code: "PERMISSION_MISSING",
          message: `扩展缺少必要权限：${missingPermissions.join(", ")}`,
        });
      }

      const hasKnownTargetTab = !!handshake.environment.targetReachable;
      const hasPageRuntimeIssue =
        hasKnownTargetTab &&
        (!handshake.environment.contentScriptReady ||
          !handshake.environment.chatgptTabReady);
      if (hasPageRuntimeIssue) {
        warnings.push({
          code: "TARGET_PAGE_UNAVAILABLE",
          message:
            "扩展当前检测到目标网页环境不稳定（ChatGPT 页或内容脚本未就绪）。将继续尝试执行任务；若失败，请打开并刷新 ChatGPT 页面后重试。",
        });
      }
    }

    this.appendUpdateWarnings(warnings, handshake);

    return {
      allowCreateSummarize: actionType !== "summarize" || blockingReasons.length === 0,
      blockingReasons,
      warnings,
      details: {
        pluginVersion,
        extensionVersion: handshake?.extensionVersion,
        protocolVersion: WEB_SUMMARY_PROTOCOL_VERSION,
        extensionProtocolVersion: handshake?.protocolVersion,
        taskContractVersion: WEB_SUMMARY_TASK_CONTRACT_VERSION,
        extensionTaskContractVersion: handshake?.taskContractVersion,
        requiredCapabilities: [...WEB_SUMMARY_REQUIRED_CAPABILITIES],
        extensionCapabilities: [...(handshake?.capabilities || [])],
        requiredPermissions: [...WEB_SUMMARY_REQUIRED_PERMISSIONS],
        extensionPermissions: [...(handshake?.permissions || [])],
        environment: handshake?.environment,
        runtimeStatus,
      },
    };
  }

  public async refreshRemoteVersionInfo(): Promise<void> {
    const now = Date.now();
    if (
      this.updateCache &&
      now - this.updateCache.fetchedAtMs < WEB_SUMMARY_UPDATE_CHECK_TTL_MS
    ) {
      return;
    }
    try {
      const response = await fetch(WEB_SUMMARY_VERSION_INFO_URL, {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const json = (await response.json()) as WebSummaryVersionInfoFile;
      this.updateCache = {
        fetchedAtMs: now,
        remote: json,
      };
    } catch (error) {
      ztoolkit.log("[AiNote][WebSummaryCompatibility] update check failed", error);
      this.updateCache = {
        fetchedAtMs: now,
      };
    }
  }

  private appendUpdateWarnings(
    warnings: CompatibilityWarning[],
    handshake?: ExtensionHandshakePayload,
  ): void {
    const remote = this.updateCache?.remote;
    if (!remote) return;
    const pluginInfo = remote.plugin;
    const extensionInfo = remote.extension;

    this.appendSingleVersionWarning(
      warnings,
      "PLUGIN_UPDATE_RECOMMENDED",
      "插件",
      pluginVersion,
      pluginInfo,
    );

    if (handshake?.extensionVersion) {
      this.appendSingleVersionWarning(
        warnings,
        "EXTENSION_UPDATE_RECOMMENDED",
        "扩展",
        handshake.extensionVersion,
        extensionInfo,
      );
    }
  }

  private appendSingleVersionWarning(
    warnings: CompatibilityWarning[],
    code: string,
    label: string,
    currentVersion: string,
    info?: UpdateVersionInfo,
  ): void {
    if (!info?.latestVersion) return;
    if (compareVersion(currentVersion, info.latestVersion) < 0) {
      warnings.push({
        code,
        message: `${label}有可用更新：当前 ${currentVersion}，最新 ${info.latestVersion}。建议更新以获得更稳定体验。`,
      });
    }
  }

  private getRuntimeStatus(): ExtensionRuntimeStatus {
    const receivedAt = this.handshakeState?.receivedAt;
    if (!receivedAt) return { online: false };
    const age = Date.now() - new Date(receivedAt).getTime();
    return {
      online: age >= 0 && age <= WEB_SUMMARY_EXTENSION_HEARTBEAT_TTL_MS,
      lastHeartbeatAt: this.handshakeState?.payload.heartbeatAt || receivedAt,
    };
  }
}
