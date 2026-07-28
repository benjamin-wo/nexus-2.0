export async function execute(
  args: {
    action?: "search" | "research" | "scrape";
    query?: string;
    url?: string;
  },
  context?: { chatId: string; alias?: string }
) {
  // Compatibility check for old aliases
  let action = args.action;
  if (context?.alias === "searchWeb") action = "search";
  if (context?.alias === "deep-research") action = "research";
  if (context?.alias === "webScraper") action = "scrape";

  // Fallback heuristic based on inputs if action is missing
  if (!action) {
    if (args.url && !args.query) {
      action = "scrape";
    } else {
      action = "search";
    }
  }

  const apiKey = process.env.TAVILY_API_KEY;

  switch (action) {
    case "search": {
      const query = args.query || "";
      if (!query) throw new Error("Parameter 'query' is required for action 'search'.");
      if (!apiKey) {
        throw new Error("TAVILY_API_KEY is not configured. Please add your Tavily API Key to environment variables.");
      }

      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: "basic",
          max_results: 5,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Tavily API search error (${res.status}): ${errText}`);
      }

      const data = (await res.json()) as any;
      const results = (data.results || []).map((r: any) => ({
        title: r.title,
        url: r.url,
        snippet: r.content,
      }));

      return { success: true, results };
    }

    case "research": {
      const query = args.query || "";
      if (!query) throw new Error("Parameter 'query' is required for action 'research'.");
      if (!apiKey) {
        throw new Error("TAVILY_API_KEY is not configured. Please add your Tavily API Key to environment variables.");
      }

      const angles = [
        `${query} overview, key concepts, definitions`,
        `${query} latest developments, news, trends 2026`,
        `${query} challenges, limitations, criticisms, controversies`
      ];

      console.log(`[Deep Research] Starting parallel multi-angle search for: "${query}"`);

      const searchPromises = angles.map(async (angleQuery, index) => {
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: apiKey,
            query: angleQuery,
            search_depth: "basic",
            max_results: 3,
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Tavily API search error on angle ${index + 1} (${res.status}): ${errText}`);
        }

        const data = (await res.json()) as any;
        return {
          angle: index === 0 ? "Conceptual Overview" : index === 1 ? "Latest Trends & News" : "Challenges & Critiques",
          query: angleQuery,
          results: (data.results || []).map((r: any) => ({
            title: r.title,
            url: r.url,
            snippet: r.content
          }))
        };
      });

      const searchResults = await Promise.all(searchPromises);

      return {
        success: true,
        topic: query,
        researchReport: searchResults
      };
    }

    case "scrape": {
      const url = args.url || "";
      if (!url) throw new Error("Parameter 'url' is required for action 'scrape'.");
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        throw new Error("Invalid URL. URL must start with http:// or https://");
      }

      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP fetch failed with status: ${response.status} ${response.statusText}`);
      }

      const html = await response.text();

      // Extract text content cleanly
      let text = html
        .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, "")
        .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&amp;/gi, "&")
        .replace(/\s+/g, " ")
        .trim();

      if (text.length > 8000) {
        text = text.substring(0, 8000) + "\n... [truncated for length]";
      }

      return {
        url,
        success: true,
        length: text.length,
        content: text,
      };
    }

    default:
      throw new Error(`Unsupported action: ${action}`);
  }
}
