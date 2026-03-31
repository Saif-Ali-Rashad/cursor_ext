import * as vscode from 'vscode';
import * as path from 'path';

// ── Fisher-Yates shuffle ─────────────────────────────────────────────────────
function shuffle<T>(array: T[]): T[] {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── State ────────────────────────────────────────────────────────────────────
interface NavigatorState {
  queue: vscode.Uri[];
  index: number;
  history: vscode.Uri[];
}

let state: NavigatorState = { queue: [], index: -1, history: [] };
let statusBarItem: vscode.StatusBarItem;
let timerStatusBarItem: vscode.StatusBarItem;

// ── Auto-advance timer ────────────────────────────────────────────────────────
let autoTimer: ReturnType<typeof setInterval> | undefined;
let countdownTimer: ReturnType<typeof setInterval> | undefined;
let secondsRemaining = 0;
let timerRunning = false;

function clearTimers(): void {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = undefined; }
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = undefined; }
}

function updateTimerStatusBar(): void {
  if (!timerRunning) {
    timerStatusBarItem.text = '$(clock) RFN: off';
    timerStatusBarItem.tooltip = 'Random File Navigator — auto-advance is off\nClick to start';
    timerStatusBarItem.color = undefined;
  } else {
    const interval = cfg<number>('autoAdvanceInterval');
    timerStatusBarItem.text = `$(sync~spin) RFN: ${secondsRemaining}s`;
    timerStatusBarItem.tooltip =
      `Random File Navigator — auto-advance every ${interval}s\nNext file in ${secondsRemaining}s\nClick to stop`;
    timerStatusBarItem.color = new vscode.ThemeColor('statusBarItem.warningForeground');
  }
  timerStatusBarItem.show();
}

function startAutoAdvance(): void {
  if (timerRunning) return;

  const interval = cfg<number>('autoAdvanceInterval');
  if (!interval || interval < 1) {
    vscode.window.showWarningMessage(
      'Random File Navigator: Set "randomFileNavigator.autoAdvanceInterval" (seconds) in settings first.'
    );
    return;
  }

  timerRunning = true;
  secondsRemaining = interval;
  updateTimerStatusBar();

  // Countdown tick every second for the status bar display
  countdownTimer = setInterval(() => {
    secondsRemaining--;
    if (secondsRemaining < 0) secondsRemaining = interval;
    updateTimerStatusBar();
  }, 1000);

  // Actual file switch on the full interval
  autoTimer = setInterval(() => {
    secondsRemaining = interval;
    nextFile();
  }, interval * 1000);

  vscode.window.setStatusBarMessage(
    `$(sync~spin) Random File Navigator: auto-advance every ${interval}s`,
    3000
  );
}

function stopAutoAdvance(): void {
  if (!timerRunning) return;
  timerRunning = false;
  clearTimers();
  updateTimerStatusBar();
  vscode.window.setStatusBarMessage('$(circle-slash) Random File Navigator: auto-advance stopped', 2500);
}

function toggleAutoAdvance(): void {
  timerRunning ? stopAutoAdvance() : startAutoAdvance();
}

async function setIntervalAndStart(): Promise<void> {
  const input = await vscode.window.showInputBox({
    title: 'Random File Navigator — Auto-advance interval',
    prompt: 'How many seconds between each file switch?',
    value: String(cfg<number>('autoAdvanceInterval') || 30),
    validateInput: (v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) return 'Enter a whole number ≥ 1';
      return null;
    },
  });

  if (input === undefined) return; // user cancelled

  const seconds = parseInt(input, 10);

  await vscode.workspace
    .getConfiguration('randomFileNavigator')
    .update('autoAdvanceInterval', seconds, vscode.ConfigurationTarget.Global);

  stopAutoAdvance();
  startAutoAdvance();

  vscode.window.showInformationMessage(
    `Random File Navigator: auto-advance set to every ${seconds} second${seconds === 1 ? '' : 's'}.`
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function cfg<T>(key: string): T {
  return vscode.workspace.getConfiguration('randomFileNavigator').get<T>(key) as T;
}

async function buildQueue(): Promise<vscode.Uri[]> {
  const includePatterns = cfg<string[]>('includePatterns');
  const excludePatterns = cfg<string[]>('excludePatterns');

  const excludeGlob =
    excludePatterns.length > 0 ? `{${excludePatterns.join(',')}}` : undefined;

  const results: vscode.Uri[] = [];

  for (const pattern of includePatterns) {
    const found = await vscode.workspace.findFiles(pattern, excludeGlob);
    results.push(...found);
  }

  const seen = new Set<string>();
  return results.filter((u) => {
    if (seen.has(u.fsPath)) return false;
    seen.add(u.fsPath);
    return true;
  });
}

function updateStatusBar(): void {
  if (!cfg<boolean>('showProgressInStatusBar')) {
    statusBarItem.hide();
    return;
  }

  if (state.queue.length === 0) {
    statusBarItem.text = '$(file-symlink-file) RFN: no files';
    statusBarItem.tooltip = 'Random File Navigator — queue is empty';
  } else {
    const pos = state.index + 1;
    const total = state.queue.length;
    const name = path.basename(state.queue[state.index]?.fsPath ?? '');
    statusBarItem.text = `$(file-symlink-file) RFN: ${pos}/${total}`;
    statusBarItem.tooltip = `Random File Navigator\n${name}\nPress Ctrl+Shift+] for next • Ctrl+Shift+[ for previous`;
  }
  statusBarItem.show();
}

async function openFile(uri: vscode.Uri): Promise<void> {
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch {
    vscode.window.showWarningMessage(
      `Random File Navigator: Could not open ${uri.fsPath}`
    );
  }
}

async function ensureQueue(forceRebuild = false): Promise<boolean> {
  if (state.queue.length === 0 || forceRebuild) {
    vscode.window.setStatusBarMessage('$(sync~spin) Random File Navigator: building queue…', 3000);
    const files = await buildQueue();

    if (files.length === 0) {
      vscode.window.showWarningMessage(
        'Random File Navigator: No files found in workspace.'
      );
      return false;
    }

    state.queue = shuffle(files);
    state.index = -1;
    state.history = [];
    vscode.window.setStatusBarMessage(
      `$(check) Random File Navigator: ${files.length} files shuffled`,
      2500
    );
  }
  return true;
}

// ── Commands ─────────────────────────────────────────────────────────────────
async function nextFile(): Promise<void> {
  const ok = await ensureQueue();
  if (!ok) return;

  state.index++;

  if (state.index >= state.queue.length) {
    if (cfg<boolean>('autoReshuffle')) {
      vscode.window.showInformationMessage(
        'Random File Navigator: Queue complete — reshuffling!'
      );
      state.queue = shuffle(state.queue);
      state.index = 0;
    } else {
      vscode.window.showInformationMessage(
        'Random File Navigator: Reached the end of the queue. Use "Reshuffle & Restart" to go again.'
      );
      state.index = state.queue.length - 1;
      return;
    }
  }

  await openFile(state.queue[state.index]);
  updateStatusBar();
}

async function prevFile(): Promise<void> {
  if (state.queue.length === 0 || state.index <= 0) {
    vscode.window.showInformationMessage(
      'Random File Navigator: Already at the beginning of the queue.'
    );
    return;
  }

  state.index--;
  await openFile(state.queue[state.index]);
  updateStatusBar();
}

async function reshuffleAndRestart(): Promise<void> {
  await ensureQueue(true);
  await nextFile();
}

async function showQueue(): Promise<void> {
  if (state.queue.length === 0) {
    vscode.window.showInformationMessage(
      'Random File Navigator: Queue is empty. Navigate to a file first.'
    );
    return;
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  const rootPath = workspaceFolders?.[0]?.uri.fsPath ?? '';

  const items: vscode.QuickPickItem[] = state.queue.map((uri, i) => {
    const relative = rootPath ? path.relative(rootPath, uri.fsPath) : uri.fsPath;
    const isCurrent = i === state.index;
    return {
      label: `${isCurrent ? '▶ ' : '  '}${path.basename(uri.fsPath)}`,
      description: path.dirname(relative),
      detail: isCurrent
        ? `Current position (${i + 1}/${state.queue.length})`
        : `${i + 1}/${state.queue.length}`,
      picked: isCurrent,
    };
  });

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: `Queue: ${state.queue.length} files — pick one to jump to it`,
    matchOnDescription: true,
  });

  if (!pick) return;

  const chosenIndex = items.indexOf(pick);
  if (chosenIndex === -1) return;

  state.index = chosenIndex;
  await openFile(state.queue[state.index]);
  updateStatusBar();
}

// ── Activation ───────────────────────────────────────────────────────────────
export function activate(context: vscode.ExtensionContext): void {
  // Main position status bar (right side)
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'randomFileNavigator.showQueue';
  context.subscriptions.push(statusBarItem);

  // Timer status bar (slightly to the left of the position one)
  timerStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  timerStatusBarItem.command = 'randomFileNavigator.toggleAutoAdvance';
  context.subscriptions.push(timerStatusBarItem);

  ensureQueue().then(updateStatusBar);
  updateTimerStatusBar();

  // Rebuild queue when files are added/deleted
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  const invalidate = () => { state.queue = []; state.index = -1; updateStatusBar(); };
  context.subscriptions.push(watcher.onDidCreate(invalidate), watcher.onDidDelete(invalidate), watcher);

  // React to settings changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('randomFileNavigator')) {
        state.queue = [];
        state.index = -1;
        updateStatusBar();
        // Restart timer with new interval if it was running
        if (timerRunning && e.affectsConfiguration('randomFileNavigator.autoAdvanceInterval')) {
          stopAutoAdvance();
          startAutoAdvance();
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('randomFileNavigator.nextFile', nextFile),
    vscode.commands.registerCommand('randomFileNavigator.prevFile', prevFile),
    vscode.commands.registerCommand('randomFileNavigator.reshuffle', reshuffleAndRestart),
    vscode.commands.registerCommand('randomFileNavigator.showQueue', showQueue),
    vscode.commands.registerCommand('randomFileNavigator.startAutoAdvance', startAutoAdvance),
    vscode.commands.registerCommand('randomFileNavigator.stopAutoAdvance', stopAutoAdvance),
    vscode.commands.registerCommand('randomFileNavigator.toggleAutoAdvance', toggleAutoAdvance),
    vscode.commands.registerCommand('randomFileNavigator.setInterval', setIntervalAndStart),
  );

  updateStatusBar();
}

export function deactivate(): void {
  clearTimers();
  statusBarItem?.dispose();
  timerStatusBarItem?.dispose();
}
