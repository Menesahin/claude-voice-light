import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { getModelsDir, getLocalModelsDir, loadConfig } from './config';
import { SHERPA_MODELS } from './stt/providers/sherpa-onnx';
import { KWS_MODEL } from './wake-word';

/**
 * Check if required tools are installed
 */
function checkDependencies(): void {
  const platform = os.platform();
  const missing: string[] = [];

  // Check curl
  try {
    execSync('which curl', { stdio: 'ignore' });
  } catch {
    missing.push('curl');
  }

  // Check tar
  try {
    execSync('which tar', { stdio: 'ignore' });
  } catch {
    missing.push('tar');
  }

  // Check bzip2 (needed for .tar.bz2)
  try {
    execSync('which bzip2', { stdio: 'ignore' });
  } catch {
    missing.push('bzip2');
  }

  if (missing.length > 0) {
    console.error('\nMissing required tools:', missing.join(', '));
    console.error('');
    if (platform === 'linux') {
      console.error('Install with: sudo apt install ' + missing.join(' '));
    } else if (platform === 'darwin') {
      console.error('Install with: brew install ' + missing.join(' '));
    }
    console.error('');
    process.exit(1);
  }
}

/**
 * Check if required models are installed
 */
export function checkModelsInstalled(): { kws: boolean; stt: boolean } {
  const modelsDir = getModelsDir();
  const config = loadConfig();

  const kwsPath = path.join(modelsDir, KWS_MODEL.folder);
  const sttModel = SHERPA_MODELS[config.stt.model];
  const sttPath = sttModel ? path.join(modelsDir, sttModel.folder) : '';

  return {
    kws: fs.existsSync(kwsPath),
    stt: sttPath ? fs.existsSync(sttPath) : false,
  };
}

/**
 * Check if all required models are installed
 */
export function areAllModelsInstalled(): boolean {
  const status = checkModelsInstalled();
  return status.kws && status.stt;
}

/**
 * Download all required models
 */
export async function downloadAllModels(): Promise<void> {
  // Check for required tools first
  checkDependencies();

  const config = loadConfig();
  const modelsDir = getLocalModelsDir();

  // Create models directory
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
  }

  console.log('Downloading required models...\n');

  // Download KWS model
  await downloadKwsModel();

  // Download STT model
  await downloadSttModel(config.stt.model);

  console.log('\nAll models installed!');
}

/**
 * Download keyword spotting model
 */
export async function downloadKwsModel(): Promise<void> {
  const modelsDir = getLocalModelsDir();
  const modelPath = path.join(modelsDir, KWS_MODEL.folder);

  if (fs.existsSync(modelPath)) {
    console.log(`[OK] Keyword spotter model already installed`);
    return;
  }

  // Create models directory
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
  }

  console.log(`Downloading ${KWS_MODEL.name} (${KWS_MODEL.size})...`);

  const tarPath = path.join(modelsDir, 'kws-model.tar.bz2');

  try {
    // Download using curl
    execSync(`curl -L --progress-bar -o "${tarPath}" "${KWS_MODEL.url}"`, { stdio: 'inherit' });

    // Extract
    console.log('Extracting model...');
    execSync(`tar -xjf "${tarPath}" -C "${modelsDir}"`, { stdio: 'pipe' });

    // Clean up
    fs.unlinkSync(tarPath);

    console.log('[OK] Keyword spotter model installed');
  } catch (error) {
    console.error('Failed to download KWS model:', error);
    throw error;
  }
}

/**
 * Download STT model
 */
export async function downloadSttModel(modelId: string): Promise<void> {
  const modelInfo = SHERPA_MODELS[modelId as keyof typeof SHERPA_MODELS];
  if (!modelInfo) {
    throw new Error(`Unknown model: ${modelId}`);
  }

  const modelsDir = getLocalModelsDir();
  const modelPath = path.join(modelsDir, modelInfo.folder);

  if (fs.existsSync(modelPath)) {
    console.log(`[OK] STT model (${modelId}) already installed`);
    return;
  }

  // Create models directory
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
  }

  console.log(`Downloading ${modelInfo.name}...`);

  const archivePath = path.join(modelsDir, `${modelId}.tar.bz2`);

  try {
    // Download with curl
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

    console.log(`[OK] STT model (${modelId}) installed`);
  } catch (error) {
    console.error('Failed to download STT model:', error);
    throw error;
  }
}

/**
 * Get model status summary
 */
export function getModelStatus(): string {
  const status = checkModelsInstalled();
  const config = loadConfig();
  const modelsDir = getModelsDir();

  const lines: string[] = [];
  lines.push(`Models directory: ${modelsDir}`);
  lines.push('');
  lines.push(`Keyword Spotter: ${status.kws ? 'installed' : 'not installed'}`);
  lines.push(`STT Model (${config.stt.model}): ${status.stt ? 'installed' : 'not installed'}`);

  if (!status.kws || !status.stt) {
    lines.push('');
    lines.push('Run "claude-voice-light model download" to install missing models.');
  }

  return lines.join('\n');
}
