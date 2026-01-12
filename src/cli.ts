#!/usr/bin/env node

import { Command } from 'commander';
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
} from './index';

const program = new Command();

program
  .name('claude-voice-light')
  .description('Lightweight voice input for Claude Code')
  .version('1.0.0');

// Start command
program
  .command('start')
  .description('Start the voice listener (Ctrl+C to stop)')
  .action(async () => {
    try {
      await startListener();
    } catch (error) {
      console.error('Failed to start:', error);
      process.exit(1);
    }
  });

// Status command
program
  .command('status')
  .description('Show status (models, config, platform)')
  .action(() => {
    const config = loadConfig();
    const modelStatus = checkModelsInstalled();
    const instructions = getInstallInstructions();

    console.log('');
    console.log('Claude Voice Light - Status');
    console.log('===========================');
    console.log('');

    console.log('Configuration:');
    console.log(`  Config file: ${getConfigPath()}`);
    console.log(`  Wake word: "${config.wakeWord.keyword}"`);
    console.log(`  Language: ${config.stt.language}`);
    console.log(`  STT model: ${config.stt.model}`);
    console.log('');

    console.log('Models:');
    console.log(`  Keyword spotter: ${modelStatus.kws ? 'installed' : 'NOT INSTALLED'}`);
    console.log(`  STT (${config.stt.model}): ${modelStatus.stt ? 'installed' : 'NOT INSTALLED'}`);
    console.log('');

    console.log('Platform:');
    console.log(getPlatformSummary().split('\n').map(l => `  ${l}`).join('\n'));
    console.log('');

    if (instructions.length > 0) {
      console.log('Required installations:');
      instructions.forEach(i => console.log(`  - ${i}`));
      console.log('');
    }

    if (!modelStatus.kws || !modelStatus.stt) {
      console.log('Run "claude-voice-light model download" to install missing models.');
      console.log('');
    }
  });

// Config commands
const configCmd = program
  .command('config')
  .description('View or modify configuration');

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const config = loadConfig();
    console.log(JSON.stringify(config, null, 2));
  });

configCmd
  .command('get <key>')
  .description('Get a config value (e.g., stt.language)')
  .action((key: string) => {
    const value = getConfigValue(key);
    if (value === undefined) {
      console.error(`Config key not found: ${key}`);
      process.exit(1);
    }
    console.log(typeof value === 'object' ? JSON.stringify(value, null, 2) : value);
  });

configCmd
  .command('set <keyValue>')
  .description('Set a config value (e.g., stt.language=tr)')
  .action((keyValue: string) => {
    const [key, ...valueParts] = keyValue.split('=');
    const value = valueParts.join('=');

    if (!key || value === undefined) {
      console.error('Usage: config set <key>=<value>');
      process.exit(1);
    }

    setConfigValue(key, value);
    console.log(`Set ${key} = ${value}`);
  });

configCmd
  .command('reset')
  .description('Reset configuration to defaults')
  .action(() => {
    resetConfig();
    console.log('Configuration reset to defaults.');
  });

configCmd
  .command('path')
  .description('Show config file path')
  .action(() => {
    console.log(getConfigPath());
  });

// Default config subcommand (show)
configCmd.action(() => {
  const config = loadConfig();
  console.log(JSON.stringify(config, null, 2));
});

// Model commands
const modelCmd = program
  .command('model')
  .description('Manage STT and wake word models');

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
  .description('Show model installation status')
  .action(() => {
    console.log(getModelStatus());
  });

// Default model subcommand (status)
modelCmd.action(() => {
  console.log(getModelStatus());
});

// Parse arguments
program.parse();
