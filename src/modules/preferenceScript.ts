import { getPref, setPref, clearPref } from "../utils/prefs";
import { config } from "../../package.json";
import {
  createDefaultPromptTemplates,
  createPromptTemplateCopy,
  createPromptTemplateId,
  ensurePromptTemplateState,
  findPromptTemplateById,
  getDefaultActivePromptTemplateId,
  isPromptTemplateNameUnique,
  PROMPT_TEMPLATES_VERSION,
  PromptTemplate,
  serializePromptTemplates,
} from "../utils/prompts";
import AIService, { LLMModelInfo } from "./aiService";
import {
  ProviderProfile,
  ProviderType,
  createProfile,
  migrateToProfilesV3,
  normalizeProfile,
  parseProfiles,
  providerDefaults,
} from "./llmProfiles";
import { runtimeT } from "../utils/runtimeLocale";
import { getString } from "../utils/locale";

const PROVIDER_OPTIONS: Array<{ value: ProviderType; label: string }> = [
  { value: "azure", label: runtimeT({ "en-US": "Azure OpenAI", "zh-CN": "Azure OpenAI", "zh-TW": "Azure OpenAI" }) },
  { value: "anthropic", label: runtimeT({ "en-US": "Anthropic Claude", "zh-CN": "Anthropic Claude", "zh-TW": "Anthropic Claude" }) },
  { value: "gemini", label: runtimeT({ "en-US": "Google Gemini", "zh-CN": "Google Gemini", "zh-TW": "Google Gemini" }) },
  { value: "deepseek", label: runtimeT({ "en-US": "DeepSeek", "zh-CN": "DeepSeek", "zh-TW": "DeepSeek" }) },
  { value: "openai_compatible", label: runtimeT({
    "en-US": "OpenAI [Chat Completions API]",
    "zh-CN": "OpenAI [Chat Completions 接口]",
    "zh-TW": "OpenAI [Chat Completions 介面]",
  }) },
  { value: "openai", label: runtimeT({
    "en-US": "OpenAI [Responses API]",
    "zh-CN": "OpenAI [Responses 接口]",
    "zh-TW": "OpenAI [Responses 介面]",
  }) },
];

const HTML_NS = "http://www.w3.org/1999/xhtml";

function createHtmlElement<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
): HTMLElementTagNameMap[K] {
  return doc.createElementNS(HTML_NS, tag) as HTMLElementTagNameMap[K];
}

function getProviderLabel(providerType: ProviderType): string {
  return (
    PROVIDER_OPTIONS.find((option) => option.value === providerType)?.label ||
    providerType
  );
}

function supportsTopP(providerType: ProviderType) {
  return providerType !== "anthropic";
}

function supportsMaxTokens(_providerType: ProviderType) {
  return true;
}

function needsAzureFields(providerType: ProviderType) {
  return providerType === "azure";
}

function estimateMultimodalSupport(
  providerType: ProviderType,
  model: string,
): "yes" | "no" | "unknown" {
  const normalized = model.trim().toLowerCase();
  if (providerType === "gemini") return "yes";
  if (providerType === "anthropic") return "yes";
  if (providerType === "openai") {
    if (/gpt-4o|gpt-4\.1|o1|o3/.test(normalized)) return "yes";
    return "unknown";
  }
  if (providerType === "azure") {
    if (/gpt-4o|gpt-4\.1/.test(normalized)) return "yes";
    return "unknown";
  }
  if (providerType === "deepseek" || providerType === "openai_compatible") {
    if (/vision|vl|omni|multimodal/.test(normalized)) return "yes";
    return "unknown";
  }
  return "unknown";
}

function getModelCapabilityHint(providerType: ProviderType, model: string): string {
  const support = estimateMultimodalSupport(providerType, model);
  if (support === "yes") {
    return getString("prefs-model-capability-yes");
  }
  if (support === "no") {
    return getString("prefs-model-capability-no");
  }
  return getString("prefs-model-capability-unknown");
}

function bindButtonAction(
  element: HTMLElement,
  handler: (event: Event) => void | Promise<void>,
) {
  let pending = false;
  const wrapped = (event: Event) => {
    event.preventDefault?.();
    event.stopPropagation?.();
    if (pending) return;
    pending = true;
    Promise.resolve(handler(event)).finally(() => {
      setTimeout(() => {
        pending = false;
      }, 0);
    });
  };
  element.addEventListener("click", wrapped);
  element.addEventListener("command", wrapped as EventListener);
}

function ensureThemeStyles(doc: Document) {
  if (doc.getElementById("ainote-pref-theme")) return;
  const style = createHtmlElement(doc, "style");
  style.id = "ainote-pref-theme";
  style.textContent = `
    :root {
      --ainote-surface: #ffffff;
      --ainote-surface-2: #f6f8fa;
      --ainote-text: #1f2328;
      --ainote-text-muted: #57606a;
      --ainote-border: #d0d7de;
      --ainote-overlay: rgba(15, 23, 42, 0.42);
      --ainote-accent: #0f766e;
      --ainote-accent-soft: rgba(15, 118, 110, 0.10);
      --ainote-danger: #c2410c;
      --ainote-success: #0f9d58;
      --ainote-input-bg: #ffffff;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --ainote-surface: #1e1f22;
        --ainote-surface-2: #26282c;
        --ainote-text: #eceff4;
        --ainote-text-muted: #b0b8c4;
        --ainote-border: #3a3f47;
        --ainote-overlay: rgba(0, 0, 0, 0.58);
        --ainote-accent: #35b7ab;
        --ainote-accent-soft: rgba(53, 183, 171, 0.16);
        --ainote-danger: #ff8a65;
        --ainote-success: #4dd0a7;
        --ainote-input-bg: #202329;
      }
    }

    .ainote-section-toggle {
      width: 100%;
      border: 1px solid var(--ainote-border);
      border-radius: 10px;
      background: var(--ainote-surface-2);
      color: var(--ainote-text);
      padding: 10px 12px;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .ainote-section-toggle:hover {
      background: var(--ainote-accent-soft);
    }

    .ainote-section-toggle-label {
      pointer-events: none;
    }

    .ainote-section-toggle-arrow {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      pointer-events: none;
    }
  `;
  const host = doc.head || doc.documentElement;
  if (host) {
    host.appendChild(style);
  }
}

export async function registerPrefsScripts(win: Window) {
  try {
    ensureThemeStyles(win.document);
    bindCollapsibleSection(
      win.document,
      "ainote-toggle-profiles-section",
      "ainote-profiles-section",
      false,
    );
    bindCollapsibleSection(
      win.document,
      "ainote-toggle-prompt-templates-section",
      "ainote-prompt-templates-section",
      false,
    );
    if ((win as any).__ainotePrefsInitialized) {
      renderProfilesUI(win);
      renderPromptTemplatesUI(win);
      return;
    }
    (win as any).__ainotePrefsInitialized = true;
    migrateToProfilesV3(
      (k) => getPref(k as any),
      (k, v) => setPref(k as any, v),
      clearPref,
    );
    initializeDefaultPrefs();
    renderProfilesUI(win);
    renderPromptTemplatesUI(win);
    bindGlobalEvents(win);
  } catch (error) {
    console.error("[AiNote][Prefs] Error in registerPrefsScripts:", error);
  }
}

function initializeDefaultPrefs() {
  const defaults: Record<string, any> = {
    profiles: "[]",
    activeProfileId: "",
    migratedToProfilesV3: false,
    truncateLength: "10",
    summaryPrompt: "",
    promptVersion: 0,
    promptTemplates: serializePromptTemplates(createDefaultPromptTemplates()),
    activePromptTemplateId: getDefaultActivePromptTemplateId(),
    pinCurrentPromptTemplate: false,
    promptTemplatesVersion: PROMPT_TEMPLATES_VERSION,
  };

  for (const [key, defaultValue] of Object.entries(defaults)) {
    try {
      const currentValue = getPref(key as any);
      if (currentValue === undefined || currentValue === null) {
        setPref(key as any, defaultValue);
      }
    } catch {
      setPref(key as any, defaultValue);
    }
  }

  const profiles = parseProfiles(getPref("profiles"));
  const activeId = String(getPref("activeProfileId") || "").trim();
  if (!profiles.length) {
    const profile = createProfile("openai_compatible", getString("prefs-profile-default-name"));
    setPref("profiles" as any, JSON.stringify([profile]));
    setPref("activeProfileId" as any, profile.id);
  } else if (!activeId || !profiles.some((p) => p.id === activeId)) {
    setPref("activeProfileId" as any, profiles[0].id);
  }

  const promptTemplateState = ensurePromptTemplateState(
    getPref("promptTemplates" as any),
    getPref("activePromptTemplateId" as any),
    getPref("promptTemplatesVersion" as any),
  );
  if (promptTemplateState.changed) {
    setPref(
      "promptTemplates" as any,
      serializePromptTemplates(promptTemplateState.templates),
    );
    setPref(
      "activePromptTemplateId" as any,
      promptTemplateState.activeTemplateId,
    );
    setPref(
      "promptTemplatesVersion" as any,
      promptTemplateState.version,
    );
  }
}

function getProfiles(): ProviderProfile[] {
  return parseProfiles(getPref("profiles")).map(normalizeProfile);
}

function saveProfiles(profiles: ProviderProfile[]) {
  setPref("profiles" as any, JSON.stringify(profiles.map(normalizeProfile)));
}

function getPromptTemplateState() {
  return ensurePromptTemplateState(
    getPref("promptTemplates" as any),
    getPref("activePromptTemplateId" as any),
    getPref("promptTemplatesVersion" as any),
  );
}

function savePromptTemplateState(
  templates: PromptTemplate[],
  activeTemplateId: string,
) {
  const state = ensurePromptTemplateState(
    serializePromptTemplates(templates),
    activeTemplateId,
    PROMPT_TEMPLATES_VERSION,
  );
  setPref("promptTemplates" as any, serializePromptTemplates(state.templates));
  setPref("activePromptTemplateId" as any, state.activeTemplateId);
  setPref("promptTemplatesVersion" as any, state.version);
}

function getPromptTemplates(): PromptTemplate[] {
  return getPromptTemplateState().templates;
}

function getCurrentPromptTemplateId(): string {
  return getPromptTemplateState().activeTemplateId;
}

function getPinnedCurrentPromptTemplate(): boolean {
  return !!getPref("pinCurrentPromptTemplate" as any);
}

function setCurrentPromptTemplate(templateId: string) {
  setPref("activePromptTemplateId" as any, templateId);
}

function setPinnedCurrentPromptTemplate(pinned: boolean) {
  setPref("pinCurrentPromptTemplate" as any, pinned);
}

function setCurrentProfile(profileId: string) {
  setPref("activeProfileId" as any, profileId);
}

function notifyPromptTemplateMenuChanged(win: Window) {
  try {
    (Zotero as any)[config.addonInstance]?.hooks?.onPrefsEvent?.(
      "promptTemplatesChanged",
      { window: win },
    );
  } catch (error) {
    console.error("[AiNote][Prefs] Failed to refresh prompt template menu:", error);
  }
}

function isProfileNameUnique(name: string, currentId?: string) {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return false;
  return !getProfiles().some(
    (profile) =>
      profile.id !== currentId &&
      profile.name.trim().toLowerCase() === normalized,
  );
}

function openAddProfileDialog(win: Window) {
  const doc = win.document;
  ensureThemeStyles(doc);
  const mountTarget =
    (doc.getElementById("zotero-prefpane-__addonRef__") as HTMLElement | null) ||
    (doc.documentElement as HTMLElement | null) ||
    doc.body;
  if (!mountTarget) return;

  const overlay = createHtmlElement(doc, "div");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    background: "var(--ainote-overlay)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
    boxSizing: "border-box",
    zIndex: "9999",
  });

  const dialog = createHtmlElement(doc, "div");
  Object.assign(dialog.style, {
    width: "460px",
    maxWidth: "calc(100% - 32px)",
    background: "var(--ainote-surface)",
    color: "var(--ainote-text)",
    border: "1px solid var(--ainote-border)",
    borderRadius: "12px",
    boxShadow: "0 20px 48px rgba(0, 0, 0, 0.28)",
    padding: "18px",
    boxSizing: "border-box",
  });

  const title = createHtmlElement(doc, "h3");
  title.textContent = getString("prefs-add-dialog-title");
  Object.assign(title.style, {
    margin: "0 0 14px 0",
    fontSize: "18px",
  });
  dialog.appendChild(title);

  const sub = createHtmlElement(doc, "div");
  sub.textContent = getString("prefs-add-dialog-subtitle");
  Object.assign(sub.style, {
    color: "var(--ainote-text-muted)",
    fontSize: "12px",
    lineHeight: "1.5",
    marginBottom: "16px",
  });
  dialog.appendChild(sub);

  const nameLabel = createHtmlElement(doc, "label");
  nameLabel.textContent = getString("prefs-add-dialog-name");
  dialog.appendChild(nameLabel);

  const nameInput = createHtmlElement(doc, "input");
  nameInput.type = "text";
  nameInput.value = `${getString("prefs-profile-default-name")} ${getProfiles().length + 1}`;
  styleTextInput(nameInput);
  nameInput.style.margin = "6px 0 12px 0";
  dialog.appendChild(nameInput);

  const providerLabel = createHtmlElement(doc, "label");
  providerLabel.textContent = getString("prefs-add-dialog-provider");
  dialog.appendChild(providerLabel);

  const providerSelect = createHtmlElement(doc, "select");
  styleTextInput(providerSelect);
  providerSelect.style.margin = "6px 0 12px 0";
  PROVIDER_OPTIONS.forEach((option) => {
    const node = createHtmlElement(doc, "option");
    node.value = option.value;
    node.textContent = option.label;
    providerSelect.appendChild(node);
  });
  dialog.appendChild(providerSelect);

  const error = createHtmlElement(doc, "div");
  Object.assign(error.style, {
    color: "var(--ainote-danger)",
    fontSize: "12px",
    minHeight: "18px",
    marginBottom: "8px",
  });
  dialog.appendChild(error);

  const actions = createHtmlElement(doc, "div");
  Object.assign(actions.style, {
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
    marginTop: "8px",
  });

  const cancelBtn = createActionButton(doc, getString("prefs-add-dialog-cancel"), false);
  const createBtn = createActionButton(doc, getString("prefs-add-dialog-create"), true);

  const close = () => {
    overlay.remove();
  };

  bindButtonAction(cancelBtn, close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  bindButtonAction(createBtn, () => {
    const name = nameInput.value.trim() || `${getString("prefs-profile-default-name")} ${getProfiles().length + 1}`;
    const providerType = providerSelect.value as ProviderType;
    if (!name) {
      error.textContent = getString("prefs-add-dialog-name-empty");
      return;
    }
    if (!isProfileNameUnique(name)) {
      error.textContent = getString("prefs-add-dialog-name-duplicate");
      return;
    }
    const profile = createProfile(providerType, name);
    const profiles = getProfiles();
    profiles.push(profile);
    saveProfiles(profiles);
    setCurrentProfile(profile.id);
    close();
    renderProfilesUI(win);
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(createBtn);
  dialog.appendChild(actions);
  overlay.appendChild(dialog);
  mountTarget.appendChild(overlay);
  nameInput.focus();
}

function openAddPromptTemplateDialog(win: Window) {
  const doc = win.document;
  ensureThemeStyles(doc);
  const mountTarget =
    (doc.getElementById("zotero-prefpane-__addonRef__") as HTMLElement | null) ||
    (doc.documentElement as HTMLElement | null) ||
    doc.body;
  if (!mountTarget) return;

  const templates = getPromptTemplates();
  const overlay = createHtmlElement(doc, "div");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    background: "var(--ainote-overlay)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
    boxSizing: "border-box",
    zIndex: "9999",
  });

  const dialog = createHtmlElement(doc, "div");
  Object.assign(dialog.style, {
    width: "560px",
    maxWidth: "calc(100% - 32px)",
    background: "var(--ainote-surface)",
    color: "var(--ainote-text)",
    border: "1px solid var(--ainote-border)",
    borderRadius: "12px",
    boxShadow: "0 20px 48px rgba(0, 0, 0, 0.28)",
    padding: "18px",
    boxSizing: "border-box",
  });

  const title = createHtmlElement(doc, "h3");
  title.textContent = getString("prefs-add-template-dialog-title");
  Object.assign(title.style, {
    margin: "0 0 14px 0",
    fontSize: "18px",
  });
  dialog.appendChild(title);

  const sub = createHtmlElement(doc, "div");
  sub.textContent = getString("prefs-add-template-dialog-subtitle");
  Object.assign(sub.style, {
    color: "var(--ainote-text-muted)",
    fontSize: "12px",
    lineHeight: "1.5",
    marginBottom: "16px",
  });
  dialog.appendChild(sub);

  const nameField = createLabeledField(doc, getString("prefs-add-template-dialog-name"));
  const nameInput = createHtmlElement(doc, "input");
  nameInput.type = "text";
  nameInput.value = `${getString("prefs-template-default-name")} ${templates.length + 1}`;
  styleTextInput(nameInput);
  nameField.field.appendChild(nameInput);
  dialog.appendChild(nameField.row);

  const error = createHtmlElement(doc, "div");
  Object.assign(error.style, {
    color: "var(--ainote-danger)",
    fontSize: "12px",
    minHeight: "18px",
    marginTop: "8px",
  });
  dialog.appendChild(error);

  const actions = createHtmlElement(doc, "div");
  Object.assign(actions.style, {
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
    marginTop: "8px",
  });

  const cancelBtn = createActionButton(doc, getString("prefs-add-template-dialog-cancel"), false);
  const createBtn = createActionButton(doc, getString("prefs-add-template-dialog-create"), true);

  const close = () => overlay.remove();
  bindButtonAction(cancelBtn, close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  bindButtonAction(createBtn, () => {
    const name = nameInput.value.trim();
    const latestTemplates = getPromptTemplates();
    if (!name) {
      error.textContent = getString("prefs-add-template-dialog-name-empty");
      return;
    }
    if (!isPromptTemplateNameUnique(latestTemplates, name)) {
      error.textContent = getString("prefs-add-template-dialog-name-duplicate");
      return;
    }

    const timestamp = new Date().toISOString();
    const template: PromptTemplate = {
      id: createPromptTemplateId(),
      name,
      description: "",
      content: "",
      builtIn: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    savePromptTemplateState([...latestTemplates, template], template.id);
    close();
    renderPromptTemplatesUI(win);
    notifyPromptTemplateMenuChanged(win);
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(createBtn);
  dialog.appendChild(actions);
  overlay.appendChild(dialog);
  mountTarget.appendChild(overlay);
  nameInput.focus();
}

function renderProfilesUI(win: Window) {
  const doc = win.document;
  const list = doc.getElementById("ainote-profiles-list");
  const select = doc.getElementById(
    "ainote-active-profile",
  ) as HTMLSelectElement | null;

  if (!list || !select) return;

  const profiles = getProfiles();
  const activeId = String(getPref("activeProfileId") || "").trim();
  const activeProfile =
    profiles.find((profile) => profile.id === activeId) || profiles[0] || null;

  select.innerHTML = "";
  profiles.forEach((profile) => {
    const option = createHtmlElement(doc, "option");
    option.value = profile.id;
    option.textContent = `${profile.name}（${getProviderLabel(
      profile.providerType,
    )}）${profile.enabled ? "" : ` ${getString("prefs-profile-disabled-label")}`}`;
    option.selected = profile.id === activeId;
    select.appendChild(option);
  });

  list.innerHTML = "";
  if (activeProfile) {
    list.appendChild(renderProfileCard(doc, activeProfile, true, win));
  }
}

function renderPromptTemplatesUI(win: Window) {
  const doc = win.document;
  const list = doc.getElementById("ainote-prompt-templates-list");
  const select = doc.getElementById(
    "ainote-active-prompt-template",
  ) as HTMLSelectElement | null;
  const pinCheckbox = doc.getElementById(
    "ainote-pin-current-prompt-template",
  ) as HTMLInputElement | null;

  if (!list || !select || !pinCheckbox) return;

  const templates = getPromptTemplates();
  const activeId = getCurrentPromptTemplateId();
  const activeTemplate =
    findPromptTemplateById(templates, activeId) || templates[0] || null;
  pinCheckbox.checked = getPinnedCurrentPromptTemplate();

  select.innerHTML = "";
  templates.forEach((template) => {
    const option = createHtmlElement(doc, "option");
    option.value = template.id;
    option.textContent = `${template.name}${template.builtIn ? ` ${getString("prefs-default-template-label")}` : ""}`;
    option.selected = template.id === activeTemplate?.id;
    select.appendChild(option);
  });

  list.innerHTML = "";
  if (activeTemplate) {
    list.appendChild(renderPromptTemplateCard(doc, activeTemplate, win));
  }
}

function renderPromptTemplateCard(
  doc: Document,
  template: PromptTemplate,
  win: Window,
): HTMLElement {
  const card = createHtmlElement(doc, "div");
  Object.assign(card.style, {
    border: template.builtIn
      ? "1px solid var(--ainote-accent)"
      : "1px solid var(--ainote-border)",
    background: template.builtIn
      ? "var(--ainote-accent-soft)"
      : "var(--ainote-surface)",
    borderRadius: "10px",
    padding: "12px",
    margin: "10px 0",
    boxSizing: "border-box",
  });

  const title = createHtmlElement(doc, "div");
  title.textContent = `${template.name}${template.builtIn ? getString("prefs-default-template-label") : ""}`;
  Object.assign(title.style, {
    fontWeight: "700",
    color: "var(--ainote-text)",
    marginBottom: "10px",
  });
  card.appendChild(title);

  const nameRow = createLabeledField(doc, getString("prefs-template-name-label"));
  const nameInput = createHtmlElement(doc, "input");
  nameInput.type = "text";
  nameInput.value = template.name;
  styleTextInput(nameInput);
  nameRow.field.appendChild(nameInput);
  card.appendChild(nameRow.row);

  const descriptionRow = createLabeledField(doc, getString("prefs-template-desc-label"));
  const descriptionInput = createHtmlElement(doc, "textarea");
  styleTextArea(descriptionInput);
  descriptionInput.rows = 3;
  descriptionInput.value = template.description || "";
  descriptionRow.field.appendChild(descriptionInput);
  card.appendChild(descriptionRow.row);
  appendHelperText(
    doc,
    card,
    getString("prefs-template-desc-hint"),
  );

  const contentRow = createLabeledField(doc, getString("prefs-template-content-label"));
  const contentInput = createHtmlElement(doc, "textarea");
  styleTextArea(contentInput);
  contentInput.rows = 14;
  contentInput.value = template.content;
  contentRow.field.appendChild(contentInput);
  card.appendChild(contentRow.row);
  appendHelperText(
    doc,
    card,
    getString("prefs-template-content-hint"),
  );

  const status = createHtmlElement(doc, "div");
  Object.assign(status.style, {
    marginTop: "8px",
    minHeight: "18px",
    fontSize: "12px",
    color: "var(--ainote-text-muted)",
  });
  card.appendChild(status);

  const actions = createHtmlElement(doc, "div");
  Object.assign(actions.style, {
    display: "flex",
    gap: "8px",
    marginTop: "12px",
    flexWrap: "wrap",
  });

  const saveBtn = createActionButton(doc, getString("prefs-template-save"), true);
  bindButtonAction(saveBtn, () => {
    const name = nameInput.value.trim();
    const description = descriptionInput.value.trim();
    const content = contentInput.value.trim();
    const templates = getPromptTemplates();
    if (!name) {
      status.textContent = getString("prefs-template-name-empty");
      status.style.color = "var(--ainote-danger)";
      return;
    }
    if (!content) {
      status.textContent = getString("prefs-template-content-empty");
      status.style.color = "var(--ainote-danger)";
      return;
    }
    if (!isPromptTemplateNameUnique(templates, name, template.id)) {
      status.textContent = getString("prefs-template-name-duplicate");
      status.style.color = "var(--ainote-danger)";
      return;
    }

    const nextTemplates = templates.map((item) =>
      item.id === template.id
        ? {
            ...item,
            name,
            description,
            content,
            updatedAt: new Date().toISOString(),
          }
        : item,
    );
    savePromptTemplateState(nextTemplates, template.id);
    status.textContent = getString("prefs-template-saved");
    status.style.color = "var(--ainote-success)";
    renderPromptTemplatesUI(win);
    notifyPromptTemplateMenuChanged(win);
  });
  actions.appendChild(saveBtn);

  const cloneBtn = createActionButton(doc, getString("prefs-template-clone"), false);
  bindButtonAction(cloneBtn, () => {
    const templates = getPromptTemplates();
    const latest =
      findPromptTemplateById(templates, template.id) || template;
    const clone = createPromptTemplateCopy(latest, templates);
    savePromptTemplateState([...templates, clone], clone.id);
    renderPromptTemplatesUI(win);
    notifyPromptTemplateMenuChanged(win);
  });
  actions.appendChild(cloneBtn);

  const deleteBtn = createActionButton(doc, getString("prefs-template-delete"), false, true);
  deleteBtn.disabled = template.builtIn;
  if (template.builtIn) {
    deleteBtn.style.opacity = "0.6";
    deleteBtn.style.cursor = "not-allowed";
  } else {
    bindButtonAction(deleteBtn, () => {
      const templates = getPromptTemplates();
      const nextTemplates = templates.filter((item) => item.id !== template.id);
      const fallbackActiveId =
        nextTemplates.find((item) => item.builtIn)?.id ||
        nextTemplates[0]?.id ||
        getDefaultActivePromptTemplateId();
      savePromptTemplateState(nextTemplates, fallbackActiveId);
      renderPromptTemplatesUI(win);
      notifyPromptTemplateMenuChanged(win);
    });
  }
  actions.appendChild(deleteBtn);

  card.appendChild(actions);
  return card;
}

function renderProfileCard(
  doc: Document,
  profile: ProviderProfile,
  isActive: boolean,
  win: Window,
): HTMLElement {
  const card = createHtmlElement(doc, "div");
  Object.assign(card.style, {
    border: isActive
      ? "1px solid var(--ainote-accent)"
      : "1px solid var(--ainote-border)",
    background: isActive
      ? "var(--ainote-accent-soft)"
      : "var(--ainote-surface)",
    borderRadius: "10px",
    padding: "12px",
    margin: "10px 0",
    boxSizing: "border-box",
  });

  const title = createHtmlElement(doc, "div");
  title.textContent = `${profile.name}${isActive ? getString("prefs-profile-active-label") : ""}`;
  Object.assign(title.style, {
    fontWeight: "700",
    color: "var(--ainote-text)",
    marginBottom: "10px",
  });
  card.appendChild(title);

  const patchProfile = (patch: Partial<ProviderProfile>) => {
    const profiles = getProfiles();
    const idx = profiles.findIndex((item) => item.id === profile.id);
    if (idx < 0) return;
    profiles[idx] = normalizeProfile({
      ...profiles[idx],
      ...patch,
      extra: {
        ...(profiles[idx].extra || {}),
        ...(patch.extra || {}),
      },
    });
    saveProfiles(profiles);
    renderProfilesUI(win);
  };

  addInputRow(doc, card, getString("prefs-profile-name"), profile.name, (value) =>
    patchProfile({ name: value }),
    "text",
    {
      helperText: getString("prefs-profile-name-hint"),
      validate: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return getString("prefs-profile-name-empty");
        if (!isProfileNameUnique(trimmed, profile.id)) {
          return getString("prefs-profile-name-duplicate");
        }
        return "";
      },
    },
  );
  addSelectRow(
    doc,
    card,
    getString("prefs-profile-provider"),
    profile.providerType,
    PROVIDER_OPTIONS,
    (value) => {
      const nextType = value as ProviderType;
      const defaults = providerDefaults(nextType);
      patchProfile({
        providerType: nextType,
        baseUrl: defaults.baseUrl,
        model: defaults.model,
        apiVersion: defaults.apiVersion || "",
        extra: {
          ...(profile.extra || {}),
          deployment:
            nextType === "azure"
              ? profile.extra?.deployment || defaults.model
              : "",
        },
      });
    },
  );

  addInputRow(doc, card, getString("prefs-profile-api-url"), profile.baseUrl, (value) =>
    patchProfile({ baseUrl: value }),
    "text",
    {
      helperText: getString("prefs-profile-api-url-hint"),
    },
  );
  renderApiKeyRow(doc, card, profile.apiKey, (value) =>
    patchProfile({ apiKey: value }),
  );
  renderModelRow(doc, card, profile, patchProfile);
  addSelectRow(
    doc,
    card,
    getString("prefs-profile-pdf-mode"),
    profile.extra?.pdfProcessMode || "base64",
    [
      { value: "base64", label: getString("prefs-profile-pdf-mode-base64") },
      { value: "text", label: getString("prefs-profile-pdf-mode-text") },
    ],
    (value) =>
      patchProfile({
        extra: {
          ...(profile.extra || {}),
          pdfProcessMode: value as "base64" | "text" | "mineru",
        },
      }),
  );
  appendHelperText(
    doc,
    card,
    getString("prefs-profile-pdf-mode-hint"),
  );

  if ((profile.extra?.pdfProcessMode || "base64") === "text") {
    addInputRow(
      doc,
      card,
      getString("prefs-profile-text-truncate"),
      profile.extra?.textTruncateLengthWan || "10",
      (value) =>
        patchProfile({
          extra: {
            ...(profile.extra || {}),
            textTruncateLengthWan: value,
          },
        }),
      "number",
      {
        helperText: getString("prefs-profile-text-truncate-hint"),
      },
    );
  }

  renderOptionalParamRow(
    doc,
    card,
    getString("prefs-profile-pdf-size-limit"),
    !!profile.extra?.enablePdfSizeLimit,
    profile.extra?.maxPdfSizeMB || "50",
    (checked) =>
      patchProfile({
        extra: { ...(profile.extra || {}), enablePdfSizeLimit: checked },
      }),
    (value) =>
      patchProfile({
        extra: { ...(profile.extra || {}), maxPdfSizeMB: value },
      }),
    getString("prefs-profile-pdf-size-limit-hint"),
  );

  if (needsAzureFields(profile.providerType)) {
    addInputRow(doc, card, getString("prefs-profile-azure-api-version"), profile.apiVersion || "", (value) =>
      patchProfile({ apiVersion: value }),
      "text",
      {
        helperText: getString("prefs-profile-azure-api-version-hint"),
      },
    );
    addInputRow(
      doc,
      card,
      getString("prefs-profile-azure-deployment"),
      profile.extra?.deployment || "",
      (value) =>
        patchProfile({
          extra: { ...(profile.extra || {}), deployment: value },
        }),
      "text",
      {
        helperText: getString("prefs-profile-azure-deployment-hint"),
      },
    );
  }

  renderOptionalParamRow(
    doc,
    card,
    getString("prefs-profile-temperature"),
    profile.extra?.enableTemperature !== false,
    profile.temperature,
    (checked) =>
      patchProfile({
        extra: { ...(profile.extra || {}), enableTemperature: checked },
      }),
    (value) => patchProfile({ temperature: value }),
    getString("prefs-profile-temperature-hint"),
    "0.1",
  );

  if (supportsTopP(profile.providerType)) {
    renderOptionalParamRow(
      doc,
      card,
      getString("prefs-profile-top-p"),
      !!profile.extra?.enableTopP,
      profile.topP || "1.0",
      (checked) =>
        patchProfile({
          extra: { ...(profile.extra || {}), enableTopP: checked },
        }),
      (value) => patchProfile({ topP: value }),
      getString("prefs-profile-top-p-hint"),
    );
  }

  if (supportsMaxTokens(profile.providerType)) {
    renderOptionalParamRow(
      doc,
      card,
      getString("prefs-profile-max-tokens"),
      !!profile.extra?.enableMaxTokens,
      profile.maxTokens || "4096",
      (checked) =>
        patchProfile({
          extra: { ...(profile.extra || {}), enableMaxTokens: checked },
        }),
      (value) => patchProfile({ maxTokens: value }),
      getString("prefs-profile-max-tokens-hint"),
    );
  }

  renderCheckboxRow(doc, card, getString("prefs-profile-stream"), profile.stream, (checked) =>
    patchProfile({ stream: checked }),
    getString("prefs-profile-stream-hint"),
  );
  addInputRow(
    doc,
    card,
    getString("prefs-profile-timeout"),
    profile.requestTimeoutMs || "30000",
    (value) => patchProfile({ requestTimeoutMs: value }),
    "number",
    {
      helperText: getString("prefs-profile-timeout-hint"),
    },
  );

  renderConnectionTools(doc, card, profile);

  const actions = createHtmlElement(doc, "div");
  Object.assign(actions.style, {
    display: "flex",
    gap: "8px",
    marginTop: "12px",
    flexWrap: "wrap",
  });

  const activeBtn = createActionButton(doc, getString("prefs-profile-set-active"), true);
  bindButtonAction(activeBtn, () => {
    setCurrentProfile(profile.id);
    renderProfilesUI(win);
  });
  actions.appendChild(activeBtn);

  const enableBtn = createActionButton(
    doc,
    profile.enabled ? getString("prefs-profile-disable") : getString("prefs-profile-enable"),
    false,
  );
  bindButtonAction(enableBtn, () =>
    patchProfile({ enabled: !profile.enabled }),
  );
  actions.appendChild(enableBtn);

  const cloneBtn = createActionButton(doc, getString("prefs-profile-clone"), false);
  bindButtonAction(cloneBtn, () => {
    const profiles = getProfiles();
    const clone = normalizeProfile({
      ...profile,
      id: createProfile(profile.providerType).id,
      name: `${profile.name}${getString("prefs-clone-name-suffix")}`,
    });
    profiles.push(clone);
    saveProfiles(profiles);
    renderProfilesUI(win);
  });
  actions.appendChild(cloneBtn);

  const deleteBtn = createActionButton(doc, getString("prefs-profile-delete"), false, true);
  bindButtonAction(deleteBtn, () => {
    const nextProfiles = getProfiles().filter((item) => item.id !== profile.id);
    if (!nextProfiles.length) {
      const fallback = createProfile("openai_compatible", getString("prefs-profile-default-name"));
      saveProfiles([fallback]);
      setCurrentProfile(fallback.id);
    } else {
      saveProfiles(nextProfiles);
      const activeId = String(getPref("activeProfileId") || "");
      if (activeId === profile.id) {
        setCurrentProfile(nextProfiles[0].id);
      }
    }
    renderProfilesUI(win);
  });
  actions.appendChild(deleteBtn);

  card.appendChild(actions);
  return card;
}

function renderModelRow(
  doc: Document,
  card: HTMLElement,
  profile: ProviderProfile,
  patchProfile: (patch: Partial<ProviderProfile>) => void,
) {
  const row = createHtmlElement(doc, "div");
  Object.assign(row.style, {
    marginTop: "8px",
    padding: "10px",
    border: "1px solid var(--ainote-border)",
    borderRadius: "8px",
    background: "var(--ainote-surface-2)",
  });

  const label = createHtmlElement(doc, "label");
  label.textContent = getString("prefs-profile-model");
  Object.assign(label.style, {
    display: "block",
    marginBottom: "6px",
  });
  row.appendChild(label);

  const top = createHtmlElement(doc, "div");
  Object.assign(top.style, {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    flexWrap: "wrap",
  });

  const input = createHtmlElement(doc, "input");
  input.type = "text";
  input.value = profile.model;
  styleTextInput(input);
  input.style.flex = "1";
  input.addEventListener("change", () => patchProfile({ model: input.value }));
  top.appendChild(input);

  const fetchButton = createActionButton(doc, getString("prefs-model-fetch"), false);
  const testButton = createActionButton(doc, getString("prefs-model-test"), false);
  top.appendChild(fetchButton);
  top.appendChild(testButton);
  row.appendChild(top);

  const helper = createHtmlElement(doc, "div");
  helper.textContent = getString("prefs-model-hint-manual");
  Object.assign(helper.style, {
    marginTop: "6px",
    color: "var(--ainote-text-muted)",
    fontSize: "12px",
    lineHeight: "1.5",
  });
  row.appendChild(helper);

  const capabilityHint = createHtmlElement(doc, "div");
  capabilityHint.textContent = getModelCapabilityHint(
    profile.providerType,
    profile.model,
  );
  Object.assign(capabilityHint.style, {
    marginTop: "4px",
    color: "var(--ainote-text-muted)",
    fontSize: "12px",
    lineHeight: "1.5",
  });
  row.appendChild(capabilityHint);

  const status = createHtmlElement(doc, "div");
  Object.assign(status.style, {
    marginTop: "8px",
    fontSize: "12px",
    color: "var(--ainote-text-muted)",
    lineHeight: "1.5",
  });
  row.appendChild(status);

  const modelList = createHtmlElement(doc, "div");
  Object.assign(modelList.style, {
    display: "none",
    marginTop: "8px",
    border: "1px solid var(--ainote-border)",
    borderRadius: "8px",
    background: "var(--ainote-surface)",
    maxHeight: "220px",
    overflowY: "auto",
  });
  row.appendChild(modelList);

  bindButtonAction(fetchButton, async () => {
    status.textContent = getString("prefs-model-fetching");
    modelList.style.display = "none";
    modelList.innerHTML = "";
    try {
      const latest = getProfiles().find((item) => item.id === profile.id);
      if (!latest) throw new Error("Profile not found");
      const models = await AIService.listModels(latest);
      status.textContent = models.length
        ? getString("prefs-model-fetch-success", { args: { count: String(models.length) } })
        : getString("prefs-model-fetch-empty");
      renderModelList(doc, modelList, models, (modelId) => {
        input.value = modelId;
        patchProfile({ model: modelId });
        status.textContent = getString("prefs-model-selected", { args: { model: modelId } });
      });
    } catch (error: any) {
      status.textContent = error?.message || String(error);
      status.style.color = "var(--ainote-danger)";
    }
  });

  bindButtonAction(testButton, async () => {
    status.textContent = getString("prefs-model-testing");
    status.style.color = "var(--ainote-text-muted)";
    try {
      const latest = getProfiles().find((item) => item.id === profile.id);
      if (!latest) throw new Error("Profile not found");
      const result = await AIService.testConnection(latest);
      status.textContent = result;
      status.style.color = "var(--ainote-success)";
    } catch (error: any) {
      status.textContent = error?.message || String(error);
      status.style.color = "var(--ainote-danger)";
    }
  });

  card.appendChild(row);
}

function renderApiKeyRow(
  doc: Document,
  card: HTMLElement,
  value: string,
  onChange: (value: string) => void,
) {
  const row = createHtmlElement(doc, "div");
  Object.assign(row.style, {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginTop: "8px",
    flexWrap: "wrap",
  });

  const label = createHtmlElement(doc, "label");
  label.textContent = getString("prefs-profile-api-key");
  Object.assign(label.style, {
    minWidth: "92px",
    color: "var(--ainote-text)",
  });
  row.appendChild(label);

  const inputWrap = createHtmlElement(doc, "div");
  Object.assign(inputWrap.style, {
    flex: "1",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minWidth: "0",
  });

  const input = createHtmlElement(doc, "input");
  input.type = "password";
  input.value = value || "";
  styleTextInput(input);
  input.style.flex = "1";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.addEventListener("change", () => onChange(input.value));
  input.addEventListener("copy", (event: ClipboardEvent) => {
    const target = event.currentTarget as HTMLInputElement | null;
    if (!target) return;
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? 0;
    const selected = target.value.slice(start, end) || target.value;
    if (!selected) return;
    if (event.clipboardData) {
      event.clipboardData.setData("text/plain", selected);
      event.preventDefault();
    }
  });
  input.addEventListener("keydown", (event: KeyboardEvent) => {
    const isCopy =
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "c";
    if (!isCopy) return;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;
    const selected = input.value.slice(start, end) || input.value;
    if (!selected) return;
    try {
      event.preventDefault();
      void doc.defaultView?.navigator?.clipboard?.writeText(selected);
    } catch {
      // ignore and let host environment handle copy if possible
    }
  });
  inputWrap.appendChild(input);

  row.appendChild(inputWrap);
  card.appendChild(row);
  appendHelperText(doc, card, getString("prefs-profile-api-key-hint"));
}

function renderConnectionTools(
  doc: Document,
  card: HTMLElement,
  profile: ProviderProfile,
) {
  const tip = createHtmlElement(doc, "div");
  tip.textContent =
    profile.providerType === "azure"
      ? getString("prefs-connection-tip-azure")
      : getString("prefs-connection-tip-default");
  Object.assign(tip.style, {
    marginTop: "8px",
    color: "var(--ainote-text-muted)",
    fontSize: "12px",
    lineHeight: "1.5",
  });
  card.appendChild(tip);
}

function renderOptionalParamRow(
  doc: Document,
  card: HTMLElement,
  labelText: string,
  checked: boolean,
  value: string,
  onToggle: (checked: boolean) => void,
  onChange: (value: string) => void,
  helperText: string,
  step = "1",
) {
  const row = createHtmlElement(doc, "div");
  Object.assign(row.style, {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginTop: "8px",
    flexWrap: "wrap",
  });

  const checkbox = createHtmlElement(doc, "input");
  checkbox.type = "checkbox";
  checkbox.checked = checked;
  checkbox.addEventListener("change", () => onToggle(checkbox.checked));
  row.appendChild(checkbox);

  const label = createHtmlElement(doc, "label");
  label.textContent = labelText;
  Object.assign(label.style, {
    minWidth: "92px",
    color: "var(--ainote-text)",
  });
  row.appendChild(label);

  const input = createHtmlElement(doc, "input");
  input.type = "number";
  input.value = value || "";
  input.step = step;
  input.disabled = !checked;
  styleTextInput(input);
  input.style.width = "220px";
  input.addEventListener("change", () => onChange(input.value));
  row.appendChild(input);

  const state = createHtmlElement(doc, "span");
  state.textContent = checked ? getString("prefs-option-enabled") : getString("prefs-option-disabled");
  Object.assign(state.style, {
    fontSize: "12px",
    color: "var(--ainote-text-muted)",
  });
  row.appendChild(state);

  card.appendChild(row);
  appendHelperText(doc, card, helperText);
}

function renderCheckboxRow(
  doc: Document,
  card: HTMLElement,
  labelText: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
  helperText?: string,
) {
  const row = createHtmlElement(doc, "div");
  Object.assign(row.style, {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginTop: "8px",
  });

  const checkbox = createHtmlElement(doc, "input");
  checkbox.type = "checkbox";
  checkbox.checked = checked;
  checkbox.addEventListener("change", () => onChange(checkbox.checked));
  row.appendChild(checkbox);

  const label = createHtmlElement(doc, "label");
  label.textContent = `${labelText}（${checked ? getString("prefs-option-enabled") : getString("prefs-option-disabled")}）`;
  row.appendChild(label);

  card.appendChild(row);
  if (helperText) {
    appendHelperText(doc, card, helperText);
  }
}

function addInputRow(
  doc: Document,
  card: HTMLElement,
  labelText: string,
  value: string,
  onChange: (value: string) => void,
  type = "text",
  options?: {
    helperText?: string;
    validate?: (value: string) => string;
  },
) {
  const row = createHtmlElement(doc, "div");
  Object.assign(row.style, {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginTop: "8px",
    flexWrap: "wrap",
  });

  const label = createHtmlElement(doc, "label");
  label.textContent = labelText;
  Object.assign(label.style, {
    minWidth: "92px",
    color: "var(--ainote-text)",
  });
  row.appendChild(label);

  const input = createHtmlElement(doc, "input");
  input.type = type;
  input.value = value || "";
  styleTextInput(input);
  input.style.flex = "1";
  if (type === "number") {
    input.step = "1";
  }
  const error = createHtmlElement(doc, "div");
  Object.assign(error.style, {
    width: "100%",
    marginLeft: "102px",
    marginTop: "4px",
    fontSize: "12px",
    color: "var(--ainote-danger)",
    display: "none",
  });
  input.addEventListener("change", () => {
    const message = options?.validate?.(input.value) || "";
    if (message) {
      error.textContent = message;
      error.style.display = "block";
      return;
    }
    error.style.display = "none";
    onChange(input.value);
  });
  row.appendChild(input);

  card.appendChild(row);
  if (options?.helperText) {
    appendHelperText(doc, card, options.helperText);
  }
  card.appendChild(error);
}

function addSelectRow(
  doc: Document,
  card: HTMLElement,
  labelText: string,
  value: string,
  options: Array<{ value: string; label: string }>,
  onChange: (value: string) => void,
) {
  const row = createHtmlElement(doc, "div");
  Object.assign(row.style, {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginTop: "8px",
    flexWrap: "wrap",
  });

  const label = createHtmlElement(doc, "label");
  label.textContent = labelText;
  Object.assign(label.style, {
    minWidth: "92px",
    color: "var(--ainote-text)",
  });
  row.appendChild(label);

  const select = createHtmlElement(doc, "select");
  styleTextInput(select);
  select.style.flex = "1";
  options.forEach((option) => {
    const node = createHtmlElement(doc, "option");
    node.value = option.value;
    node.textContent = option.label;
    node.selected = option.value === value;
    select.appendChild(node);
  });
  select.addEventListener("change", () => onChange(select.value));
  row.appendChild(select);

  card.appendChild(row);
}

function renderModelList(
  doc: Document,
  container: HTMLElement,
  models: LLMModelInfo[],
  onPick: (modelId: string) => void,
) {
  container.innerHTML = "";
  if (!models.length) {
    container.style.display = "none";
    return;
  }

  models.forEach((model) => {
    const item = createHtmlElement(doc, "button");
    item.type = "button";
    item.textContent = model.name ? `${model.id} - ${model.name}` : model.id;
    Object.assign(item.style, {
      display: "block",
      width: "100%",
      textAlign: "left",
      padding: "8px 10px",
      border: "none",
      background: "transparent",
      color: "var(--ainote-text)",
      cursor: "pointer",
    });
    bindButtonAction(item, () => {
      onPick(model.id);
      container.style.display = "none";
    });
    container.appendChild(item);
  });
  container.style.display = "block";
}

function appendHelperText(doc: Document, card: HTMLElement, text: string) {
  const helper = createHtmlElement(doc, "div");
  helper.textContent = text;
  Object.assign(helper.style, {
    marginLeft: "0",
    marginTop: "4px",
    color: "var(--ainote-text-muted)",
    fontSize: "12px",
    lineHeight: "1.5",
  });
  card.appendChild(helper);
}

function createActionButton(
  doc: Document,
  text: string,
  primary: boolean,
  danger = false,
) {
  const button = createHtmlElement(doc, "button");
  button.type = "button";
  button.textContent = text;
  Object.assign(button.style, {
    border: "1px solid transparent",
    borderRadius: "8px",
    background: danger
      ? "var(--ainote-danger)"
      : primary
        ? "var(--ainote-accent)"
        : "var(--ainote-surface-2)",
    color: danger || primary ? "#ffffff" : "var(--ainote-text)",
    padding: "7px 12px",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: "1",
    verticalAlign: "middle",
  });
  return button;
}

function styleTextInput(element: HTMLInputElement | HTMLSelectElement) {
  Object.assign(element.style, {
    width: "100%",
    boxSizing: "border-box",
    minHeight: "34px",
    padding: "6px 10px",
    borderRadius: "8px",
    border: "1px solid var(--ainote-border)",
    background: "var(--ainote-input-bg)",
    color: "var(--ainote-text)",
    userSelect: "text",
    webkitUserSelect: "text",
    MozUserSelect: "text",
  });
}

function styleTextArea(element: HTMLTextAreaElement) {
  Object.assign(element.style, {
    width: "100%",
    boxSizing: "border-box",
    minHeight: "90px",
    padding: "8px 10px",
    borderRadius: "8px",
    border: "1px solid var(--ainote-border)",
    background: "var(--ainote-input-bg)",
    color: "var(--ainote-text)",
    resize: "vertical",
    fontFamily: "Consolas, Monaco, monospace",
    lineHeight: "1.6",
    userSelect: "text",
    webkitUserSelect: "text",
    MozUserSelect: "text",
  });
}

function createLabeledField(doc: Document, labelText: string) {
  const row = createHtmlElement(doc, "div");
  Object.assign(row.style, {
    marginTop: "8px",
  });

  const label = createHtmlElement(doc, "label");
  label.textContent = labelText;
  Object.assign(label.style, {
    display: "block",
    marginBottom: "6px",
    color: "var(--ainote-text)",
  });
  row.appendChild(label);

  const field = createHtmlElement(doc, "div");
  row.appendChild(field);

  return { row, field };
}

function setSectionCollapsed(
  toggle: HTMLElement | null,
  section: HTMLElement | null,
  collapsed: boolean,
) {
  if (!toggle || !section) return;
  const baseLabel =
    toggle.getAttribute("data-section-label") ||
    toggle.textContent?.replace(/^[▾▸]\s*/, "") ||
    "";
  toggle.setAttribute("data-section-label", baseLabel);
  toggle.innerHTML = `<span class="ainote-section-toggle-arrow">${collapsed ? "▸" : "▾"}</span><span class="ainote-section-toggle-label">${baseLabel}</span>`;
  section.style.display = collapsed ? "none" : "";
  toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

function bindCollapsibleSection(
  doc: Document,
  toggleId: string,
  sectionId: string,
  defaultCollapsed = false,
) {
  const toggle = doc.getElementById(toggleId) as HTMLElement | null;
  const section = doc.getElementById(sectionId) as HTMLElement | null;
  if (!toggle || !section) return;
  toggle.classList.add("ainote-section-toggle");
  setSectionCollapsed(toggle, section, defaultCollapsed);
  bindButtonAction(toggle, () => {
    const isExpanded = toggle.getAttribute("aria-expanded") === "true";
    setSectionCollapsed(toggle, section, isExpanded);
  });
}

function bindGlobalEvents(win: Window) {
  const doc = win.document;
  const addBtn = doc.getElementById("ainote-add-profile") as HTMLElement | null;
  const activeSelect = doc.getElementById(
    "ainote-active-profile",
  ) as HTMLSelectElement | null;
  const addTemplateBtn = doc.getElementById(
    "ainote-add-prompt-template",
  ) as HTMLElement | null;
  const activeTemplateSelect = doc.getElementById(
    "ainote-active-prompt-template",
  ) as HTMLSelectElement | null;
  const pinCurrentTemplateCheckbox = doc.getElementById(
    "ainote-pin-current-prompt-template",
  ) as HTMLInputElement | null;

  if (addBtn) {
    bindButtonAction(addBtn, () => {
      openAddProfileDialog(win);
    });
  }

  if (activeSelect) {
    const syncActive = () => {
      setCurrentProfile(activeSelect.value || "");
      renderProfilesUI(win);
    };
    activeSelect.addEventListener("change", syncActive);
    activeSelect.addEventListener("command", syncActive as EventListener);
  }

  if (addTemplateBtn) {
    bindButtonAction(addTemplateBtn, () => {
      openAddPromptTemplateDialog(win);
    });
  }

  if (activeTemplateSelect) {
    const syncActiveTemplate = () => {
      setCurrentPromptTemplate(activeTemplateSelect.value || "");
      renderPromptTemplatesUI(win);
      notifyPromptTemplateMenuChanged(win);
    };
    activeTemplateSelect.addEventListener("change", syncActiveTemplate);
    activeTemplateSelect.addEventListener(
      "command",
      syncActiveTemplate as EventListener,
    );
  }

  if (pinCurrentTemplateCheckbox) {
    const syncPinCurrentTemplate = () => {
      setPinnedCurrentPromptTemplate(pinCurrentTemplateCheckbox.checked);
      notifyPromptTemplateMenuChanged(win);
    };
    pinCurrentTemplateCheckbox.addEventListener(
      "click",
      syncPinCurrentTemplate,
    );
    pinCurrentTemplateCheckbox.addEventListener(
      "input",
      syncPinCurrentTemplate,
    );
    pinCurrentTemplateCheckbox.addEventListener(
      "change",
      syncPinCurrentTemplate,
    );
    pinCurrentTemplateCheckbox.addEventListener(
      "command",
      syncPinCurrentTemplate as EventListener,
    );
  }
}
