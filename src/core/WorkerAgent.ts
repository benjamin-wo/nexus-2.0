import { Message, MediaAttachment } from "../database/Storage";
import { LlmService } from "./LlmService";
import { GeminiEmptyResponseError, GeminiApiError } from "./errors";
import { SkillRegistry } from "./SkillRegistry";

export class WorkerAgent {
  private name: string;
  private systemPrompt: string;
  private allowedSkills: string[];
  private llmService: LlmService;
  private maxTurns: number;

  constructor(name: string, systemPrompt: string, allowedSkills: string[]) {
    this.name = name;
    this.systemPrompt = systemPrompt;
    this.allowedSkills = allowedSkills;
    
    let customProvider: string | undefined;
    let customModel: string | undefined;
    let customMaxTurns: number | undefined;
    const frontmatterMatch = systemPrompt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      const providerMatch = frontmatter.match(/^provider:\s*([^\r\n]+)/m);
      const modelMatch = frontmatter.match(/^model:\s*([^\r\n]+)/m);
      const maxTurnsMatch = frontmatter.match(/^maxTurns:\s*(\d+)/m);
      if (providerMatch) customProvider = providerMatch[1].trim();
      if (modelMatch) customModel = modelMatch[1].trim();
      if (maxTurnsMatch) customMaxTurns = parseInt(maxTurnsMatch[1], 10);
    }
    this.llmService = new LlmService(customProvider, customModel);
    this.maxTurns = customMaxTurns && customMaxTurns > 0 ? customMaxTurns : 8;
  }

  async execute(chatHistory: Message[], chatId: string): Promise<string> {
    try {
      const registry = SkillRegistry.getInstance();
      const skillsList = registry.getSkills().filter((s) => this.allowedSkills.includes(s.name));

      // Format tool definitions in Hermes standard XML structure
      const toolsXml = skillsList
        .map((s) => {
          return JSON.stringify({
            type: "function",
            function: {
              name: s.name,
              description: s.description,
              parameters: s.parameters,
            },
          });
        })
        .join("\n");

      const skillInstructions = skillsList
        .filter((s) => s.instructions && s.instructions.trim())
        .map((s) => `### Guidelines & Instructions for using tool '${s.name}':\n${s.instructions}`)
        .join("\n\n");

      if (process.env.DEBUG_SKILL_PROMPT) {
        console.log(`[WorkerAgent:${this.name}] Injected skill instructions:\n${skillInstructions || "(none)"}`);
      }

      const systemPromptTemplate = `${this.systemPrompt}

${skillInstructions ? `## Skill Guidelines & Protocols\n${skillInstructions}\n\n` : ""}## System Instructions & Protocols
You are executing in a ReAct loop. You can use the tools provided below.
To reason about your next step, write your reasoning within '<thought></thought>' tags.
If you need to call a tool, you must write a single '<tool_call>{"name": "toolName", "arguments": {...}}</tool_call>' tag directly after your thought block.
When the tool output is received, you will be given a '<tool_response></tool_response>' block. Read it and continue your reasoning.
If you do not need to call any more tools, simply output your final markdown response without any <tool_call> tags.

Available tools:
<tools>
${toolsXml}
</tools>

Format requirements:
- Always think first using <thought>your step-by-step reasoning</thought>.
- Keep tool calls exact: <tool_call>{"name": "...", "arguments": {...}}</tool_call>.
- Do not make assumptions about argument values.
`;

      // Initialize messages array for the ReAct session
      const messages: Message[] = [
        { role: "system", content: systemPromptTemplate },
        ...chatHistory,
      ];

      let turns = 0;
      const maxTurns = this.maxTurns;

      while (turns < maxTurns) {
        turns++;
        console.log(`[WorkerAgent:${this.name}] Turn ${turns}/${maxTurns}...`);

        let completion = "";
        try {
          completion = await this.llmService.generateResponse(messages);
        } catch (err: any) {
          if (err instanceof GeminiEmptyResponseError || err instanceof GeminiApiError) {
            console.error(`[WorkerAgent:${this.name}] Temporary API error caught, aborting task: ${err.message}`);
            return "⚠️ I'm sorry, I encountered a temporary issue with the AI provider while processing your request. Please try again later.";
          }
          throw err;
        }
        
        // Save LLM turn to the execution dialogue
        messages.push({ role: "assistant", content: completion, subagent: this.name });

        // Extract thought and all tool_call matches (supports parallel tool calls)
        const thoughtMatch = completion.match(/<thought>([\s\S]*?)<\/thought>/i);
        const toolCallMatches = Array.from(completion.matchAll(/<tool_call>([\s\S]*?)<\/tool_call>/gi));

        if (thoughtMatch) {
          console.log(`[Thought] ${thoughtMatch[1].trim()}`);
        }

        if (toolCallMatches.length > 0) {
          const parsedCalls: { toolName: string; toolArgs: any }[] = [];
          const syntaxErrors: string[] = [];

          for (const match of toolCallMatches) {
            const rawJson = match[1].trim();
            try {
              const parsed = JSON.parse(rawJson);
              const toolName = parsed.name || parsed.tool || parsed.toolName || parsed.function?.name || "";
              let rawArgs = parsed.arguments || parsed.args || parsed.parameters || parsed.function?.arguments;
              
              if (!rawArgs || (typeof rawArgs === "object" && Object.keys(rawArgs).length === 0)) {
                const { name, tool, toolName, function: fnMeta, ...rest } = parsed;
                rawArgs = rest;
              }

              let toolArgs: any = {};
              if (typeof rawArgs === "string") {
                try { toolArgs = JSON.parse(rawArgs); } catch (_) { toolArgs = rawArgs; }
              } else {
                toolArgs = rawArgs;
              }
              parsedCalls.push({ toolName, toolArgs });
            } catch (err: any) {
              syntaxErrors.push(`Invalid JSON in tool call: ${err.message}`);
            }
          }

          if (syntaxErrors.length > 0 && parsedCalls.length === 0) {
            messages.push({
              role: "user",
              content: `<tool_response>{"success": false, "error": "${syntaxErrors.join("; ")}"}</tool_response>`,
            });
            continue;
          }

          console.log(`[Tool Call] Executing ${parsedCalls.length} tool(s) in parallel:`, parsedCalls.map(c => c.toolName));

          // Execute all valid tool calls concurrently in parallel
          const toolResults = await Promise.all(
            parsedCalls.map(async ({ toolName, toolArgs }) => {
              if (!this.allowedSkills.includes(toolName)) {
                return {
                  toolName,
                  result: { success: false, error: `Permission denied: Tool '${toolName}' is not allowed for worker '${this.name}'.` },
                };
              }

              try {
                const res = await registry.executeSkill(toolName, toolArgs, { chatId });
                console.log(`[Tool Response] '${toolName}' succeeded.`);
                return { toolName, result: res };
              } catch (err: any) {
                const safeMsg = (err.message || String(err)).replace(/"/g, "'").replace(/\n/g, " ");
                console.error(`[Tool Error] '${toolName}' failed:`, err.message);
                return { toolName, result: { success: false, error: safeMsg } };
              }
            })
          );

          // Check if any tool required Google OAuth authorization
          for (const tr of toolResults) {
            if (tr.result && tr.result.success === false && tr.result.error === "NOT_AUTHENTICATED") {
              return `🔒 **Google Authentication Required**\n\nTo allow me to access your Google account, please authorize access by visiting this link:\n\n👉 [Authorize Google Account](${tr.result.authUrl})\n\nAfter authorizing, return here and run your command again!`;
            }
          }

          // Collect any media (e.g. a screenshotPage PNG) returned by a tool, and strip the
          // base64 payload out of the visible tool_response text so it isn't duplicated -
          // it gets attached separately below as this turn's `media`, which LlmService
          // already scans for and auto-routes to a vision-capable model.
          const collectedMedia: MediaAttachment[] = [];
          const toolResponsesStr = toolResults
            .map((tr) => {
              let resultForText: any = tr.result;
              if (tr.result && Array.isArray(tr.result.media) && tr.result.media.length > 0) {
                collectedMedia.push(...tr.result.media);
                resultForText = { ...tr.result, media: `[${tr.result.media.length} image(s) attached]` };
              }
              return `<tool_response name="${tr.toolName}">${JSON.stringify(resultForText)}</tool_response>`;
            })
            .join("\n");

          messages.push({
            role: "user",
            content: toolResponsesStr,
            ...(collectedMedia.length > 0 ? { media: collectedMedia } : {}),
          });
        } else {
          // No tool call: ReAct loop has completed and returned the final answer
          const cleanResponse = completion
            .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
            .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
            .replace(/<tool_response>[\s\S]*?<\/tool_response>/gi, "")
            .replace(/<toolresponse>[\s\S]*?<\/toolresponse>/gi, "")
            .trim();
          return cleanResponse;
        }
      }

      return `⚠️ I reached my maximum reasoning steps (${maxTurns} turns) without resolving the query. Please refine your request or check logs.`;
    } catch (error: any) {
      console.error(`[WorkerAgent:${this.name}] Execution crashed:`, error);
       
      const { StorageService } = await import("../database/Storage");
      const storage = new StorageService();
      await storage.initialize();
      
      const stackTrace = error.stack || error.message;
      const lastInput = chatHistory[chatHistory.length - 1]?.content || "Unknown Input";
      
      const crashPayload = `Crash in worker '${this.name}'\nInput: ${lastInput}\nStack: ${stackTrace}`;
      await storage.logEpisodicMemory(chatId, "crash_telemetry", crashPayload);
      
      const devopsThreadId = await storage.getProfileValue("DEVOPS_THREAD_ID");
      const pmThreadId = await storage.getProfileValue("PM_THREAD_ID");
      await storage.close();
      
      if (devopsThreadId || pmThreadId) {
          throw new Error(`WorkerCrash::${devopsThreadId || ""}::${this.name}::${lastInput}::${stackTrace}`);
      }

      return "❌ An unexpected error occurred while processing your request. The issue has been logged.";
    }
  }
}
