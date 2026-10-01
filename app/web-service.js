"use strict";

const fs = require("node:fs");
const http = require("node:http");

const requiredVariables = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "PROFILE_FILE"];
const missingVariables = requiredVariables.filter((name) => !process.env[name]);

function log(level, event, context = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: "web-service",
    event,
    ...context,
  }));
}

if (missingVariables.length > 0) {
  log("error", "config_error", {
    missingVariables,
    remediation: "Check the service environment file; do not print secret values.",
  });
  process.exit(78);
}

const port = Number(process.env.WEB_PORT || 3000);
const upstreamBaseUrl = process.env.SUPABASE_URL.replace(/\/$/, "");
const profileFile = process.env.PROFILE_FILE;

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function proxyProfile(response, requestId) {
  let localProfile;
  try {
    localProfile = JSON.parse(fs.readFileSync(profileFile, "utf8"));
  } catch (error) {
    log("error", "profile_read_failed", {
      requestId,
      code: error.code,
      path: profileFile,
      message: error.message,
    });
    return sendJson(response, 500, {
      code: "LOCAL_PROFILE_UNAVAILABLE",
      message: "The application could not read its local profile configuration.",
    });
  }

  const upstreamUrl = `${upstreamBaseUrl}/rest/v1/profiles?user_id=demo-user`;
  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      headers: { apikey: process.env.SUPABASE_ANON_KEY },
    });

    if (!upstreamResponse.ok) {
      const responseSnippet = (await upstreamResponse.text()).slice(0, 180);
      log("error", "upstream_http_error", {
        requestId,
        upstreamUrl,
        upstreamStatus: upstreamResponse.status,
        responseSnippet,
      });
      return sendJson(response, 502, {
        code: "UPSTREAM_API_UNAVAILABLE",
        message: "The upstream API returned an unexpected response.",
      });
    }

    const upstreamPayload = await upstreamResponse.json();
    log("info", "profile_request_succeeded", {
      requestId,
      upstreamStatus: upstreamResponse.status,
    });
    return sendJson(response, 200, {
      source: "local training web service",
      localProfile,
      upstreamData: upstreamPayload.data,
    });
  } catch (error) {
    log("error", "upstream_network_error", {
      requestId,
      upstreamUrl,
      code: error.cause?.code || error.code || error.name,
      message: error.message,
    });
    return sendJson(response, 502, {
      code: "UPSTREAM_API_UNAVAILABLE",
      message: "The upstream API could not be reached.",
    });
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
  const requestId = crypto.randomUUID().slice(0, 8);
  log("info", "request_received", { requestId, method: request.method, path: url.pathname });

  if (request.method === "GET" && url.pathname === "/health") {
    return sendJson(response, 200, { status: "ok", service: "web-service" });
  }

  if (request.method === "GET" && url.pathname === "/api/profile") {
    return proxyProfile(response, requestId);
  }

  log("warn", "route_not_found", { requestId, method: request.method, path: url.pathname });
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
