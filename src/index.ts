import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { loadConfig } from './config';
import { SherpaOnnxDetector } from './wake-word';
import { STTManager } from './stt';
import { sendToClaudeCode } from './terminal/input-injector';
import { saveToWav, createTempAudioPath, safeDeleteFile } from './utils/audio';
import { areAllModelsInstalled } from './model';

let detector: SherpaOnnxDetector | null = null;
let sttManager: STTManager | null = null;

/**
 * Start the voice listener
 */
export async function startListener(): Promise<void> {
  const config = loadConfig();

  console.log('');
  console.log('Claude Voice Light');
  console.log('==================');
  console.log('');

  // Check if models are installed
  if (!areAllModelsInstalled()) {
    console.error('Required models are not installed.');
    console.error('Run: claude-voice-light model download');
    process.exit(1);
  }

  console.log(`Wake word: "${config.wakeWord.keyword}"`);
  console.log(`Language: ${config.stt.language}`);
  console.log(`STT Model: ${config.stt.model}`);
  console.log('');
  console.log('Press Ctrl+C to stop.');
  console.log('');

  // Initialize STT
  sttManager = new STTManager(config.stt);

  // Initialize wake word detector
  detector = new SherpaOnnxDetector(config.wakeWord, config.recording);

  detector.on('wakeword', () => {
    console.log('Listening...');
  });

  detector.on('command', async (audioBuffer: Buffer) => {
    const tempPath = createTempAudioPath('cvl');

    try {
      // Save audio to WAV file
      saveToWav(audioBuffer, tempPath, config.recording.sampleRate, 1);

      // Transcribe
      const transcript = await sttManager!.transcribe(tempPath);

      if (transcript?.trim()) {
        console.log(`> ${transcript}`);

        // Send to terminal
        await sendToClaudeCode(transcript);
      } else {
        console.log('(no speech detected)');
      }
    } catch (error) {
      console.error('Transcription error:', error);
    } finally {
      // Clean up temp file
      safeDeleteFile(tempPath);
    }
  });

  detector.on('error', (error) => {
    console.error('Wake word detector error:', error);
  });

  // Initialize and start
  await detector.initialize();
  await detector.start();

  console.log('Listening for wake word...');
}

/**
 * Stop the listener
 */
export function stopListener(): void {
  if (detector) {
    detector.cleanup();
    detector = null;
  }
  sttManager = null;
  console.log('Stopped.');
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nStopping...');
  stopListener();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopListener();
  process.exit(0);
});

// Export for CLI
export { loadConfig, getConfigPath, getConfigDir, getConfigValue, setConfigValue, resetConfig } from './config';
export { checkModelsInstalled, downloadAllModels, getModelStatus } from './model';
export { getPlatformSummary, getInstallInstructions } from './platform';
