import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getModelsDir, getLocalModelsDir } from '../../config';

// Set up library path for sherpa-onnx native bindings
function setupLibraryPath(): void {
  const platform = os.platform();
  const arch = os.arch();

  let platformPackage = '';
  if (platform === 'darwin' && arch === 'arm64') {
    platformPackage = 'sherpa-onnx-darwin-arm64';
  } else if (platform === 'darwin' && arch === 'x64') {
    platformPackage = 'sherpa-onnx-darwin-x64';
  } else if (platform === 'linux' && arch === 'x64') {
    platformPackage = 'sherpa-onnx-linux-x64';
  } else if (platform === 'linux' && arch === 'arm64') {
    platformPackage = 'sherpa-onnx-linux-arm64';
  }

  if (platformPackage) {
    // Try to find the package in node_modules
    const possiblePaths = [
      path.join(__dirname, '..', '..', '..', '..', 'node_modules', platformPackage),
      path.join(__dirname, '..', '..', '..', 'node_modules', platformPackage),
      path.join(process.cwd(), 'node_modules', platformPackage),
    ];

    for (const libPath of possiblePaths) {
      if (fs.existsSync(libPath)) {
        const envVar = platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
        const current = process.env[envVar] || '';
        if (!current.includes(libPath)) {
          process.env[envVar] = libPath + (current ? ':' + current : '');
        }
        break;
      }
    }
  }
}

// Initialize library path
setupLibraryPath();

// Available models for download
export const SHERPA_MODELS = {
  'whisper-tiny': {
    name: 'Whisper Tiny (75MB)',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.tar.bz2',
    folder: 'sherpa-onnx-whisper-tiny',
    languages: ['en', 'tr', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'zh', 'ja', 'ko'],
    type: 'stt',
  },
  'whisper-base': {
    name: 'Whisper Base (142MB)',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.tar.bz2',
    folder: 'sherpa-onnx-whisper-base',
    languages: ['en', 'tr', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'zh', 'ja', 'ko'],
    type: 'stt',
  },
  'whisper-small': {
    name: 'Whisper Small (488MB)',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.tar.bz2',
    folder: 'sherpa-onnx-whisper-small',
    languages: ['en', 'tr', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'zh', 'ja', 'ko'],
    type: 'stt',
  },
};

export interface SherpaOnnxConfig {
  model: keyof typeof SHERPA_MODELS;
  language: string;
}

export class SherpaOnnxProvider {
  name = 'sherpa-onnx';
  private config: SherpaOnnxConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recognizer: any = null;
  private ready = false;

  constructor(config: SherpaOnnxConfig) {
    this.config = config;
    this.initialize();
  }

  private async initialize(): Promise<void> {
    const modelInfo = SHERPA_MODELS[this.config.model];
    if (!modelInfo) {
      console.error(`Unknown model: ${this.config.model}`);
      return;
    }

    const modelsDir = getModelsDir();
    const modelPath = path.join(modelsDir, modelInfo.folder);

    if (!fs.existsSync(modelPath)) {
      console.warn(`Model not found: ${modelPath}`);
      console.warn(`Run: claude-voice-light model download`);
      return;
    }

    try {
      const { OfflineRecognizer } = require('sherpa-onnx-node/non-streaming-asr');

      // Model file naming: whisper-tiny -> tiny-encoder.onnx, etc.
      const modelPrefix = this.config.model.replace('whisper-', '');

      // Configure for whisper model
      this.recognizer = new OfflineRecognizer({
        modelConfig: {
          whisper: {
            encoder: path.join(modelPath, `${modelPrefix}-encoder.onnx`),
            decoder: path.join(modelPath, `${modelPrefix}-decoder.onnx`),
            language: this.config.language || 'en',
            task: 'transcribe',
          },
          tokens: path.join(modelPath, `${modelPrefix}-tokens.txt`),
          numThreads: 2,
          debug: false,
          provider: 'cpu',
        },
      });

      this.ready = true;
      console.log(`STT initialized with model: ${this.config.model}`);
    } catch (error) {
      console.error('Failed to initialize Sherpa-ONNX:', error);
    }
  }

  async transcribe(audioPath: string): Promise<string> {
    if (!this.ready || !this.recognizer) {
      throw new Error('Sherpa-ONNX not initialized. Download a model first.');
    }

    try {
      // Read WAV file
      const samples = await this.readWavFile(audioPath);

      // Create stream and process
      const stream = this.recognizer.createStream();
      stream.acceptWaveform({ samples, sampleRate: 16000 });

      this.recognizer.decode(stream);
      const result = this.recognizer.getResult(stream);

      return result.text?.trim() || '';
    } catch (error) {
      console.error('Transcription error:', error);
      throw error;
    }
  }

  private async readWavFile(filePath: string): Promise<Float32Array> {
    const buffer = fs.readFileSync(filePath);

    // Parse WAV header (skip first 44 bytes for standard WAV)
    const dataStart = 44;
    const samples = new Float32Array((buffer.length - dataStart) / 2);

    for (let i = 0; i < samples.length; i++) {
      const sample = buffer.readInt16LE(dataStart + i * 2);
      samples[i] = sample / 32768.0; // Normalize to [-1, 1]
    }

    return samples;
  }

  isReady(): boolean {
    return this.ready;
  }
}

/**
 * Download a Sherpa-ONNX model
 */
export async function downloadModel(modelId: keyof typeof SHERPA_MODELS): Promise<void> {
  const modelInfo = SHERPA_MODELS[modelId];
  if (!modelInfo) {
    throw new Error(`Unknown model: ${modelId}`);
  }

  const modelsDir = getLocalModelsDir();
  const modelPath = path.join(modelsDir, modelInfo.folder);

  if (fs.existsSync(modelPath)) {
    console.log(`Model already installed: ${modelId}`);
    return;
  }

  // Create models directory
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
  }

  console.log(`Downloading ${modelInfo.name}...`);
  console.log(`Languages: ${modelInfo.languages.slice(0, 5).join(', ')}...`);

  const { execSync } = require('child_process');
  const archivePath = path.join(modelsDir, `${modelId}.tar.bz2`);

  try {
    // Download with curl
    console.log('Downloading model...');
    execSync(`curl -L --progress-bar -o "${archivePath}" "${modelInfo.url}"`, {
      stdio: 'inherit',
      cwd: modelsDir
    });

    // Extract
    console.log('Extracting model files...');
    execSync(`tar -xjf "${archivePath}"`, {
      stdio: 'pipe',
      cwd: modelsDir
    });

    // Cleanup archive
    fs.unlinkSync(archivePath);

    console.log(`Model installed: ${modelId}`);
  } catch (error) {
    console.error('Download failed:', error);
    throw error;
  }
}

/**
 * List available and installed models
 */
export function listModels(): { id: string; name: string; installed: boolean; languages: string[] }[] {
  const modelsDir = getModelsDir();
  return Object.entries(SHERPA_MODELS).map(([id, info]) => ({
    id,
    name: info.name,
    installed: fs.existsSync(path.join(modelsDir, info.folder)),
    languages: info.languages,
  }));
}
