/**
 * AI 提示词模板配置
 * 集中管理默认模板、模板解析与标题拼装逻辑。
 */

export const PROMPT_TEMPLATES_VERSION = 1;

const BUILT_IN_TEMPLATE_DEFINITIONS = [
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
] as const;

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
  return BUILT_IN_TEMPLATE_DEFINITIONS.map((item) => ({
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
  return BUILT_IN_TEMPLATE_DEFINITIONS[0].id;
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
    if (builtInTemplate && !template.builtIn) {
      changed = true;
      return { ...template, builtIn: true };
    }
    return template;
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
  const baseName = `${source.name} - 副本`;
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

export function buildUserMessage(prompt: string, text: string): string {
  return `${prompt}\n\n请用中文回答。\n\n<Paper>\n${text}\n</Paper>`;
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
