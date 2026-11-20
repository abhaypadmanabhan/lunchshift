// Runs the sandbox grocer as its own process (independent merchant). Port GROCER_PORT, default 4100.
import { startGrocer } from "./server";

const port = Number(process.env.GROCER_PORT ?? 4100);
startGrocer({ port, dbPath: process.env.GROCER_DB ?? ".data/grocer.db" }).then((g) => {
  console.log(`[grocer] sandbox store listening on ${g.url}`);
  const stop = () => g.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
});
