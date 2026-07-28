// @ts-nocheck
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function markdownToHtml(markdown: string): string {
  let html = escapeHtml(markdown);
  const placeholders: string[] = [];

  // Code blocks
  html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
    const lines = code.split("\n");
    if (lines.length > 0 && /^[a-zA-Z0-9_-]+$/.test(lines[0].trim())) {
      lines.shift();
    }
    placeholders.push(`<pre><code>${lines.join("\n").trim()}</code></pre>`);
    return `@@@PLACEHOLDER${placeholders.length - 1}@@@`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, (match, code) => {
    placeholders.push(`<code>${code}</code>`);
    return `@@@PLACEHOLDER${placeholders.length - 1}@@@`;
  });

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
    placeholders.push(url);
    return `<a href="@@@PLACEHOLDER${placeholders.length - 1}@@@">${text}</a>`;
  });

  // Formatting
  html = html.replace(/(?<!\*)\*\*(?!\*)(?=\S)([\s\S]*?)(?<=\S)\*\*(?!\*)/g, "<b>$1</b>");
  html = html.replace(/(?<!\*)\*(?!\*)(?=\S)([\s\S]*?)(?<=\S)\*(?!\*)/g, "<i>$1</i>");
  html = html.replace(/(?<!_)_(?!_)(?=\S)([\s\S]*?)(?<=\S)_(?!_)/g, "<i>$1</i>");
 
  // Restore placeholders
  for (let i = 0; i < placeholders.length; i++) {
    html = html.replace(`@@@PLACEHOLDER${i}@@@`, () => placeholders[i]);
  }

  return html;
}

const input = `👉 [**Authorize** _Nexus_ Assistant](https://accounts.google.com/o/oauth2/v2/auth?client_id=877152309714-c04dfn5qjqiq4ge4tj1fb3e2aernl293.apps.googleusercontent.com&redirect_uri=https%3A%2F%2Fnexus-assistant-production-52a2.up.railway.app%2Fapi%2Foauth%2Fcallback&response_type=code&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.modify%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.labels%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.send%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar&state=-1004331094172&access_type=offline&prompt=consent)`;
console.log(markdownToHtml(input));
