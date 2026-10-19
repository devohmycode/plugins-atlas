import { App, type AppProps, type WizardResult } from './App.js';
import { enableMouse } from './mouse.js';
import { renderTerminal } from './render.js';

export type WizardProps = Omit<AppProps, 'onDone'>;

/** Shows the wizard full screen and resolves with what it chose, or null when the user left. */
export async function runWizard(props: WizardProps, mouse = true): Promise<WizardResult | null> {
  let result: WizardResult | null = null;
  const restoreScreen = mouse ? enableMouse() : () => {};
  const app = renderTerminal(<App {...props} onDone={(r) => (result = r)} />);
  await app.waitUntilExit();
  restoreScreen();
  // Ink leaves stdin raw and flowing after unmounting, which keeps the process alive.
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdin.unref();
  return result;
}
