---
name: outlookEmail
description: Accesses the user's Outlook or Hotmail inbox via IMAP to list, search, or read recent emails.
parameters:
  type: object
  properties:
    action:
      type: string
      enum: ["list", "search"]
      description: "Action to perform: 'list' to view recent emails, 'search' to filter by keyword."
    query:
      type: string
      description: "Optional keyword search query (e.g. 'receipt', 'bank', 'PayNow', 'order')."
  required: [action]
---
Use this skill whenever the user asks to check, read, or search their Outlook or Hotmail emails.

IMPORTANT: Do NOT ask the user for Microsoft Graph tokens, Graph Explorer access tokens, or OAuth links. This skill automatically connects to Outlook/Hotmail IMAP using OUTLOOK_EMAIL and OUTLOOK_APP_PASSWORD configured on the server. Always call this tool directly when asked about Outlook or Hotmail.
