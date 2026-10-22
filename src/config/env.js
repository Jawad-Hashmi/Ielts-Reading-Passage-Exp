import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL || 'gpt-6-luna',
  maxSourceCharacters: Number(process.env.MAX_SOURCE_CHARACTERS || 30000),
  maxSourceLinks: Number(process.env.MAX_SOURCE_LINKS || 10),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 100000),
};
