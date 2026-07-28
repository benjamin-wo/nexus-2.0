---
name: sysAdmin
description: DevOps and system administration helper to read execution logs and record bug reports or feature improvements in the database.
parameters:
  type: object
  properties:
    action:
      type: string
      enum: [readLogs, logImprovement]
      description: "The system action: 'readLogs' to retrieve recent event logs, or 'logImprovement' to save a bug report or feature request."
    limit:
      type: number
      description: "Used by 'readLogs'. Max number of entries to retrieve. Default: 20."
    category:
      type: string
      enum: [BUG_REPORT, IMPROVEMENT]
      description: "Used by 'logImprovement'. Type of system event: BUG_REPORT or IMPROVEMENT."
    message:
      type: string
      description: "Used by 'logImprovement'. Summary of the issue or feature request."
    details:
      type: string
      description: "Used by 'logImprovement'. Detailed description, steps to reproduce, or stack trace."
    isError:
      type: boolean
      description: "Used by 'logImprovement'. Whether this represents a system error."
  required:
    - action
---
Use this skill for DevOps introspection, reading logs, debugging errors, or recording bugs/enhancement suggestions.
