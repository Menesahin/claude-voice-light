import { exec, execSync, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface InputInjectorOptions {
  terminal?: 'Terminal' | 'iTerm' | 'auto';
  pressEnter?: boolean;
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
 * Check if running on Wayland
 */
function isWayland(): boolean {
  return !!(process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland');
}

/**
 * Injects text into the terminal
 */
export class TerminalInputInjector {
  private terminal: 'Terminal' | 'iTerm';

  constructor(options: InputInjectorOptions = {}) {
    if (options.terminal === 'auto' || !options.terminal) {
      this.terminal = 'Terminal';
    } else {
      this.terminal = options.terminal;
    }
  }

  async type(text: string, pressEnter = true): Promise<void> {
    if (process.platform === 'linux') {
      return this.typeLinux(text, pressEnter);
    }

    if (process.platform !== 'darwin') {
      throw new Error('Terminal input injection is only supported on macOS and Linux');
    }

    const escapedText = this.escapeForAppleScript(text);
    const script = this.generateAppleScript(escapedText, pressEnter);

    try {
      await this.runAppleScript(script);
    } catch (error) {
      const alternateTerminal = this.terminal === 'Terminal' ? 'iTerm' : 'Terminal';
      const alternateScript = this.generateAppleScript(escapedText, pressEnter, alternateTerminal);

      try {
        await this.runAppleScript(alternateScript);
      } catch {
        throw new Error(`Failed to inject text into terminal: ${error}`);
      }
    }
  }

  private async runAppleScript(script: string): Promise<void> {
    const lines = script.split('\n').filter(line => line.trim());
    const args = lines.map(line => `-e '${line.replace(/'/g, "'\\''")}'`).join(' ');
    await execAsync(`osascript ${args}`);
  }

  async typeSlowly(text: string, delayMs = 50, pressEnter = true): Promise<void> {
    for (const char of text) {
      await this.type(char, false);
      await this.delay(delayMs);
    }
    if (pressEnter) {
      await this.pressKey('return');
    }
  }

  async pressKey(key: string): Promise<void> {
    if (process.platform === 'linux') {
      if (isWayland() && hasCommand('wtype')) {
        const keyMap: Record<string, string> = {
          return: 'Return',
          enter: 'Return',
          tab: 'Tab',
          space: 'space',
          escape: 'Escape',
        };
        const wtypeKey = keyMap[key.toLowerCase()] || key;
        await execAsync(`wtype -k ${wtypeKey}`);
      } else if (hasCommand('xdotool')) {
        await execAsync(`xdotool key ${key}`);
      } else {
        throw new Error('No input tool found. Install wtype (Wayland) or xdotool (X11).');
      }
      return;
    }

    if (process.platform !== 'darwin') {
      throw new Error('Key press simulation is only supported on macOS and Linux');
    }

    const keyCode = this.getKeyCode(key);
    const script = `tell application "System Events" to key code ${keyCode}`;
    await execAsync(`osascript -e '${script}'`);
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
   * Copy text to clipboard on Linux
   */
  private async copyToClipboard(text: string): Promise<boolean> {
    // Wayland: use wl-copy
    if (isWayland() && hasCommand('wl-copy')) {
      return new Promise((resolve) => {
        const proc = spawn('wl-copy', [], {
          stdio: ['pipe', 'ignore', 'ignore']
        });
        proc.stdin.write(text);
        proc.stdin.end();
        proc.on('close', (code) => resolve(code === 0));
        proc.on('error', () => resolve(false));
      });
    }

    // X11: try xclip
    if (hasCommand('xclip')) {
      return new Promise((resolve) => {
        const proc = spawn('xclip', ['-selection', 'clipboard'], {
          stdio: ['pipe', 'ignore', 'ignore']
        });
        proc.stdin.write(text);
        proc.stdin.end();
        proc.on('close', (code) => resolve(code === 0));
        proc.on('error', () => resolve(false));
      });
    }

    // X11: try xsel
    if (hasCommand('xsel')) {
      return new Promise((resolve) => {
        const proc = spawn('xsel', ['--clipboard', '--input'], {
          stdio: ['pipe', 'ignore', 'ignore']
        });
        proc.stdin.write(text);
        proc.stdin.end();
        proc.on('close', (code) => resolve(code === 0));
        proc.on('error', () => resolve(false));
      });
    }

    return false;
  }

  /**
   * Types text into the active terminal on Linux
   */
  private async typeLinux(text: string, pressEnter: boolean): Promise<void> {
    const wayland = isWayland();

    // Method 1: Direct typing with wtype (Wayland) - BEST for Wayland
    if (wayland && hasCommand('wtype')) {
      try {
        // wtype types text directly, very reliable on Wayland
        const fullText = pressEnter ? text + '\n' : text;
        await execAsync(`wtype "${fullText.replace(/"/g, '\\"')}"`);
        return;
      } catch (error) {
        console.error('wtype failed:', error);
      }
    }

    // Method 2: Clipboard + paste shortcut
    const copied = await this.copyToClipboard(text);

    if (copied) {
      await this.delay(50);

      if (wayland && hasCommand('wtype')) {
        // Wayland: Ctrl+Shift+V with wtype
        try {
          await execAsync('wtype -M ctrl -M shift -k v -m shift -m ctrl');
          if (pressEnter) {
            await this.delay(100);
            await execAsync('wtype -k Return');
          }
          return;
        } catch (error) {
          console.error('wtype paste failed:', error);
        }
      } else if (hasCommand('xdotool')) {
        // X11: Ctrl+Shift+V with xdotool
        try {
          await execAsync('xdotool key --clearmodifiers ctrl+shift+v');
          if (pressEnter) {
            await this.delay(100);
            await execAsync('xdotool key Return');
          }
          return;
        } catch (error) {
          console.error('xdotool paste failed:', error);
        }
      }
    }

    // Method 3: Direct typing with xdotool (X11 fallback)
    if (!wayland && hasCommand('xdotool')) {
      const escapedText = text
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/`/g, '\\`')
        .replace(/\$/g, '\\$');

      try {
        await execAsync(`xdotool type --clearmodifiers -- "${escapedText}"`);
        if (pressEnter) {
          await this.delay(50);
          await execAsync('xdotool key Return');
        }
        return;
      } catch (error) {
        throw new Error(`xdotool failed: ${error}`);
      }
    }

    // No tool available
    const toolSuggestion = wayland
      ? 'sudo apt install wtype wl-clipboard'
      : 'sudo apt install xdotool xclip';

    throw new Error(
      `No input tool found for ${wayland ? 'Wayland' : 'X11'}.\n` +
      `Install with: ${toolSuggestion}`
    );
  }

  private escapeForAppleScript(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }

  private getKeyCode(key: string): number {
    const keyCodes: Record<string, number> = {
      return: 36, enter: 36, tab: 48, space: 49, delete: 51,
      escape: 53, command: 55, shift: 56, capslock: 57,
      option: 58, control: 59, fn: 63,
    };
    return keyCodes[key.toLowerCase()] || 0;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  static isInTerminal(): boolean {
    return !!(process.stdout.isTTY && (process.env.TERM || process.env.TERM_PROGRAM));
  }

  static detectTerminal(): 'Terminal' | 'iTerm' | 'unknown' {
    const termProgram = process.env.TERM_PROGRAM;
    if (termProgram === 'Apple_Terminal') return 'Terminal';
    if (termProgram === 'iTerm.app') return 'iTerm';
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
