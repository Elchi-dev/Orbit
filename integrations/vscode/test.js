// Runs the extension against a stand-in for the editor API and a stand-in Orbit,
// and checks the link it opens. `node test.js`
const Module = require("module");
const http = require("http");
const assert = require("assert");

const opened = [];
const commands = {};
const fake = {
  workspace: {
    getConfiguration: () => ({ get: (k, d) => (k === "port" ? 47123 : d) }),
    getWorkspaceFolder: () => ({ uri: { fsPath: "/home/me/code/api" } }),
    workspaceFolders: [{ uri: { fsPath: "/home/me/code/api" } }],
  },
  window: {
    activeTextEditor: {
      document: { uri: { fsPath: "/home/me/code/api/src/a.ts" }, getText: () => "const a = 1;\nconst b = 2;" },
      selection: { isEmpty: false, start: { line: 9 }, end: { line: 10 } },
    },
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
  },
  commands: { registerCommand: (id, fn) => ((commands[id] = fn), { dispose() {} }) },
  env: { openExternal: async (u) => opened.push(u.toString()) },
  Uri: { parse: (s) => ({ toString: () => s }) },
};
const load = Module._load;
Module._load = (req, ...rest) => (req === "vscode" ? fake : load(req, ...rest));

const orbit = http.createServer((req, res) => res.end(req.url === "/api/session" ? "{}" : "")).listen(47123, async () => {
  require("./extension").activate({ subscriptions: [] });
  await commands["orbit.sendSelection"]();
  await commands["orbit.openFolder"]({ fsPath: "/home/me/code/web" });
  orbit.close();
  const sel = new URL(opened[0].replace("/#/open?", "/open?"));
  assert.equal(sel.searchParams.get("path"), "/home/me/code/api");
  assert.equal(sel.searchParams.get("file"), "src/a.ts");
  assert.equal(sel.searchParams.get("line"), "10");
  assert.equal(sel.searchParams.get("end"), "11");
  assert.equal(sel.searchParams.get("text"), "const a = 1;\nconst b = 2;");
  assert.ok(opened[1].endsWith("#/open?path=%2Fhome%2Fme%2Fcode%2Fweb"));
  console.log("extension ok");
});
