import { execSync } from 'child_process';
import * as os from 'os';

export type Platform = 'darwin' | 'linux' | 'unsupported';

export interface PlatformCapabilities {
  platform: Platform;
  audioCapture: 'sox' | 'arecord' | 'none';
  audioPlayer: string;
  terminalInjection: 'applescript' | 'xdotool' | 'ydotool' | 'none';
  supportsWakeWord: boolean;
}

/**
 * Get the current platform
 */
export function getPlatform(): Platform {
  const platform = os.platform();
  if (platform === 'darwin') return 'darwin';
  if (platform === 'linux') return 'linux';
  return 'unsupported';
}

/**
 * Check if a command is available in PATH
 */
export function hasCommand(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get platform-specific capabilities
 */
export function getPlatformCapabilities(): PlatformCapabilities {
  const platform = getPlatform();

  if (platform === 'darwin') {
    return {
      platform: 'darwin',
      audioCapture: hasCommand('rec') ? 'sox' : 'none',
      audioPlayer: 'afplay',
      terminalInjection: 'applescript',
      supportsWakeWord: true,
    };
  }

  if (platform === 'linux') {
    // Determine terminal injection method
    let terminalInjection: 'xdotool' | 'ydotool' | 'none' = 'none';
    if (hasCommand('xdotool')) {
      terminalInjection = 'xdotool';
    } else if (hasCommand('ydotool')) {
      terminalInjection = 'ydotool';
    }

    // Determine audio capture method
    let audioCapture: 'sox' | 'arecord' | 'none' = 'none';
    if (hasCommand('arecord')) {
      audioCapture = 'arecord';
    } else if (hasCommand('rec')) {
      audioCapture = 'sox';
    }

    // Determine audio player
    let audioPlayer = '';
    if (hasCommand('ffplay')) {
      audioPlayer = 'ffplay';
    } else if (hasCommand('aplay')) {
      audioPlayer = 'aplay';
    } else if (hasCommand('paplay')) {
      audioPlayer = 'paplay';
    }

    return {
      platform: 'linux',
      audioCapture,
      audioPlayer,
      terminalInjection,
      supportsWakeWord: audioCapture !== 'none',
    };
  }

  return {
    platform: 'unsupported',
    audioCapture: 'none',
    audioPlayer: '',
    terminalInjection: 'none',
    supportsWakeWord: false,
  };
}

/**
 * Get platform-specific installation instructions
 */
export function getInstallInstructions(): string[] {
  const platform = getPlatform();
  const caps = getPlatformCapabilities();
  const instructions: string[] = [];

  if (platform === 'darwin') {
    if (caps.audioCapture === 'none') {
      instructions.push('Install sox for audio capture: brew install sox');
    }
  }

  if (platform === 'linux') {
    if (caps.audioCapture === 'none') {
      instructions.push('Install ALSA utils for audio capture: sudo apt install alsa-utils');
    }
    if (caps.terminalInjection === 'none') {
      instructions.push('Install xdotool for terminal injection: sudo apt install xdotool');
    }
    if (!caps.audioPlayer) {
      instructions.push('Install ffmpeg for audio playback: sudo apt install ffmpeg');
    }
  }

  if (platform === 'unsupported') {
    instructions.push('This platform is not supported.');
  }

  return instructions;
}

/**
 * Check if the platform is supported
 */
export function isPlatformSupported(): boolean {
  return getPlatform() !== 'unsupported';
}

/**
 * Get a summary of platform status
 */
export function getPlatformSummary(): string {
  const caps = getPlatformCapabilities();
  const lines: string[] = [];

  lines.push(`Platform: ${caps.platform}`);
  lines.push(`Audio Capture: ${caps.audioCapture}`);
  lines.push(`Audio Player: ${caps.audioPlayer || 'not available'}`);
  lines.push(`Terminal Injection: ${caps.terminalInjection}`);
  lines.push(`Wake Word Support: ${caps.supportsWakeWord ? 'yes' : 'no'}`);

  return lines.join('\n');
}
