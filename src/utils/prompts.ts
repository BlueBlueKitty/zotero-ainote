/**
 * AI 提示词模板配置
 * 集中管理默认模板、模板解析与标题拼装逻辑。
 */

import { RuntimeLocale, getRuntimeLocale, runtimeT } from "./runtimeLocale";

export const PROMPT_TEMPLATES_VERSION = 2;

type BuiltInTemplateDefinition = {
  id: string;
  name: string;
  description: string;
  content: string;
};

const BUILT_IN_TEMPLATE_DEFINITIONS: Record<
  RuntimeLocale,
  BuiltInTemplateDefinition[]
> = {
  "zh-CN": [
    {
      id: "builtin-ai-full-summary",
      name: "AI全文总结",
      description: "适合想完整理解论文，不限制输出结构，但要求讲得详细。",
      content: `请你用中文详细讲解下面这篇论文。
输出要求：
1. 开始时先用一段话总结这篇论文的核心内容；
2. 后续围绕论文内容展开详细讲解；
3. 不限制总结结构，但要逻辑清晰、层次分明；
4. 对关键术语、方法和结论进行必要解释；
5. 只输出关于论文内容的讲解，不要包含寒暄、客套话或无关内容；
6. 不要编造原文没有明确说明的信息，如果信息缺失，请说明“原文未明确说明”。`,
    },
    {
      id: "builtin-ai-abstract-summary",
      name: "AI摘要总结",
      description: "适合一段话快速总结全文。",
      content: `请你用中文将下面这篇论文总结成一段话。
要求：
1. 只输出一段话；
2. 概括论文的研究背景、研究目标、核心方法、主要结果和结论；
3. 表述要准确、简洁、完整；
4. 不要包含寒暄、客套话或无关内容；
5. 不要编造原文没有明确说明的信息。`,
    },
    {
      id: "builtin-ai-structured-summary",
      name: "AI全文结构化总结",
      description: "适合生成结构化内容总结",
      content: `请你用中文对下面这篇论文进行结构化总结，要求内容准确、完整、层次清晰。
请按照以下结构输出：
# 核心概括
用一段话总结这篇论文的核心内容。
# 研究背景
说明本文的研究背景、问题来源以及研究意义。
# 研究目标
概括本文想解决的核心问题或实现的主要目标。
# 数据与研究对象
总结本文使用的数据、实验区域、研究对象、样本来源或案例信息。
# 方法流程
按步骤说明本文的方法、模型、算法或实验流程。
# 关键技术与公式
提取并解释本文中的关键技术、重要公式、核心参数或判别逻辑。如果原文没有明确公式，请说明“原文未明确说明关键公式”。
# 实验设计
总结本文的实验设置、对比方法、评价指标和验证方式。
# 主要结果
总结本文得到的主要实验结果和重要发现。
# 结论
概括作者最终得出的结论。
# 创新点
提炼本文的主要创新点。
# 局限性
分析本文可能存在的不足、适用范围或未解决问题。
# 可借鉴之处
说明这篇论文对后续研究、方法设计或论文写作有什么参考价值。
输出要求：
1. 只输出论文总结内容，不要包含寒暄；
2. 不要编造原文没有明确说明的信息；
3. 如果某一部分原文没有提供，请写“原文未明确说明”；
4. 尽量使用清晰的小标题和项目符号。`,
    },
    {
      id: "builtin-ai-innovation-summary",
      name: "AI创新点总结",
      description: "适合只提炼论文贡献、创新点、与已有方法的区别。",
      content: `请你用中文总结下面这篇论文的创新点。
要求：
1. 只关注论文的创新点、主要贡献和与已有研究的区别；
2. 不需要完整总结全文；
3. 区分“作者声称的贡献”和“实际具有实质性的创新”；
4. 如果某些创新只是已有方法的组合、迁移或应用，请明确说明；
5. 每个创新点都要简要解释其意义；
6. 不要包含寒暄、客套话或无关内容；
7. 不要编造原文没有明确说明的信息。
请按照以下结构输出：
# 总体创新概括
用一段话概括本文的主要创新。
# 具体创新点
逐条列出本文的创新点，并说明每一点的具体含义和作用。
# 与已有研究的区别
说明本文相比已有方法、已有模型或已有研究工作的主要差异。
# 创新点评价
判断本文的创新属于理论创新、方法创新、数据创新、应用创新、工程改进，还是已有方法的组合与迁移。`,
    },
  ],
  "zh-TW": [
    {
      id: "builtin-ai-full-summary",
      name: "AI全文總結",
      description: "適合想完整理解論文，不限制輸出結構，但要求講解詳細。",
      content: `請你用中文詳細講解下面這篇論文。
輸出要求：
1. 開始時先用一段話總結這篇論文的核心內容；
2. 後續圍繞論文內容展開詳細講解；
3. 不限制總結結構，但要邏輯清晰、層次分明；
4. 對關鍵術語、方法和結論進行必要解釋；
5. 只輸出關於論文內容的講解，不要包含寒暄、客套話或無關內容；
6. 不要編造原文沒有明確說明的資訊，如果資訊缺失，請說明「原文未明確說明」。`,
    },
    {
      id: "builtin-ai-abstract-summary",
      name: "AI摘要總結",
      description: "適合用一段話快速總結全文。",
      content: `請你用中文將下面這篇論文總結成一段話。
要求：
1. 只輸出一段話；
2. 概括論文的研究背景、研究目標、核心方法、主要結果和結論；
3. 表述要準確、簡潔、完整；
4. 不要包含寒暄、客套話或無關內容；
5. 不要編造原文沒有明確說明的資訊。`,
    },
    {
      id: "builtin-ai-structured-summary",
      name: "AI全文結構化總結",
      description: "適合生成結構化內容總結",
      content: `請你用中文對下面這篇論文進行結構化總結，要求內容準確、完整、層次清晰。
請按照以下結構輸出：
# 核心概括
用一段話總結這篇論文的核心內容。
# 研究背景
說明本文的研究背景、問題來源以及研究意義。
# 研究目標
概括本文想解決的核心問題或實現的主要目標。
# 數據與研究對象
總結本文使用的數據、實驗區域、研究對象、樣本來源或案例資訊。
# 方法流程
按步驟說明本文的方法、模型、演算法或實驗流程。
# 關鍵技術與公式
提取並解釋本文中的關鍵技術、重要公式、核心參數或判別邏輯。如果原文沒有明確公式，請說明「原文未明確說明關鍵公式」。
# 實驗設計
總結本文的實驗設定、對比方法、評價指標和驗證方式。
# 主要結果
總結本文得到的主要實驗結果和重要發現。
# 結論
概括作者最終得出的結論。
# 創新點
提煉本文的主要創新點。
# 局限性
分析本文可能存在的不足、適用範圍或未解決問題。
# 可借鑑之處
說明這篇論文對後續研究、方法設計或論文寫作有什麼參考價值。
輸出要求：
1. 只輸出論文總結內容，不要包含寒暄；
2. 不要編造原文沒有明確說明的資訊；
3. 如果某一部分原文沒有提供，請寫「原文未明確說明」；
4. 盡量使用清晰的小標題和項目符號。`,
    },
    {
      id: "builtin-ai-innovation-summary",
      name: "AI創新點總結",
      description: "適合只提煉論文貢獻、創新點與既有方法的差異。",
      content: `請你用中文總結下面這篇論文的創新點。
要求：
1. 只關注論文的創新點、主要貢獻和與既有研究的差異；
2. 不需要完整總結全文；
3. 區分「作者聲稱的貢獻」和「實際具有實質性的創新」；
4. 如果某些創新只是既有方法的組合、遷移或應用，請明確說明；
5. 每個創新點都要簡要解釋其意義；
6. 不要包含寒暄、客套話或無關內容；
7. 不要編造原文沒有明確說明的資訊。
請按照以下結構輸出：
# 總體創新概括
用一段話概括本文的主要創新。
# 具體創新點
逐條列出本文的創新點，並說明每一點的具體含義和作用。
# 與既有研究的差異
說明本文相比既有方法、既有模型或既有研究工作的主要差異。
# 創新點評價
判斷本文的創新屬於理論創新、方法創新、數據創新、應用創新、工程改進，還是既有方法的組合與遷移。`,
    },
  ],
  "en-US": [
    {
      id: "builtin-ai-full-summary",
      name: "AI Full Summary",
      description: "Good for understanding the whole paper in detail without forcing a rigid output structure.",
      content: `Please explain the following paper in detail in English.
Output requirements:
1. Start with one paragraph summarizing the core content of the paper.
2. Then provide a detailed explanation based on the paper.
3. The summary structure is flexible, but it must be clear and well organized.
4. Explain key terms, methods, and conclusions when necessary.
5. Output only the explanation of the paper itself, without greetings or unrelated text.
6. Do not fabricate information not explicitly stated in the paper. If something is missing, say "The original paper does not explicitly state this."`,
    },
    {
      id: "builtin-ai-abstract-summary",
      name: "AI Abstract Summary",
      description: "Good for a one-paragraph quick summary of the whole paper.",
      content: `Please summarize the following paper into one paragraph in English.
Requirements:
1. Output only one paragraph.
2. Cover the research background, objective, core method, main results, and conclusion.
3. Keep the wording accurate, concise, and complete.
4. Do not include greetings or unrelated content.
5. Do not fabricate information not explicitly stated in the paper.`,
    },
    {
      id: "builtin-ai-structured-summary",
      name: "AI Structured Full Summary",
      description: "Good for producing a structured summary.",
      content: `Please provide a structured summary of the following paper in English. The content should be accurate, complete, and clearly organized.
Use the following structure:
# Core Overview
Summarize the core content of the paper in one paragraph.
# Research Background
Explain the research background, problem source, and significance.
# Research Objective
Summarize the main problem the paper tries to solve or the main goal it wants to achieve.
# Data and Study Object
Summarize the data, study area, research object, sample source, or case information used in the paper.
# Method Workflow
Explain the method, model, algorithm, or experimental process step by step.
# Key Techniques and Formulas
Extract and explain key techniques, important formulas, core parameters, or decision logic. If the original paper does not explicitly provide formulas, state that clearly.
# Experimental Design
Summarize the experimental setup, baselines, evaluation metrics, and validation methods.
# Main Results
Summarize the major experimental results and important findings.
# Conclusion
Summarize the authors' final conclusions.
# Innovations
Extract the main innovations of the paper.
# Limitations
Analyze possible limitations, scope constraints, or unresolved issues.
# Practical Takeaways
Explain what can be learned from this paper for future research, method design, or writing.
Output requirements:
1. Output only the summary content of the paper, without greetings.
2. Do not fabricate information not explicitly stated in the paper.
3. If a section is not provided in the paper, write "The original paper does not explicitly state this."
4. Use clear headings and bullet points whenever possible.`,
    },
    {
      id: "builtin-ai-innovation-summary",
      name: "AI Innovation Summary",
      description: "Good for extracting contributions, innovations, and differences from prior work.",
      content: `Please summarize the innovations of the following paper in English.
Requirements:
1. Focus only on the innovations, main contributions, and differences from prior studies.
2. Do not provide a full-paper summary.
3. Distinguish between the authors' claimed contributions and truly substantive innovations.
4. If some innovations are only combinations, transfers, or applications of existing methods, say so explicitly.
5. Briefly explain the significance of each innovation.
6. Do not include greetings or unrelated content.
7. Do not fabricate information not explicitly stated in the paper.
Use the following structure:
# Overall Innovation Overview
Summarize the paper's main innovations in one paragraph.
# Specific Innovations
List each innovation and explain its specific meaning and role.
# Differences from Prior Work
Explain the main differences between this paper and prior methods, models, or studies.
# Innovation Assessment
Judge whether the innovations are theoretical, methodological, data-related, application-oriented, engineering improvements, or mainly combinations/transfers of existing methods.`,
    },
  ],
};

export type PromptTemplate = {
  id: string;
  name: string;
  content: string;
  description?: string;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PromptTemplateState = {
  templates: PromptTemplate[];
  activeTemplateId: string;
  version: number;
  changed: boolean;
};

export const SYSTEM_ROLE_PROMPT = "You are a helpful academic assistant.";

function nowIso(): string {
  return new Date().toISOString();
}

function getBuiltInTemplateDefinitions(
  locale = getRuntimeLocale(),
): BuiltInTemplateDefinition[] {
  return BUILT_IN_TEMPLATE_DEFINITIONS[locale];
}

function getBuiltInTemplateSnapshotsById() {
  const snapshots = new Map<string, BuiltInTemplateDefinition[]>();
  (Object.keys(BUILT_IN_TEMPLATE_DEFINITIONS) as RuntimeLocale[]).forEach(
    (locale) => {
      getBuiltInTemplateDefinitions(locale).forEach((definition) => {
        const list = snapshots.get(definition.id) || [];
        list.push(definition);
        snapshots.set(definition.id, list);
      });
    },
  );
  return snapshots;
}

function normalizePromptTemplate(template: Partial<PromptTemplate>): PromptTemplate | null {
  const id = String(template.id || "").trim();
  const name = String(template.name || "").trim();
  const content = typeof template.content === "string" ? template.content : "";
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    content,
    description: String(template.description || "").trim(),
    builtIn: !!template.builtIn,
    createdAt: String(template.createdAt || nowIso()),
    updatedAt: String(template.updatedAt || template.createdAt || nowIso()),
  };
}

export function createPromptTemplateId(prefix = "prompt-template"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDefaultPromptTemplates(): PromptTemplate[] {
  const timestamp = nowIso();
  return getBuiltInTemplateDefinitions().map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    content: item.content,
    builtIn: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
}

export function getDefaultActivePromptTemplateId(): string {
  return getBuiltInTemplateDefinitions()[0].id;
}

export function parsePromptTemplates(raw: unknown): PromptTemplate[] {
  if (typeof raw !== "string" || !raw.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => normalizePromptTemplate(item || {}))
      .filter((item): item is PromptTemplate => !!item);
  } catch {
    return [];
  }
}

export function serializePromptTemplates(templates: PromptTemplate[]): string {
  return JSON.stringify(templates);
}

export function findPromptTemplateById(
  templates: PromptTemplate[],
  templateId: string,
): PromptTemplate | undefined {
  return templates.find((template) => template.id === templateId);
}

export function isPromptTemplateNameUnique(
  templates: PromptTemplate[],
  name: string,
  currentId?: string,
): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return !templates.some(
    (template) =>
      template.id !== currentId && template.name.trim().toLowerCase() === normalized,
  );
}

export function ensurePromptTemplateState(
  rawTemplates: unknown,
  rawActiveTemplateId: unknown,
  rawVersion?: unknown,
): PromptTemplateState {
  const defaults = createDefaultPromptTemplates();
  const defaultById = new Map(defaults.map((template) => [template.id, template]));
  const snapshotById = getBuiltInTemplateSnapshotsById();
  const parsedTemplates = parsePromptTemplates(rawTemplates);
  const activeTemplateId = String(rawActiveTemplateId || "").trim();
  const version = Number(rawVersion);

  if (!parsedTemplates.length) {
    return {
      templates: defaults,
      activeTemplateId: getDefaultActivePromptTemplateId(),
      version: PROMPT_TEMPLATES_VERSION,
      changed: true,
    };
  }

  let changed = false;
  let templates = parsedTemplates.map((template) => ({ ...template }));

  if (!Number.isFinite(version) || version < PROMPT_TEMPLATES_VERSION) {
    for (const defaultTemplate of defaults) {
      if (!templates.some((template) => template.id === defaultTemplate.id)) {
        templates.push(defaultTemplate);
        changed = true;
      }
    }
  }

  const validActiveTemplateId =
    activeTemplateId && templates.some((template) => template.id === activeTemplateId)
      ? activeTemplateId
      : "";

  let nextActiveTemplateId = validActiveTemplateId;
  if (!nextActiveTemplateId) {
    nextActiveTemplateId =
      templates.find((template) => template.id === getDefaultActivePromptTemplateId())?.id ||
      templates[0]?.id ||
      getDefaultActivePromptTemplateId();
    changed = true;
  }

  templates = templates.map((template) => {
    const builtInTemplate = defaultById.get(template.id);
    if (!builtInTemplate) {
      return template;
    }

    const nextTemplate = { ...template, builtIn: true };
    if (!template.builtIn) {
      changed = true;
    }

    const knownSnapshots = snapshotById.get(template.id) || [];
    if (
      shouldRefreshBuiltInTemplate(nextTemplate, builtInTemplate, knownSnapshots)
    ) {
      if (
        nextTemplate.name !== builtInTemplate.name ||
        (nextTemplate.description || "") !== (builtInTemplate.description || "") ||
        nextTemplate.content !== builtInTemplate.content
      ) {
        changed = true;
      }
      return {
        ...nextTemplate,
        name: builtInTemplate.name,
        description: builtInTemplate.description,
        content: builtInTemplate.content,
      };
    }

    return nextTemplate;
  });

  return {
    templates,
    activeTemplateId: nextActiveTemplateId,
    version: PROMPT_TEMPLATES_VERSION,
    changed: changed || version !== PROMPT_TEMPLATES_VERSION,
  };
}

export function getActivePromptTemplate(
  rawTemplates: unknown,
  rawActiveTemplateId: unknown,
  rawVersion?: unknown,
): PromptTemplate {
  const state = ensurePromptTemplateState(rawTemplates, rawActiveTemplateId, rawVersion);
  return (
    findPromptTemplateById(state.templates, state.activeTemplateId) ||
    state.templates[0] ||
    createDefaultPromptTemplates()[0]
  );
}

export function createPromptTemplateCopy(
  source: PromptTemplate,
  templates: PromptTemplate[],
): PromptTemplate {
  const baseName = `${source.name}${runtimeT({
    "en-US": " - Copy",
    "zh-CN": " - 副本",
    "zh-TW": " - 副本",
  })}`;
  let nextName = baseName;
  let index = 2;
  while (!isPromptTemplateNameUnique(templates, nextName)) {
    nextName = `${baseName} ${index}`;
    index += 1;
  }
  const timestamp = nowIso();
  return {
    id: createPromptTemplateId(),
    name: nextName,
    description: source.description || "",
    content: source.content,
    builtIn: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function shouldRefreshBuiltInTemplate(
  template: PromptTemplate,
  currentDefault: PromptTemplate,
  knownSnapshots: BuiltInTemplateDefinition[],
): boolean {
  return knownSnapshots.some(
    (snapshot) =>
      template.name === snapshot.name &&
      (template.description || "") === (snapshot.description || "") &&
      template.content === snapshot.content,
  );
}

export function buildUserMessage(prompt: string, text: string): string {
  return `${prompt}\n\n<Paper>\n${text}\n</Paper>`;
}

export function buildSummaryHeading(templateName: string, itemTitle: string): string {
  return `${templateName.trim()} - ${itemTitle.trim()}`;
}

export function ensureSummaryHeading(content: string, heading: string): string {
  const trimmedHeading = heading.trim();
  const normalizedContent = String(content || "").replace(/^\uFEFF/, "");
  const trimmedContent = normalizedContent.trimStart();
  if (!trimmedHeading) {
    return normalizedContent;
  }
  if (trimmedContent.startsWith(trimmedHeading)) {
    return normalizedContent;
  }
  if (!trimmedContent) {
    return `${trimmedHeading}\n`;
  }
  return `${trimmedHeading}\n\n${trimmedContent}`;
}

export function stripLeadingSummaryHeading(content: string, heading: string): string {
  const normalizedContent = String(content || "").replace(/^\uFEFF/, "");
  const lines = normalizedContent.split(/\r?\n/);
  if (!lines.length) {
    return normalizedContent;
  }
  if (lines[0].trim() !== heading.trim()) {
    return normalizedContent;
  }
  lines.shift();
  while (lines.length && !lines[0].trim()) {
    lines.shift();
  }
  return lines.join("\n");
}
