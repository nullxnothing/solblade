import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import {
  type SolbladeConfig,
  DEFAULT_CONFIG,
  SOLBLADE_DIR,
  KEYS_DIR,
  CONFIG_PATH,
} from '../core/types.ts';

export function ensureDirs(): void {
  if (!existsSync(SOLBLADE_DIR)) mkdirSync(SOLBLADE_DIR, { recursive: true });
  if (!existsSync(KEYS_DIR)) mkdirSync(KEYS_DIR, { recursive: true });
}

export function loadConfig(): SolbladeConfig {
  ensureDirs();
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: SolbladeConfig): void {
  ensureDirs();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function updateConfig(updates: Partial<SolbladeConfig>): SolbladeConfig {
  const config = loadConfig();
  Object.assign(config, updates);
  saveConfig(config);
  return config;
}
