---
name: listHostedPages
description: Lists all HTML pages currently published via hostHtmlPage, including when each was created/updated and whether it looks stale. Use when asked what pages are hosted, to check for old pages before cleaning up, or to find the URL of something previously published.
parameters:
  type: object
  properties:
    olderThanDays:
      type: number
      description: Optional. Flag pages last updated more than this many days ago as stale. Defaults to 30.
  required: []
---
Use this skill to see everything currently hosted under the pages/ directory before deciding whether to publish something new, re-publish, or clean up old pages with 'cleanupHostedPages'.
