export type ChatGPTPageKind =
  | "project"
  | "conversation"
  | "home"
  | "login"
  | "human_intervention"
  | "unknown";

export interface PageClassification {
  kind: ChatGPTPageKind;
  reason: string;
}

export interface ComposerResolution {
  root: Element | null;
  promptInput: HTMLElement | null;
  fileInput: HTMLInputElement | null;
  fileInputDetails: FileInputSummary[];
  sendButton: HTMLButtonElement | null;
  composerCount: number;
  promptInputCount: number;
  fileInputCount: number;
  sendButtonCount: number;
  sendEnabled: boolean;
  ready: boolean;
  reason: string;
}

export interface FileInputSummary {
  id: string;
  accept: string;
  ariaHidden: string;
  hidden: boolean;
  capture: string;
}

export interface AttachmentProbe {
  found: boolean;
  attachmentCount: number;
  busy: boolean;
  error: boolean;
  attachmentDetails: DomElementSummary | null;
  errorDetails: DomElementSummary[];
  sendEnabled: boolean;
  ready: boolean;
  reason: string;
}

export interface DomElementSummary {
  tag: string;
  id: string;
  testId: string;
  role: string;
  ariaLabel: string;
  title: string;
  className: string;
  text: string;
}

export interface ResponseProbe {
  assistantCount: number;
  hasNewAssistant: boolean;
  started: boolean;
  generating: boolean;
  completed: boolean;
  latestTextLength: number;
  latestTextFingerprint: string;
}

export interface ResponseStabilityState {
  generationObserved: boolean;
  signature: string;
  stableSince: number | null;
}

export interface ResponseCompletionCheck {
  completed: boolean;
  state: ResponseStabilityState;
}

const CANONICAL_PROMPT_SELECTOR = "#prompt-textarea";
const FILE_SELECTORS = ['input[type="file"]'];
const DOCUMENT_FILE_INPUT_IDS = ["upload-fast-tools-files", "upload-files"];
const MEDIA_FILE_INPUT_IDS = new Set([
  "upload-photos",
  "upload-camera",
  "upload-media-files",
]);
const CANONICAL_SEND_SELECTOR = 'button[data-testid="send-button"]';
const ASSISTANT_SELECTORS = ['[data-message-author-role="assistant"]'];
const STOP_SELECTORS = [
  '[data-testid="stop-button"]',
  'button[aria-label*="Stop"]',
  'button[aria-label*="停止"]',
];

function uniqueElements(elements: Element[]): Element[] {
  return elements.filter(
    (element, index) => elements.indexOf(element) === index,
  );
}

function fingerprintText(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}:${hash >>> 0}`;
}

function queryAll(root: ParentNode, selectors: string[]): Element[] {
  return uniqueElements(
    selectors.flatMap((selector) =>
      Array.from(root.querySelectorAll(selector)),
    ),
  );
}

function summarizeElement(element: Element): DomElementSummary {
  const text = String(element.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    tag: element.tagName.toLowerCase(),
    id: String(element.getAttribute("id") || ""),
    testId: String(element.getAttribute("data-testid") || ""),
    role: String(element.getAttribute("role") || ""),
    ariaLabel: String(element.getAttribute("aria-label") || ""),
    title: String(element.getAttribute("title") || ""),
    className: String(element.getAttribute("class") || ""),
    text: text.slice(0, 240),
  };
}

function elementDiagnosticText(element: Element): string {
  return [
    element.textContent,
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.getAttribute("data-testid"),
  ]
    .map((value) =>
      String(value || "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isUploadErrorElement(element: Element): boolean {
  const testId = String(
    element.getAttribute("data-testid") || "",
  ).toLowerCase();
  if (testId.includes("upload-error") || testId.includes("file-error")) {
    return true;
  }
  if (element.getAttribute("role") !== "alert") return false;
  const text = elementDiagnosticText(element);
  const mentionsUpload = /upload|file|attachment|pdf|上传|文件|附件/.test(text);
  const mentionsFailure =
    /error|failed|failure|unable|unsupported|too large|错误|失败|无法|不支持|过大/.test(
      text,
    );
  return mentionsUpload && mentionsFailure;
}

function visible(element: Element): boolean {
  if (element.getAttribute("hidden") !== null) return false;
  if (element.getAttribute("aria-hidden") === "true") return false;
  if (element.getAttribute("inert") !== null) return false;
  const style = (element as HTMLElement).style;
  if (style?.display === "none" || style?.visibility === "hidden") {
    return false;
  }
  const computed =
    element.ownerDocument?.defaultView?.getComputedStyle?.(element);
  if (
    computed &&
    (computed.display === "none" || computed.visibility === "hidden")
  ) {
    return false;
  }
  for (
    let ancestor = element.parentElement;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    if (
      ancestor.getAttribute("hidden") !== null ||
      ancestor.getAttribute("aria-hidden") === "true" ||
      ancestor.getAttribute("inert") !== null
    ) {
      return false;
    }
  }
  return true;
}

function enabled(button: HTMLButtonElement | null): boolean {
  return !!(
    button &&
    visible(button) &&
    !button.disabled &&
    button.getAttribute("aria-disabled") !== "true" &&
    button.getAttribute("data-testid") !== "stop-button"
  );
}

function fileInputId(input: HTMLInputElement): string {
  return String(input.getAttribute("id") || "")
    .trim()
    .toLowerCase();
}

function fileInputAcceptsPdf(input: HTMLInputElement): boolean {
  const accept = String(input.getAttribute("accept") || "").toLowerCase();
  return accept.includes("pdf") || accept.includes("application/pdf");
}

function isMediaFileInput(input: HTMLInputElement): boolean {
  const id = fileInputId(input);
  if (MEDIA_FILE_INPUT_IDS.has(id)) return true;
  if (input.getAttribute("aria-hidden") === "true") return true;
  if (input.getAttribute("capture") !== null) return true;
  const accept = String(input.getAttribute("accept") || "")
    .toLowerCase()
    .trim();
  if (!accept) return false;
  const tokens = accept
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  return (
    tokens.length > 0 &&
    tokens.every(
      (token) => token.startsWith("image/") || token.startsWith("video/"),
    )
  );
}

function selectFileInputCandidates(
  fileInputs: HTMLInputElement[],
): HTMLInputElement[] {
  for (const id of DOCUMENT_FILE_INPUT_IDS) {
    const preferredDocumentInputs = fileInputs.filter(
      (input) => fileInputId(input) === id,
    );
    if (preferredDocumentInputs.length) {
      return preferredDocumentInputs;
    }
  }

  const pdfFileInputs = fileInputs.filter(fileInputAcceptsPdf);
  if (pdfFileInputs.length) return pdfFileInputs;

  return fileInputs.filter((input) => !isMediaFileInput(input));
}

export function resolveUploadFilesInput(
  document: Document,
): HTMLInputElement | null {
  const input = document.querySelector('input[type="file"]#upload-files');
  return input instanceof HTMLInputElement ? input : null;
}

export function isSupportedChatGPTUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "chatgpt.com" || url.hostname === "chat.openai.com")
    );
  } catch {
    return false;
  }
}

function isProjectPath(pathname: string): boolean {
  return (
    /^\/g\/g-p-[^/]+\/project(?:\/|$)/i.test(pathname) ||
    /^\/project\/[^/]+(?:\/|$)/i.test(pathname)
  );
}

export function isSupportedProjectUrl(value: string): boolean {
  if (!isSupportedChatGPTUrl(value)) return false;
  return isProjectPath(new URL(value).pathname);
}

export function classifyPage(
  document: Document,
  href: string,
): PageClassification {
  if (!isSupportedChatGPTUrl(href)) {
    return { kind: "unknown", reason: "unsupported-origin" };
  }
  const url = new URL(href);
  if (/\/(auth|login)(\/|$)/i.test(url.pathname)) {
    return { kind: "login", reason: "login-path" };
  }
  const challenge = document.querySelector(
    '[data-testid*="captcha"], iframe[src*="captcha"], form[action*="challenge"], [id*="challenge-running"], [data-testid*="security"]',
  );
  if (challenge) {
    return { kind: "human_intervention", reason: "security-challenge" };
  }
  const pageText = String(document.body?.textContent || "").toLowerCase();
  const interventionPhrases = [
    "verify you are human",
    "unusual activity",
    "choose an account",
    "accept terms",
    "验证您是人类",
    "驗證您是人類",
    "异常活动",
    "異常活動",
    "选择账户",
    "選擇帳戶",
  ];
  if (interventionPhrases.some((phrase) => pageText.includes(phrase))) {
    return { kind: "human_intervention", reason: "intervention-text" };
  }
  if (/\/c\/[^/]+/i.test(url.pathname)) {
    return { kind: "conversation", reason: "conversation-path" };
  }
  if (isProjectPath(url.pathname)) {
    return { kind: "project", reason: "project-path" };
  }
  if (url.pathname === "/" || url.pathname === "") {
    return { kind: "home", reason: "home-path" };
  }
  return { kind: "unknown", reason: "unrecognized-path" };
}

export function resolveComposer(document: Document): ComposerResolution {
  const promptInput = document.querySelector(CANONICAL_PROMPT_SELECTOR);
  const root = document.body;
  if (!root || !promptInput || !visible(promptInput)) {
    return {
      root: null,
      promptInput: null,
      fileInput: null,
      fileInputDetails: [],
      sendButton: null,
      composerCount: 0,
      promptInputCount: 0,
      fileInputCount: 0,
      sendButtonCount: 0,
      sendEnabled: false,
      ready: false,
      reason: "composer-not-found",
    };
  }
  const fileInputs = queryAll(document, FILE_SELECTORS).filter(
    (element) => element instanceof HTMLInputElement,
  ) as HTMLInputElement[];
  const fileInputDetails = fileInputs.map((input) => ({
    id: fileInputId(input),
    accept: String(input.getAttribute("accept") || ""),
    ariaHidden: String(input.getAttribute("aria-hidden") || ""),
    hidden: Boolean(input.hidden),
    capture: String(input.getAttribute("capture") || ""),
  }));
  const candidateFileInputs = selectFileInputCandidates(fileInputs);
  const sendButtonElement = queryAll(document, [CANONICAL_SEND_SELECTOR]).find(
    (element) => element instanceof HTMLButtonElement && visible(element),
  );
  const sendButton =
    sendButtonElement instanceof HTMLButtonElement ? sendButtonElement : null;
  const resolution: ComposerResolution = {
    root,
    promptInput: promptInput as HTMLElement,
    fileInput: candidateFileInputs.length === 1 ? candidateFileInputs[0] : null,
    fileInputDetails,
    sendButton,
    composerCount: 1,
    promptInputCount: 1,
    fileInputCount: candidateFileInputs.length,
    sendButtonCount: sendButton ? 1 : 0,
    sendEnabled: enabled(sendButton),
    ready: false,
    reason: "ready",
  };
  if (candidateFileInputs.length === 0) {
    resolution.reason = "file-input-not-found";
  } else if (candidateFileInputs.length !== 1) {
    resolution.reason = "ambiguous-file-input";
  } else if (!sendButton) {
    resolution.reason = "send-button-not-found";
  }
  resolution.ready = resolution.reason === "ready";
  return resolution;
}

export function probeAttachment(
  composer: Element,
  fileName: string,
  sendButton: HTMLButtonElement | null,
): AttachmentProbe {
  const normalizedFileName = fileName.trim().toLowerCase();
  const candidates = Array.from(
    composer.querySelectorAll(
      '[data-testid*="attachment"], [data-testid*="file"], [aria-label], [title]',
    ),
  ) as Element[];
  const attachments = candidates.filter((element) => {
    const values = [
      element.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
    ]
      .map((value) =>
        String(value || "")
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean);
    return values.some(
      (value) =>
        value === normalizedFileName || value.includes(normalizedFileName),
    );
  });
  const attachment = attachments[attachments.length - 1] || null;
  const attachmentHasBusyClass = attachments.some(
    (element) =>
      element instanceof HTMLElement &&
      element.classList.contains("cursor-wait"),
  );
  const busy = !!(
    attachmentHasBusyClass ||
    attachment?.closest('[aria-busy="true"]') ||
    composer.querySelector(
      '[aria-busy="true"], [role="progressbar"], [data-testid*="uploading"]',
    )
  );
  const errorElements = queryAll(composer, [
    '[role="alert"]',
    '[data-testid*="upload-error"]',
    '[data-testid*="file-error"]',
  ]).filter(isUploadErrorElement);
  const error = errorElements.length > 0;
  const sendEnabled = enabled(sendButton);
  const found = !!attachment;
  return {
    found,
    attachmentCount: attachments.length,
    busy,
    error,
    attachmentDetails: attachment ? summarizeElement(attachment) : null,
    errorDetails: errorElements.slice(0, 8).map(summarizeElement),
    sendEnabled,
    ready: found && !busy && !error && sendEnabled,
    reason: !found
      ? "attachment-not-found"
      : busy
        ? "attachment-busy"
        : error
          ? "attachment-error"
          : !sendEnabled
            ? "send-disabled"
            : "ready",
  };
}

export function captureAssistantBaseline(document: Document): number {
  return queryAll(document, ASSISTANT_SELECTORS).length;
}

export function probeResponse(
  document: Document,
  baselineAssistantCount: number,
): ResponseProbe {
  const assistants = queryAll(document, ASSISTANT_SELECTORS).filter(visible);
  const generating = queryAll(document, STOP_SELECTORS).some(visible);
  const latest = assistants[assistants.length - 1];
  const latestText = String(latest?.textContent || "").trim();
  const latestTextLength = latestText.length;
  const hasNewAssistant = assistants.length > baselineAssistantCount;
  const started = hasNewAssistant || generating;
  return {
    assistantCount: assistants.length,
    hasNewAssistant,
    started,
    generating,
    completed: started && !generating && latestTextLength > 0,
    latestTextLength,
    latestTextFingerprint: fingerprintText(latestText),
  };
}

export function evaluateResponseCompletion(
  probe: ResponseProbe,
  now: number,
  previous: ResponseStabilityState,
  stabilityMs = 3_000,
): ResponseCompletionCheck {
  if (probe.generating) {
    return {
      completed: false,
      state: {
        generationObserved: true,
        signature: "",
        stableSince: null,
      },
    };
  }

  if (
    !previous.generationObserved ||
    !probe.hasNewAssistant ||
    probe.latestTextLength === 0
  ) {
    return {
      completed: false,
      state: previous,
    };
  }

  const signature = `${probe.assistantCount}:${probe.latestTextFingerprint}`;
  if (previous.signature !== signature || previous.stableSince === null) {
    return {
      completed: false,
      state: {
        generationObserved: true,
        signature,
        stableSince: now,
      },
    };
  }

  return {
    completed: now - previous.stableSince >= stabilityMs,
    state: previous,
  };
}
