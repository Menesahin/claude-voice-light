import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Wake Word Configuration
export interface WakeWordConfig {
  keyword: string;
  sensitivity: number;
  playSound: boolean;
  keywords: Record<string, string[]>;
}

// STT Configuration
export interface STTConfig {
  language: string;
  model: 'whisper-tiny' | 'whisper-base' | 'whisper-small';
}

// Recording Configuration
export interface RecordingConfig {
  sampleRate: number;
  silenceThreshold: number;
  silenceAmplitude: number;
  maxDuration: number;
}

// Main Configuration Interface
export interface Config {
  wakeWord: WakeWordConfig;
  stt: STTConfig;
  recording: RecordingConfig;
  debug: boolean;
}

const CONFIG_DIR = path.join(os.homedir(), '.claude-voice-light');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const MODELS_DIR = path.join(CONFIG_DIR, 'models');

// Shared models location (from full claude-voice extension)
const SHARED_MODELS_DIR = path.join(os.homedir(), '.claude-voice', 'models');

let cachedConfig: Config | null = null;

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

/**
 * Get models directory - prefers shared models if they exist
 */
export function getModelsDir(): string {
  // Check if shared models exist first
  if (fs.existsSync(SHARED_MODELS_DIR)) {
    return SHARED_MODELS_DIR;
  }
  return MODELS_DIR;
}

/**
 * Get local models directory (for downloads)
 */
export function getLocalModelsDir(): string {
  return MODELS_DIR;
}

export function getDefaultConfig(): Config {
  const defaultConfigPath = path.join(__dirname, '..', 'config', 'default.json');
  const altDefaultConfigPath = path.join(__dirname, '..', '..', 'config', 'default.json');

  const configPath = fs.existsSync(defaultConfigPath) ? defaultConfigPath : altDefaultConfigPath;

  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }

  // Fallback default config
  return {
    wakeWord: {
      keyword: 'jarvis',
      sensitivity: 0.5,
      playSound: true,
      keywords: {
        jarvis: [
          '▁JA R VI S',
          '▁JA R V I S',
          'J AR VI S',
        ],
        claude: [
          '▁C L A U DE',
          '▁C L A U D E',
        ],
      },
    },
    stt: {
      language: 'en',
      model: 'whisper-tiny',
    },
    recording: {
      sampleRate: 16000,
      silenceThreshold: 2500,
      silenceAmplitude: 500,
      maxDuration: 30000,
    },
    debug: false,
  };
}

export function loadConfig(): Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  const defaultConfig = getDefaultConfig();

  if (!fs.existsSync(CONFIG_FILE)) {
    cachedConfig = defaultConfig;
    return cachedConfig;
  }

  try {
    const userConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    cachedConfig = deepMerge(defaultConfig, userConfig) as Config;
    return cachedConfig;
  } catch (error) {
    console.warn('Failed to load user config, using defaults:', error);
    cachedConfig = defaultConfig;
    return cachedConfig;
  }
}

export function saveConfig(config: Partial<Config>): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  const currentConfig = loadConfig();
  const newConfig = deepMerge(currentConfig, config);

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
  cachedConfig = newConfig;
}

export function resetConfig(): void {
  if (fs.existsSync(CONFIG_FILE)) {
    fs.unlinkSync(CONFIG_FILE);
  }
  cachedConfig = null;
}

export function clearConfigCache(): void {
  cachedConfig = null;
}

/**
 * Get a nested config value by dot-notation path
 * e.g., getConfigValue('stt.language') returns 'en'
 */
export function getConfigValue(keyPath: string): unknown {
  const config = loadConfig();
  const keys = keyPath.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let value: any = config;

  for (const key of keys) {
    if (value === undefined || value === null) {
      return undefined;
    }
    value = value[key];
  }

  return value;
}

/**
 * Set a nested config value by dot-notation path
 * e.g., setConfigValue('stt.language', 'tr')
 */
export function setConfigValue(keyPath: string, value: unknown): void {
  const config = loadConfig();
  const keys = keyPath.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = config;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (current[key] === undefined) {
      current[key] = {};
    }
    current = current[key];
  }

  const lastKey = keys[keys.length - 1];

  // Try to parse value as JSON for objects/arrays/booleans/numbers
  if (typeof value === 'string') {
    if (value === 'true') {
      current[lastKey] = true;
    } else if (value === 'false') {
      current[lastKey] = false;
    } else if (!isNaN(Number(value)) && value.trim() !== '') {
      current[lastKey] = Number(value);
    } else {
      current[lastKey] = value;
    }
  } else {
    current[lastKey] = value;
  }

  saveConfig(config);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(target: any, source: any): any {
  const result = { ...target };

  for (const key in source) {
    if (source[key] !== undefined) {
      if (
        typeof source[key] === 'object' &&
        source[key] !== null &&
        !Array.isArray(source[key]) &&
        typeof target[key] === 'object' &&
        target[key] !== null
      ) {
        result[key] = deepMerge(target[key], source[key]);
      } else {
        result[key] = source[key];
      }
    }
  }

  return result;
}
