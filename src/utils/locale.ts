import { config } from "../../package.json";
import { FluentMessageId } from "../../typings/i10n";

export { initLocale, getString, getLocaleID };

/**
 * Initialize locale data
 */
function initLocale() {
  const l10n = new (
    typeof Localization === "undefined"
      ? ztoolkit.getGlobal("Localization")
      : Localization
  )([
    `${config.addonRef}-addon.ftl`,
    `${config.addonRef}-mainWindow.ftl`,
    `${config.addonRef}-preferences.ftl`,
  ], true);
  addon.data.locale = {
    current: l10n,
  };
}

/**
 * Get locale string, see https://firefox-source-docs.mozilla.org/l10n/fluent/tutorial.html#fluent-translation-list-ftl
 * @param localString ftl key
 * @param options.branch branch name
 * @param options.args args
 * @example
 * ```ftl
 * # addon.ftl
 * addon-static-example = This is default branch!
 *     .branch-example = This is a branch under addon-static-example!
 * addon-dynamic-example =
    { $count ->
        [one] I have { $count } apple
       *[other] I have { $count } apples
    }
 * ```
 * ```js
 * getString("addon-static-example"); // This is default branch!
 * getString("addon-static-example", { branch: "branch-example" }); // This is a branch under addon-static-example!
 * getString("addon-dynamic-example", { args: { count: 1 } }); // I have 1 apple
 * getString("addon-dynamic-example", { args: { count: 2 } }); // I have 2 apples
 * ```
 */
function getString(localString: FluentMessageId): string;
function getString(localString: FluentMessageId, branch: string): string;
function getString(
  localeString: FluentMessageId,
  options: { branch?: string | undefined; args?: Record<string, unknown> },
): string;
function getString(...inputs: any[]) {
  if (inputs.length === 1) {
    return _getString(inputs[0]);
  } else if (inputs.length === 2) {
    if (typeof inputs[1] === "string") {
      return _getString(inputs[0], { branch: inputs[1] });
    } else {
      return _getString(inputs[0], inputs[1]);
    }
  } else {
    throw new Error("Invalid arguments");
  }
}

function _getString(
  localeString: FluentMessageId,
  options: { branch?: string | undefined; args?: Record<string, unknown> } = {},
): string {
  const localStringWithPrefix = `${config.addonRef}-${localeString}`;
  const { branch, args } = options;
  const locale = ensureLocaleInstance();
  const safeArgs = normalizeFluentArgs(args);
  
  // 构建系统会自动添加前缀，所以我们优先查找带前缀的版本
  const [patternPrefixed] = locale?.formatMessagesSync([
    { id: localStringWithPrefix, args: safeArgs },
  ]) || [];
  
  // 如果带前缀的没找到，尝试不带前缀的（向后兼容）
  const [patternRaw] = (!patternPrefixed?.value) 
    ? (locale?.formatMessagesSync([
        { id: localeString as string, args: safeArgs },
      ]) || [])
    : [];
  
  const pattern = patternPrefixed?.value ? patternPrefixed : patternRaw;
  
  if (!pattern) {
    return localStringWithPrefix;
  }
  if (branch && pattern.attributes) {
    for (const attr of pattern.attributes) {
      if (attr.name === branch) {
        return attr.value;
      }
    }
    return localStringWithPrefix;
  } else {
    return pattern.value || localStringWithPrefix;
  }
}

function getLocaleID(id: FluentMessageId) {
  return `${config.addonRef}-${id}`;
}

function ensureLocaleInstance() {
  const addonData = (globalThis as typeof globalThis & {
    addon?: { data?: { locale?: { current?: Localization } } };
  }).addon?.data;
  if (addonData?.locale?.current) {
    return addonData.locale.current;
  }

  try {
    const LocalizationCtor =
      typeof Localization === "undefined"
        ? ztoolkit.getGlobal("Localization")
        : Localization;
    if (!LocalizationCtor) {
      return undefined;
    }
    const locale = new LocalizationCtor(
      [
        `${config.addonRef}-addon.ftl`,
        `${config.addonRef}-mainWindow.ftl`,
        `${config.addonRef}-preferences.ftl`,
      ],
      true,
    );
    if (addonData) {
      addonData.locale = { current: locale };
    }
    return locale;
  } catch (_error) {
    return undefined;
  }
}

function normalizeFluentArgs(args?: Record<string, unknown>) {
  if (!args) {
    return undefined;
  }
  const normalized: Record<string, string | number | null> = {};
  for (const [key, value] of Object.entries(args)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      value === null
    ) {
      normalized[key] = value;
      continue;
    }
    normalized[key] = value == null ? null : String(value);
  }
  return normalized;
}
