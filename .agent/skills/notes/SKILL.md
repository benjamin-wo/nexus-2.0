---
name: notes
description: Manages personal research notes by saving new notes or retrieving the list of saved notes.
parameters:
  type: object
  properties:
    action:
      type: string
      enum: [save, list]
      description: "The action to perform: 'save' to store a new research note, or 'list' to retrieve all saved notes."
    title:
      type: string
      description: "Used by 'save'. The heading or title of the research note."
    content:
      type: string
      description: "Used by 'save'. The detailed markdown content of the note."
  required:
    - action
---
Use this skill when the user asks to save research summaries, store information, or list their saved notes.
- When the user asks to save a note, use action 'save' and provide title and content.
- When the user asks to view or list their notes, use action 'list'.
