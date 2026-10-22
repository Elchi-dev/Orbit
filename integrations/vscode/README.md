# Orbit for VS Code

Hands a folder, a file or a selection from your editor to
[Orbit](https://github.com/Elchi-dev/orbit) running on your machine. Orbit opens
the workspace for that folder (or makes one) and puts the text into its
composer. Nothing is sent to Claude until you press Enter there.

Works in VS Code, Cursor, Windsurf and VSCodium.

| Command | Where | What it does |
| --- | --- | --- |
| Send selection to Orbit | right click in the editor, or `Ctrl Alt O` (`Cmd Alt O`) | the selection, its file and lines |
| Ask Orbit about this file | right click a file or in the editor | the file's path |
| Open this folder in Orbit | right click a folder, or the command palette | the folder as a workspace |

If Orbit isn't running, the extension offers to start it in a terminal.

Settings: `orbit.port` (7777) and `orbit.command` (`orbit`).

## Install

Download `orbit-vscode.vsix` from the
[latest release](https://github.com/Elchi-dev/orbit/releases), then:

```sh
code --install-extension orbit-vscode.vsix      # or cursor, windsurf, codium
```

The other way round, Orbit opens files in your editor at the right line: pick
the editor in Orbit's Settings, Integrations.
