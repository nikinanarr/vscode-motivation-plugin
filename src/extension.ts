import * as vscode from "vscode";
import {
  charMilestoneMessages,
  saveMessages,
  comebackMessages,
  focusMessages,
  cleanSaveMessages,
  terminalSuccessMessages,
  achievementMessages
} from "./messages";

interface SessionStats {
  charsWritten: number;
  linesDelta: number;
  saves: number;
  cleanSaveStreak: number;
  bestCleanSaveStreak: number;
  focusMinutes: number;
  terminalSuccesses: number;
}

let stats: SessionStats = {
  charsWritten: 0,
  linesDelta: 0,
  saves: 0,
  cleanSaveStreak: 0,
  bestCleanSaveStreak: 0,
  focusMinutes: 0,
  terminalSuccesses: 0
};

let charsSinceLastPraise = 0;
const lastLineCounts = new Map<string, number>();

let lastActivity = Date.now();
let focusStart = Date.now();
let focusPraised = false;

let charThreshold = 100;
let idleThresholdMs = 5 * 60 * 1000;
let focusRewardMs = 20 * 60 * 1000;
let enableTerminalSuccessPraise = true;

let statusBar: vscode.StatusBarItem;

function loadConfig() {
  const cfg = vscode.workspace.getConfiguration("motivation");
  charThreshold = cfg.get<number>("charThreshold", 100);
  idleThresholdMs = (cfg.get<number>("idleMinutes", 5) || 5) * 60 * 1000;
  focusRewardMs = (cfg.get<number>("focusMinutes", 20) || 20) * 60 * 1000;
  enableTerminalSuccessPraise = cfg.get<boolean>(
    "enableTerminalSuccessPraise",
    true
  );
}

function randomFrom(list: string[]): string {
  return list[Math.floor(Math.random() * list.length)];
}

function registerActivity(now: number) {
  if (now - lastActivity > idleThresholdMs) {
    focusStart = now;
    focusPraised = false;
  } else {
    if (!focusPraised && now - focusStart >= focusRewardMs) {
      focusPraised = true;
      const minutes = Math.round((now - focusStart) / 60000);
      stats.focusMinutes += minutes;
      vscode.window.showInformationMessage(randomFrom(focusMessages));

      vscode.window.showInformationMessage(achievementMessages.focusMaster);
    }
  }
  lastActivity = now;
  updateStatusBar();
}

function updateStatusBar() {
  if (!statusBar) {
    return;
  }
  const level = 1 + Math.floor(stats.charsWritten / 500);
  statusBar.text = `$(heart) Lvl ${level} | +${stats.linesDelta} строк | saves: ${stats.saves}`;
  statusBar.tooltip = new vscode.MarkdownString(
    `**Motivation Plugin**\n\n` +
      `Символов за сессию: ${stats.charsWritten}\n\n` +
      `∆ строк за сессию: ${stats.linesDelta}\n\n` +
      `Сохранений: ${stats.saves}\n\n` +
      `Лучшая серия чистых сохранений: ${stats.bestCleanSaveStreak}\n\n` +
      `Успешных запусков в терминале: ${stats.terminalSuccesses}\n\n` +
      `Фокус-время (примерно): ${stats.focusMinutes} мин`
  );
}

function showSaveDiffMessage(diff: number) {
  const variants = saveMessages(diff);
  vscode.window.showInformationMessage(randomFrom(variants));
}

export function activate(context: vscode.ExtensionContext) {
  loadConfig();

  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBar.command = "motivation.showStats";
  statusBar.show();
  updateStatusBar();
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("motivation")) {
        loadConfig();
      }
    })
  );

  const showStatsCommand = vscode.commands.registerCommand(
    "motivation.showStats",
    () => {
      const message =
        `Символов за сессию: ${stats.charsWritten}\n` +
        `∆ строк за сессию: ${stats.linesDelta}\n` +
        `Сохранений: ${stats.saves}\n` +
        `Лучшая серия чистых сохранений: ${stats.bestCleanSaveStreak}\n` +
        `Успешных запусков в терминале: ${stats.terminalSuccesses}\n` +
        `Фокус-время (примерно): ${stats.focusMinutes} мин`;
      vscode.window.showInformationMessage(message, { modal: true });
    }
  );
  context.subscriptions.push(showStatsCommand);

  const changeListener = vscode.workspace.onDidChangeTextDocument((event) => {
    const now = Date.now();
    registerActivity(now);

    let addedChars = 0;
    for (const change of event.contentChanges) {
      addedChars += change.text.length;
    }

    if (addedChars > 0) {
      stats.charsWritten += addedChars;
      charsSinceLastPraise += addedChars;

      if (charsSinceLastPraise >= charThreshold) {
        charsSinceLastPraise = 0;
        vscode.window.showInformationMessage(
          randomFrom(charMilestoneMessages)
        );
      }

      updateStatusBar();
    }
  });
  context.subscriptions.push(changeListener);

  const saveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
    const now = Date.now();

    if (now - lastActivity > idleThresholdMs) {
      vscode.window.showInformationMessage(randomFrom(comebackMessages));
    }

    registerActivity(now);

    const uriKey = doc.uri.toString();
    const prevLines = lastLineCounts.get(uriKey) ?? doc.lineCount;
    const diff = doc.lineCount - prevLines;
    lastLineCounts.set(uriKey, doc.lineCount);

    stats.linesDelta += diff;
    stats.saves += 1;
    showSaveDiffMessage(diff);

    const diagnostics = vscode.languages.getDiagnostics(doc.uri);
    const hasErrors = diagnostics.some(
      (d) => d.severity === vscode.DiagnosticSeverity.Error
    );

    if (!hasErrors) {
      stats.cleanSaveStreak += 1;
      stats.bestCleanSaveStreak = Math.max(
        stats.bestCleanSaveStreak,
        stats.cleanSaveStreak
      );

      if ([3, 5, 10].includes(stats.cleanSaveStreak)) {
        vscode.window.showInformationMessage(randomFrom(cleanSaveMessages));
        vscode.window.showInformationMessage(
          achievementMessages.cleanStreak(stats.cleanSaveStreak)
        );
      }
    } else {
      stats.cleanSaveStreak = 0;
    }

    if (stats.linesDelta >= 100 && stats.linesDelta < 300) {
      vscode.window.showInformationMessage(achievementMessages.lines100);
    } else if (stats.linesDelta >= 300) {
      vscode.window.showInformationMessage(achievementMessages.lines300);
    }

    updateStatusBar();

    if (stats.saves === 1) {
      vscode.window.showInformationMessage(achievementMessages.firstSave);
    }
  });
  context.subscriptions.push(saveListener);

}

export function deactivate() {
  
}
