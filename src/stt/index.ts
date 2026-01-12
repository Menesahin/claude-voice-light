import { SherpaOnnxProvider, SherpaOnnxConfig } from './providers/sherpa-onnx';
import { STTConfig } from '../config';

/**
 * STT Manager - handles speech-to-text transcription
 */
export class STTManager {
  private provider: SherpaOnnxProvider;

  constructor(config: STTConfig) {
    const sherpaConfig: SherpaOnnxConfig = {
      model: config.model,
      language: config.language,
    };
    this.provider = new SherpaOnnxProvider(sherpaConfig);
  }

  async transcribe(audioPath: string): Promise<string> {
    return this.provider.transcribe(audioPath);
  }

  isReady(): boolean {
    return this.provider.isReady();
  }
}

// Re-export for convenience
export { SherpaOnnxProvider, downloadModel, listModels, SHERPA_MODELS } from './providers/sherpa-onnx';
