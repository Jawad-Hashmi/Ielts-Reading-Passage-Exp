import { JSDOM } from "jsdom";

export const countWords = (text) =>
  text.trim().split(/\s+/u).filter(Boolean).length;

export const extractParagraphs = ({
  content,
  sourceUrl,
  sourceIndex,
  maxCharacters,
}) => {
  const dom = new JSDOM(content);

  try {
    const elements = dom.window.document.querySelectorAll("p");

    const paragraphs = [];
    let totalCharacters = 0;

    for (const element of elements) {
      const text = element.textContent.trim();

      if (!text) continue;

      if (totalCharacters + text.length > maxCharacters) {
        break;
      }

      paragraphs.push({
        id: `source${sourceIndex + 1}-p${paragraphs.length + 1}`,
        text,
        wordCount: countWords(text),
        sourceUrl,
      });

      totalCharacters += text.length;
    }

    return paragraphs;
  } finally {
    dom.window.close();
  }
};

export const assemblePassages = ({ selections, sources, passageLimits }) => {
  const paragraphMap = new Map();

  for (const source of sources) {
    for (const paragraph of source.paragraphs) {
      if (paragraphMap.has(paragraph.id)) {
        throw new Error(`Duplicate paragraph ID: ${paragraph.id}`);
      }

      paragraphMap.set(paragraph.id, paragraph);
    }
  }

  const usedIds = new Set();
  const usedPassageNumbers = new Set();
  const usedTopics = new Set();

  return selections
    .map((selection) => {
      const { passage, topic, selectedParagraphIds } = selection;

      if (usedPassageNumbers.has(passage)) {
        throw new Error(`Duplicate passage: ${passage}`);
      }
      usedPassageNumbers.add(passage);

      const normalizedTopic = topic.trim().toLowerCase();

      if (usedTopics.has(normalizedTopic)) {
        throw new Error(`Duplicate topic: ${topic}`);
      }
      usedTopics.add(normalizedTopic);

      const limits = passageLimits[`passage${passage}`];

      const selected = selectedParagraphIds.map((id) => {
        const paragraph = paragraphMap.get(id);

        if (!paragraph) {
          throw new Error(`Unknown paragraph: ${id}`);
        }

        if (usedIds.has(id)) {
          throw new Error(`Repeated paragraph: ${id}`);
        }

        usedIds.add(id);
        return paragraph;
      });

      if (selected.length !== limits.paragraphs) {
        throw new Error(
          `Passage ${passage} requires ${limits.paragraphs} paragraphs`,
        );
      }

      const text = selected.map((p) => p.text).join("\n\n");

      const wordCount = countWords(text);

      if (wordCount > limits.maxWords) {
        throw new Error(`Passage ${passage} exceeds its word limit`);
      }

      return {
        passage,
        topic,
        text,
        wordCount,
        paragraphs: selected.length,
        sources: [...new Set(selected.map((p) => p.sourceUrl))],
      };
    })
    .sort((a, b) => a.passage - b.passage);
};
