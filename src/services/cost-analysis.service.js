const MODEL_RATES_PER_MILLION = {
  "gpt-6-luna": {
    input: 0.1,
    cachedInput: 0.01,
    cacheWrite: 0.125,
    output: 0.5,
  },
};

const WEB_SEARCH_USD_PER_THOUSAND_CALLS = 10;
const USD_TO_PKR_RATE = 276.35;
const TOKENS_PER_MILLION = 1_000_000;

const tokenValue = (value) => Number.isFinite(value) ? value : 0;
const roundCurrency = (value) => Number(value.toFixed(8));

const priceTokens = (tokens, rate) => {
  const usd = (tokens * rate) / TOKENS_PER_MILLION;
  return { tokens, ratePerMillionTokens: rate, usd: roundCurrency(usd), pkr: roundCurrency(usd * USD_TO_PKR_RATE) };
};

const unknownPrice = (tokens) => ({ tokens, usd: null, pkr: null });

export const calculateRunCosts = ({ model, usage, webSearchCalls = null }) => {
  const rates = MODEL_RATES_PER_MILLION[model];
  const usageAvailable = usage && Number.isFinite(usage.input_tokens) && Number.isFinite(usage.output_tokens);
  const inputDetails = usage?.input_tokens_details || {};
  const inputDetailsAvailable = Number.isFinite(inputDetails.cached_tokens)
    && Number.isFinite(inputDetails.cache_write_tokens);
  const cachedTokens = inputDetailsAvailable ? inputDetails.cached_tokens : null;
  const cacheWriteTokens = inputDetailsAvailable ? inputDetails.cache_write_tokens : null;
  const inputTokens = usageAvailable ? usage.input_tokens : null;
  const outputTokens = usageAvailable ? usage.output_tokens : null;
  const uncachedInputTokens = usageAvailable && inputDetailsAvailable
    ? Math.max(0, inputTokens - cachedTokens - cacheWriteTokens)
    : null;

  const modelTokenCosts = rates
    ? {
        uncachedInput: uncachedInputTokens === null ? unknownPrice(null) : priceTokens(uncachedInputTokens, rates.input),
        cachedInput: cachedTokens === null ? unknownPrice(null) : priceTokens(cachedTokens, rates.cachedInput),
        cacheWriteInput: cacheWriteTokens === null ? unknownPrice(null) : priceTokens(cacheWriteTokens, rates.cacheWrite),
        output: outputTokens === null ? unknownPrice(null) : priceTokens(outputTokens, rates.output),
      }
    : {
        uncachedInput: unknownPrice(uncachedInputTokens),
        cachedInput: unknownPrice(cachedTokens),
        cacheWriteInput: unknownPrice(cacheWriteTokens),
        output: unknownPrice(outputTokens),
      };

  const modelUsd = Object.values(modelTokenCosts).every((item) => item.usd !== null)
    ? roundCurrency(Object.values(modelTokenCosts).reduce((sum, item) => sum + item.usd, 0))
    : null;
  const modelPkr = modelUsd === null ? null : roundCurrency(modelUsd * USD_TO_PKR_RATE);
  const searchCallsKnown = Number.isFinite(webSearchCalls);
  const webSearchUsd = searchCallsKnown
    ? roundCurrency((webSearchCalls * WEB_SEARCH_USD_PER_THOUSAND_CALLS) / 1000)
    : null;
  const totalUsd = modelUsd === null || webSearchUsd === null
    ? null
    : roundCurrency(modelUsd + webSearchUsd);

  return {
    model,
    currency: { usdToPkr: USD_TO_PKR_RATE },
    tokenUsage: {
      input: inputTokens,
      uncachedInput: uncachedInputTokens,
      cachedInput: cachedTokens,
      cacheWriteInput: cacheWriteTokens,
      output: outputTokens,
      total: usageAvailable && Number.isFinite(usage.total_tokens)
        ? usage.total_tokens
        : usageAvailable ? inputTokens + outputTokens : null,
    },
    modelTokenCosts,
    modelTotal: { usd: modelUsd, pkr: modelPkr },
    webSearch: {
      calls: webSearchCalls,
      ratePerThousandCalls: WEB_SEARCH_USD_PER_THOUSAND_CALLS,
      usd: webSearchUsd,
      pkr: webSearchUsd === null ? null : roundCurrency(webSearchUsd * USD_TO_PKR_RATE),
      note: "Search content tokens are included in model input token usage and priced above.",
    },
    total: {
      usd: totalUsd,
      pkr: totalUsd === null ? null : roundCurrency(totalUsd * USD_TO_PKR_RATE),
      status: totalUsd === null ? "unknown" : "calculated",
    },
    ratesPerMillionTokens: rates || null,
    notes: [
      "Token rates are interpreted as USD per million tokens.",
      ...(rates ? [] : [`No token pricing is configured for ${model}; model and total costs are unknown.`]),
      ...(!usageAvailable ? ["The API did not return token usage; model and total costs are unknown."] : []),
      ...(!inputDetailsAvailable ? ["The API did not return cached and cache-write token counts; the input cost breakdown is unknown."] : []),
      ...(!searchCallsKnown ? ["The API did not return search call details; web search and total costs are unknown."] : []),
    ],
  };
};
