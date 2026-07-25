---
name: logImprovement
description: Use this skill when the user reports a bug, issue, codebase feature, or enhancement. It will parse their request and log it into the PostgreSQL database for tracking and fixing.
---

# Log Improvement & Bug Report Skill

This skill allows you to capture user-reported bugs, system issues, or feature improvements and store them safely in the PostgreSQL database.

## When to Use
- The user reports a bug, exception, crash, or unexpected behavior.
- The user says "we should add dark mode".
- The user suggests a feature or architectural fix to log for development.

## What it Does
This skill executes a simple bun script that calls `StorageService.logEvent()` to insert a new entry into the PostgreSQL database `logs` table.

## How to use

1. Run the following command using the `run_command` tool.
   - For **Bug Reports**: pass category `"BUG_REPORT"` and `isError: true`.
   - For **Feature Improvements**: pass category `"IMPROVEMENT"` and `isError: false`.

```bash
bun eval 'import { StorageService } from "./src/database/Storage.ts"; const s = new StorageService(); await s.initialize(); await s.logEvent({ category: process.argv[1], message: process.argv[2], details: process.argv[3], isError: process.argv[4] === "true" }); await s.close();' "[BUG_REPORT|IMPROVEMENT]" "[summary]" "[details]" "[true|false]"
```

2. Confirm to the user that their bug report or feature request has been recorded into the database!
