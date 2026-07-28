---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, artifacts, posters, or applications (examples include websites, landing pages, dashboards, React components, HTML/CSS layouts, or when styling/beautifying any web UI). Generates creative, polished code and UI design that avoids generic AI aesthetics.
license: Complete terms in LICENSE.txt
---

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

## Output Requirements

Name entry files for their content (e.g. `travel-itinerary.html`, `q3-report.html`). **Never** name a generated file `index.html`, `app.js`, or `style.css` — those are reserved for the assistant's own live dashboard app and publishing a page under one of those names would silently overwrite it. When publishing via `hostHtmlPage`, files are written into a dedicated `pages/` subdirectory specifically to keep generated content separate from the real app.

## Verifying Your Work

Once a draft is otherwise ready, use the `screenshotPage` skill to render it and see an actual screenshot before publishing. Compare what you see against this skill's guidance - contrast, layout, responsive behavior, leftover placeholder text - and revise if something looks wrong. Then call `hostHtmlPage` to publish. See `screenshotPage`'s own instructions for when in the reasoning flow to call it (late, not early - each call is costly to repeat).

## Existing Visual System

This product already ships a coherent, proven visual system at `src/public/style.css` — a dark glassmorphism aesthetic built on CSS custom properties (background gradient, panel background/border, card shadow, primary/secondary text, primary/secondary accent, sans-serif font stack) plus a `.glass-container`/`.glass-card` pattern and Telegram theme-variable overrides. For most standalone pages (dashboards, reports, itineraries, general utility pages), treat this as the **default aesthetic base** — reuse its token names and glass-panel pattern rather than inventing a wholly new palette from scratch each time, so output feels like it belongs to the same product. Read the actual current values from `src/public/style.css` at generation time rather than assuming specific hex codes, since they may change.

Deviating from this base is still encouraged and expected for one-off editorial, travel, social-card, or other clearly distinct-purpose pages (see "Design Thinking" below) — the point is to have a grounded default, not a straitjacket.

## Design Thinking

Before coding, understand the context and commit to a BOLD aesthetic direction:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, etc. There are so many flavors to choose from. Use these for inspiration but design one that is true to the aesthetic direction.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work - the key is intentionality, not intensity.

Then implement working code (HTML/CSS/JS, React, Vue, etc.) that is:
- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

## Frontend Aesthetics Guidelines

Focus on:
- **Typography**: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics; unexpected, characterful font choices. Pair a distinctive display font with a refined body font. See "Typography Pairings" below for the specific pairings already in use in this product.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.
- **Motion**: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions. Use scroll-triggering and hover states that surprise. Always wrap non-essential motion in `@media (prefers-reduced-motion: reduce)` (see Accessibility below).
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density.
- **Backgrounds & Visual Details**: Create atmosphere and depth rather than defaulting to solid colors. Add contextual effects and textures that match the overall aesthetic. Apply creative forms like gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, custom cursors, and grain overlays.

NEVER use generic AI-generated aesthetics like overused font families (Inter, Roboto, Arial, system fonts), cliched color schemes (particularly purple gradients on white backgrounds), predictable layouts and component patterns, and cookie-cutter design that lacks context-specific character.

Interpret creatively and make unexpected choices that feel genuinely designed for the context. No design should be the same. Vary between light and dark themes, different fonts, different aesthetics. NEVER converge on common choices (Space Grotesk, for example) across generations.

**IMPORTANT**: Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details. Elegance comes from executing the vision well.

## Accessibility

Every generated interface must meet a baseline accessibility bar, regardless of aesthetic direction:
- **Contrast**: WCAG AA minimums — 4.5:1 for body text, 3:1 for large text (18pt+/14pt+ bold) and UI components. Double-check contrast on low-opacity glass panels and gradient backgrounds specifically, since these are the most common failure point.
- **Semantic structure**: Use real landmark elements (`header`, `nav`, `main`, `footer`, `section`) instead of generic `div` soup. Use heading levels (`h1`-`h6`) in logical order, not for visual size alone.
- **Images**: Every `<img>` needs meaningful `alt` text (or `alt=""` if purely decorative).
- **Focus states**: Never remove `outline`/focus styling without providing a clearly visible custom `:focus-visible` replacement — keyboard users must always be able to see where they are.
- **Motion**: Wrap non-essential animation/parallax/autoplay in `@media (prefers-reduced-motion: reduce) { ... }` so it's disabled for users who've opted out at the OS level.
- **ARIA**: Only add ARIA attributes where semantic HTML genuinely isn't enough (e.g. `aria-expanded`/`aria-controls` on accordion triggers). Prefer the native semantic element over an ARIA-patched `div` whenever one exists.

## Responsive / Mobile

Every generated page must work from small phones up, not just desktop:
- Design mobile-first: base styles for small screens, then layer up with `min-width` media queries at common breakpoints (roughly 480px, 768px, 1024px) rather than only testing one viewport.
- Touch targets (buttons, links, form controls) should be at least 44x44px.
- Use fluid type via `clamp()` (e.g. `font-size: clamp(1.5rem, 4vw, 3rem)`) instead of fixed pixel sizes for headings, so text scales smoothly across viewports.
- Avoid fixed-pixel-width primary containers — prefer `max-width` + fluid width (`min(600px, 90vw)`-style patterns) so layouts don't overflow or get clipped on narrow screens.

## Interaction & Rich Media Protocols

- **Interactive Components**: Every hosted page MUST feel alive and interactive. Use Vanilla JS to build tab switchers, search filter inputs, expandable FAQs/accordions, modal details popups, or hover-revealed details cards.
- **Rich Visuals & Real Images**: DO NOT leave image placeholders or use blank spaces. Default to `https://picsum.photos/seed/<descriptive-slug>/<width>/<height>` (Lorem Picsum) for embedded photography — it's seed-based and deterministic, so it cannot 404 the way a guessed Unsplash photo ID can. Use a descriptive slug for the seed (e.g. `seed/barcelona-street-cafe/800/600`) so repeated seeds stay visually consistent within one page. Only use a literal Unsplash `photo-<id>` URL for a handful of well-known, stable IDs you're highly confident actually exist; if in doubt, prefer Picsum or a CSS-generated background (gradient mesh, SVG pattern) instead of guessing.
- **Micro-Animations**: Add entry animations (staggered transitions using \`animation-delay\` or \`@keyframes fade-in-up\`) so the UI loads elegantly. Use smooth scroll behaviors and reactive hover transitions on buttons and interactive elements. Respect `prefers-reduced-motion` per the Accessibility section above.

## Typography Pairings

These pairings are already in use by the `htmlAnything` skill's layout templates — reuse them for consistency, or pick your own distinctive pairing for a bespoke page:
- **Playfair Display** (Serif Heading) + **Lora** (Serif Body) — editorial, print, travel guides (`magazine` template).
- **Outfit** (Sans Heading) + **Space Grotesk** (Sans Accent) — tech/product, dark decks (`keynote` template).
- **Fraunces** (Serif Display) + **Plus Jakarta Sans** (Sans Body) — quote cards, social/share graphics (`socialCard` template).
- **DM Sans** (Sans Body) + **JetBrains Mono** (Monospace, for metrics/numbers) — dashboards, data reports (`dataReport` template).

## Premium Design Code Recipes

Use the following modern CSS patterns to make interfaces look premium and custom-coded:

### 1. Frosted Glassmorphism (Dark / Light)
Use nested semi-transparent borders and backdrops for elegant structural depth:
```css
.card-glass {
  background: rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 24px;
  box-shadow: 0 30px 60px rgba(0, 0, 0, 0.25);
  transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), 
              border-color 0.4s ease, 
              background 0.4s ease;
}
.card-glass:hover {
  transform: translateY(-8px);
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.15);
}
```
Note: low-opacity text/borders like these need a solid or semi-opaque backdrop behind them to keep contrast within the Accessibility guidelines above — don't place body text directly on the most transparent layer.

### 2. Aura Ambient Backgrounds (Modern Dark Mode)
Never use flat black or white backgrounds. Use subtle, non-distracting gradient meshes:
```css
body {
  background-color: #0b0a0e;
  background-image: 
    radial-gradient(circle at 10% 20%, rgba(255, 87, 34, 0.06) 0%, transparent 45%),
    radial-gradient(circle at 90% 80%, rgba(0, 255, 204, 0.05) 0%, transparent 50%);
  color: #e5e3ea;
  min-height: 100vh;
}
```

### 3. Interactive Accordions (CSS & JS)
Make list items expand smoothly using modern grid height tricks:
```html
<div class="accordion">
  <button class="accordion-trigger" aria-expanded="false" onclick="const c=this.nextElementSibling; const open=c.classList.toggle('open'); this.setAttribute('aria-expanded', open);">Show details</button>
  <div class="accordion-content">
    <div class="content-wrapper">Inner details text here...</div>
  </div>
</div>
<style>
  .accordion-content {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 0.3s ease-out;
    overflow: hidden;
  }
  .accordion-content.open {
    grid-template-rows: 1fr;
  }
  .content-wrapper {
    min-height: 0;
  }
</style>
```

Ensure every design element has smooth transitions, uses custom scrollbars, and includes clean spacing. Do not resort to simple black borders on white containers.

Remember: Claude is capable of extraordinary creative work. Don't hold back, show what can truly be created when thinking outside the box and committing fully to a distinctive vision.
