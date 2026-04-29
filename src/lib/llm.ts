import 'dotenv/config';
import { openai } from '@ai-sdk/openai';

export function getModel(name: string) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set in .env');
  }
  return openai(name);
}
