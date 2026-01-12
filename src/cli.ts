#!/usr/bin/env node

import { Command } from 'commander';
import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import {
  startListener,
  loadConfig,
  getConfigPath,
  getConfigValue,
  setConfigValue,
  resetConfig,
  checkModelsInstalled,
  downloadAllModels,
  getModelStatus,
  getPlatformSummary,
  getInstallInstructions,
  getConfigDir,
} from './index';

const program = new Command();

// Utility functions
function hasCommand(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isWayland(): boolean {
  return !!(process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland');
}

function getPackageManager(): 'apt' | 'dnf' | 'pacman' | 'brew' | null {
  if (hasCommand('apt')) return 'apt';
  if (hasCommand('dnf')) return 'dnf';
  if (hasCommand('pacman')) return 'pacman';
  if (hasCommand('brew')) return 'brew';
  return null;
}

async function askQuestion(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() !== 'n');
    });
  });
}

function getPidFile(): string {
  return path.join(getConfigDir(), 'daemon.pid');
}

function getLogFile(): string {
  return path.join(getConfigDir(), 'daemon.log');
}

function isRunning(): boolean {
  const pidFile = getPidFile();
  if (!fs.existsSync(pidFile)) return false;

  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    process.kill(pid, 0);
    return true;
  } catch {
    try { fs.unlinkSync(pidFile); } catch {}
    return false;
  }
}

function getDaemonPid(): number | null {
  const pidFile = getPidFile();
  if (!fs.existsSync(pidFile)) return null;
  try {
    return parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
  } catch {
    return null;
  }
}

program
  .name('claude-voice-light')
  .description('Lightweight voice input for Claude Code')
  .version('1.3.0');

// Setup command
program
  .command('setup')
  .description('Interactive setup - install dependencies and download models')
  .option('-y, --yes', 'Auto-confirm all prompts')
  .action(async (options) => {
    console.log('');
    console.log('Claude Voice Light - Setup');
    console.log('==========================');
    console.log('');

    const platform = process.platform;
    const wayland = isWayland();
    const pkgManager = getPackageManager();

    // Platform info
    console.log(`Platform: ${platform}`);
    if (platform === 'linux') {
      console.log(`Display: ${wayland ? 'Wayland' : 'X11'}`);
    }
    console.log(`Package manager: ${pkgManager || 'not detected'}`);
    console.log('');

    // Check dependencies
    console.log('Checking dependencies...');
    console.log('');

    interface Dep {
      name: string;
      command: string;
      packages: { apt?: string; dnf?: string; pacman?: string; brew?: string };
      required: boolean;
      description: string;
    }

    const deps: Dep[] = [];

    if (platform === 'darwin') {
      deps.push({
        name: 'sox',
        command: 'rec',
        packages: { brew: 'sox' },
        required: true,
        description: 'Audio capture'
      });
    }

    if (platform === 'linux') {
      // Audio capture
      deps.push({
        name: 'alsa-utils',
        command: 'arecord',
        packages: { apt: 'alsa-utils', dnf: 'alsa-utils', pacman: 'alsa-utils' },
        required: true,
        description: 'Audio capture (microphone)'
      });

      // Audio playback
      deps.push({
        name: 'pulseaudio-utils',
        command: 'paplay',
        packages: { apt: 'pulseaudio-utils', dnf: 'pulseaudio-utils', pacman: 'pulseaudio' },
        required: false,
        description: 'Audio playback (sounds)'
      });

      if (wayland) {
        // Wayland tools
        deps.push({
          name: 'wtype',
          command: 'wtype',
          packages: { apt: 'wtype', dnf: 'wtype', pacman: 'wtype' },
          required: true,
          description: 'Keyboard simulation (Wayland)'
        });
        deps.push({
          name: 'wl-clipboard',
          command: 'wl-copy',
          packages: { apt: 'wl-clipboard', dnf: 'wl-clipboard', pacman: 'wl-clipboard' },
          required: true,
          description: 'Clipboard (Wayland)'
        });
      } else {
        // X11 tools
        deps.push({
          name: 'xdotool',
          command: 'xdotool',
          packages: { apt: 'xdotool', dnf: 'xdotool', pacman: 'xdotool' },
          required: true,
          description: 'Keyboard simulation (X11)'
        });
        deps.push({
          name: 'xclip',
          command: 'xclip',
          packages: { apt: 'xclip', dnf: 'xclip', pacman: 'xclip' },
          required: true,
          description: 'Clipboard (X11)'
        });
      }
    }

    // Check each dependency
    const missing: Dep[] = [];
    const installed: Dep[] = [];

    for (const dep of deps) {
      const has = hasCommand(dep.command);
      if (has) {
        console.log(`  [OK] ${dep.name} - ${dep.description}`);
        installed.push(dep);
      } else {
        console.log(`  [X]  ${dep.name} - ${dep.description}`);
        missing.push(dep);
      }
    }
    console.log('');

    // Install missing dependencies
    if (missing.length > 0 && pkgManager) {
      const packages = missing
        .map(d => d.packages[pkgManager as keyof typeof d.packages])
        .filter(Boolean)
        .join(' ');

      if (packages) {
        console.log(`Missing packages: ${packages}`);
        console.log('');

        const shouldInstall = options.yes || await askQuestion('Install missing packages? [Y/n] ');

        if (shouldInstall) {
          console.log('');
          console.log('Installing...');

          let cmd = '';
          switch (pkgManager) {
            case 'apt':
              cmd = `sudo apt install -y ${packages}`;
              break;
            case 'dnf':
              cmd = `sudo dnf install -y ${packages}`;
              break;
            case 'pacman':
              cmd = `sudo pacman -S --noconfirm ${packages}`;
              break;
            case 'brew':
              cmd = `brew install ${packages}`;
              break;
          }

          try {
            execSync(cmd, { stdio: 'inherit' });
            console.log('');
            console.log('Packages installed successfully.');
          } catch (error) {
            console.error('');
            console.error('Failed to install packages. Try manually:');
            console.error(`  ${cmd}`);
          }
        }
      }
    } else if (missing.length > 0) {
      console.log('Could not detect package manager.');
      console.log('Please install manually:');
      missing.forEach(d => console.log(`  - ${d.name}: ${d.description}`));
    } else {
      console.log('All dependencies installed!');
    }
    console.log('');

    // Check models
    console.log('Checking models...');
    const modelStatus = checkModelsInstalled();

    console.log(`  Keyword spotter: ${modelStatus.kws ? '[OK]' : '[X] not installed'}`);
    console.log(`  STT model: ${modelStatus.stt ? '[OK]' : '[X] not installed'}`);
    console.log('');

    if (!modelStatus.kws || !modelStatus.stt) {
      const shouldDownload = options.yes || await askQuestion('Download missing models? [Y/n] ');

      if (shouldDownload) {
        console.log('');
        try {
          await downloadAllModels();
        } catch (error) {
          console.error('Failed to download models:', error);
        }
      }
    } else {
      console.log('All models installed!');
    }

    console.log('');
    console.log('Setup complete!');
    console.log('');
    console.log('Usage:');
    console.log('  claude-voice-light start    # Start in background');
    console.log('  claude-voice-light stop     # Stop');
    console.log('  claude-voice-light status   # Check status');
    console.log('');
  });

// Start command
program
  .command('start')
  .description('Start the voice listener (background by default)')
  .option('-f, --foreground', 'Run in foreground')
  .action(async (options) => {
    if (options.foreground) {
      if (process.env.CVL_DAEMON === '1') {
        const configDir = getConfigDir();
        if (!fs.existsSync(configDir)) {
          fs.mkdirSync(configDir, { recursive: true });
        }
        fs.writeFileSync(getPidFile(), String(process.pid));
      }

      try {
        await startListener();
      } catch (error) {
        console.error('Failed to start:', error);
        process.exit(1);
      }
    } else {
      if (isRunning()) {
        console.log('Already running. Use "claude-voice-light stop" first.');
        return;
      }

      const configDir = getConfigDir();
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      const logFile = getLogFile();
      const out = fs.openSync(logFile, 'a');
      const err = fs.openSync(logFile, 'a');

      const scriptPath = path.join(__dirname, 'cli.js');

      const child = spawn('node', [scriptPath, 'start', '-f'], {
        detached: true,
        stdio: ['ignore', out, err],
        env: { ...process.env, CVL_DAEMON: '1' }
      });

      child.unref();
      await new Promise(r => setTimeout(r, 500));

      console.log('Claude Voice Light started in background.');
      console.log(`Log: ${logFile}`);
      console.log('');
      console.log('Use "claude-voice-light stop" to stop.');
    }
  });

// Stop command
program
  .command('stop')
  .description('Stop the background voice listener')
  .action(() => {
    const pid = getDaemonPid();

    if (!pid) {
      console.log('Not running.');
      return;
    }

    try {
      process.kill(pid, 'SIGTERM');
      try { fs.unlinkSync(getPidFile()); } catch {}
      console.log('Stopped.');
    } catch {
      try { fs.unlinkSync(getPidFile()); } catch {}
      console.log('Stopped (was not running).');
    }
  });

// Restart command
program
  .command('restart')
  .description('Restart the voice listener')
  .action(async () => {
    const pid = getDaemonPid();
    if (pid) {
      try {
        process.kill(pid, 'SIGTERM');
        try { fs.unlinkSync(getPidFile()); } catch {}
      } catch {}
      await new Promise(r => setTimeout(r, 500));
    }

    const configDir = getConfigDir();
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    const logFile = getLogFile();
    const out = fs.openSync(logFile, 'a');
    const err = fs.openSync(logFile, 'a');

    const scriptPath = path.join(__dirname, 'cli.js');

    const child = spawn('node', [scriptPath, 'start', '-f'], {
      detached: true,
      stdio: ['ignore', out, err],
      env: { ...process.env, CVL_DAEMON: '1' }
    });

    child.unref();
    await new Promise(r => setTimeout(r, 500));

    console.log('Restarted.');
  });

// Status command
program
  .command('status')
  .description('Show status')
  .action(() => {
    const config = loadConfig();
    const modelStatus = checkModelsInstalled();
    const instructions = getInstallInstructions();
    const running = isRunning();
    const pid = getDaemonPid();

    console.log('');
    console.log('Claude Voice Light');
    console.log('==================');
    console.log('');

    console.log(`Status: ${running ? `running (PID: ${pid})` : 'stopped'}`);
    console.log('');

    console.log('Config:');
    console.log(`  Wake word: "${config.wakeWord.keyword}"`);
    console.log(`  Language: ${config.stt.language}`);
    console.log(`  STT model: ${config.stt.model}`);
    console.log('');

    console.log('Models:');
    console.log(`  Keyword spotter: ${modelStatus.kws ? 'OK' : 'NOT INSTALLED'}`);
    console.log(`  STT: ${modelStatus.stt ? 'OK' : 'NOT INSTALLED'}`);
    console.log('');

    if (instructions.length > 0) {
      console.log('Missing dependencies:');
      instructions.forEach(i => console.log(`  - ${i}`));
      console.log('');
    }

    if (!modelStatus.kws || !modelStatus.stt) {
      console.log('Run: claude-voice-light setup');
    }
  });

// Logs command
program
  .command('logs')
  .description('Show daemon logs')
  .option('-f, --follow', 'Follow log output')
  .option('-n, --lines <n>', 'Number of lines', '30')
  .action((options) => {
    const logFile = getLogFile();

    if (!fs.existsSync(logFile)) {
      console.log('No logs yet.');
      return;
    }

    if (options.follow) {
      const tail = spawn('tail', ['-f', logFile], { stdio: 'inherit' });
      process.on('SIGINT', () => {
        tail.kill();
        process.exit(0);
      });
    } else {
      spawn('tail', ['-n', options.lines, logFile], { stdio: 'inherit' });
    }
  });

// Config commands
const configCmd = program
  .command('config')
  .description('Configuration');

configCmd
  .command('show')
  .description('Show config')
  .action(() => {
    console.log(JSON.stringify(loadConfig(), null, 2));
  });

configCmd
  .command('get <key>')
  .description('Get config value')
  .action((key: string) => {
    const value = getConfigValue(key);
    if (value === undefined) {
      console.error(`Not found: ${key}`);
      process.exit(1);
    }
    console.log(typeof value === 'object' ? JSON.stringify(value, null, 2) : value);
  });

configCmd
  .command('set <keyValue>')
  .description('Set config value (key=value)')
  .action((keyValue: string) => {
    const [key, ...valueParts] = keyValue.split('=');
    const value = valueParts.join('=');

    if (!key || value === undefined) {
      console.error('Usage: config set key=value');
      process.exit(1);
    }

    setConfigValue(key, value);
    console.log(`${key} = ${value}`);
  });

configCmd
  .command('reset')
  .description('Reset to defaults')
  .action(() => {
    resetConfig();
    console.log('Reset to defaults.');
  });

configCmd.action(() => {
  console.log(JSON.stringify(loadConfig(), null, 2));
});

// Model commands
const modelCmd = program
  .command('model')
  .description('Manage models');

modelCmd
  .command('download')
  .description('Download required models')
  .action(async () => {
    try {
      await downloadAllModels();
    } catch (error) {
      console.error('Download failed:', error);
      process.exit(1);
    }
  });

modelCmd
  .command('status')
  .description('Show model status')
  .action(() => {
    console.log(getModelStatus());
  });

modelCmd.action(() => {
  console.log(getModelStatus());
});

program.parse();
