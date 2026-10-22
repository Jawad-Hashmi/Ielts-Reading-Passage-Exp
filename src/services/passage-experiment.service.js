import { config } from "../config/env.js";
import { calculateRunCosts } from "./cost-analysis.service.js";
import { createRunArtifacts } from "./run-artifact.service.js";
import { renderPassagesHtml } from "./passage-html.service.js";
import {
  passageGenerationOutputSchema,
  passageGenerationJsonSchema,
} from "../schemas/passage.schema.js";

const fail = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

const countWords = (text) => text.trim().split(/\s+/u).filter(Boolean).length;
const normalizeTopic = (topic) => topic.trim().toLocaleLowerCase();

const getSearchReason = (query, topics) => {
  const queryText = query.toLowerCase();
  const matchedTopics = topics.filter((topic) => topic
    .toLowerCase()
    .split(/\s+/u)
    .some((word) => word.length > 3 && queryText.includes(word)));

  if (matchedTopics.length) {
    return `Find articles supporting the requested topic${matchedTopics.length > 1 ? "s" : ""}: ${matchedTopics.join(", ")}.`;
  }
  if (topics.length) return `Expand the search for the requested topics across the supplied websites.`;
  return "Find source-supported topics on the supplied websites because no topics were provided.";
};

const validateUrl = (value) => {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    if (url.username || url.password) throw new Error();
    return url;
  } catch {
    throw fail(`Invalid HTTP or HTTPS URL: ${value}`);
  }
};

const validatePassageRequest = (body) => {
  const { links, topics = [], maxWords, paragraphs, passageLimits } = body;
  if (!Array.isArray(links) || links.length < 1 || links.length > config.maxSourceLinks) {
    throw fail(`Provide between 1 and ${config.maxSourceLinks} source links.`);
  }
  if (links.some((link) => typeof link !== "string" || !link.trim())) {
    throw fail("Every source link must be a non-empty string.");
  }
  if (!Array.isArray(topics) || topics.some((topic) => typeof topic !== "string" || !topic.trim())) {
    throw fail("topics must be an array of non-empty strings.");
  }
  if (topics.length > 3) {
    throw fail("Provide no more than three topics, one for each passage.");
  }
  if (maxWords !== undefined && (!Number.isInteger(maxWords) || maxWords < 50 || maxWords > 5000)) {
    throw fail("maxWords must be an integer between 50 and 5000.");
  }
  if (paragraphs !== undefined && (!Number.isInteger(paragraphs) || paragraphs < 1 || paragraphs > 20)) {
    throw fail("paragraphs must be an integer between 1 and 20.");
  }
  if (passageLimits !== undefined) {
    if (!passageLimits || typeof passageLimits !== "object" || Array.isArray(passageLimits)) {
      throw fail("passageLimits must be an object.");
    }
    for (const passage of ["passage1", "passage2", "passage3"]) {
      const limits = passageLimits[passage];
      if (!limits || typeof limits !== "object" || Array.isArray(limits)) throw fail(`passageLimits.${passage} must be an object.`);
      if (!Number.isInteger(limits.maxWords) || limits.maxWords < 50 || limits.maxWords > 5000) throw fail(`Invalid maxWords for ${passage}.`);
      if (!Number.isInteger(limits.paragraphs) || limits.paragraphs < 1 || limits.paragraphs > 20) throw fail(`Invalid paragraphs for ${passage}.`);
    }
  }
  return {
    links: links.map((link) => link.trim()),
    topics: topics.map((topic) => topic.trim()),
    requestedLimits: passageLimits || {
      passage1: { maxWords: maxWords ?? 500, paragraphs: paragraphs ?? 3 },
      passage2: { maxWords: maxWords ?? 700, paragraphs: paragraphs ?? 4 },
      passage3: { maxWords: maxWords ?? 900, paragraphs: paragraphs ?? 5 },
    },
  };
};

const getOutputText = (response) => response.output
  ?.flatMap((item) => item.content || [])
  .filter((item) => item.type === "output_text")
  .map((item) => item.text)
  .join("");

const collectSearchCitations = (response) => {
  const citations = new Map();
  const addCitation = (url, title) => {
    if (!url) return;
    const existing = citations.get(url);
    const usefulTitle = title && title !== url
      ? title
      : existing?.title && existing.title !== url
        ? existing.title
        : title || url;
    citations.set(url, { title: usefulTitle, url });
  };

  for (const item of response.output || []) {
    for (const content of item.content || []) {
      for (const annotation of content.annotations || []) {
        if (annotation.type !== "url_citation") continue;
        const citation = annotation.url_citation || annotation;
        addCitation(citation.url, citation.title);
      }
    }
    for (const source of item.action?.sources || []) {
      addCitation(source.url, source.title);
    }
  }
  return citations;
};

const summarizeSearchActions = (searchCalls) => ({
  toolActions: searchCalls.length,
  searches: searchCalls.filter((call) => call.action?.type === "search").length,
  queries: searchCalls.reduce((total, call) => {
    const action = call.action || {};
    return total + (action.type === "search"
      ? action.queries?.length || (action.query ? 1 : 0)
      : 0);
  }, 0),
  pageOpens: searchCalls.filter((call) => call.action?.type === "open_page").length,
  findInPage: searchCalls.filter((call) => call.action?.type === "find_in_page").length,
});

const logSearchActions = async ({ searchCalls, topics, artifacts }) => {
  for (const call of searchCalls) {
    const action = call.action || {};
    const sources = (action.sources || []).map((source) => source.url).filter(Boolean);

    if (action.type === "search") {
      const queries = action.queries?.length
        ? action.queries
        : action.query ? [action.query] : [];
      for (const query of queries) {
        await artifacts.log("web_search_performed", {
          toolCallId: call.id,
          actionType: action.type,
          query,
          reason: getSearchReason(query, topics),
          sourceCount: sources.length,
        });
      }
      continue;
    }

    const isOpen = action.type === "open_page";
    const isFind = action.type === "find_in_page";
    await artifacts.log("web_search_page_action", {
      toolCallId: call.id,
      actionType: action.type,
      url: action.url || null,
      pattern: action.pattern || null,
      reason: isOpen
        ? "Open the selected article to read and verify its content for passage generation."
        : isFind
          ? "Locate relevant details inside an already opened source page."
          : "Process the web search tool action returned by the model.",
    });
  }
};

const generateWithOpenAI = async ({ links, topics, requestedLimits, onApiResponse }) => {
  const urls = [];
  const failedSources = [];
  for (const link of links) {
    try {
      urls.push(validateUrl(link));
    } catch (error) {
      failedSources.push({ url: link, reason: error.message });
    }
  }
  if (urls.length === 0) throw fail("None of the supplied links are valid HTTP or HTTPS URLs.", 422);

  const allowedDomains = [...new Set(urls.map((url) => url.hostname))];
  const missingTopicCount = 3 - topics.length;
  const input = {
    model: config.openaiModel,
    instructions: [
      "You create IELTS Academic Reading practice passages grounded in web research.",
      "The supplied URLs identify the only allowed websites. Search those sites for specific relevant articles; a homepage or category page alone is not source material.",
      "There must be exactly three different topics and exactly three passages, one passage per topic.",
      topics.length === 3
        ? "The user supplied all three topics. Use those three topics as given, in order, and do not add or replace topics."
        : topics.length > 0
          ? `The user supplied ${topics.length} topic(s). Keep every supplied topic exactly as given and in order. Find exactly ${missingTopicCount} additional distinct topic(s) by randomly selecting among topics supported by articles found on the supplied websites. Do not invent a topic without an article source.`
          : "The user supplied no topics. Randomly select three distinct topics from specific articles found on the supplied websites. Do not invent topics without article sources.",
      "If a user-supplied topic has no supporting article, report it in notFoundTopics, but still try to complete all three passages by filling the unavailable slot with a different source-supported topic. Explain the substituted topic in discoveredTopics.",
      "Open the selected article pages and use their actual content before writing. Do not use homepages, category pages, or search snippets as factual source material.",
      "Create three different, coherent passages: Passage 1 accessible, Passage 2 moderately difficult, Passage 3 academically challenging.",
      "Write original practice text based only on facts and ideas found in the searched articles. Do not copy long passages verbatim and do not add unsupported facts.",
      "Use exactly the paragraph count requested for each passage and stay within its maximum word count.",
      "Use a different topic and at least one specific supporting article citation for each passage.",
      "For every passage, include one or more citations from the web pages you actually searched and used.",
      "Each citation must have the exact page title and direct URL of the article page that supports the passage. Do not cite a homepage, category page, or search page when an article URL is available.",
      "Never invent a source title or URL. Use the article title shown by the search result and its direct article URL.",
      "Return a passage only when you found relevant source material and can cite it. Do not fill gaps with invented material.",
    ].join("\n"),
    input: JSON.stringify({
      suppliedUrls: urls.map((url) => url.href),
      topics,
      passageLimits: requestedLimits,
      requestedTopicCount: 3,
      additionalTopicsToDiscover: missingTopicCount,
      task: "Search the supplied websites, choose source-backed topics for all three passages according to the user's topic count, open the supporting article pages, classify each article by IELTS difficulty, and write the passages.",
    }),
    tools: [{
      type: "web_search",
      search_context_size: "high",
      filters: { allowed_domains: allowedDomains },
    }],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    text: {
      format: {
        type: "json_schema",
        name: "ielts_passage_generation",
        strict: true,
        schema: passageGenerationJsonSchema,
      },
    },
  };

  let response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.openaiApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
  } catch (error) {
    throw fail(`OpenAI web search request failed: ${error.message}`, 502);
  }

  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    await onApiResponse({ status: response.status, body: details });
    throw fail(details.error?.message || `OpenAI returned HTTP ${response.status}.`, 502);
  }
  const result = await response.json();
  await onApiResponse({ status: response.status, body: result });
  if (result.status !== "completed") throw fail(`OpenAI response not completed: ${result.status}`, 502);

  const outputText = getOutputText(result);
  if (!outputText) throw fail("OpenAI returned no passage content.", 502);
  let parsed;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw fail("OpenAI returned invalid passage JSON.", 502);
  }
  const validation = passageGenerationOutputSchema.safeParse(parsed);
  if (!validation.success) {
    console.error({ stage: "openai_validation", issues: validation.error.issues });
    throw fail("OpenAI returned invalid passage data.", 502);
  }

  const passageNumbers = new Set(validation.data.passages.map(({ passage }) => passage));
  if (passageNumbers.size !== 3 || [1, 2, 3].some((number) => !passageNumbers.has(number))) {
    throw fail("OpenAI must return exactly one passage for Passage 1, Passage 2, and Passage 3.", 502);
  }

  const searchedCitations = collectSearchCitations(result);
  const seenPassages = new Set();
  const seenTopics = new Set();
  const passages = validation.data.passages.map((passage) => {
    if (seenPassages.has(passage.passage)) {
      throw fail(`OpenAI returned Passage ${passage.passage} more than once.`, 502);
    }
    seenPassages.add(passage.passage);
    const normalizedTopic = normalizeTopic(passage.topic);
    if (seenTopics.has(normalizedTopic)) {
      throw fail(`Passage ${passage.passage} repeats another passage topic.`, 502);
    }
    seenTopics.add(normalizedTopic);
    const requestedTopic = topics.find((topic) => normalizeTopic(topic) === normalizedTopic);
    if (requestedTopic && passage.topic.trim() !== requestedTopic) {
      throw fail(`Passage ${passage.passage} changed a user-provided topic.`, 502);
    }
    const limits = requestedLimits[`passage${passage.passage}`];
    if (passage.paragraphs.length !== limits.paragraphs) {
      throw fail(`Passage ${passage.passage} did not meet its requested paragraph count.`, 502);
    }
    const text = passage.paragraphs.join("\n\n");
    const wordCount = countWords(text);
    if (wordCount > limits.maxWords) {
      throw fail(`Passage ${passage.passage} exceeded its ${limits.maxWords} word limit.`, 502);
    }
    const citations = passage.citations.flatMap((citation) => {
      const searchedCitation = searchedCitations.get(citation.url);
      if (!searchedCitation) return [];
      const citedUrl = validateUrl(searchedCitation.url);
      if (!allowedDomains.some((domain) => citedUrl.hostname === domain || citedUrl.hostname.endsWith(`.${domain}`))) return [];
      const path = citedUrl.pathname.replace(/\/+$/u, "");
      if (!path || path.split("/").filter(Boolean).length < 2) return [];
      return [{
        url: searchedCitation.url,
        title: searchedCitation.title !== searchedCitation.url
          ? searchedCitation.title
          : citation.title,
      }];
    });
    if (citations.length === 0) {
      throw fail(`Passage ${passage.passage} did not include a verified web citation.`, 502);
    }
    return {
      passage: passage.passage,
      topic: passage.topic,
      text,
      wordCount,
      paragraphs: passage.paragraphs.length,
      citations,
    };
  });

  const citations = [...new Map(passages.flatMap((passage) => passage.citations).map((citation) => [citation.url, citation])).values()];
  const requestedTopicKeys = new Set(topics.map(normalizeTopic));
  const discoveredTopics = [
    ...new Set([
      ...passages.map(({ topic }) => topic).filter((topic) => !requestedTopicKeys.has(normalizeTopic(topic))),
      ...validation.data.discoveredTopics.filter((topic) => !requestedTopicKeys.has(normalizeTopic(topic))),
    ]),
  ];
  const passageTopics = new Set(passages.map(({ topic }) => normalizeTopic(topic)));
  const missingRequestedTopics = topics.filter((topic) => !passageTopics.has(normalizeTopic(topic)));
  if (missingRequestedTopics.length > 0) {
    throw fail(`The generated passages did not cover requested topic(s): ${missingRequestedTopics.join(", ")}.`, 502);
  }

  return {
    passages,
    notFoundTopics: validation.data.notFoundTopics,
    discoveredTopics,
    citations,
    failedSources,
  };
};

export const generatePassages = async (body = {}) => {
  if (!config.openaiApiKey) throw fail("OPENAI_API_KEY is not configured.", 503);
  const { links, topics, requestedLimits } = validatePassageRequest(body);
  const artifacts = await createRunArtifacts({
    model: config.openaiModel,
    request: { links, topics, passageLimits: requestedLimits },
  });
  let apiUsage = null;
  let webSearchCalls = null;
  let searchCalls = [];
  let searchedSources = [];
  let searchSummary = { toolActions: 0, searches: 0, queries: 0, pageOpens: 0, findInPage: 0 };

  const recordApiResponse = async ({ status, body: apiBody }) => {
    apiUsage = apiBody?.usage || null;
    searchCalls = (apiBody?.output || []).filter((item) => item.type === "web_search_call");
    webSearchCalls = searchCalls.length;
    searchSummary = summarizeSearchActions(searchCalls);
    searchedSources = searchCalls.flatMap((item) => item.action?.sources || []);
    await logSearchActions({ searchCalls, topics, artifacts });
    const tokenBreakdown = {
      input: apiUsage?.input_tokens ?? null,
      cachedInput: apiUsage?.input_tokens_details?.cached_tokens ?? null,
      cacheWriteInput: apiUsage?.input_tokens_details?.cache_write_tokens ?? null,
      output: apiUsage?.output_tokens ?? null,
      total: apiUsage?.total_tokens ?? null,
    };
    const costs = calculateRunCosts({ model: config.openaiModel, usage: apiUsage, webSearchCalls });
    await artifacts.writeJson("usage.json", {
      runId: artifacts.runId,
      apiResponseId: apiBody?.id || null,
      httpStatus: status,
      model: apiBody?.model || config.openaiModel,
      rawUsage: apiUsage,
      tokenBreakdown,
      webSearchCalls,
      searchSummary,
    });
    await artifacts.writeJson("cost.json", costs);
    await artifacts.writeJson("search.json", {
      runId: artifacts.runId,
      summary: searchSummary,
      calls: searchCalls.map(({ id, status: callStatus, action }) => ({ id, status: callStatus, action })),
      sources: searchedSources,
    });
    await artifacts.log("api_response_received", {
      httpStatus: status,
      responseId: apiBody?.id || null,
      tokenBreakdown,
      webSearchCalls,
      searchSummary,
      totalCostUsd: costs.total.usd,
      totalCostPkr: costs.total.pkr,
    });
  };

  try {
    const result = await generateWithOpenAI({
      links,
      topics,
      requestedLimits,
      onApiResponse: recordApiResponse,
    });
    const runCosts = calculateRunCosts({ model: config.openaiModel, usage: apiUsage, webSearchCalls });
    const passageNumbers = new Set(result.passages.map((passage) => passage.passage));
    const htmlFile = `${artifacts.relativeDirectory.replaceAll("\\", "/")}/output.html`;
    const finalResult = {
      ...result,
      runId: artifacts.runId,
      artifactDirectory: artifacts.relativeDirectory,
      htmlFile,
      htmlEndpoint: `/api/v1/experiments/passages/${artifacts.runId}/html`,
      usage: {
        inputTokens: runCosts.tokenUsage.input,
        uncachedInputTokens: runCosts.tokenUsage.uncachedInput,
        cachedInputTokens: runCosts.tokenUsage.cachedInput,
        cacheWriteInputTokens: runCosts.tokenUsage.cacheWriteInput,
        outputTokens: runCosts.tokenUsage.output,
        totalTokens: runCosts.tokenUsage.total,
        webSearchCalls,
        searchSummary,
      },
      cost: runCosts,
      message: result.passages.length === 0
        ? "No complete passages could be created from the searched source pages. Try direct article URLs or different topics."
        : undefined,
      status: result.passages.length === 0
        ? "no_passages"
        : result.passages.length === 3
          ? "completed"
          : "partial",
      model: config.openaiModel,
      sourceCount: result.citations.length,
      missingPassages: [1, 2, 3].filter((number) => !passageNumbers.has(number)),
    };
    const analysis = {
      runId: artifacts.runId,
      status: finalResult.status,
      passageCount: finalResult.passages.length,
      passages: finalResult.passages.map(({ passage, topic, wordCount, paragraphs, citations }) => ({
        passage,
        topic,
        wordCount,
        paragraphs,
        citationCount: citations.length,
      })),
      discoveredTopics: finalResult.discoveredTopics,
      notFoundTopics: finalResult.notFoundTopics,
      missingPassages: finalResult.missingPassages,
      citationCount: finalResult.citations.length,
      failedSourceCount: finalResult.failedSources.length,
      searchSummary,
    };
    await artifacts.writeText("output.html", renderPassagesHtml(finalResult));
    await artifacts.writeJson("output.json", finalResult);
    await artifacts.writeJson("search.json", {
      runId: artifacts.runId,
      summary: searchSummary,
      calls: searchCalls.map(({ id, status: callStatus, action }) => ({ id, status: callStatus, action })),
      sources: searchedSources,
      citedSources: result.citations,
    });
    await artifacts.writeJson("analysis.json", analysis);
    await artifacts.writeJson("run.json", {
      runId: artifacts.runId,
      model: config.openaiModel,
      status: finalResult.status,
      startedAt: artifacts.startedAt,
      finishedAt: new Date().toISOString(),
      request: { links, topics, passageLimits: requestedLimits },
      artifactFiles: ["output.json", "output.html", "usage.json", "cost.json", "analysis.json", "search.json", "logs.jsonl"],
    });
    await artifacts.log("run_completed", {
      status: finalResult.status,
      passageCount: finalResult.passages.length,
    });
    return finalResult;
  } catch (error) {
    const costs = calculateRunCosts({ model: config.openaiModel, usage: apiUsage, webSearchCalls });
    try {
      if (!apiUsage) {
        await artifacts.writeJson("usage.json", {
          runId: artifacts.runId,
          model: config.openaiModel,
          rawUsage: null,
          tokenBreakdown: { input: null, cachedInput: null, cacheWriteInput: null, output: null, total: null },
          webSearchCalls,
        });
        await artifacts.writeJson("cost.json", costs);
        await artifacts.writeJson("search.json", {
          runId: artifacts.runId,
          calls: searchCalls.map(({ id, status: callStatus, action }) => ({ id, status: callStatus, action })),
          sources: searchedSources,
        });
      }
      const htmlFile = `${artifacts.relativeDirectory.replaceAll("\\", "/")}/output.html`;
      const failedResult = {
        runId: artifacts.runId,
        model: config.openaiModel,
        htmlFile,
        htmlEndpoint: `/api/v1/experiments/passages/${artifacts.runId}/html`,
        usage: {
          totalTokens: apiUsage?.total_tokens ?? null,
          searchSummary,
        },
        cost: costs,
        passages: [],
        status: "failed",
        error: error.message,
      };
      await artifacts.writeText("output.html", renderPassagesHtml(failedResult));
      await artifacts.writeJson("output.json", failedResult);
      await artifacts.writeJson("analysis.json", {
        runId: artifacts.runId,
        status: "failed",
        error: error.message,
        webSearchCalls,
        searchSummary,
        tokenUsageAvailable: Boolean(apiUsage),
      });
      await artifacts.writeJson("run.json", {
        runId: artifacts.runId,
        model: config.openaiModel,
        status: "failed",
        startedAt: artifacts.startedAt,
        finishedAt: new Date().toISOString(),
        request: { links, topics, passageLimits: requestedLimits },
        error: error.message,
        artifactFiles: ["output.json", "output.html", "usage.json", "cost.json", "analysis.json", "search.json", "logs.jsonl"],
      });
      await artifacts.log("run_failed", { message: error.message, webSearchCalls });
    } catch (artifactError) {
      console.error({ stage: "run_artifact_write_failed", runId: artifacts.runId, message: artifactError.message });
    }
    error.runId = artifacts.runId;
    error.artifactDirectory = artifacts.relativeDirectory;
    throw error;
  }
};
