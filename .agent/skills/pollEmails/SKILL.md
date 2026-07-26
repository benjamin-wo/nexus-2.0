---
name: pollEmails
description: Triggers an on-demand email polling cycle across connected accounts (Gmail and Outlook/Hotmail) to check for new transaction receipts and bank alerts.
parameters:
  type: object
  properties:
    provider:
      type: string
      enum: ["all", "outlook", "gmail"]
      description: "Email provider to poll ('all' by default, or 'outlook' / 'gmail')."
  required: []
---
Use this skill whenever the user asks to poll, fetch, or sync new emails, or when a scheduled workflow checks for new receipt emails.
