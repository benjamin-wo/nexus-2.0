---
name: expenses
description: Manages personal budget and bills by logging new expenses, listing logged transactions, or splitting group bills with friends.
parameters:
  type: object
  properties:
    action:
      type: string
      enum: [log, list, split]
      description: "The action to perform: 'log' to record a personal expense, 'list' to view recent transactions, or 'split' to log a group bill and split it among friends."
    amount:
      type: number
      description: "Used by 'log'. The numeric value of the expense (e.g. 14.50)."
    category:
      type: string
      description: "Used by 'log' and 'split'. Expense category (e.g. Food, Transport, Entertainment, Shopping, Bills, Others). Default: Food."
    description:
      type: string
      description: "Used by 'log' and 'split'. Descriptive explanation of the transaction."
    date:
      type: string
      description: "Used by 'log'. Optional transaction date in YYYY-MM-DD format (defaults to today)."
    totalAmount:
      type: number
      description: "Used by 'split'. The total bill amount paid upfront (e.g. 100)."
    myShare:
      type: number
      description: "Used by 'split'. The user's net personal share of the bill (e.g. 25)."
    splits:
      type: array
      items:
        type: object
        properties:
          name:
            type: string
            description: "Friend's name who owes money (e.g. 'Alice')."
          amount:
            type: number
            description: "Amount owed by this friend (e.g. 25)."
        required: [name, amount]
      description: "Used by 'split'. List of friends and the amounts they owe."
  required:
    - action
---
Use this skill for logging personal expenses, viewing budget history, or recording group tabs where friends owe the user money.
- When the user asks to split a bill or group tab, use action 'split' and specify split amounts. This logs only your net personal share to expenses and records pending reimbursements for each friend.
- After successfully splitting a bill, tell the user they can check active receivables by typing `/owed` anytime.
- When the user asks to see what they spent or analyze their budget, use action 'list'.
