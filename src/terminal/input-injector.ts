import { exec, execSync, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface InputInjectorOptions {
  terminal?: 'Terminal' | 'iTerm' | 'auto';
  pressEnter?: boolean;
  typingDelay?: number;
}

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

export class TerminalInputInjector {
  private terminal: 'Terminal' | 'iTerm';

  constructor(options: InputInjectorOptions = {}) {
    this.terminal = options.terminal === 'iTerm' ? 'iTerm' : 'Terminal';
  }

  async type(text: string, pressEnter = true): Promise<void> {
    if (process.platform === 'linux') {
      return this.typeLinux(text, pressEnter);
    }

    if (process.platform !== 'darwin') {
      throw new Error('Only macOS and Linux supported');
    }

    const escapedText = this.escapeForAppleScript(text);
    const script = this.generateAppleScript(escapedText, pressEnter);

    try {
      await this.runAppleScript(script);
    } catch (error) {
      const alt = this.terminal === 'Terminal' ? 'iTerm' : 'Terminal';
      await this.runAppleScript(this.generateAppleScript(escapedText, pressEnter, alt));
    }
  }

  private async runAppleScript(script: string): Promise<void> {
    const lines = script.split('\n').filter(line => line.trim());
    const args = lines.map(line => `-e '${line.replace(/'/g, "'\\''")}'`).join(' ');
    await execAsync(`osascript ${args}`);
  }

  async pressKey(key: string): Promise<void> {
    if (process.platform === 'linux') {
      if (isWayland() && hasCommand('wtype')) {
        const keyMap: Record<string, string> = {
          return: 'Return', enter: 'Return', tab: 'Tab', space: 'space', escape: 'Escape',
        };
        await execAsync(`wtype -k ${keyMap[key.toLowerCase()] || key}`);
      } else if (hasCommand('xdotool')) {
        await execAsync(`xdotool key ${key}`);
      }
      return;
    }

    if (process.platform === 'darwin') {
      const keyCode = this.getKeyCode(key);
      await execAsync(`osascript -e 'tell application "System Events" to key code ${keyCode}'`);
    }
  }

  private generateAppleScript(text: string, pressEnter: boolean, terminal?: string): string {
    const app = terminal || this.terminal;

    if (app === 'iTerm') {
      return `tell application "iTerm" to tell current session of current window to write text "${text}"${pressEnter ? '' : ' without newline'}`.replace(/\n/g, ' ');
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

  private async copyToClipboard(text: string): Promise<boolean> {
    if (isWayland() && hasCommand('wl-copy')) {
      return new Promise((resolve) => {
        const proc = spawn('wl-copy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
        proc.stdin.write(text);
        proc.stdin.end();
        proc.on('close', (code) => resolve(code === 0));
        proc.on('error', () => resolve(false));
      });
    }

    if (hasCommand('xclip')) {
      return new Promise((resolve) => {
        const proc = spawn('xclip', ['-selection', 'clipboard'], { stdio: ['pipe', 'ignore', 'ignore'] });
        proc.stdin.write(text);
        proc.stdin.end();
        proc.on('close', (code) => resolve(code === 0));
        proc.on('error', () => resolve(false));
      });
    }

    if (hasCommand('xsel')) {
      return new Promise((resolve) => {
        const proc = spawn('xsel', ['--clipboard', '--input'], { stdio: ['pipe', 'ignore', 'ignore'] });
        proc.stdin.write(text);
        proc.stdin.end();
        proc.on('close', (code) => resolve(code === 0));
        proc.on('error', () => resolve(false));
      });
    }

    return false;
  }

  private async typeLinux(text: string, pressEnter: boolean): Promise<void> {
    const wayland = isWayland();

    // Debug info
    console.log(`[paste] wayland=${wayland}`);
    console.log(`[paste] WAYLAND_DISPLAY=${process.env.WAYLAND_DISPLAY || 'not set'}`);
    console.log(`[paste] XDG_SESSION_TYPE=${process.env.XDG_SESSION_TYPE || 'not set'}`);
    console.log(`[paste] has wtype=${hasCommand('wtype')}`);
    console.log(`[paste] has wl-copy=${hasCommand('wl-copy')}`);
    console.log(`[paste] has xdotool=${hasCommand('xdotool')}`);

    // Method 1: Wayland - direct wtype
    if (wayland && hasCommand('wtype')) {
      try {
        // Escape single quotes for shell
        const escaped = text.replace(/'/g, "'\"'\"'");
        const cmd = `wtype -- '${escaped}'`;
        console.log(`[paste] trying: ${cmd}`);

        await execAsync(cmd);

        if (pressEnter) {
          await execAsync('wtype -k Return');
        }

        console.log(`[paste] wtype success!`);
        return;
      } catch (err: any) {
        console.error(`[paste] wtype direct failed: ${err.message}`);
      }
    }

    // Method 2: Wayland - clipboard + Ctrl+Shift+V
    if (wayland && hasCommand('wl-copy') && hasCommand('wtype')) {
      try {
        console.log(`[paste] trying clipboard method...`);
        const copied = await this.copyToClipboard(text);
        console.log(`[paste] clipboard copy: ${copied}`);

        if (copied) {
          await this.delay(100);

          // Ctrl+Shift+V
          console.log(`[paste] sending Ctrl+Shift+V...`);
          await execAsync('wtype -M ctrl -M shift -P v -m shift -m ctrl');

          if (pressEnter) {
            await this.delay(100);
            await execAsync('wtype -k Return');
          }

          console.log(`[paste] clipboard method success!`);
          return;
        }
      } catch (err: any) {
        console.error(`[paste] clipboard method failed: ${err.message}`);
      }
    }

    // Method 3: X11 - xdotool type
    if (!wayland && hasCommand('xdotool')) {
      try {
        const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
        console.log(`[paste] trying xdotool type...`);

        await execAsync(`xdotool type --clearmodifiers -- "${escaped}"`);

        if (pressEnter) {
          await this.delay(50);
          await execAsync('xdotool key Return');
        }

        console.log(`[paste] xdotool success!`);
        return;
      } catch (err: any) {
        console.error(`[paste] xdotool failed: ${err.message}`);
      }
    }

    // Method 4: X11 - clipboard + Ctrl+Shift+V
    if (!wayland && hasCommand('xdotool')) {
      try {
        console.log(`[paste] trying X11 clipboard method...`);
        const copied = await this.copyToClipboard(text);

        if (copied) {
          await this.delay(100);
          await execAsync('xdotool key --clearmodifiers ctrl+shift+v');

          if (pressEnter) {
            await this.delay(100);
            await execAsync('xdotool key Return');
          }

          console.log(`[paste] X11 clipboard success!`);
          return;
        }
      } catch (err: any) {
        console.error(`[paste] X11 clipboard failed: ${err.message}`);
      }
    }

    // Last resort: just copy to clipboard
    const copied = await this.copyToClipboard(text);
    if (copied) {
      console.log(`[paste] Text copied to clipboard. Press Ctrl+Shift+V to paste manually.`);
    } else {
      console.error(`[paste] All methods failed!`);
      throw new Error('Could not paste text. Install wtype + wl-clipboard (Wayland) or xdotool + xclip (X11)');
    }
  }

  private escapeForAppleScript(text: string): string {
    return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
  }

  private getKeyCode(key: string): number {
    const codes: Record<string, number> = { return: 36, enter: 36, tab: 48, space: 49, delete: 51, escape: 53 };
    return codes[key.toLowerCase()] || 0;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  static isInTerminal(): boolean {
    return !!(process.stdout.isTTY && (process.env.TERM || process.env.TERM_PROGRAM));
  }

  static detectTerminal(): 'Terminal' | 'iTerm' | 'unknown' {
    const p = process.env.TERM_PROGRAM;
    if (p === 'Apple_Terminal') return 'Terminal';
    if (p === 'iTerm.app') return 'iTerm';
    return 'unknown';
  }
}

export async function sendToClaudeCode(text: string): Promise<void> {
  const injector = new TerminalInputInjector({ terminal: 'auto' });
  await injector.type(text, true);
}
