# Support Troubleshooting Lab Record

Practice record  
Do not include full command output or API keys. Keep each record concise and specific: **symptom → evidence → root cause → recovery → verification**.

## 0. Baseline: Healthy Services

- Practice date: 2026-10-01
- `backend` PID: `13073`
- `web` PID: `13192`
- `curl -i /health` result: `HTTP/1.1 200 OK` — confirmation that the web service was running normally
- `curl -i /api/profile` result: `HTTP/1.1 200 OK` — confirmation that the web-to-backend request was working normally
- Log evidence: confirmation of the `server_started`, `request_received`, and `profile_request_succeeded` events in `runtime/logs/web.log`
- Basis for healthy status: normal process status from `status`, successful HTTP responses from `curl -i`, and successful web-to-backend activity in the web log

## 1. Service Startup Failure Caused by a Missing Environment Variable

- Symptom: the `web` service stopped immediately after startup
- Initial diagnostic commands: `bash scripts/labctl.sh status`, `bash scripts/labctl.sh logs web 30`
- Key log event / error: `config_error` and `missingVariables: ["SUPABASE_ANON_KEY"]`
- Root cause from logs: `SUPABASE_ANON_KEY` was absent from the environment file
- Variable verification: confirmation of the missing variable with `grep -q`
- Recovery: restart of the web service with the default environment file using `bash scripts/labctl.sh start web`
- Verification: both `backend` and `web` shown as `running` in `status`; `/health` and `/api/profile` returned `HTTP 200`; confirmation of the `profile_request_succeeded` event in the web log

## 2. Port Conflict

- Symptom: the web service failed to start on port `3000`
- PID and command occupying the port: PID `22518`, `node .../app/port-occupier.js`
- Diagnostic commands: `lsof -nP -iTCP:3000 -sTCP:LISTEN`, `ps -p 22518 -o pid,ppid,command`
- Key log event / error: `server_listen_failed`, `EADDRINUSE` — confirmation that `127.0.0.1:3000` was already in use
- Action and rationale: confirmation that PID `22518` belonged to the lab's `port-occupier` process, followed by a targeted stop using `bash scripts/labctl.sh release-port`
- Recovery: restart of the web service using `bash scripts/labctl.sh start web`
- Verification: `web` shown as `running` in `status`; `/health` returned `HTTP 200`

## 3. Incorrect API Endpoint

- Symptom: `/api/profile` returned `HTTP 502`
- Client HTTP response: `HTTP/1.1 502 Bad Gateway`
- Upstream URL / status in web log: the `upstream_http_error` event showed `http://127.0.0.1:4000/wrong-rest/rest/v1/profiles?user_id=demo-user` with upstream status `404`
- Evidence from backend log: the `backend` received the same `/wrong-rest/rest/v1/profiles` request path and recorded the `route_not_found` event
- Root cause and confirmation: the `SUPABASE_URL` environment variable included the incorrect `/wrong-rest` path, and the web service appended `/rest/v1/profiles`; matching incorrect paths and `404` responses in both web and backend logs confirmed the cause
- Recovery and verification: stopped the web service using the fault configuration and restarted it with the default environment file; both services shown as `running` in `status`; `/health` and `/api/profile` returned `HTTP 200`; confirmation of `profile_request_succeeded` in the web log

## 4. File Permission Error

- Symptom: `/health` returned `HTTP 200`, while `/api/profile` returned `HTTP 500`
- Error code in web log: `profile_read_failed`, `EACCES`, and `EACCES: permission denied, open 'runtime/data/profile.json'`
- Result of `ls -l runtime/data/profile.json`: permission mode `000`, with no read, write, or execute permissions for the owner, group, or others
- Root cause: the service user could not read the profile file because all permissions had been removed; permission mode `000` was the direct cause
- Minimum-permission recovery: restored the file to permission mode `600` (owner read/write) using `bash scripts/labctl.sh fix-profile-permissions`
- Verification: permission mode changed to `600`; `/api/profile` returned `HTTP 200`; confirmation of `profile_request_succeeded` in the web log

## 5. Upstream Process Down

- Symptom: `/api/profile` returned `HTTP 502`
- Client HTTP response: `HTTP/1.1 502 Bad Gateway`
- Web log event: `upstream_network_error` and `ECONNREFUSED`
- Backend PID / process status: `backend` shown as `stopped` and `web` as `running` in `status`; no backend process listening on port `4000`
- Evidence distinguishing an upstream process failure from a general network failure: the web service and port `3000` remained healthy with `/health` returning `HTTP 200`; no listener existed at `127.0.0.1:4000`, and `ECONNREFUSED` occurred
- Assessment: backend process failure rather than DNS or an external network issue
- Recovery and verification: restarted the backend using `bash scripts/labctl.sh start backend`; both services shown as `running` in `status`; `/api/profile` returned `HTTP 200`; confirmation of `request_received` in the backend log and `profile_request_succeeded` in the web log