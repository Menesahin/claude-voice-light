import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { WakeWordConfig, RecordingConfig, getModelsDir, getConfigDir } from '../config';
import { getPlatformCapabilities } from '../platform';
import { playSound } from '../utils/audio';
import { calculateAmplitude, bufferToFloat32 } from '../utils/silence';

// Model info for keyword spotting
export const KWS_MODEL = {
  id: 'kws-zipformer-gigaspeech',
  name: 'Keyword Spotter (English)',
  folder: 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2',
  size: '19 MB',
};

/**
 * Sherpa-ONNX based wake word detector
 */
export class SherpaOnnxDetector extends EventEmitter {
  private config: WakeWordConfig;
  private recordingConfig: RecordingConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private kws: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private stream: any = null;
  private isListening = false;
  private isRecordingCommand = false;
  private recordingProcess: ReturnType<typeof spawn> | null = null;
  private audioBuffer: Buffer[] = [];
  private silenceStartTime: number | null = null;

  constructor(wakeWordConfig: WakeWordConfig, recordingConfig: RecordingConfig) {
    super();
    this.config = wakeWordConfig;
    this.recordingConfig = recordingConfig;
  }

  async initialize(): Promise<void> {
    const modelsDir = getModelsDir();
    const modelPath = path.join(modelsDir, KWS_MODEL.folder);

    // Check if model is downloaded
    if (!fs.existsSync(modelPath)) {
      console.warn(
        `Keyword spotting model not found. Download it with:\n  claude-voice-light model download`
      );
      console.log('Wake word detection will be disabled until model is installed.');
      return;
    }

    // Get keywords file
    const keywordsFile = this.getKeywordsFile(modelPath);

    try {
      // Dynamic import for sherpa-onnx
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sherpaOnnx = (await import('sherpa-onnx-node')) as any;

      // Configure keyword spotter
      const kwsConfig = {
        featConfig: {
          sampleRate: this.recordingConfig.sampleRate,
          featureDim: 80,
        },
        modelConfig: {
          transducer: {
            encoder: path.join(modelPath, 'encoder-epoch-12-avg-2-chunk-16-left-64.onnx'),
            decoder: path.join(modelPath, 'decoder-epoch-12-avg-2-chunk-16-left-64.onnx'),
            joiner: path.join(modelPath, 'joiner-epoch-12-avg-2-chunk-16-left-64.onnx'),
          },
          tokens: path.join(modelPath, 'tokens.txt'),
          numThreads: 1,
          provider: 'cpu',
          debug: 0,
        },
        keywordsFile: keywordsFile,
      };

      this.kws = new sherpaOnnx.KeywordSpotter(kwsConfig);
      this.stream = this.kws.createStream();

      console.log(`Wake word detector initialized (keyword: "${this.config.keyword}")`);
    } catch (error) {
      console.error('Failed to initialize Sherpa-ONNX keyword spotter:', error);
      throw error;
    }
  }

  /**
   * Get keywords file path
   */
  private getKeywordsFile(modelPath: string): string {
    const keyword = this.config.keyword.toLowerCase();
    const keywords = this.config.keywords || {};

    const tokenData = keywords[keyword];
    if (!tokenData) {
      console.warn(`Keyword "${keyword}" not found in config.`);
      console.warn(`Available keywords: ${Object.keys(keywords).join(', ')}`);
      // Fallback to model's default keywords
      return path.join(modelPath, 'keywords.txt');
    }

    // Handle both string and array formats
    const lines = Array.isArray(tokenData) ? tokenData : [tokenData];

    // Write active keyword variations to file
    const configDir = getConfigDir();
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    const activeFile = path.join(configDir, 'active-keyword.txt');
    fs.writeFileSync(activeFile, lines.join('\n') + '\n');

    console.log(`Wake word: "${keyword}" (${lines.length} variations)`);
    return activeFile;
  }

  async start(): Promise<void> {
    if (!this.kws || !this.stream) {
      console.warn('Wake word detector not initialized');
      return;
    }

    if (this.isListening) {
      return;
    }

    this.isListening = true;
    this.startAudioCapture();
    this.emit('started');
  }

  private startAudioCapture(): void {
    const caps = getPlatformCapabilities();
    const sampleRate = this.recordingConfig.sampleRate;

    // Use sox on macOS, arecord on Linux
    if (caps.platform === 'darwin') {
      // Check if sox is installed
      try {
        execSync('which rec', { stdio: 'ignore' });
      } catch {
        console.error('');
        console.error('  Wake word detection requires sox for audio capture.');
        console.error('  Install it with: brew install sox');
        console.error('');
        return;
      }

      // Use sox (rec command) for audio capture
      this.recordingProcess = spawn(
        'rec',
        [
          '-q', // Quiet mode
          '-t',
          'raw', // Raw audio format
          '-b',
          '16', // 16-bit
          '-e',
          'signed-integer',
          '-c',
          '1', // Mono
          '-r',
          String(sampleRate),
          '-', // Output to stdout
        ],
        { stdio: ['ignore', 'pipe', 'ignore'] }
      );
    } else if (caps.platform === 'linux') {
      // Check if arecord is installed
      try {
        execSync('which arecord', { stdio: 'ignore' });
      } catch {
        console.error('');
        console.error('  Wake word detection requires alsa-utils for audio capture.');
        console.error('  Install it with: sudo apt install alsa-utils');
        console.error('');
        return;
      }

      // Use arecord for audio capture
      this.recordingProcess = spawn(
        'arecord',
        ['-q', '-f', 'S16_LE', '-c', '1', '-r', String(sampleRate), '-t', 'raw', '-'],
        { stdio: ['ignore', 'pipe', 'ignore'] }
      );
    } else {
      console.error('Audio capture not supported on this platform');
      return;
    }

    if (!this.recordingProcess.stdout) {
      console.error('Failed to start audio capture');
      return;
    }

    this.recordingProcess.stdout.on('data', (data: Buffer) => {
      if (!this.isListening || !this.kws || !this.stream) {
        return;
      }

      if (this.isRecordingCommand) {
        // Collecting audio for command transcription
        this.audioBuffer.push(data);
        this.checkSilenceAndFinish(data);
      } else {
        // Process audio for keyword detection
        this.processAudioForKeyword(data);
      }
    });

    this.recordingProcess.on('error', (err) => {
      console.error('Audio capture error:', err);
    });
  }

  private processAudioForKeyword(data: Buffer): void {
    if (!this.kws || !this.stream) return;

    // Convert Int16 buffer to Float32Array
    const samples = bufferToFloat32(data);

    // Feed audio to the stream
    this.stream.acceptWaveform({
      sampleRate: this.recordingConfig.sampleRate,
      samples: samples,
    });

    // Check for keyword detection
    while (this.kws.isReady(this.stream)) {
      this.kws.decode(this.stream);
    }

    const result = this.kws.getResult(this.stream);
    if (result.keyword && result.keyword.trim() !== '') {
      console.log(`Wake word detected: "${result.keyword}"`);

      // Play "listening" sound
      if (this.config.playSound) {
        playSound('Ping');
      }

      // Start recording the command
      this.emit('wakeword', 0);
      this.startCommandRecording();
    }
  }

  private startCommandRecording(): void {
    if (this.isRecordingCommand) {
      return;
    }

    this.isRecordingCommand = true;
    this.audioBuffer = [];
    this.silenceStartTime = null;
    this.emit('listening');
  }

  private checkSilenceAndFinish(data: Buffer): void {
    const amplitude = calculateAmplitude(data);
    const silenceThreshold = this.recordingConfig.silenceThreshold;
    const silenceAmplitude = this.recordingConfig.silenceAmplitude || 500;

    if (amplitude < silenceAmplitude) {
      if (!this.silenceStartTime) {
        this.silenceStartTime = Date.now();
      } else if (Date.now() - this.silenceStartTime > silenceThreshold) {
        // End of speech detected
        this.finishRecording();
        return;
      }
    } else {
      this.silenceStartTime = null;
    }

    // Max duration check
    const totalDuration =
      (this.audioBuffer.reduce((sum, b) => sum + b.length, 0) / 2 / this.recordingConfig.sampleRate) * 1000;
    if (totalDuration > this.recordingConfig.maxDuration) {
      this.finishRecording();
    }
  }

  private finishRecording(): void {
    this.isRecordingCommand = false;
    this.silenceStartTime = null;

    // Play "done" sound
    if (this.config.playSound) {
      playSound('Pop');
    }

    const audioBuffer = Buffer.concat(this.audioBuffer);
    this.audioBuffer = [];
    this.emit('command', audioBuffer);
  }

  stop(): void {
    this.isListening = false;
    this.isRecordingCommand = false;

    if (this.recordingProcess) {
      this.recordingProcess.kill();
      this.recordingProcess = null;
    }

    this.emit('stopped');
  }

  cleanup(): void {
    this.stop();

    if (this.stream) {
      try {
        this.stream.free();
      } catch {
        // Ignore cleanup errors
      }
      this.stream = null;
    }

    if (this.kws) {
      try {
        this.kws.free();
      } catch {
        // Ignore cleanup errors
      }
      this.kws = null;
    }
  }
}
