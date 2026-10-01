"use strict";

const http = require("node:http");

const port = Number(process.env.PORT || 3000);

function log(level, event, context = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: "port-occupier",
    event,
    ...context,
  }));
}

const server = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ status: "holding-port-for-training", port }));
});

server.on("error", (error) => {
  log("error", "server_listen_failed", { code: error.code, message: error.message, port });
  process.exitCode = 1;
});

server.listen(port, "127.0.0.1", () => log("info", "server_started", { port }));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    log("info", "server_stopping", { signal });
    server.close(() => process.exit(0));
  });
}
