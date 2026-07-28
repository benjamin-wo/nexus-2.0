---
name: hostHtmlPage
description: Saves a custom HTML content string into a static public file so it is instantly hosted online (e.g. for travel itineraries, dynamic data views, interactive dashboards).
parameters:
  type: object
  properties:
    fileName:
      type: string
      description: The name of the HTML file, which must end in .html (e.g., 'travel-itinerary.html' or 'trip_plan.html'). Letters, numbers, hyphens, and underscores only. Never use 'index.html', 'app.js', or 'style.css' - those are reserved for the live dashboard app and will be rejected.
    htmlContent:
      type: string
      description: Complete, valid HTML content string to host (including tags like <!DOCTYPE html>, <html>, <head>, <body>, etc.).
  required:
    - fileName
    - htmlContent
---
Use this skill when the user wants to see a response or structured output (such as a travel itinerary, a report, a spreadsheet grid, or an interactive tool) as a web app, web page, or HTML file hosted directly on the server.

MANDATORY DESIGN STANDARD: The HTML content MUST be exceptionally beautiful, distinct, and follow the 'frontend-design' aesthetic rules. Avoid generic AI aesthetics (e.g., system fonts, basic white templates, or cliché purple gradients). Keep the designs highly premium, responsive, and functional.

Pages are written into a dedicated `pages/` subdirectory, kept separate from the live dashboard app (`index.html`, `app.js`, `style.css`), which this tool refuses to overwrite. Re-publishing the same `fileName` overwrites its content (the standard, expected way to update a page) - a manifest tracks when each page was first created and last updated.

Security note: generated HTML originates from the assistant's own output in response to chat requests, not from arbitrary user-pasted markup - this is a single-user personal assistant, not a multi-tenant CMS accepting untrusted third-party HTML. The tool still flags `<script src="...">` tags pointing at non-allowlisted remote domains as a `warning` in its response, as defense-in-depth.

After successfully calling this tool, provide the user with the public hosted URL. If the response includes a `warning` field (e.g. an unreachable localhost URL, or a flagged remote script), surface that warning to the user verbatim rather than silently presenting the link as shareable.

Use the `listHostedPages` skill to see what's currently published, and `cleanupHostedPages` to remove old pages.
