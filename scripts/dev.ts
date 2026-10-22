// Runs the API server (port 7777, mock model unless you set a key) and the Vite dev server together.
const env = { ...process.env, ORBIT_DEV: "1", ORBIT_NO_OPEN: "1" };
const server = Bun.spawn(["bun", "--watch", "server/index.ts"], { env, stdout: "inherit", stderr: "inherit" });
const web = Bun.spawn(["bunx", "vite"], { env, stdout: "inherit", stderr: "inherit" });
process.on("SIGINT", () => {
  server.kill();
  web.kill();
  process.exit(0);
});
await Promise.race([server.exited, web.exited]);
export {};
