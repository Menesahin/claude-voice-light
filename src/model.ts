import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { pipeline } from 'stream/promises';
import * as tar from 'tar';
import unbzip2 from 'unbzip2-stream';
import { getModelsDir, getLocalModelsDir, loadConfig } from './config';
import { SHERPA_MODELS } from './stt/providers/sherpa-onnx';
import { KWS_MODEL } from './wake-word';

/**
 * Download a file from URL with progress indicator
 */
async function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);

    const request = (url.startsWith('https') ? https : http).get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        fs.unlinkSync(destPath);
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
          return;
        }
        reject(new Error('Redirect without location header'));
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const totalSize = parseInt(response.headers['content-length'] || '0', 10);
      let downloadedSize = 0;
      let lastPercent = 0;

      response.on('data', (chunk: Buffer) => {
        downloadedSize += chunk.length;
        if (totalSize > 0) {
          const percent = Math.floor((downloadedSize / totalSize) * 100);
          if (percent !== lastPercent && percent % 10 === 0) {
            process.stdout.write(`\r  Progress: ${percent}%`);
            lastPercent = percent;
          }
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        if (totalSize > 0) {
          process.stdout.write('\r  Progress: 100%\n');
        }
        resolve();
      });
    });

    request.on('error', (err) => {
      file.close();
      if (fs.existsSync(destPath)) {
        fs.unlinkSync(destPath);
      }
      reject(err);
    });

    file.on('error', (err) => {
      file.close();
      if (fs.existsSync(destPath)) {
        fs.unlinkSync(destPath);
      }
      reject(err);
    });
  });
}

/**
 * Extract a .tar.bz2 file using Node.js streams
 */
async function extractTarBz2(archivePath: string, destDir: string): Promise<void> {
  const source = fs.createReadStream(archivePath);
  const decompressor = unbzip2();
  const extractor = tar.extract({ cwd: destDir });

  await pipeline(source, decompressor, extractor);
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

  const archivePath = path.join(modelsDir, 'kws-model.tar.bz2');

  try {
    // Download using Node.js https
    await downloadFile(KWS_MODEL.url, archivePath);

    // Extract using Node.js streams
    console.log('Extracting model...');
    await extractTarBz2(archivePath, modelsDir);

    // Clean up
    fs.unlinkSync(archivePath);

    console.log('[OK] Keyword spotter model installed');
  } catch (error) {
    console.error('Failed to download KWS model:', error);
    // Cleanup on error
    if (fs.existsSync(archivePath)) {
      fs.unlinkSync(archivePath);
    }
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
    // Download using Node.js https
    await downloadFile(modelInfo.url, archivePath);

    // Extract using Node.js streams
    console.log('Extracting model files...');
    await extractTarBz2(archivePath, modelsDir);

    // Cleanup archive
    fs.unlinkSync(archivePath);

    console.log(`[OK] STT model (${modelId}) installed`);
  } catch (error) {
    console.error('Failed to download STT model:', error);
    // Cleanup on error
    if (fs.existsSync(archivePath)) {
      fs.unlinkSync(archivePath);
    }
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
