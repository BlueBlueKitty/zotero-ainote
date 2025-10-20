/**
 * AI 提示词配置文件
 * 集中管理所有 AI 提示词，便于修改和维护
 */

/**
 * 提示词版本号
 * 每次修改默认提示词时，增加此版本号，可以触发已有用户的提示词更新
 */
export const PROMPT_VERSION = 1;

/**
 * 默认的论文总结提示词
 */
export const DEFAULT_SUMMARY_PROMPT = 
`# 角色
你是一名专业的学术研究助理，擅长将复杂的学术论文提炼为清晰、结构化的摘要。

# 任务
请对下方提供的学术论文，进行一个包含两部分的综合性总结。
第一部分：全文核心摘要
首先，请提供一个对全文内容的高度概括。这个摘要应该在一个段落内，精准地捕捉论文的核心研究问题、使用的方法、关键发现以及主要结论，让人能快速了解论文全貌。
第二部分：分章节详细解析
接下来，请识别并划分论文的主要章节结构（例如：引言、文献综述、研究方法、实验结果、讨论、结论等）：
1.为每一个章节的总结内容，都起一个清晰、概括性的标题。
2.在标题下，详细总结该章节的关键论点、核心内容和重要信息。
3.文章的致谢与参考文献部分不需要总结。
第三部分：创新性与局限性评估
最后，请根据论文内容，独立分析并总结其主要创新点和存在的局限性：
1.创新点: 论文在理论、方法或实践方面做出了哪些独特的贡献？
3.局限性: 研究存在哪些不足之处？为未来的研究提供了哪些方向？

# 输出要求
1.条理清晰，逻辑性强。
2.语言简练、准确。
3.使用中文进行回答。`;

/**
 * 系统角色提示词
 * 定义 AI 助手的基本角色和行为
 */
export const SYSTEM_ROLE_PROMPT = "You are a helpful academic assistant.";

/**
 * 构建用户消息的模板
 * @param prompt 用户自定义的提示词
 * @param text 论文全文
 * @returns 格式化后的用户消息
 */
export function buildUserMessage(prompt: string, text: string): string {
  return `${prompt}\n\n请用中文回答。\n\n<Paper>\n${text}\n</Paper>`;
}

/**
 * 获取默认的总结提示词
 * @returns 默认提示词
 */
export function getDefaultSummaryPrompt(): string {
  return DEFAULT_SUMMARY_PROMPT;
}

/**
 * 检查是否需要更新提示词
 * @param currentPromptVersion 当前用户的提示词版本
 * @param currentPrompt 当前用户的提示词内容
 * @returns 是否需要更新
 */
export function shouldUpdatePrompt(currentPromptVersion?: number, currentPrompt?: string): boolean {
    // 如果没有版本号，强制更新为默认提示词
    if (currentPromptVersion === undefined) {
        return true;
    }

    // 如果有版本号但版本低于当前版本，则需要更新（仅当用户没有自定义时）
    return currentPromptVersion < PROMPT_VERSION;
}
