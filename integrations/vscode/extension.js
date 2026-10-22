// Orbit for VS Code, Cursor, Windsurf and VSCodium.
// It never talks to Claude itself: it hands a folder, a file or a selection to the
// Orbit running on this machine, which opens the right workspace and puts the text
// into its composer. Nothing is sent until you press Enter there.

const vscode = require("vscode");
const http = require("http");
const path = require("path");

const MAX_TEXT = 6000;

function settings() {
  const c = vscode.workspace.getConfiguration("orbit");
  return { port: c.get("port", 7777), command: c.get("command", "orbit") };
}

function isRunning(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/session", timeout: 1200 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function folderFor(uri) {
  const ws = uri && vscode.workspace.getWorkspaceFolder(uri);
  if (ws) return ws.uri.fsPath;
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length) return vscode.workspace.workspaceFolders[0].uri.fsPath;
  return uri ? path.dirname(uri.fsPath) : undefined;
}

async function hand(params) {
  const { port, command } = settings();
  const query = new URLSearchParams(params).toString();
  const link = `http://localhost:${port}/#/open?${query}`;
  if (await isRunning(port)) {
    await vscode.env.openExternal(vscode.Uri.parse(link));
    return;
  }
  const pick = await vscode.window.showInformationMessage("Orbit isn't running.", "Start it", "Cancel");
  if (pick !== "Start it") return;
  const term = vscode.window.createTerminal({ name: "Orbit" });
  term.show(true);
  term.sendText(`${command} ${JSON.stringify(params.path)}`);
  // Orbit opens the folder itself once it is up; the selection follows when it answers
  if (params.text || params.file) {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await isRunning(port)) {
        await vscode.env.openExternal(vscode.Uri.parse(link));
        return;
      }
    }
  }
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("orbit.openFolder", async (uri) => {
      const target = uri ? uri.fsPath : folderFor(vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri);
      if (!target) return vscode.window.showWarningMessage("Open a folder first.");
      await hand({ path: target });
    }),

    vscode.commands.registerCommand("orbit.sendSelection", async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) return;
      const doc = ed.document;
      const root = folderFor(doc.uri);
      if (!root) return vscode.window.showWarningMessage("Save the file in a folder first.");
      const sel = ed.selection;
      let text = doc.getText(sel.isEmpty ? undefined : sel);
      if (text.length > MAX_TEXT) {
        text = text.slice(0, MAX_TEXT);
        vscode.window.showInformationMessage(`Only the first ${MAX_TEXT} characters were sent; Claude can read the rest from the file.`);
      }
      await hand({
        path: root,
        file: path.relative(root, doc.uri.fsPath),
        line: String(sel.start.line + 1),
        end: String(sel.end.line + 1),
        text,
      });
    }),

    vscode.commands.registerCommand("orbit.sendFile", async (uri) => {
      const target = uri || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri);
      if (!target) return;
      const root = folderFor(target);
      await hand({ path: root, file: path.relative(root, target.fsPath) });
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
