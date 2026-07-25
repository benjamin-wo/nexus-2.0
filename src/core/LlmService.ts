import { Message } from "../database/Storage";
import { GeminiEmptyResponseError, GeminiApiError } from "./errors";
import { Logger } from "./Logger";

export class LlmService {
  private provider: string;
  private customModel?: string;
  private geminiKey: string;
  private deepseekKey: string;
  private openrouterKey: string;

  constructor(customProvider?: string, customModel?: string) {
    this.provider = (customProvider || process.env.LLM_PROVIDER || "gemini").toLowerCase();
    this.customModel = customModel;
    this.geminiKey = process.env.GEMINI_API_KEY || "";
    this.deepseekKey = process.env.DEEPSEEK_API_KEY || "";
    this.openrouterKey = process.env.OPENROUTER_API_KEY || "";
  }

  async generateResponse(messages: Message[]): Promise<string> {
    let totalLength = 0;
    for (const msg of messages) {
      if (msg.content) totalLength += msg.content.length;
    }

    if (totalLength === 0) {
      Logger.error("[LlmService] Validation Error: Prompt string is empty");
      return "I'm sorry, I couldn't process that request.";
    }

    if (totalLength > 500000) {
      Logger.error(`[LlmService] Validation Error: Prompt length (${totalLength}) exceeds 500000 characters`);
      return "I'm sorry, I couldn't process that request.";
    }

    const hasMedia = messages.some((msg) => msg.media && msg.media.length > 0);
    if (hasMedia) {
      Logger.info("[LlmService] Media detected. Routing to Gemini...");
      return this.callGeminiWithFallback(messages);
    }

    switch (this.provider) {
      case "gemini":
        return this.callGeminiWithFallback(messages);
      case "deepseek":
        return this.callDeepseek(messages);
      case "openrouter":
        return this.callOpenrouter(messages);
      default:
        throw new Error(`Unsupported LLM provider: ${this.provider}`);
    }
  }

  private async callGeminiWithFallback(messages: Message[]): Promise<string> {
    try {
      return await this.callGemini(messages);
    } catch (err: any) {
      Logger.error(`[LlmService] Gemini API failed after retries: ${err.message}. Attempting fallback...`);
      try {
        return await this.callDeepseek(messages);
      } catch (fallbackErr: any) {
        Logger.error(`[LlmService] Fallback to Deepseek also failed: ${fallbackErr.message}`);
        throw err; // Throw original Gemini error for upstream graceful degradation
      }
    }
  }

  private async callGemini(messages: Message[]): Promise<string> {
    const model = this.customModel || process.env.GEMINI_MODEL || "gemini-2.5-flash";
    if (!this.geminiKey) {
      throw new Error("GEMINI_API_KEY is not configured in environment variables.");
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.geminiKey}`;

    // Filter messages, extract system prompt
    let systemInstruction = "";
    const contents: any[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemInstruction += msg.content + "\n";
      } else {
        // Translate roles for Gemini compatibility (gemini expects 'user' or 'model')
        const role = msg.role === "assistant" ? "model" : "user";
        
        const parts: any[] = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        
        if (msg.media) {
          for (const m of msg.media) {
            parts.push({
              inlineData: {
                mimeType: m.mimeType,
                data: m.data,
              },
            });
          }
        }

        // Gemini requires at least one part
        if (parts.length === 0) {
          parts.push({ text: "" });
        }

        contents.push({
          role,
          parts,
        });
      }
    }

    const body: any = { contents };
    if (systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: systemInstruction.trim() }],
      };
    }
    body.generationConfig = {
      temperature: 0.1,
    };

    const reqId = Math.random().toString(36).substring(7);
    const maxRetries = 3;
    let attempt = 0;
    const delays = [1000, 2000, 4000];

    while (attempt <= maxRetries) {
      try {
        Logger.info(`[LlmService] [req-${reqId}] Calling Gemini API (Attempt ${attempt + 1}/${maxRetries + 1})...`);
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const errText = await res.text();
          Logger.error(`[LlmService] [req-${reqId}] Gemini API error (${res.status}): ${errText}`);
          
          // Transient errors
          if (res.status >= 500 || res.status === 429) {
            throw new GeminiApiError(res.status, errText);
          }
          
          // Non-transient errors (4xx) throw immediately without retry
          throw new GeminiApiError(res.status, errText);
        }

        const data = (await res.json()) as any;
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!text) {
          Logger.warn(`[LlmService] [req-${reqId}] Gemini API returned empty completion. Data: ${JSON.stringify(data)}`);
          throw new GeminiEmptyResponseError();
        }

        Logger.info(`[LlmService] [req-${reqId}] Gemini API call successful.`);
        return text;
      } catch (err: any) {
        if (err.name !== "GeminiApiError" && err.name !== "TypeError" && err.name !== "FetchError") {
          // If it's a structural error (like empty response) or unknown error, don't retry unless it's a network error
          if (err instanceof GeminiEmptyResponseError) {
             throw err; // don't retry empty response, as it might be a prompt rejection
          }
        }
        
        // Let's refine retry condition: only retry for 5xx/429 or network errors
        const isTransientHttp = err instanceof GeminiApiError && (err.statusCode >= 500 || err.statusCode === 429);
        const isNetworkError = err.name === "TypeError" || err.name === "FetchError";
        
        if (!isTransientHttp && !isNetworkError) {
           throw err; // throw immediately for non-transient
        }

        if (attempt >= maxRetries) {
          Logger.error(`[LlmService] [req-${reqId}] Max retries reached. Failing.`);
          throw err;
        }

        const delay = delays[attempt];
        Logger.info(`[LlmService] [req-${reqId}] Transient error caught. Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        attempt++;
      }
    }
    
    throw new Error("Unexpected end of retry loop");
  }

  private async callDeepseek(messages: Message[]): Promise<string> {
    const model = this.customModel || process.env.DEEPSEEK_MODEL || "deepseek-v4-pro";
    if (!this.deepseekKey) {
      throw new Error("DEEPSEEK_API_KEY is not configured in environment variables.");
    }

    try {
      return await this.callOpenAiCompatible(
        "https://api.deepseek.com/chat/completions",
        this.deepseekKey,
        model,
        messages
      );
    } catch (err: any) {
      if (err.message && (err.message.includes("model") || err.message.includes("supported API model"))) {
        const fallbackModel = process.env.DEEPSEEK_MODEL || "deepseek-v4-pro";
        if (fallbackModel !== model) {
          Logger.warn(`[LlmService] Model '${model}' rejected by API. Retrying with fallback model '${fallbackModel}'...`);
          return await this.callOpenAiCompatible(
            "https://api.deepseek.com/chat/completions",
            this.deepseekKey,
            fallbackModel,
            messages
          );
        }
      }
      throw err;
    }
  }

  private async callOpenrouter(messages: Message[]): Promise<string> {
    const model = this.customModel || process.env.OPENROUTER_MODEL || "nousresearch/hermes-3-llama-3-8b";
    if (!this.openrouterKey) {
      throw new Error("OPENROUTER_API_KEY is not configured in environment variables.");
    }

    return this.callOpenAiCompatible(
      "https://openrouter.ai/api/v1/chat/completions",
      this.openrouterKey,
      model,
      messages
    );
  }

  private async callOpenAiCompatible(
    url: string,
    apiKey: string,
    model: string,
    messages: Message[]
  ): Promise<string> {
    const formattedMessages = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: formattedMessages,
        temperature: 0.1,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`API error (${res.status}) on ${url}: ${errText}`);
    }

    const data = (await res.json()) as any;
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error("API returned an empty completions response.");
    }

    return text;
  }
}
