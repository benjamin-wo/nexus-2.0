---
name: outlookEmail
description: Accesses the user's Outlook or Hotmail inbox via Microsoft Graph REST API to list, search, or read recent emails.
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
Use this skill whenever the user asks to check, read, search, or inspect their Outlook, Hotmail, or Microsoft emails.

IMPORTANT:
- This tool automatically connects to Microsoft Graph API using the user's OAuth credentials.
- Do NOT say you lack Outlook access or demand Graph tokens. Always execute `outlookEmail` directly!
