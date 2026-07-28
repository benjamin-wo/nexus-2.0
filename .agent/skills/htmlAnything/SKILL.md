---
name: htmlAnything
description: Retrieves templates, CSS design frameworks, and structured HTML examples for html-anything surfaces (magazine, keynote, socialCard, dataReport, itinerary). Use this when generating visually stunning documents, slides, dashboards, itineraries, or posters to get premium layout structures.
parameters:
  type: object
  properties:
    layoutType:
      type: string
      enum: [magazine, keynote, socialCard, dataReport, itinerary]
      description: "The desired layout type: 'magazine' for editorial print articles, 'keynote' for presentation slides, 'socialCard' for high-impact visual cards, 'dataReport' for clean dashboard metrics, or 'itinerary' for day-by-day travel/event timelines."
  required:
    - layoutType
---
Use this skill when you want to retrieve clean CSS frameworks, Google Fonts imports, and boilerplate HTML layouts for specific design surfaces. Every template returns bracketed `[placeholder]` text marked with an HTML comment above it — replace every placeholder with the user's actual content before publishing; never leave `[Placeholder]`-style text in the final page. You can then populate these boilerplates with the user's specific content and save them using 'hostHtmlPage'.
