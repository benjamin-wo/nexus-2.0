---
name: googleCalendar
description: Accesses the user's Google Calendar to list or create events.
parameters:
  type: object
  properties:
    action:
      type: string
      enum: [listEvents, createEvent]
      description: "The action to perform: 'listEvents' to get upcoming events, or 'createEvent' to schedule a new calendar event."
    timeMin:
      type: string
      description: "Optional for 'listEvents'. ISO 8601 string (e.g., '2026-07-15T00:00:00Z') to list events starting from this time."
    summary:
      type: string
      description: "Required for 'createEvent'. The title of the calendar event."
    location:
      type: string
      description: "Optional for 'createEvent'. Event location/address."
    start:
      type: string
      description: "Required for 'createEvent'. ISO 8601 datetime string for event start (e.g. '2026-07-15T15:00:00+08:00')."
    end:
      type: string
      description: "Required for 'createEvent'. ISO 8601 datetime string for event end (e.g. '2026-07-15T16:00:00+08:00')."
  required:
    - action
---
Use this skill when the user asks to schedule a meeting, create a calendar event, check their schedule, or list upcoming events.
- If the tool returns a NOT_AUTHENTICATED error, output the auth URL link directly to the user so they can authenticate.
- If this skill returns a Google API error (e.g., status 403, 400, or 401), report the exact error message, description, and links returned by the tool directly to the user (instead of translating it to generic system issues) so they can resolve access or scopes.
