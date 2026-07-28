---
name: webSearch
description: Searches the web, performs multi-angle deep research, or scrapes a specific webpage URL content.
parameters:
  type: object
  properties:
    action:
      type: string
      enum: [search, research, scrape]
      description: "The action to perform: 'search' to run a basic Tavily query, 'research' to trigger a multi-angle deep dive, or 'scrape' to fetch readable text from a URL."
    query:
      type: string
      description: "Required for 'search' and 'research' actions. The query or topic to search for."
    url:
      type: string
      description: "Required for 'scrape' action. The absolute http/https URL of the target webpage to read."
  required:
    - action
---
Use this skill to access information from the internet.
- Use 'search' to quickly look up facts, recent news, or specific questions.
- Use 'research' for systematic, comprehensive investigations that require gathering data from multiple perspectives and angles. Always research before generating high-fidelity reports, articles, or spreadsheets.
- Use 'scrape' to read the full text content of a specific public article or documentation page after finding its URL.
