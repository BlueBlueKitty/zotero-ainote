// AiNote 插件默认配置
// 注意：默认提示词统一在 src/utils/prompts.ts 中管理
// 本文件中的 summaryPrompt 为备用默认值，实际使用时会被 src/hooks.ts 和 src/modules/preferenceScript.ts 中的初始化逻辑覆盖

pref("__prefsPrefix__.provider", "openai");
pref("__prefsPrefix__.apiKey", "");
pref("__prefsPrefix__.apiUrl", "https://api.openai.com/v1/chat/completions");
pref("__prefsPrefix__.model", "gpt-3.5-turbo");
pref("__prefsPrefix__.temperature", "0.7");
pref("__prefsPrefix__.stream", true);
pref("__prefsPrefix__.summaryPrompt", "# 角色\n你是一名专业的学术研究助理，擅长将复杂的学术论文提炼为清晰、结构化的摘要。\n\n# 任务\n请对下方提供的学术论文，进行一个包含两部分的综合性总结。\n第一部分：全文核心摘要\n首先，请提供一个对全文内容的高度概括。这个摘要应该在一个段落内，精准地捕捉论文的核心研究问题、使用的方法、关键发现以及主要结论，让人能快速了解论文全貌。\n第二部分：分章节详细解析\n接下来，请识别并划分论文的主要章节结构（例如：引言、文献综述、研究方法、实验结果、讨论、结论等）：\n1.为每一个章节的总结内容，都起一个清晰、概括性的标题。\n2.在标题下，详细总结该章节的关键论点、核心内容和重要信息。\n第三部分：创新性与局限性评估\n最后，请根据论文内容，独立分析并总结其主要创新点和存在的局限性：\n1.创新点: 论文在理论、方法或实践方面做出了哪些独特的贡献？\n3.局限性: 研究存在哪些不足之处？为未来的研究提供了哪些方向？\n\n# 输出要求\n1.条理清晰，逻辑性强。\n2.语言简练、准确。\n3.使用中文进行回答。");
