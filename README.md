# Support Troubleshooting Lab

A local troubleshooting lab for practicing how to investigate web-service issues without immediately restarting everything.

The goal is to build a practical support workflow:

```text
Symptom → Process status → Logs → Port / network → Configuration → API → Recovery → Verification
```

The lab uses only local Node.js services. It does not use customer data, external API calls, or real API keys.

## What This Lab Practices

- Checking whether services are actually running
- Finding and validating process IDs
- Reading application logs and error codes
- Identifying port conflicts
- Testing HTTP endpoints with `curl`
- Diagnosing missing environment variables
- Diagnosing incorrect API endpoint configuration
- Investigating file permission errors
- Distinguishing an upstream process failure from a general network issue
- Recording evidence, root cause, recovery, and verification

## Project Layout

```text
app/
  web-service.js        # Web service listening on port 3000
  mock-backend.js       # Mock backend service listening on port 4000
  port-occupier.js      # Safe process used to reproduce a port conflict

scripts/
  labctl.sh             # Starts, stops, checks, and faults the lab services

runtime/
  logs/                 # Service logs
  pids/                 # Process ID files
  scenarios/            # Fault environment files
  data/                 # Data file used for permission testing
```

`runtime/` is generated during practice and contains logs, PID files, and local environment files. It is excluded from GitHub.

## Troubleshooting Records

Each exercise was documented using the same structure:

```text
Symptom → Evidence → Root cause → Recovery → Verification
```

- [Korean troubleshooting record](task_log_kr.md)
- [English troubleshooting record](task_log_en.md)

The records focus on verified process status, logs, error codes, and recovery results. They do not include full command output, environment-variable values, or API keys.

## Run the Lab

Node.js is the only requirement. No package installation is needed.

Open a terminal in the repository root directory. If you are cloning the project from GitHub, run:

```bash
# Clone the repository from GitHub.
git clone https://github.com/meldyssey/support-troubleshooting-lab.git

# Move to the cloned project directory.
cd support-troubleshooting-lab
```

Then run:

```bash
# Create the runtime folders, environment files, logs, and sample data.
bash scripts/labctl.sh bootstrap

# Start the local backend service.
bash scripts/labctl.sh start backend

# Start the local web service.
bash scripts/labctl.sh start web

# Check whether both services are running and view their PIDs.
bash scripts/labctl.sh status
```

Using two terminals is recommended.

- **Terminal 1:** Start or stop services and reproduce faults.
- **Terminal 2:** Inspect status, logs, ports, and HTTP responses.

## Baseline: Healthy Services

Before reproducing a failure, confirm the normal state.

```bash
# Check the status and PID of both services.
bash scripts/labctl.sh status

# Check whether the web service itself is healthy.
curl -i http://127.0.0.1:3000/health

# Check whether the web service can call the backend successfully.
curl -i http://127.0.0.1:3000/api/profile

# View recent web-service log entries.
bash scripts/labctl.sh logs web 20

# View recent backend log entries.
bash scripts/labctl.sh logs backend 20
```

A healthy baseline includes:

- Both `backend` and `web` shown as `running`
- Successful responses from `/health` and `/api/profile`
- `server_started` and `profile_request_succeeded` in the web log
- `request_received` in the backend log

## Troubleshooting Exercises

Each scenario starts from the healthy baseline. After reproducing a fault, the service is restored to its normal state.


### 1. Missing Environment Variable

This scenario starts the web service with an environment file that does not include `SUPABASE_ANON_KEY`.

```bash
# Stop the healthy web service before changing its environment file.
bash scripts/labctl.sh stop web

# Create a fault environment file without SUPABASE_ANON_KEY.
bash scripts/labctl.sh prepare missing-env

# Start the web service with the fault environment file.
# A startup failure is expected.
bash scripts/labctl.sh start web runtime/scenarios/missing-env.web.env

# Confirm that the web service is stopped.
bash scripts/labctl.sh status

# Check the startup log for the configuration error.
bash scripts/labctl.sh logs web 30

# Confirm that the normal environment file contains the variable name.
grep -n '^SUPABASE_ANON_KEY=' runtime/web.env

# Confirm that the fault environment file does not contain the variable name.
grep -n '^SUPABASE_ANON_KEY=' runtime/scenarios/missing-env.web.env

# Restart the web service with the default environment file.
bash scripts/labctl.sh start web

# Verify that the profile API works again.
curl -i http://127.0.0.1:3000/api/profile
```

- Symptom: the web service stops immediately after startup
- Key evidence: `config_error` and `missingVariables`
- Root cause: missing environment variable
- Recovery: restart with the default environment file

### 2. Port Conflict

This scenario starts a safe lab process that occupies port `3000` before starting the web service.

```bash
# Stop the healthy web service to free port 3000.
bash scripts/labctl.sh stop web

# Start the lab process that occupies port 3000.
bash scripts/labctl.sh occupy-port

# Identify the process currently listening on port 3000.
lsof -nP -iTCP:3000 -sTCP:LISTEN

# Replace <PID> with the PID returned by lsof.
# Check the process ID, parent process ID, and command.
ps -p <PID> -o pid,ppid,command

# Try to start the web service on the already occupied port.
bash scripts/labctl.sh start web

# Check the web log for the port conflict error.
bash scripts/labctl.sh logs web 30

# Stop only the lab's port-occupier process.
bash scripts/labctl.sh release-port

# Start the web service again after freeing port 3000.
bash scripts/labctl.sh start web

# Verify that the web service is healthy again.
curl -i http://127.0.0.1:3000/health
```

- Symptom: the web service cannot start
- Key evidence: `server_listen_failed` and `EADDRINUSE`
- Root cause: another process is already listening on port `3000`
- Recovery: stop the verified port-occupier process and restart the web service

### 3. Incorrect API Endpoint

This scenario starts the web service with a `SUPABASE_URL` that contains an incorrect `/wrong-rest` path.

```bash
# Stop the healthy web service before changing its environment file.
bash scripts/labctl.sh stop web

# Create a fault environment file with an incorrect SUPABASE_URL.
bash scripts/labctl.sh prepare wrong-supabase-url

# Start the web service with the fault environment file.
bash scripts/labctl.sh start web runtime/scenarios/wrong-supabase-url.web.env

# Send a request to the profile API.
curl -i http://127.0.0.1:3000/api/profile

# Check the web log for the upstream URL and upstream response status.
bash scripts/labctl.sh logs web 40

# Check the backend log for the received path and route_not_found event.
bash scripts/labctl.sh logs backend 40

# Compare the normal and fault SUPABASE_URL values.
grep -n '^SUPABASE_URL=' runtime/web.env runtime/scenarios/wrong-supabase-url.web.env

# Stop the web service running with the fault configuration.
bash scripts/labctl.sh stop web

# Restart the web service with the default environment file.
bash scripts/labctl.sh start web

# Verify that the profile API works again.
curl -i http://127.0.0.1:3000/api/profile
```

- Symptom: the profile API request fails
- Key evidence: `upstream_http_error`, backend `404`, and `route_not_found`
- Root cause: an incorrect path in `SUPABASE_URL`
- Recovery: restart with the default API URL configuration

### 4. File Permission Error

This scenario removes all permissions from the local profile data file.

```bash
# Remove all permissions from the lab profile data file.
bash scripts/labctl.sh break-profile-permissions

# Check the file permissions and ownership.
ls -l runtime/data/profile.json

# Confirm that the web service itself is still healthy.
curl -i http://127.0.0.1:3000/health

# Send a request that requires the profile data file.
curl -i http://127.0.0.1:3000/api/profile

# Check the web log for the file-read error.
bash scripts/labctl.sh logs web 40

# Restore the profile file to owner read/write permission mode 600.
bash scripts/labctl.sh fix-profile-permissions

# Confirm that the permission mode has been restored.
ls -l runtime/data/profile.json

# Verify that the profile API works again.
curl -i http://127.0.0.1:3000/api/profile
```

- Symptom: the profile API request fails while the health endpoint remains available
- Key evidence: `profile_read_failed`, `EACCES`, and permission mode `000`
- Root cause: the running user cannot read the profile data file
- Recovery: restore the minimum required permission mode, `600`

### 5. Upstream Process Down

This scenario stops only the backend service while leaving the web service running.

```bash
# Stop only the backend service.
bash scripts/labctl.sh stop backend

# Confirm that the backend is stopped while the web service is still running.
bash scripts/labctl.sh status

# Confirm that the web service itself is still available.
curl -i http://127.0.0.1:3000/health

# Send a request that requires the backend service.
curl -i http://127.0.0.1:3000/api/profile

# Check the web log for the upstream network error.
bash scripts/labctl.sh logs web 40

# Confirm that no process is listening on the backend port.
lsof -nP -iTCP:4000 -sTCP:LISTEN

# Restart the backend service.
bash scripts/labctl.sh start backend

# Confirm that both services are running.
bash scripts/labctl.sh status

# Verify that the web-to-backend request works again.
curl -i http://127.0.0.1:3000/api/profile

# Confirm that the backend received a new request.
bash scripts/labctl.sh logs backend 20
```

- Symptom: requests requiring the backend fail while the web service remains available
- Key evidence: `upstream_network_error`, `ECONNREFUSED`, and no listener on port `4000`
- Root cause: the upstream backend process is down
- Recovery: restart the backend process and verify the end-to-end request

## Scope and Safety

- Uses only built-in Node.js functionality
- Does not call external APIs
- Does not use customer data or real API keys
- Stops only processes created by this lab
- Excludes generated logs, PID files, and local environment files in `runtime/`
- Demonstrates local troubleshooting practice, not production operations experience