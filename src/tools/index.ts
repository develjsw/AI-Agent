import { webSearchTool } from './web-search.ts';
import { fetchUrlTool } from './fetch-url.ts';

export const workerExternalTools = {
  web_search: webSearchTool,
  fetch_url: fetchUrlTool,
};
