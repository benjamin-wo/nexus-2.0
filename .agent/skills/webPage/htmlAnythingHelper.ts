export async function execute(args: {
  layoutType: "magazine" | "keynote" | "socialCard" | "dataReport" | "itinerary";
}) {
  const { layoutType } = args;

  switch (layoutType) {
    case "magazine":
      return {
        success: true,
        layoutType,
        fonts: "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400..900;1,400..900&family=Lora:ital,wght@0,400..700;1,400..700&display=swap",
        boilerplate: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Magazine Article</title>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400..900;1,400..900&family=Lora:ital,wght@0,400..700;1,400..700&display=swap" rel="stylesheet">
  <style>
    body {
      font-family: 'Lora', Georgia, serif;
      line-height: 1.7;
      color: #1c1a17;
      padding: 3rem 1.5rem;
      max-width: 850px;
      margin: auto;
      background-color: #fdfcf7;
    }
    header {
      text-align: center;
      margin-bottom: 4rem;
      border-bottom: 2px double #e0dbcd;
      padding-bottom: 2rem;
    }
    h1 {
      font-family: 'Playfair Display', serif;
      font-size: clamp(2.2rem, 6vw, 3.5rem);
      font-weight: 900;
      line-height: 1.15;
      margin-bottom: 1.5rem;
      letter-spacing: -1px;
    }
    .meta {
      font-family: 'Playfair Display', serif;
      font-style: italic;
      color: #706856;
      font-size: 1.1rem;
    }
    .lead-paragraph {
      font-size: 1.3rem;
      line-height: 1.6;
      color: #403b30;
      margin-bottom: 2.5rem;
    }
    .lead-paragraph::first-letter {
      font-family: 'Playfair Display', serif;
      font-size: 5.5rem;
      float: left;
      line-height: 0.8;
      padding-right: 12px;
      padding-top: 4px;
      font-weight: 900;
      color: #1c1a17;
    }
    .article-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 3rem;
      text-align: justify;
    }
    h2 {
      font-family: 'Playfair Display', serif;
      font-size: 1.8rem;
      font-weight: 700;
      margin-top: 2rem;
      border-top: 1px solid #e0dbcd;
      padding-top: 1rem;
    }
    a:focus-visible, button:focus-visible { outline: 3px solid #1c1a17; outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
    @media (max-width: 650px) {
      .article-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <!-- Replace with the article's actual headline -->
    <h1>[Article Headline]</h1>
    <!-- Replace with byline and publish date -->
    <div class="meta">[Byline &bull; Date]</div>
  </header>
  
  <!-- Replace with a 1-2 sentence lead/dek that hooks the reader -->
  <p class="lead-paragraph">[Lead paragraph introducing the piece.]</p>
  
  <div class="article-grid">
    <div>
      <h2>[Section One Heading]</h2>
      <!-- Replace with real section content -->
      <p>[Section one body copy.]</p>
    </div>
    <div>
      <h2>[Section Two Heading]</h2>
      <!-- Replace with real section content -->
      <p>[Section two body copy.]</p>
    </div>
  </div>
</body>
</html>`,
      };

    case "keynote":
      return {
        success: true,
        layoutType,
        fonts: "https://fonts.googleapis.com/css2?family=Outfit:wght@400;700;900&family=Space+Grotesk:wght@400;700&display=swap",
        boilerplate: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Presentation Slides</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;700;900&family=Space+Grotesk:wght@400;700&display=swap" rel="stylesheet">
  <style>
    body, html {
      margin: 0;
      padding: 0;
      background-color: #080808;
      color: #f0f0f0;
      font-family: 'Space Grotesk', sans-serif;
      scroll-snap-type: y mandatory;
      overflow-y: scroll;
      height: 100vh;
    }
    .slide {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      padding: 4rem 1.5rem;
      box-sizing: border-box;
      scroll-snap-align: start;
      position: relative;
      border-bottom: 1px solid #1a1a1a;
    }
    .slide-number {
      position: absolute;
      bottom: 1.5rem;
      right: 1.5rem;
      font-family: 'Space Grotesk', sans-serif;
      font-size: 1rem;
      color: #444;
    }
    h2 {
      font-family: 'Outfit', sans-serif;
      font-size: clamp(2.2rem, 7vw, 4.5rem);
      font-weight: 900;
      letter-spacing: -2px;
      margin: 0 0 1.5rem 0;
      background: linear-gradient(135deg, #ffffff 0%, #a3a3a3 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      text-align: center;
    }
    .content {
      max-width: 800px;
      font-size: clamp(1.1rem, 3vw, 1.6rem);
      line-height: 1.6;
      text-align: center;
      color: #999;
    }
    .highlight {
      color: #00ffcc;
      font-weight: 700;
    }
    a:focus-visible, button:focus-visible { outline: 3px solid #00ffcc; outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
  </style>
</head>
<body>
  <div class="slide">
    <!-- Replace with the deck's title slide heading -->
    <h2>[Deck Title]</h2>
    <!-- Replace with the title slide's supporting description -->
    <div class="content">[Slide description, use <span class="highlight">highlight spans</span> for key phrases.]</div>
    <div class="slide-number">01</div>
  </div>
  <div class="slide">
    <!-- Duplicate this slide block for additional slides -->
    <h2>[Slide Title]</h2>
    <div class="content">[Slide description.]</div>
    <div class="slide-number">02</div>
  </div>
</body>
</html>`,
      };

    case "socialCard":
      return {
        success: true,
        layoutType,
        fonts: "https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,600;0,900;1,600&family=Plus+Jakarta+Sans:wght@400;600;800&display=swap",
        boilerplate: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Social Media Card</title>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,600;0,900;1,600&family=Plus+Jakarta+Sans:wght@400;600;800&display=swap" rel="stylesheet">
  <style>
    body {
      margin: 0;
      background-color: #121214;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      font-family: 'Plus Jakarta Sans', sans-serif;
      padding: 1.5rem;
      box-sizing: border-box;
    }
    .card {
      width: min(420px, 92vw);
      aspect-ratio: 3 / 4;
      padding: clamp(1.5rem, 5vw, 2.5rem);
      background: linear-gradient(135deg, #ff5722 0%, #ff9800 100%);
      border-radius: 32px;
      box-shadow: 0 30px 60px rgba(255, 87, 34, 0.25);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      box-sizing: border-box;
      position: relative;
      overflow: hidden;
    }
    .card::before {
      content: '';
      position: absolute;
      top: -50%;
      left: -50%;
      width: 200%;
      height: 200%;
      background: radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 60%);
      pointer-events: none;
    }
    .badge {
      align-self: flex-start;
      background-color: rgba(0, 0, 0, 0.85);
      color: #fff;
      padding: 6px 16px;
      border-radius: 99px;
      font-weight: 700;
      font-size: 0.85rem;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
    .quote {
      font-family: 'Fraunces', serif;
      font-size: clamp(1.5rem, 5vw, 2.4rem);
      font-weight: 600;
      font-style: italic;
      color: #ffffff;
      line-height: 1.3;
      margin: 0;
      text-shadow: 0 2px 10px rgba(0,0,0,0.15);
    }
    .footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: rgba(255,255,255,0.9);
      font-size: 1rem;
      font-weight: 600;
    }
    .brand {
      opacity: 0.85;
    }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
  </style>
</head>
<body>
  <div class="card">
    <!-- Replace with a short category/context label -->
    <div class="badge">[Label]</div>
    <!-- Replace with a 1-2 sentence pull quote relevant to the user's content -->
    <p class="quote">"[Pull quote goes here.]"</p>
    <div class="footer">
      <!-- Replace with attribution -->
      <span>[Attribution]</span>
      <!-- Replace with brand/source name -->
      <span class="brand">[Brand]</span>
    </div>
  </div>
</body>
</html>`,
      };

    case "dataReport":
      return {
        success: true,
        layoutType,
        fonts: "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=JetBrains+Mono:wght@400;700&display=swap",
        boilerplate: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Data Report Dashboard</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
  <style>
    body {
      font-family: 'DM Sans', sans-serif;
      background-color: #0b0a12;
      color: #e2e1ec;
      padding: 2.5rem 1.5rem;
      max-width: 1100px;
      margin: auto;
    }
    header {
      margin-bottom: 3rem;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 1.5rem;
      justify-content: space-between;
      align-items: baseline;
      border-bottom: 1px solid rgba(255,255,255,0.1);
      padding-bottom: 1.5rem;
    }
    h1 {
      font-size: clamp(1.5rem, 4vw, 2rem);
      font-weight: 700;
      margin: 0;
    }
    .date {
      color: #7b7890;
      font-family: 'JetBrains Mono', monospace;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 2rem;
    }
    .card {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      padding: 2rem;
      border-radius: 20px;
      backdrop-filter: blur(12px);
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    }
    .card-title {
      font-size: 1rem;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #9491a8;
      margin-bottom: 1rem;
      font-weight: 500;
    }
    .metric {
      font-family: 'JetBrains Mono', monospace;
      font-size: clamp(1.8rem, 5vw, 2.5rem);
      font-weight: 700;
      color: #4ce8c9;
      margin: 0;
    }
    .subtext {
      font-size: 0.95rem;
      color: #9491a8;
      margin-top: 0.8rem;
    }
    .trend-up { color: #39e58c; }
    .trend-down { color: #ff5e62; }
    a:focus-visible, button:focus-visible { outline: 3px solid #4ce8c9; outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
  </style>
</head>
<body>
  <header>
    <!-- Replace with the report's title -->
    <h1>[Report Title]</h1>
    <!-- Replace with the reporting period -->
    <div class="date">[REPORTING PERIOD]</div>
  </header>
  
  <div class="grid">
    <div class="card">
      <!-- Duplicate this card block per metric -->
      <div class="card-title">[Metric Name]</div>
      <p class="metric">[Value]</p>
      <div class="subtext"><span class="trend-up">[&uarr; change]</span> [context]</div>
    </div>
    <div class="card">
      <div class="card-title">[Metric Name]</div>
      <p class="metric">[Value]</p>
      <div class="subtext"><span class="trend-down">[&darr; change]</span> [context]</div>
    </div>
  </div>
</body>
</html>`,
      };

    case "itinerary":
      return {
        success: true,
        layoutType,
        fonts: "https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap",
        boilerplate: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Travel Itinerary</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-gradient: linear-gradient(135deg, #0f0c20 0%, #15102a 50%, #090614 100%);
      --panel-bg: rgba(255, 255, 255, 0.04);
      --panel-border: rgba(255, 255, 255, 0.08);
      --text-primary: #f3f4f6;
      --text-secondary: #9ca3af;
      --accent-primary: #a78bfa;
    }
    body {
      margin: 0;
      font-family: 'Outfit', sans-serif;
      background: var(--bg-gradient);
      color: var(--text-primary);
      padding: 2rem 1.25rem 4rem;
    }
    .trip-header {
      max-width: 720px;
      margin: 0 auto 3rem;
      text-align: center;
    }
    .trip-header h1 {
      font-size: clamp(2rem, 6vw, 3rem);
      font-weight: 800;
      margin: 0 0 0.5rem;
    }
    .trip-header .dates {
      color: var(--text-secondary);
      font-size: 1.1rem;
    }
    .timeline {
      max-width: 720px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }
    .day-card {
      background: var(--panel-bg);
      border: 1px solid var(--panel-border);
      border-radius: 20px;
      padding: 1.75rem;
      backdrop-filter: blur(16px);
    }
    .day-card .day-label {
      display: inline-block;
      background: var(--accent-primary);
      color: #14101f;
      font-weight: 700;
      font-size: 0.85rem;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      padding: 4px 14px;
      border-radius: 99px;
      margin-bottom: 0.75rem;
    }
    .day-card h2 {
      margin: 0 0 1rem;
      font-size: 1.4rem;
      font-weight: 600;
    }
    .activity {
      display: flex;
      gap: 1rem;
      padding: 0.75rem 0;
      border-top: 1px solid var(--panel-border);
    }
    .activity:first-of-type { border-top: none; }
    .activity .time {
      flex: 0 0 auto;
      font-variant-numeric: tabular-nums;
      color: var(--text-secondary);
      min-width: 4.5rem;
    }
    .activity .detail p {
      margin: 0.25rem 0 0;
      color: var(--text-secondary);
      font-size: 0.95rem;
    }
    a:focus-visible, button:focus-visible { outline: 3px solid var(--accent-primary); outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
    @media (max-width: 480px) {
      .activity { flex-direction: column; gap: 0.25rem; }
    }
  </style>
</head>
<body>
  <div class="trip-header">
    <!-- Replace with the trip's destination/title -->
    <h1>[Trip Title]</h1>
    <!-- Replace with the trip's date range -->
    <div class="dates">[Start Date] &ndash; [End Date]</div>
  </div>

  <div class="timeline">
    <!-- Duplicate this day-card block for each day of the trip -->
    <div class="day-card">
      <span class="day-label">[Day 1]</span>
      <h2>[Day 1 Location/Theme]</h2>
      <div class="activity">
        <div class="time">[9:00 AM]</div>
        <div class="detail">
          <strong>[Activity Name]</strong>
          <p>[Short description or address.]</p>
        </div>
      </div>
      <div class="activity">
        <div class="time">[1:00 PM]</div>
        <div class="detail">
          <strong>[Activity Name]</strong>
          <p>[Short description or address.]</p>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`,
      };

    default:
      throw new Error(`Unsupported layout type: ${layoutType}`);
  }
}
