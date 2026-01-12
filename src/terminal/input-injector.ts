import { exec, execSync } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface InputInjectorOptions {
  /**
   * Target terminal application
   */
  terminal?: 'Terminal' | 'iTerm' | 'auto';

  /**
   * Whether to simulate pressing Enter after typing
   */
  pressEnter?: boolean;

  /**
   * Delay between characters in milliseconds (for slow typing effect)
   */
  typingDelay?: number;
}

/**
 * Check if a command exists in PATH
 */
function hasCommand(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Injects text into the terminal using AppleScript on macOS or xdotool on Linux.
 * This allows voice-transcribed text to be sent to Claude Code.
 */
export class TerminalInputInjector {
  private terminal: 'Terminal' | 'iTerm';

  constructor(options: InputInjectorOptions = {}) {
    if (options.terminal === 'auto' || !options.terminal) {
      // Auto-detect: prefer iTerm if running, otherwise Terminal
      this.terminal = 'Terminal';
    } else {
      this.terminal = options.terminal;
    }
  }

  /**
   * Types text into the active terminal window
   */
  async type(text: string, pressEnter = true): Promise<void> {
    if (process.platform === 'linux') {
      return this.typeLinux(text, pressEnter);
    }

    if (process.platform !== 'darwin') {
      throw new Error('Terminal input injection is only supported on macOS and Linux');
    }

    // Escape special characters for AppleScript
    const escapedText = this.escapeForAppleScript(text);

    const script = this.generateAppleScript(escapedText, pressEnter);

    try {
      await this.runAppleScript(script);
    } catch (error) {
      // Try the other terminal app
      const alternateTerminal = this.terminal === 'Terminal' ? 'iTerm' : 'Terminal';
      const alternateScript = this.generateAppleScript(escapedText, pressEnter, alternateTerminal);

      try {
        await this.runAppleScript(alternateScript);
      } catch {
        throw new Error(`Failed to inject text into terminal: ${error}`);
      }
    }
  }

  /**
   * Runs an AppleScript, handling multi-line scripts properly
   */
  private async runAppleScript(script: string): Promise<void> {
    // Split script into lines and use multiple -e arguments
    const lines = script.split('\n').filter(line => line.trim());
    const args = lines.map(line => `-e '${line.replace(/'/g, "'\\''")}'`).join(' ');
    await execAsync(`osascript ${args}`);
  }

  /**
   * Types text character by character with a delay (for visual effect)
   */
  async typeSlowly(text: string, delayMs = 50, pressEnter = true): Promise<void> {
    for (const char of text) {
      await this.type(char, false);
      await this.delay(delayMs);
    }

    if (pressEnter) {
      await this.pressKey('return');
    }
  }

  /**
   * Simulates pressing a key
   */
  async pressKey(key: string): Promise<void> {
    if (process.platform === 'linux') {
      // Use xdotool for Linux
      if (!hasCommand('xdotool')) {
        throw new Error('xdotool not found. Install with: sudo apt install xdotool');
      }
      await execAsync(`xdotool key ${key}`);
      return;
    }

    if (process.platform !== 'darwin') {
      throw new Error('Key press simulation is only supported on macOS and Linux');
    }

    const keyCode = this.getKeyCode(key);
    const script = `
      tell application "System Events"
        key code ${keyCode}
      end tell
    `;

    await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
  }

  private generateAppleScript(text: string, pressEnter: boolean, terminal?: string): string {
    const app = terminal || this.terminal;

    if (app === 'iTerm') {
      return `
        tell application "iTerm"
          tell current session of current window
            write text "${text}"${pressEnter ? '' : ' without newline'}
          end tell
        end tell
      `.replace(/\n/g, ' ');
    }

    // Default: Terminal.app
    // For Terminal, we use System Events to type
    // Note: keystroke and key code must be separate statements
    // Added delay before Enter to prevent race condition
    if (pressEnter) {
      return `tell application "Terminal" to activate
delay 0.1
tell application "System Events"
keystroke "${text}"
delay 0.15
key code 36
end tell`;
    }

    return `tell application "Terminal" to activate
delay 0.1
tell application "System Events"
keystroke "${text}"
end tell`;
  }

  /**
   * Types text into the active terminal using xdotool on Linux
   */
  private async typeLinux(text: string, pressEnter: boolean): Promise<void> {
    // Check for xdotool
    if (!hasCommand('xdotool')) {
      throw new Error(
        'xdotool not found. Install it with: sudo apt install xdotool\n' +
        'Note: xdotool works with X11. For Wayland, use ydotool.'
      );
    }

    // Escape special characters for shell
    const escapedText = text
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$');

    try {
      // Type the text using xdotool
      await execAsync(`xdotool type --clearmodifiers "${escapedText}"`);

      // Press Enter if requested
      if (pressEnter) {
        await execAsync('xdotool key Return');
      }
    } catch (error) {
      throw new Error(`Failed to inject text via xdotool: ${error}`);
    }
  }

  private escapeForAppleScript(text: string): string {
    return text
      .replace(/\\/g, '\\\\') // Escape backslashes first
      .replace(/"/g, '\\"') // Escape double quotes
      .replace(/\n/g, '\\n') // Escape newlines
      .replace(/\r/g, '\\r') // Escape carriage returns
      .replace(/\t/g, '\\t'); // Escape tabs
  }

  private getKeyCode(key: string): number {
    const keyCodes: Record<string, number> = {
      return: 36,
      enter: 36,
      tab: 48,
      space: 49,
      delete: 51,
      escape: 53,
      command: 55,
      shift: 56,
      capslock: 57,
      option: 58,
      control: 59,
      fn: 63,
      f1: 122,
      f2: 120,
      f3: 99,
      f4: 118,
      f5: 96,
      f6: 97,
      f7: 98,
      f8: 100,
      f9: 101,
      f10: 109,
      f11: 103,
      f12: 111,
      home: 115,
      pageup: 116,
      forwarddelete: 117,
      end: 119,
      pagedown: 121,
      left: 123,
      right: 124,
      down: 125,
      up: 126,
    };

    return keyCodes[key.toLowerCase()] || 0;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Check if we're running inside a terminal
   */
  static isInTerminal(): boolean {
    return !!(process.stdout.isTTY && (process.env.TERM || process.env.TERM_PROGRAM));
  }

  /**
   * Detect the current terminal application
   */
  static detectTerminal(): 'Terminal' | 'iTerm' | 'unknown' {
    const termProgram = process.env.TERM_PROGRAM;

    if (termProgram === 'Apple_Terminal') {
      return 'Terminal';
    }

    if (termProgram === 'iTerm.app') {
      return 'iTerm';
    }

    return 'unknown';
  }
}

/**
 * Convenience function to send voice-transcribed text to Claude Code
 */
export async function sendToClaudeCode(text: string): Promise<void> {
  const injector = new TerminalInputInjector({ terminal: 'auto' });
  await injector.type(text, true);
}
