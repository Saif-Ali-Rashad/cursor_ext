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

  // Deduplicate by fsPath
  const seen = new Set<string>();
  const deduped = results.filter((u) => {
    if (seen.has(u.fsPath)) return false;
    seen.add(u.fsPath);
    return true;
  });

  // Filter out directories (findFiles should only return files, but be safe)
  return deduped;
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

  // Auto-reshuffle when queue is exhausted
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
    const relative = rootPath
      ? path.relative(rootPath, uri.fsPath)
      : uri.fsPath;
    const isCurrent = i === state.index;
    return {
      label: `${isCurrent ? '▶ ' : '  '}${path.basename(uri.fsPath)}`,
      description: path.dirname(relative),
      detail: isCurrent ? `Current position (${i + 1}/${state.queue.length})` : `${i + 1}/${state.queue.length}`,
      picked: isCurrent,
    };
  });

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: `Queue: ${state.queue.length} files — pick one to jump to it`,
    matchOnDescription: true,
  });

  if (!pick) return;

  // Find the index of the selected item
  const chosenIndex = items.indexOf(pick);
  if (chosenIndex === -1) return;

  state.index = chosenIndex;
  await openFile(state.queue[state.index]);
  updateStatusBar();
}

// ── Activation ───────────────────────────────────────────────────────────────
export function activate(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = 'randomFileNavigator.showQueue';
  context.subscriptions.push(statusBarItem);

  // Pre-build queue in the background on activation so first keypress is instant
  ensureQueue().then(updateStatusBar);

  // Rebuild queue when workspace changes
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  const rebuild = () => {
    state.queue = [];
    state.index = -1;
    updateStatusBar();
  };
  context.subscriptions.push(
    watcher.onDidCreate(rebuild),
    watcher.onDidDelete(rebuild),
    watcher
  );

  // Re-build when config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('randomFileNavigator')) {
        state.queue = [];
        state.index = -1;
        updateStatusBar();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('randomFileNavigator.nextFile', nextFile),
    vscode.commands.registerCommand('randomFileNavigator.prevFile', prevFile),
    vscode.commands.registerCommand('randomFileNavigator.reshuffle', reshuffleAndRestart),
    vscode.commands.registerCommand('randomFileNavigator.showQueue', showQueue)
  );

  updateStatusBar();
}

export function deactivate(): void {
  statusBarItem?.dispose();
}
