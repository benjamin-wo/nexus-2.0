---
name: splitBill
description: Splits a group bill by logging your net personal share to expenses and creating pending reimbursement entries for friends.
parameters:
  type: object
  properties:
    totalAmount:
      type: number
      description: "Total bill amount paid (e.g. 100)."
    myShare:
      type: number
      description: "Your net share of the bill to record as your personal expense (e.g. 25)."
    category:
      type: string
      description: "Category for your net expense (e.g. 'Food', 'Entertainment', 'Travel'). Default: 'Food'."
    description:
      type: string
      description: "Description of the group bill (e.g. 'Jumbo Seafood Dinner')."
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
      description: "List of friends and the amounts they owe."
  required: [totalAmount, myShare, description, splits]
---
Use this skill whenever the user mentions paying for a group tab, dinner, or shared expense upfront, where friends need to pay them back. This skill logs the user's net share into their personal expense budget and records the friends' shares in the reimbursements ledger.
