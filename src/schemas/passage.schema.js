import { z } from "zod";

// Schema for a single IELTS reading passage
export const passageSchema = z.object({
  passage: z.number().int().min(1).max(3),

  topic: z.string().trim().min(1),

  text: z.string().trim().min(1),

  wordCount: z.number().int().nonnegative(),

  paragraphs: z.number().int().positive(),

  sources: z.array(z.url()).min(1),
});

// Schema for the complete AI response
export const passageOutputSchema = z.object({
  passages: z.array(passageSchema).max(3),

  notFoundTopics: z.array(z.string()),

  discoveredTopics: z.array(z.string()),
});

// The model returns paragraph IDs; source text is assembled by the server.
export const passageSelectionOutputSchema = z.object({
  passages: z
    .array(
      z.object({
        passage: z.number().int().min(1).max(3),
        topic: z.string().trim().min(1),
        selectedParagraphIds: z.array(z.string().min(1)).min(1),
      }),
    )
    .max(3),
  notFoundTopics: z.array(z.string()),
  discoveredTopics: z.array(z.string()),
});

export const passageSelectionJsonSchema = {
  type: "object",
  properties: {
    passages: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          passage: { type: "integer", enum: [1, 2, 3] },
          topic: { type: "string" },
          selectedParagraphIds: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["passage", "topic", "selectedParagraphIds"],
        additionalProperties: false,
      },
    },
    notFoundTopics: { type: "array", items: { type: "string" } },
    discoveredTopics: { type: "array", items: { type: "string" } },
  },
  required: ["passages", "notFoundTopics", "discoveredTopics"],
  additionalProperties: false,
};

export const passageGenerationOutputSchema = z.object({
  passages: z.array(z.object({
    passage: z.number().int().min(1).max(3),
    topic: z.string().trim().min(1),
    paragraphs: z.array(z.string().trim().min(1)).min(1),
    citations: z.array(z.object({
      title: z.string().trim().min(1),
      url: z.url(),
    })).min(1),
  })).length(3),
  notFoundTopics: z.array(z.string()),
  discoveredTopics: z.array(z.string()),
});

export const passageGenerationJsonSchema = {
  type: "object",
  properties: {
    passages: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          passage: { type: "integer", enum: [1, 2, 3] },
          topic: { type: "string" },
          paragraphs: { type: "array", items: { type: "string" } },
          citations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                url: { type: "string" },
              },
              required: ["title", "url"],
              additionalProperties: false,
            },
          },
        },
        required: ["passage", "topic", "paragraphs", "citations"],
        additionalProperties: false,
      },
    },
    notFoundTopics: { type: "array", items: { type: "string" } },
    discoveredTopics: { type: "array", items: { type: "string" } },
  },
  required: ["passages", "notFoundTopics", "discoveredTopics"],
  additionalProperties: false,
};
