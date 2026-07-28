import { Orchestrator } from "./core/Orchestrator";
import { SkillRegistry } from "./core/SkillRegistry";

declare var process: any;

console.log("=========================================");
console.log("   Telegram Output Sandbox & Validator  ");
console.log("=========================================");

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function markdownToHtml(markdown: string): string {
  let html = escapeHtml(markdown);
  const placeholders: string[] = [];

  // Code blocks
  html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
    const lines = code.split("\n");
    if (lines.length > 0 && /^[a-zA-Z0-9_-]+$/.test(lines[0].trim())) {
      lines.shift();
    }
    placeholders.push(`<pre><code>${lines.join("\n").trim()}</code></pre>`);
    return `@@@PLACEHOLDER${placeholders.length - 1}@@@`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, (match, code) => {
    placeholders.push(`<code>${code}</code>`);
    return `@@@PLACEHOLDER${placeholders.length - 1}@@@`;
  });

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
    placeholders.push(url);
    return `<a href="@@@PLACEHOLDER${placeholders.length - 1}@@@">${text}</a>`;
  });

  // Formatting
  html = html.replace(/(?<!\*)\*\*(?!\*)(?=\S)([\s\S]*?)(?<=\S)\*\*(?!\*)/g, "<b>$1</b>");
  html = html.replace(/(?<!\*)\*(?!\*)(?=\S)([\s\S]*?)(?<=\S)\*(?!\*)/g, "<i>$1</i>");
  html = html.replace(/(?<!_)_(?!_)(?=\S)([\s\S]*?)(?<=\S)_(?!_)/g, "<i>$1</i>");
 
  // Restore placeholders
  for (let i = 0; i < placeholders.length; i++) {
    html = html.replace(`@@@PLACEHOLDER${i}@@@`, () => placeholders[i]);
  }

  return html;
}

// Safe lightweight HTML balancer for Telegram Parse Mode
function validateTelegramHtml(html: string): { valid: boolean; error?: string } {
  const allowedTags = ["b", "strong", "i", "em", "u", "ins", "s", "strike", "del", "span", "tg-spoiler", "a", "code", "pre", "br"];
  const stack: string[] = [];
  const tagRegex = /<\/?([a-zA-Z0-9-]+)(?:\s+[^>]*)?>/g;
  let match;

  console.log(`[HTML Debug] Validating text: "${html}"`);

  while ((match = tagRegex.exec(html)) !== null) {
    const fullTag = match[0];
    const tagName = match[1].toLowerCase();
    console.log(`[HTML Debug] Found tag match: "${fullTag}" (name: "${tagName}")`);

    if (!allowedTags.includes(tagName)) {
      return { valid: false, error: `Disallowed tag found: <${tagName}>` };
    }

    const isClosing = fullTag.startsWith("</");
    if (isClosing) {
      if (stack.length === 0) {
        return { valid: false, error: `Unexpected closing tag </${tagName}> without opening tag` };
      }
      const lastOpen = stack.pop();
      if (lastOpen !== tagName) {
        return { valid: false, error: `Mismatched closing tag </${tagName}>, expected </${lastOpen}> (Current stack: ${stack.join(", ")})` };
      }
    } else if (tagName !== "br") { // br is self-closing
      stack.push(tagName);
    }
  }

  if (stack.length > 0) {
    return { valid: false, error: `Unclosed tags: ${stack.reverse().map(t => `<${t}>`).join(", ")}` };
  }

  return { valid: true };
}

// Rules validator for Telegram AGENTS.md requirements
function validateOutputRules(text: string): { passed: boolean; failures: string[] } {
  const failures: string[] = [];

  // Rule 1: Starts with an emoji
  const startEmoji = /^\p{Emoji}/u.test(text) && !/^[a-zA-Z0-9\s]/.test(text);
  if (!startEmoji) {
    failures.push("Does not start with a thematic emoji.");
  }

  // Rule 2: No markdown tables (|)
  if (text.includes("|")) {
    failures.push("Contains markdown tables ('|'), which break on mobile.");
  }

  // Rule 3: No standard markdown headers (like # or ##)
  if (/(?:^|\n)#+\s/.test(text)) {
    failures.push("Contains standard Markdown headers ('#'), which are unsupported in Telegram Parse Mode.");
  }

  // Rule 4: Short sentences (warn if any sentence exceeds 20 words)
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
  const longSentences = sentences.filter(s => s.split(/\s+/).length > 20);
  if (longSentences.length > 0) {
    failures.push(`Contains long sentences (exceeding 20 words): "${longSentences[0].substring(0, 40)}..."`);
  }

  // Rule 5: No escaped special characters (like \., \!, \-)
  if (/\\\.|\\!|\\-/.test(text)) {
    failures.push("Contains backslash escaped special characters (e.g. '\\.', '\\!').");
  }

  return {
    passed: failures.length === 0,
    failures
  };
}

async function runSandbox() {
  const registry = SkillRegistry.getInstance();
  await registry.initialize();

  const orchestrator = new Orchestrator();
  const testChatId = "telegram_sandbox_chat";

  const testCases = [
    // 1. Calculator (1-8)
    { name: "Calc simple add", query: "what is 25 + 75?" },
    { name: "Calc parenthesis", query: "evaluate (100 - 45) * 3" },
    { name: "Calc decimal fraction", query: "what is 5.5 / 2.5?" },
    { name: "Calc negative number", query: "calculate -15 * -3" },
    { name: "Calc float mix", query: "what is 9.81 * (2.5 + 1.25)?" },
    { name: "Calc divide by zero fallback", query: "what is 10 / 0?" },
    { name: "Calc large numbers", query: "calculate 123456 + 789012" },
    { name: "Calc complex algebraic pattern", query: "what is (5 * 5) + (10 / 2) - 3?" },

    // 2. Maps (Transit, Directions, Bus, Parking) (9-25)
    { name: "Maps simple bus timing", query: "bus 03519" },
    { name: "Maps bus search code", query: "when is the next bus at stop 80112?" },
    { name: "Maps driving route directions", query: "show me driving directions from Orchard Road to Changi Airport" },
    { name: "Maps walking query directions", query: "walk from Raffles Place to Marina Bay Sands" },
    { name: "Maps geocode landmark", query: "where is the coordinates of Merlion Park?" },
    { name: "Maps search local restaurants", query: "find sushi restaurants near City Hall" },
    { name: "Maps parking availability search", query: "check carpark availability at HarbourFront" },
    { name: "Maps transit routing plan", query: "how do I get from Pasir Ris to Orchard via public transport?" },
    { name: "Maps track bus background", query: "track bus 65 at stop 03519 for the next 15 minutes" },
    { name: "Maps traffic incident logs", query: "are there any traffic accidents on the PIE right now?" },
    { name: "Maps bus stop name lookup", query: "what is the name of bus stop code 66021?" },
    { name: "Maps geocode postal code", query: "locate postal code 189768 in Singapore" },
    { name: "Maps directions via cycling", query: "cycle routing from East Coast Park to Marina Barrage" },
    { name: "Maps parking lot count", query: "is there parking space left in Jurong East mall?" },
    { name: "Maps transit option search", query: "what's the fastest way to travel from Woodlands to Bugis?" },
    { name: "Maps track bus service filter", query: "start tracking bus 190 at stop 19059" },
    { name: "Maps local cafe search", query: "search for cafes near Bugis Junction" },

    // 3. Email (Gmail, Outlook, Polling) (26-38)
    { name: "Email list inbox", query: "check my recent emails" },
    { name: "Email list specific sender", query: "do I have any emails from bosses or alerts?" },
    { name: "Email get specific content", query: "retrieve the email with ID msg_12345" },
    { name: "Email list Gmail recent", query: "show my last 5 Gmail messages" },
    { name: "Email list Outlook recent", query: "list my recent Outlook emails" },
    { name: "Email send gmail composing", query: "send an email to test@gmail.com with subject Hello and body Hi" },
    { name: "Email poll alerts sync", query: "sync my emails now" },
    { name: "Email poll custom merchant filter", query: "poll my emails from Gojek" },
    { name: "Email check bank receipts", query: "check my inbox for Citibank receipts" },
    { name: "Email send outlook message", query: "email manager@company.com saying the project is complete" },
    { name: "Email query keyword search", query: "search my emails for 'invoice'" },
    { name: "Email get body info", query: "read email content for receipt verification" },
    { name: "Email poll DBS notifications", query: "check my Gmail for DBS PayNow notifications" },

    // 4. Expenses & Receivables (39-50)
    { name: "Expenses log manual transaction", query: "log expense $12.50 for lunch on food" },
    { name: "Expenses list recent logs", query: "show my expenses this month" },
    { name: "Expenses log receipt image caption", query: "log a payment of $85.20 at NTUC FairPrice" },
    { name: "Expenses list receivables owed", query: "who owes me money?" },
    { name: "Expenses mark settle bill", query: "settle reimbursement ID 5 because John paid me back" },
    { name: "Expenses match and settle amount", query: "Alice paid me $20.00, settle her debt" },
    { name: "Expenses log category check", query: "log an expense of SGD 45 for taxi under transport" },
    { name: "Expenses delete transaction", query: "delete expense entry ID 102" },
    { name: "Expenses total monthly summary", query: "how much did I spend on groceries this week?" },
    { name: "Expenses record group bill split", query: "split a bill of $120 for dinner between John and Mary" },
    { name: "Expenses get pending logs", query: "show my pending receipt logs" },
    { name: "Expenses clear all settled", query: "show all settled reimbursements" },

    // 5. Notes & Research Library (51-62)
    { name: "Notes create research note", query: "save note: Flat Agent design simplifies ReAct cognitive cycles" },
    { name: "Notes list note library", query: "show all my saved notes" },
    { name: "Notes find specific query", query: "search my notes for 'ReAct'" },
    { name: "Notes create title specific", query: "save note titled 'API Fallbacks' with text 'Gemini falls back to DeepSeek'" },
    { name: "Notes delete item index", query: "delete note ID 15" },
    { name: "Notes clear note index", query: "remove note about Flat Agent design" },
    { name: "Notes check recent logs", query: "list my recent research logs" },
    { name: "Notes create code note", query: "save a note with the database schema details" },
    { name: "Notes search empty match", query: "find notes containing 'invalidkey'" },
    { name: "Notes append text warning", query: "add note: remember to check postgres logs on weekend" },
    { name: "Notes fetch detail view", query: "read note titled 'API Fallbacks'" },
    { name: "Notes list count total", query: "how many notes do I have saved?" },

    // 6. Schedule & Heartbeats (63-75)
    { name: "Schedule reminder one-off", query: "remind me to check postgres server in 15 minutes" },
    { name: "Schedule cron job weekday", query: "schedule checking emails every weekday at 9am" },
    { name: "Schedule automated task prefix", query: "schedule [TASK] poll my emails for receipts every 30 minutes" },
    { name: "Schedule check active schedules", query: "list my reminders" },
    { name: "Schedule cancel timer id", query: "delete reminder ID 8" },
    { name: "Schedule cron heartbeat check", query: "schedule [TASK] run system health check every day at midnight" },
    { name: "Schedule calendar date one-shot", query: "set a reminder for 2026-10-28T09:00:00Z to verify railway deployment" },
    { name: "Schedule transit integration test", query: "remind me about the meeting at Orchard Road tomorrow at 2pm" },
    { name: "Schedule direct cron cancel", query: "cancel reminder ID 10" },
    { name: "Schedule reminder with location check", query: "set reminder: pick up parcel at Pasir Ris mall in 2 hours" },
    { name: "Schedule heartbeat check log", query: "schedule [TASK] print orchestrator.log details every 6 hours" },
    { name: "Schedule weekly cron notify", query: "remind me every Monday at 8am to review active receivables" },
    { name: "Schedule prompt confirmation", query: "remind me to call John in 5 hours" },

    // 7. Consulting & Industry Analysis (76-83)
    { name: "Consulting market research report", query: "write a consulting analysis report on EV market size in Singapore" },
    { name: "Consulting brand analysis query", query: "generate a consumer insights analysis for Dyson brand expansion" },
    { name: "Consulting financial diligence report", query: "create a financial analysis report comparing Grab and Gojek" },
    { name: "Consulting competitive intelligence analysis", query: "write a competitive report on AI chip competitors" },
    { name: "Consulting market trend report", query: "research and analyze global micro-mobility trends" },
    { name: "Consulting investment diligence", query: "analyze the semiconductor supply chain risks for 2026" },
    { name: "Consulting market size projection", query: "generate market entry strategy for a fintech app in SEA" },
    { name: "Consulting consumer trends report", query: "write research report on Gen Z spending behaviors in Singapore" },

    // 8. SysAdmin & DevOps Error Audit (84-91)
    { name: "SysAdmin check log trace resolution", query: "/fixingtime" },
    { name: "SysAdmin manual bug report insertion", query: "🚨 **MANUAL_BUG_REPORT** Worker: maps. Input: bus 99999. Error: API timeout" },
    { name: "SysAdmin set sandbox thread", query: "/set_devops_thread" },
    { name: "SysAdmin set bug PM thread", query: "/set_pm_thread" },
    { name: "SysAdmin set finance thread", query: "/set_finance_thread" },
    { name: "SysAdmin run trajectory optimization check", query: "run system trajectory optimization audits" },
    { name: "SysAdmin manual audit report run", query: "run a manual DevOps audit report" },
    { name: "SysAdmin read episodic memory", query: "inspect recent crash logs in episodic memory" },

    // 9. WebPage Design & Dynamic Skill Evolution (92-100)
    { name: "WebPage host dashboard component", query: "host a static page showing my expense summary with clean grid charts" },
    { name: "WebPage list published pages", query: "list my hosted html pages" },
    { name: "WebPage remove stale page", query: "delete hosted page expense_summary.html" },
    { name: "WebPage design visual preview screenshot", query: "render a screenshot preview of an outfit shop landing page" },
    { name: "WebPage clean hosted pages count", query: "clean hosted HTML pages older than 7 days" },
    { name: "WebPage design landing page component", query: "host a beautiful dashboard for my research notes" },
    { name: "Dynamic Skill creation compile check", query: "create a new skill named calculateTax that multiplies value by 0.08" },
    { name: "Dynamic Skill execution verify", query: "calculate tax for 1500 using calculateTax skill" },
    { name: "Dynamic Skill list registry info", query: "list my active modular skills" }
  ];

  // Parse command line arguments for limit
  let limit = 3;
  const limitArgIdx = process.argv.indexOf("--limit");
  if (limitArgIdx !== -1 && process.argv[limitArgIdx + 1]) {
    limit = parseInt(process.argv[limitArgIdx + 1], 10);
  } else if (process.argv.includes("--all")) {
    limit = testCases.length;
  }

  const runCases = testCases.slice(0, limit);
  console.log(`\nStarting validation for ${runCases.length} mock user queries (out of ${testCases.length} total)...`);

  for (const tc of runCases) {
    console.log(`\n-----------------------------------------`);
    console.log(`🧪 Test Case: ${tc.name}`);
    console.log(`User query: "${tc.query}"`);
    console.log(`Thinking...`);

    const response = await orchestrator.processMessage(testChatId, tc.query);
    console.log(`\nResponse returned:`);
    console.log(response);
    console.log(`-----------------------------------------`);

    // Run HTML and rule validation
    const htmlResult = validateTelegramHtml(markdownToHtml(response));
    const ruleResult = validateOutputRules(response);

    if (htmlResult.valid) {
      console.log("✅ HTML Format: Valid and balanced tags.");
    } else {
      console.log(`❌ HTML Format Error: ${htmlResult.error}`);
    }

    if (ruleResult.passed) {
      console.log("✅ Style Rules: Passed all Telegram rules.");
    } else {
      console.log("❌ Style Failures:");
      ruleResult.failures.forEach(f => console.log(`   - ${f}`));
    }
  }

  console.log("\n=========================================");
  console.log("        SANDBOX CHECK COMPLETED          ");
  console.log("=========================================");
}

runSandbox().catch(console.error);
