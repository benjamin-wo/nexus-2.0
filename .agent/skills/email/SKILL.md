---
name: email
description: Accesses the user's Gmail or Outlook/Hotmail accounts to list, search, read, send, or poll for new emails.
parameters:
  type: object
  properties:
    action:
      type: string
      enum: [list, get, send, poll]
      description: "The action to perform: 'list' to search/list recent messages, 'get' to fetch full content of a specific email, 'send' to compose and send a new email, or 'poll' to run a synchronization loop checking for new receipt/bank alert emails."
    provider:
      type: string
      enum: [gmail, outlook, all]
      description: "The email provider to target: 'gmail', 'outlook' (for Outlook/Hotmail), or 'all' (only valid/default for 'poll' action)."
    q:
      type: string
      description: "Optional for 'list' and 'poll' actions. Search/filter query string (e.g. Gmail query format 'from:boss' or keyword like 'receipt')."
    messageId:
      type: string
      description: "Required for 'get' action. The unique ID of the target email message."
    to:
      type: string
      description: "Required for 'send' action. The recipient email address."
    subject:
      type: string
      description: "Required for 'send' action. The email subject line."
    body:
      type: string
      description: "Required for 'send' action. The plain text body content."
  required:
    - action
---
Use this skill when the user asks to check their emails, list recent messages, fetch email details, send emails, or sync their inboxes.
- Be provider-aware: check if the user specified Gmail vs Outlook or if they have connected accounts. If they connected Google, use provider 'gmail'. If Microsoft, use provider 'outlook'.
- For the 'poll' action, you can optionally pass a custom search query in 'q' to check specific email filters on-the-fly (e.g., checks only UOB alerts or Gojek receipts).
- If the tool returns a NOT_AUTHENTICATED error for Gmail, output the auth URL link directly to the user.
- If it returns account not authorized for Outlook, tell the user to run `/authorize_outlook` to link their account.
