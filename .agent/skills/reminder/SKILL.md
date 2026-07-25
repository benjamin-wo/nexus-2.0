---
name: reminder
description: Schedules a background notification or recurring cron alarm event.
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
        For recurring reminders using standard 5-field cron syntax: `[minute] [hour] [dayOfMonth] [month] [dayOfWeek]`.
        Examples:
        - `0 9 * * *` (every day at 9:00 AM)
        - `0 9 * * 1` (every Monday at 9:00 AM)
        - `30 8 * * 1-5` (every weekday at 8:30 AM)
        - `*/15 * * * *` (every 15 minutes)
    message:
      type: string
      description: The reminder alert text content.
  required:
    - message
---
Use this tool when users ask to set one-time reminders or recurring cron notifications.
Must specify either `duration` (for one-off reminders) or `cron` (for recurring reminders).
Confirm the precise scheduled execution time / frequency with the user.
