"use strict";

const http = require("node:http");

const port = Number(process.env.BACKEND_PORT || 4000);
const expectedApiKey = process.env.MOCK_BACKEND_API_KEY || "lab-only-public-key";

function log(level, event, context = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: "mock-backend",
    event,
    ...context,
  }));
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
  const apiKeyPresent = Boolean(request.headers.apikey);

  log("info", "request_received", {
    method: request.method,
    path: url.pathname,
    apiKeyPresent,
  });

  if (request.method === "GET" && url.pathname === "/health") {
    return sendJson(response, 200, { status: "ok", service: "mock-backend" });
  }

  if (request.method === "GET" && url.pathname === "/rest/v1/profiles") {
    if (request.headers.apikey !== expectedApiKey) {
      log("warn", "authentication_failed", { path: url.pathname, apiKeyPresent });
      return sendJson(response, 401, {
        code: "PGRST301",
        message: "Invalid API key for the local training backend",
      });
    }

    return sendJson(response, 200, {
      data: [{ id: "demo-user", name: "Support Lab User", plan: "training" }],
    });
  }

  log("warn", "route_not_found", { method: request.method, path: url.pathname });
  return sendJson(response, 404, {
    code: "ROUTE_NOT_FOUND",
    message: `No route matches ${request.method} ${url.pathname}`,
  });
});

server.on("error", (error) => {
  log("error", "server_listen_failed", {
    code: error.code,
    message: error.message,
    port,
  });
  process.exitCode = 1;
});

server.listen(port, "127.0.0.1", () => {
  log("info", "server_started", { port });
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    log("info", "server_stopping", { signal });
    server.close(() => process.exit(0));
  });
}
