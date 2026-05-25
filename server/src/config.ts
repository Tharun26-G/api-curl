import { OllamaConfig } from './types';

let config: OllamaConfig = {
  url: process.env.OLLAMA_URL || 'http://localhost:11434',
  model: process.env.OLLAMA_MODEL || 'qwen3:0.6b',
};

export function getConfig(): OllamaConfig {
  return { ...config };
}

export function updateConfig(partial: Partial<OllamaConfig>): OllamaConfig {
  config = { ...config, ...partial };
  return { ...config };
}
