const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const renderParagraphs = (text) => text
  .split(/\n\s*\n/u)
  .map((paragraph) => paragraph.trim())
  .filter(Boolean)
  .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
  .join("\n");

export const renderPassagesHtml = (result) => {
  const passages = result.passages.map((passage) => `
    <article class="passage">
      <header>
        <p class="eyebrow">Passage ${passage.passage}</p>
        <h2>${escapeHtml(passage.topic)}</h2>
        <p class="meta">${passage.wordCount} words · ${passage.paragraphs} paragraphs</p>
      </header>
      <div class="passage-text">${renderParagraphs(passage.text)}</div>
      <footer>
        <h3>Sources</h3>
        <ol>${passage.citations.map((citation) => `
          <li><a href="${escapeHtml(citation.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(citation.title)}</a></li>
        `).join("")}</ol>
      </footer>
    </article>
  `).join("\n");

  const cost = result.cost?.total || {};
  const topics = result.discoveredTopics?.length
    ? `<p><strong>Discovered topics:</strong> ${escapeHtml(result.discoveredTopics.join(", "))}</p>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>IELTS Reading Passages — Run ${escapeHtml(result.runId)}</title>
  <style>
    :root { color-scheme: light; font-family: Arial, Helvetica, sans-serif; color: #202733; background: #f3f5f8; }
    body { max-width: 900px; margin: 0 auto; padding: 32px 20px 64px; line-height: 1.7; }
    main { background: #fff; border-radius: 12px; padding: 32px; box-shadow: 0 4px 24px #1b273512; }
    h1, h2, h3 { line-height: 1.25; }
    h1 { margin-top: 0; }
    .summary, .meta { color: #5c6675; }
    .passage { border-top: 1px solid #dce1e8; margin-top: 32px; padding-top: 24px; }
    .eyebrow { color: #315f9d; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 4px; }
    .passage-text p { margin: 0 0 1em; }
    a { color: #175db3; overflow-wrap: anywhere; }
    footer { background: #f7f9fb; padding: 12px 18px; border-radius: 8px; }
    footer h3 { margin: 0; }
    @media print { :root { background: #fff; } body { padding: 0; } main { box-shadow: none; padding: 0; } }
  </style>
</head>
<body>
  <main>
    <h1>IELTS Reading Passages</h1>
    <p class="summary">Run ${escapeHtml(result.runId)} · ${escapeHtml(result.status)} · Model ${escapeHtml(result.model)}</p>
    <p class="summary">${result.usage?.totalTokens ?? "Unknown"} tokens · Search calls: ${result.usage?.searchSummary?.toolActions ?? "Unknown"} · Cost: $${cost.usd ?? "unknown"} / PKR ${cost.pkr ?? "unknown"}</p>
    ${topics}
    ${passages || "<p>No passages were generated for this run.</p>"}
  </main>
</body>
</html>
`;
};
