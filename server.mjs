import { createServer } from "node:http";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { port: { type: "string" }, hostname: { type: "string" } },
});
const port = Number(values.port ?? process.env.PORT ?? 3000);
const hostname = values.hostname ?? "0.0.0.0";
process.env.NODE_ENV ??= "production";
const { default: next } = await import("next");
const app = next({ dev: false, hostname, port });
await app.prepare();
const handle = app.getRequestHandler();

// Limit idle connections instead of setting a deadline for the entire body.
const server = createServer(
  { requestTimeout: 0, headersTimeout: 60_000 },
  (req, res) => {
    void handle(req, res).catch((error) => {
      console.error("Next.js request failed.", error.name);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  },
);
server.setTimeout(300_000, (socket) => socket.destroy());
server.listen(port, hostname, () =>
  console.log(`YourCDN listening on port ${port}`),
);
