export type ProviderType =
  | "openai"
  | "azure"
  | "anthropic"
  | "gemini"
  | "deepseek"
  | "openai_compatible";

export interface ProviderProfile {
  id: string;
  name: string;
  providerType: ProviderType;
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  model: string;
  apiVersion?: string;
  extra?: {
    deployment?: string;
    headers?: Record<string, string>;
    enableTemperature?: boolean;
    enableTopP?: boolean;
    enableMaxTokens?: boolean;
  };
  temperature: string;
  topP?: string;
  maxTokens?: string;
  stream: boolean;
  requestTimeoutMs?: string;
}

const DEFAULT_PROFILE: ProviderProfile = {
  id: "",
  name: "",
  providerType: "openai_compatible",
  enabled: true,
  apiKey: "",
  baseUrl: "https://api.openai.com/v1/chat/completions",
  model: "gpt-3.5-turbo",
  temperature: "0.7",
  topP: "1.0",
  maxTokens: "4096",
  stream: true,
  requestTimeoutMs: "30000",
  extra: {
    enableTemperature: true,
    enableTopP: false,
    enableMaxTokens: false,
  },
};

export function providerDefaults(providerType: ProviderType): Pick<ProviderProfile, "baseUrl" | "model" | "apiVersion"> {
  switch (providerType) {
    case "openai":
      return { baseUrl: "https://api.openai.com/v1/responses", model: "gpt-4o" };
    case "azure":
      return {
        baseUrl: "https://your-resource.openai.azure.com/openai/deployments",
        model: "gpt-4o",
        apiVersion: "2024-10-21",
      };
    case "anthropic":
      return { baseUrl: "https://api.anthropic.com/v1/messages", model: "claude-3-5-sonnet-latest" };
    case "gemini":
      return { baseUrl: "https://generativelanguage.googleapis.com", model: "gemini-2.5-pro" };
    case "deepseek":
      return { baseUrl: "https://api.deepseek.com/chat/completions", model: "deepseek-chat" };
    case "openai_compatible":
    default:
      return { baseUrl: "https://api.openai.com/v1/chat/completions", model: "gpt-3.5-turbo" };
  }
}

export function generateProfileId() {
  return `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createProfile(providerType: ProviderType, name?: string): ProviderProfile {
  const defaults = providerDefaults(providerType);
  return {
    ...DEFAULT_PROFILE,
    id: generateProfileId(),
    providerType,
    name: name || `${providerType}-${new Date().toISOString().slice(0, 10)}`,
    baseUrl: defaults.baseUrl,
    model: defaults.model,
    apiVersion: defaults.apiVersion,
  };
}

export function parseProfiles(raw: unknown): ProviderProfile[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeProfile(item as Partial<ProviderProfile>))
      .filter((p) => !!p.id);
  } catch {
    return [];
  }
}

export function normalizeProfile(item: Partial<ProviderProfile>): ProviderProfile {
  const providerType = normalizeProviderType(item.providerType);
  const defaults = providerDefaults(providerType);
  const extra = item.extra || {};
  return {
    ...DEFAULT_PROFILE,
    ...item,
    id: String(item.id || "").trim() || generateProfileId(),
    name: String(item.name || "").trim() || `${providerType} profile`,
    providerType,
    enabled: item.enabled !== false,
    apiKey: String(item.apiKey || "").trim(),
    baseUrl: String(item.baseUrl || defaults.baseUrl).trim(),
    model: String(item.model || defaults.model).trim(),
    apiVersion: String(item.apiVersion || defaults.apiVersion || "").trim() || undefined,
    temperature: String(item.temperature ?? "0.7"),
    topP: String(item.topP ?? "1.0"),
    maxTokens: String(item.maxTokens ?? "4096"),
    stream: item.stream !== false,
    requestTimeoutMs: String(item.requestTimeoutMs ?? "30000"),
    extra: {
      deployment: extra.deployment,
      headers: extra.headers || {},
      enableTemperature: extra.enableTemperature !== false,
      enableTopP: !!extra.enableTopP,
      enableMaxTokens: !!extra.enableMaxTokens,
    },
  };
}

export function normalizeProviderType(type: unknown): ProviderType {
  const t = String(type || "").toLowerCase();
  if (t === "openai") return "openai";
  if (t === "azure") return "azure";
  if (t === "anthropic" || t === "claude") return "anthropic";
  if (t === "gemini" || t === "google") return "gemini";
  if (t === "deepseek") return "deepseek";
  return "openai_compatible";
}

export function migrateToProfilesV3(getPref: (key: string) => any, setPref: (key: string, value: any) => any, clearPref: (key: string) => any): void {
  const done = getPref("migratedToProfilesV3") as boolean;
  if (done) return;

  const oldApiKey = String(getPref("apiKey") || "").trim();
  const oldApiUrl = String(getPref("apiUrl") || "https://api.openai.com/v1/chat/completions").trim();
  const oldModel = String(getPref("model") || "gpt-3.5-turbo").trim();
  const oldTemp = String(getPref("temperature") || "0.7");
  const oldStream = (getPref("stream") as boolean) ?? true;

  const existing = parseProfiles(getPref("profiles"));
  if (existing.length === 0) {
    const profile = createProfile("openai_compatible", "旧版迁移配置");
    profile.apiKey = oldApiKey;
    profile.baseUrl = oldApiUrl;
    profile.model = oldModel;
    profile.temperature = oldTemp;
    profile.stream = !!oldStream;
    setPref("profiles", JSON.stringify([profile]));
    setPref("activeProfileId", profile.id);
  } else {
    const active = String(getPref("activeProfileId") || "").trim();
    if (!active) {
      setPref("activeProfileId", existing[0].id);
    }
  }

  for (const key of [
    "apiKey",
    "apiUrl",
    "model",
    "temperature",
    "stream",
    "migratedToGlobalV2",
    "openai_apiKey",
    "openai_apiUrl",
    "openai_model",
    "deepseek_apiKey",
    "deepseek_apiUrl",
    "deepseek_model",
    "custom_apiKey",
    "custom_apiUrl",
    "custom_model",
  ]) {
    try {
      clearPref(key);
    } catch {
      // ignore
    }
  }

  setPref("migratedToProfilesV3", true as any);
}
