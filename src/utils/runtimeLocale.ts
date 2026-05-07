export type RuntimeLocale = "zh-CN" | "zh-TW" | "en-US";

export function getRuntimeLocale(): RuntimeLocale {
  const candidates = [
    safeRead(() => (Zotero as any)?.locale),
    safeRead(() => Intl.DateTimeFormat().resolvedOptions().locale),
  ].filter(Boolean) as string[];

  const normalized = String(candidates[0] || "").toLowerCase();
  if (
    normalized.startsWith("zh-tw") ||
    normalized.startsWith("zh-hk") ||
    normalized.startsWith("zh-mo") ||
    normalized.includes("hant")
  ) {
    return "zh-TW";
  }
  if (normalized.startsWith("zh")) {
    return "zh-CN";
  }
  return "en-US";
}

export function runtimeT<T extends string>(
  messages: Record<RuntimeLocale, T>,
): T {
  return messages[getRuntimeLocale()] || messages["en-US"];
}

function safeRead<T>(getter: () => T): T | null {
  try {
    return getter();
  } catch (_error) {
    return null;
  }
}
