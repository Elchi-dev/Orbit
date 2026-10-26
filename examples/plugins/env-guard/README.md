# Env guard

An Orbit plugin. Before any action runs, it checks whether it touches `.env`
files, SSH keys, cloud or registry credentials, and sends those to you to
decide, in every mode, Full included. Set "Block instead of asking" to refuse
them outright, and add your own patterns in its settings.

Install: Settings, Plugins, Install, and paste

```
https://github.com/Elchi-dev/Orbit#main:examples/plugins/env-guard
```

A TypeScript plugin with one hook: about twenty lines in `index.ts`.
