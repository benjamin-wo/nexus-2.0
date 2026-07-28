---
name: cleanupHostedPages
description: Deletes a specific hosted HTML page by file name, or all hosted pages older than a given number of days. Use when the user explicitly asks to remove, delete, or clean up a previously hosted page, or to clear out old/stale published pages.
parameters:
  type: object
  properties:
    fileName:
      type: string
      description: The specific hosted file to delete (e.g. 'travel-itinerary.html'). Omit this to instead delete all pages older than olderThanDays.
    olderThanDays:
      type: number
      description: When fileName is omitted, delete all pages whose manifest updatedAt is older than this many days. Required if fileName is omitted.
  required: []
---
Always confirm with the user which page(s) will be deleted before or after calling this - deletion is not automatic/scheduled, it only ever runs when explicitly requested in this conversation. Use 'listHostedPages' first if you need to check what exists or how old it is.
