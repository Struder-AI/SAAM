import {spawn,execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Reports dispatch, not proof that a browser rendered the page. Background
// development instances and test runs never touch a browser.
export const background = process.env.SAAM_BACKGROUND === '1' || Boolean(process.env.NODE_TEST_CONTEXT);
export async function openBrowser(url) {
  if (background) return false;
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  return new Promise(resolveOpen => {
    try {
      const child = spawn(command, args, {stdio: 'ignore', windowsHide: true});
      child.once('error', () => resolveOpen(false));
      child.once('spawn', () => { child.unref(); resolveOpen(true); });
    } catch { resolveOpen(false); }
  });
}
const script = name => fileURLToPath(new URL(name, import.meta.url));
// The command that brings the browser window and tab showing url forward; it prints
// raised, found (the system kept the foreground elsewhere) or not-found.
// raise-window.ps1 and raise-window.jxa own how each system finds them.
export function raiseCommand(url) {
  const {port} = new URL(url);
  if (process.platform === 'win32') return ['powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', script('raise-window.ps1'), '-Port', port]];
  if (process.platform === 'darwin') return ['/usr/bin/osascript', ['-l', 'JavaScript', script('raise-window.jxa'), url]];
  return null;
}
// Shows the Studio a control open answered for the person's own launch. Only this
// process, which that launch started, may take the foreground: raise brings the
// window someone views forward (opening it when no browser window is found), open
// opens it, opening means a tab is already on its way. packaging/tray.ps1 and
// tray.applescript do the same for a tray click.
export async function showOpened(opened) {
  const {url, display} = opened ?? {};
  if (background || !url) return false;
  const raise = display === 'raise' && raiseCommand(url);
  if (raise) {
    const outcome = await new Promise(done => execFile(raise[0], raise[1], {windowsHide: true}, (error, stdout) => done(error ? 'not-found' : stdout.trim())));
    if (outcome !== 'not-found') return true;
  }
  return display === 'raise' || display === 'open' ? openBrowser(url) : false;
}
