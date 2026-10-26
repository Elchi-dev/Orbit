"""Orbit plugin SDK for Python. One file, standard library only: copy it next
to your plugin (new plugins get it automatically) and import it.
Protocol: docs/PLUGINS.md.

    from orbit_plugin import plugin

    @plugin.tool("Today's weather for a city", city="string")
    def weather(city, ctx):
        return f"Sunny in {city}"

    plugin.start()

Handlers can be plain functions or async functions.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import os
import re
import sys
import threading
from typing import Any, Callable, Optional

__all__ = ["plugin", "Plugin", "ToolContext"]


class ToolContext:
    """Where a tool call comes from: the workspace, its folder and the call id."""

    def __init__(self, workspace: str, cwd: str, call: str):
        self.workspace = workspace
        self.cwd = cwd
        self.call = call


def _schema(fields: dict) -> dict:
    """{"city": "string", "days": "number?"} becomes a JSON schema; a dict with "type": "object" stays."""
    if fields.get("type") == "object":
        return fields
    props, required = {}, []
    for k, v in fields.items():
        if isinstance(v, str):
            optional = v.endswith("?")
            t = v.rstrip("?")
            props[k] = {"type": "array", "items": {"type": t[:-2]}} if t.endswith("[]") else {"type": t}
            if not optional:
                required.append(k)
        else:
            props[k] = v
            required.append(k)
    return {"type": "object", "properties": props, "required": required}


class Plugin:
    def __init__(self) -> None:
        self.id = os.environ.get("ORBIT_PLUGIN_ID", "")
        self.dir = os.environ.get("ORBIT_PLUGIN_DIR", os.getcwd())
        self.data_dir = os.environ.get("ORBIT_PLUGIN_DATA", os.getcwd())
        self.settings: dict = {}
        self._tools: dict = {}
        self._commands: dict = {}
        self._routes: list = []
        self._hooks: dict = {}
        self._events: dict = {}
        self._ready: list = []
        self._on_settings: list = []
        self._on_stop: list = []
        self._next = 1
        self._pending: dict = {}
        self._lock = threading.Lock()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._out = sys.stdout

    # ---------- what the plugin offers ----------

    def tool(self, description: str, tool_name: Optional[str] = None, read_only: bool = False, timeout_s: Optional[int] = None, schema: Optional[dict] = None, **fields):
        """Decorator for a tool Claude can call. Fields like city="string", days="number?".
        The tool is named after the function unless tool_name is given.
        The function gets the inputs as keyword arguments plus ctx."""

        def wrap(fn):
            self._tools[tool_name or fn.__name__] = {
                "description": description,
                "input_schema": schema or _schema(fields),
                "read_only": read_only,
                "timeout_s": timeout_s,
                "run": fn,
            }
            return fn

        return wrap

    def command(self, description: str, command_name: Optional[str] = None):
        """Decorator for a slash command, named after the function unless command_name is given.
        The function gets (args, workspace)."""

        def wrap(fn):
            self._commands[(command_name or fn.__name__).lstrip("/")] = {"description": description, "run": fn}
            return fn

        return wrap

    def route(self, method: str, path: str):
        """Decorator for an HTTP route under /plugins/<id>/api. The function gets the request dict.
        A path may be a regex if it starts with ^."""

        def wrap(fn):
            self._routes.append((method.upper(), path, fn))
            return fn

        return wrap

    def hook(self, name: str):
        """Decorator for before_tool, after_tool, turn_start, turn_end, message or approval."""

        def wrap(fn):
            self._hooks.setdefault(name, []).append(fn)
            return fn

        return wrap

    def before_tool(self, fn):
        """Return {"decision": "allow"|"deny"|"ask", "reason": "..."} or None."""
        return self.hook("before_tool")(fn)

    def after_tool(self, fn):
        return self.hook("after_tool")(fn)

    def on(self, event_type: str):
        """Decorator: every Orbit event of a type ("*" for all). Needs the "events" permission."""

        def wrap(fn):
            self._events.setdefault(event_type, []).append(fn)
            return fn

        return wrap

    def ready(self, fn):
        """Runs once Orbit has said hello; settings are ready."""
        self._ready.append(fn)
        return fn

    def settings_changed(self, fn):
        self._on_settings.append(fn)
        return fn

    def stopping(self, fn):
        self._on_stop.append(fn)
        return fn

    # ---------- what the plugin can ask Orbit ----------

    def call(self, method: str, params: Any = None, timeout: float = 600) -> Any:
        """Call Orbit and wait for the answer. Safe from any thread and from handlers."""
        fut = self._call_async(method, params)
        if self._loop and threading.current_thread() is threading.main_thread() and self._loop.is_running():
            raise RuntimeError("Inside an async handler, use: await plugin.acall(...)")
        return fut.result(timeout)

    async def acall(self, method: str, params: Any = None) -> Any:
        return await asyncio.wrap_future(self._call_async(method, params))

    def _call_async(self, method: str, params: Any):
        import concurrent.futures

        fut: concurrent.futures.Future = concurrent.futures.Future()
        with self._lock:
            i = self._next
            self._next += 1
            self._pending[i] = fut
        self._write({"jsonrpc": "2.0", "id": i, "method": method, "params": params if params is not None else {}})
        return fut

    def log(self, *parts: Any) -> None:
        self._write({"jsonrpc": "2.0", "method": "orbit.log", "params": {"message": " ".join(p if isinstance(p, str) else json.dumps(p) for p in parts)}})

    def toast(self, title: str, body: str = "", tone: str = "info"):
        return self._call_async("orbit.ui.toast", {"title": title, "body": body, "tone": tone})

    def notify(self, title: str, body: str = ""):
        return self._call_async("orbit.ui.notify", {"title": title, "body": body})

    # storage
    def get(self, key: str) -> Any:
        return self.call("orbit.storage.get", {"key": key})

    def set(self, key: str, value: Any) -> None:
        self.call("orbit.storage.set", {"key": key, "value": value})

    def delete(self, key: str) -> None:
        self.call("orbit.storage.delete", {"key": key})

    # workspaces and Claude
    def workspaces(self) -> list:
        return self.call("orbit.workspaces.list")

    def workspace(self, id: str) -> dict:
        return self.call("orbit.workspaces.get", {"id": id})

    def create_workspace(self, **o) -> dict:
        return self.call("orbit.workspaces.create", o)

    def send(self, workspace: str, text: str) -> None:
        self.call("orbit.workspaces.send", {"workspace": workspace, "text": text})

    def agent(self, prompt: str, **o) -> dict:
        """Let Claude do a task with all of Orbit's tools and the gate. Returns its last reply."""
        return self.call("orbit.agent.run", {"prompt": prompt, **o}, timeout=o.get("timeout_s", 1800) + 30)

    async def aagent(self, prompt: str, **o) -> dict:
        return await self.acall("orbit.agent.run", {"prompt": prompt, **o})

    def model(self, prompt: Optional[str] = None, **o) -> dict:
        """One model call billed to Orbit's budget. The plugin never sees the API key."""
        return self.call("orbit.model.complete", {"prompt": prompt, **o})

    def approvals(self) -> list:
        return self.call("orbit.approvals.list")

    def answer(self, approval_id: str, decision: str) -> None:
        self.call("orbit.approvals.answer", {"id": approval_id, "decision": decision})

    def api(self, method: str, path: str, body: Any = None) -> dict:
        return self.call("orbit.api", {"method": method, "path": path, "body": body})

    # ---------- running ----------

    def start(self) -> None:
        """Answer Orbit until it stops the plugin. Call once, after registering everything."""
        # print() would break the protocol: send it to Orbit's log instead
        real = sys.stdout
        self._out = real

        class _Log:
            def __init__(s):
                s.buf = ""

            def write(s, t):
                s.buf += t
                while "\n" in s.buf:
                    line, s.buf = s.buf.split("\n", 1)
                    if line.strip():
                        self.log(line)

            def flush(s):
                pass

        sys.stdout = _Log()
        self._loop = asyncio.new_event_loop()
        threading.Thread(target=self._loop.run_forever, daemon=True).start()
        for line in sys.stdin:
            line = line.strip()
            if line:
                self._receive(line)

    def _write(self, msg: dict) -> None:
        data = json.dumps(msg) + "\n"
        with self._lock:
            self._out.write(data)
            self._out.flush()

    def _receive(self, line: str) -> None:
        try:
            msg = json.loads(line)
        except ValueError:
            return
        if msg.get("id") is not None and "method" not in msg:
            with self._lock:
                fut = self._pending.pop(msg["id"], None)
            if fut:
                if msg.get("error"):
                    fut.set_exception(RuntimeError(msg["error"].get("message", "error")))
                else:
                    fut.set_result(msg.get("result"))
            return
        # handlers run on their own thread so they can call Orbit and wait
        threading.Thread(target=self._dispatch, args=(msg,), daemon=True).start()

    def _run(self, fn: Callable, *a, **k):
        r = fn(*a, **k)
        if inspect.isawaitable(r):
            r = asyncio.run_coroutine_threadsafe(r, self._loop).result()
        return r

    def _dispatch(self, msg: dict) -> None:
        mid = msg.get("id")
        try:
            result = self._handle(msg["method"], msg.get("params") or {})
            if mid is not None:
                self._write({"jsonrpc": "2.0", "id": mid, "result": result})
        except Exception as e:  # noqa: BLE001
            if mid is not None:
                self._write({"jsonrpc": "2.0", "id": mid, "error": {"code": -32000, "message": str(e)}})
            else:
                self.log(f"{msg.get('method')}: {e}")

    def _handle(self, method: str, p: Any) -> Any:
        if method == "initialize":
            self.settings = p.get("settings") or {}
            if self._events:
                self._call_async("orbit.events.subscribe", {"types": list(self._events)})
            for f in self._ready:
                threading.Thread(target=self._run, args=(f, {"settings": self.settings}), daemon=True).start()
            return {
                "tools": [{"name": n, "description": t["description"], "input_schema": t["input_schema"], "read_only": t["read_only"], "timeout_s": t["timeout_s"]} for n, t in self._tools.items()],
                "commands": [{"name": n, "description": c["description"]} for n, c in self._commands.items()],
            }
        if method == "tool.call":
            t = self._tools.get(p.get("name"))
            if not t:
                raise RuntimeError(f"No tool {p.get('name')}")
            ctx = ToolContext(p.get("workspace", ""), p.get("cwd", ""), p.get("call", ""))
            r = self._run(t["run"], ctx=ctx, **(p.get("input") or {}))
            return {"content": r} if isinstance(r, str) else r
        if method == "command.run":
            c = self._commands.get(p.get("name"))
            if not c:
                raise RuntimeError(f"No command /{p.get('name')}")
            r = self._run(c["run"], p.get("args", ""), p.get("workspace"))
            return {"reply": r} if isinstance(r, str) else (r or {})
        if method == "http.request":
            for m, path, fn in self._routes:
                if m in ("*", p.get("method")) and (path == p.get("path") or (path.startswith("^") and re.match(path, p.get("path", "")))):
                    return self._run(fn, p)
            return {"status": 404, "body": {"error": f"No route {p.get('method')} {p.get('path')}"}}
        if method == "settings":
            self.settings = p or {}
            for f in self._on_settings:
                self._run(f, self.settings)
            return None
        if method == "event":
            for k in (p.get("type"), "*"):
                for f in self._events.get(k, []):
                    self._run(f, p)
            return None
        if method == "shutdown":
            for f in self._on_stop:
                self._run(f)
            threading.Timer(0.05, lambda: os._exit(0)).start()
            return None
        if method.startswith("hook."):
            verdict = None
            for f in self._hooks.get(method[5:], []):
                v = self._run(f, p)
                if v and verdict is None:
                    verdict = v
                if v and v.get("decision") == "deny":
                    break
            return verdict
        raise RuntimeError(f"Unknown method {method}")


plugin = Plugin()
