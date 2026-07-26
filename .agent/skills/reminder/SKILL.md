---
name: reminder
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
