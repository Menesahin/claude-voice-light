#!/usr/bin/env node

import { Command } from 'commander';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
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

// PID file for daemon management
function getPidFile(): string {
  return path.join(getConfigDir(), 'daemon.pid');
}

function getLogFile(): string {
  return path.join(getConfigDir(), 'daemon.log');
}

function isRunning(): boolean {
  const pidFile = getPidFile();
  if (!fs.existsSync(pidFile)) {
    return false;
  }

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
  if (!fs.existsSync(pidFile)) {
    return null;
  }
  try {
    return parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
  } catch {
    return null;
  }
}

program
  .name('claude-voice-light')
  .description('Lightweight voice input for Claude Code')
  .version('1.2.0');

// Start command
program
  .command('start')
  .description('Start the voice listener (background by default)')
  .option('-f, --foreground', 'Run in foreground')
  .action(async (options) => {
    if (options.foreground) {
      // Foreground mode - write PID if running as daemon child
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
      // Background daemon mode
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

      // Wait a bit for the child to write its PID
      await new Promise(r => setTimeout(r, 500));

      console.log('Claude Voice Light started in background.');
      console.log(`Log: ${logFile}`);
      console.log('');
      console.log('Use "claude-voice-light stop" to stop.');
      console.log('Use "claude-voice-light logs -f" to follow logs.');
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
    } catch (error) {
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

    // Start in background
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
      console.log('Run: claude-voice-light model download');
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
