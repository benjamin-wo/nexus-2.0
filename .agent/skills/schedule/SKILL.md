---
name: schedule
description: Schedules a background notification or recurring cron alarm event. Can schedule automated tasks/commands.
parameters:
  type: object
  properties:
    duration:
      type: string
      description: |
        For one-time reminders. Pass an absolute ISO date string OR relative time (e.g. `5 minutes`).
        Formats: `[number] [unit]`, where unit is `s`, `m`, `h`, `d`.
        Examples: `10 minutes`, `2 hours`, `3 days`, `2026-10-28T09:00:00Z`.
    cron:
      type: string
      description: |
        For recurring tasks/reminders using standard 5-field cron syntax: `[minute] [hour] [dayOfMonth] [month] [dayOfWeek]`.
        Examples:
        - `0 9 * * *` (every day at 9:00 AM)
        - `0 9 * * 1` (every Monday at 9:00 AM)
        - `30 8 * * 1-5` (every weekday at 8:30 AM)
        - `*/15 * * * *` (every 15 minutes)
    message:
      type: string
      description: |
        The text description or prompt.
        If you want to run an automated command/workflow (e.g., polling email or logging a summary), prefix the message with `[TASK]`.
        Examples:
        - `[TASK] pollEmails` (triggers on-demand email polling)
        - `[TASK] check my Outlook emails`
        - `Remember to call mom` (regular user reminder)
  required:
    - message
---
Use this tool when users ask to set one-time reminders, recurring alerts, or recurring scheduled tasks (like checking emails).
- If scheduling a task/action, prefix the `message` with `[TASK]`.
- Must specify either `duration` (for one-off execution) or `cron` (for recurring execution).
- Confirm the precise scheduled execution time / frequency with the user.

## Travel and Transit Proactive Integration
- **Proactive Directions**: If the appointment or reminder includes a specific location or venue (e.g., "at Pasir Ris" or "at Orchard Road"), use the `maps` skill (action: `getDirections` or `searchPlaces`) to check travel directions and estimated travel times from a logical starting point (defaulting to a central hub like "Changi Airport" if not specified). Append this routing summary and travel time directly to the confirmation message and the scheduled reminder message text.
- **Proactive Transit Planning**: When the user sets a reminder or appointment at a specific Singapore venue, automatically call the `maps` skill (action: `transitRoute`, passing the venue as `destination`) to fetch the nearest bus stops and live arrival times. Append the transit plan — stop names, bus numbers, and ETAs — to the confirmation and the reminder message body.

## Dynamic System Heartbeats & Monitoring
- Users can schedule periodic heartbeats or system audits using cron.
- Always use the `[TASK]` prefix to automate it.
- **Examples**:
  - `[TASK] run system health check` (triggers a periodic system audit)
  - `[TASK] poll my emails for receipts` (checks for receipts automatically)
