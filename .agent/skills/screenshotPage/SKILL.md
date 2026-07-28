---
name: screenshotPage
description: Renders an HTML string in a headless browser and returns a screenshot image, so you can visually inspect a page before publishing it. Use this once a draft page is ready, near the end of your reasoning, to self-critique the design against the frontend-design guidelines before calling hostHtmlPage.
parameters:
  type: object
  properties:
    htmlContent:
      type: string
      description: Complete, valid HTML content string to render (including tags like <!DOCTYPE html>, <html>, <head>, <body>, etc.) - same shape as hostHtmlPage's htmlContent.
    viewport:
      type: string
      enum: [desktop, mobile]
      description: Which viewport to render at - 'desktop' (1280x800) or 'mobile' (390x844). Defaults to 'desktop'. Use 'mobile' to specifically verify responsive behavior.
  required:
    - htmlContent
---
Call this only once a draft is ready to verify, ideally near the end of your reasoning - each call attaches an image to the conversation, and every subsequent turn in this reasoning loop re-sends that image, so calling it early or repeatedly is costly.

The returned screenshot is attached as an image you can see in your next turn. Compare what you see against the frontend-design guidelines (accessibility, responsive layout, typography, avoiding generic AI aesthetics) and revise the HTML if something is visibly wrong - poor contrast, overflowing/clipped content, a broken layout, leftover `[placeholder]` text. If it looks right, proceed to call `hostHtmlPage` to actually publish it.

This does not write anything to disk or the public site - it only renders in-memory and returns an image, so it's safe to call on drafts before deciding they're ready to publish.
