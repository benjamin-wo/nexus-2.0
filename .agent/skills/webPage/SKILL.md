---
name: webPage
description: Retrieves HTML templates, hosts pages locally, or reviews local HTML pages against design/accessibility guidelines.
parameters:
  type: object
  properties:
    action:
      type: string
      enum: [template, host, review]
      description: "The layout/hosting action to perform. 'template' to fetch layouts/styles, 'host' to publish an HTML string, or 'review' to audit a local HTML file against best practices."
    layoutType:
      type: string
      enum: [magazine, keynote, socialCard, dataReport, itinerary]
      description: "Required for 'template' action. The layout style to generate."
    fileName:
      type: string
      description: "Required for 'host' action. The unique name ending in .html (e.g. 'q3-report.html'). Never use index.html, style.css, or app.js."
    htmlContent:
      type: string
      description: "Required for 'host' action. The full, valid HTML content string to host."
    targetFile:
      type: string
      description: "Required for 'review' action. The relative workspace path to the file to audit (e.g., 'src/public/itinerary.html')."
  required:
    - action
---
Use this skill when generating visual layouts, publishing dynamic travel itineraries/dashboards, or checking compliance of generated frontends against accessibility and responsive design systems.
- Use 'template' to retrieve structural snippets and design pairings.
- Use 'host' to write and host the final page on the local server.
- Use 'review' to audit HTML and get detailed suggestions for design/contrast/accessibility improvements.
