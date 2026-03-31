# Random File Navigator

A Cursor / VS Code extension that shuffles all files in your open workspace into a random queue and lets you walk through them one by one — including files nested inside any number of sub-folders.

## Features

- **Full-workspace shuffle** — discovers every file (root-level *and* inside every folder) and shuffles them using Fisher-Yates for a true random order.
- **Next / Previous navigation** — step forward and backward through the shuffled queue.
- **Auto-reshuffle** — once you reach the end of the queue it re-shuffles automatically (configurable).
- **Status bar widget** — shows `RFN: 12/87` so you always know where you are. Click it to open the queue picker.
- **Quick-Pick queue browser** — see the full list of files, the current position is highlighted, and you can jump to any entry.
- **Reshuffle & Restart** command — generate a fresh random order at any time.
- **Configurable include / exclude globs** — fine-tune which files appear in the queue.
- **File-system watcher** — queue is rebuilt automatically when files are added or deleted.

## Keyboard Shortcuts

| Action | Windows / Linux | macOS |
|---|---|---|
| Next random file | `Ctrl+Shift+]` | `Cmd+Shift+]` |
| Previous file | `Ctrl+Shift+[` | `Cmd+Shift+[` |

## Commands (Command Palette)

| Command | Description |
|---|---|
| `Random File Navigator: Next Random File` | Open the next file in the shuffled queue |
| `Random File Navigator: Previous File` | Go back one step in the queue |
| `Random File Navigator: Reshuffle & Restart` | Build a brand-new random queue |
| `Random File Navigator: Show File Queue` | Browse and jump to any file in the queue |

## Settings

```jsonc
{
  // Glob patterns to exclude (default excludes common build/tool folders)
  "randomFileNavigator.excludePatterns": [
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**",
    "**/out/**",
    "**/.next/**",
    "**/__pycache__/**",
    "**/*.pyc",
    "**/.DS_Store"
  ],

  // Which files to include
  "randomFileNavigator.includePatterns": ["**/*"],

  // Re-shuffle automatically when the queue is exhausted
  "randomFileNavigator.autoReshuffle": true,

  // Show position counter in the status bar
  "randomFileNavigator.showProgressInStatusBar": true
}
```

## How It Works

1. On activation the extension calls `vscode.workspace.findFiles` with your include/exclude patterns and collects every matching `Uri`.
2. The list is shuffled in-place with a Fisher-Yates algorithm.
3. Each `nextFile` call advances the index and opens the file via `vscode.workspace.openTextDocument`.
4. A `FileSystemWatcher` invalidates the cache whenever a file is created or deleted so the queue stays accurate.

## Install from GitHub

Anyone can clone and install the extension in three commands:

```bash
git clone https://github.com/your-username/random-file-navigator
cd random-file-navigator
npm install
npm run compile
npx vsce package --no-dependencies
cursor --install-extension random-file-navigator-0.1.0.vsix
```

Then reload Cursor (`Ctrl+Shift+P` → `Developer: Reload Window`).

**Prerequisites:** [Node.js](https://nodejs.org) (v18+) and `npm` must be installed.
