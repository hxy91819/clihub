import * as vscode from 'vscode';
import { execFile } from 'child_process';

const WRITE_TO_ITERM2_COMMAND = 'clihubLocal.writeToIterm2';
const ITERM2_WRITE_TEXT_SCRIPT = [
  'on run argv',
  '  if (count of argv) is 0 then error "Missing text to write."',
  '  set textToWrite to item 1 of argv',
  '  tell application "iTerm2"',
  '    activate',
  '    if (count of windows) is 0 then error "No iTerm2 windows are open."',
  '    tell current session of current window',
  '      write text textToWrite newline NO',
  '    end tell',
  '  end tell',
  'end run'
].join('\n');

export function buildIterm2WriteTextArgs(text: string): string[] {
  return ['-e', ITERM2_WRITE_TEXT_SCRIPT, text];
}

function execFileAsync(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function writeToIterm2(text: unknown): Promise<boolean> {
  if (typeof text !== 'string') {
    throw new Error('clihubLocal.writeToIterm2 requires a string argument.');
  }

  if (process.platform !== 'darwin') {
    throw new Error('CLI Hub Local Bridge iTerm2 sending is only supported on macOS.');
  }

  await execFileAsync('osascript', buildIterm2WriteTextArgs(text));
  return true;
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(WRITE_TO_ITERM2_COMMAND, writeToIterm2)
  );
}

export function deactivate(): void {
  // No persistent resources.
}
