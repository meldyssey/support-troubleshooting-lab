#!/usr/bin/env bash

# A small, deliberately cautious process controller for this training lab.
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/runtime"

bootstrap() {
  node "$ROOT_DIR/scripts/bootstrap.js" >/dev/null
}

pid_file() {
  printf '%s/pids/%s.pid\n' "$RUNTIME_DIR" "$1"
}

log_file() {
  printf '%s/logs/%s.log\n' "$RUNTIME_DIR" "$1"
}

ensure_directories() {
  bootstrap
  mkdir -p "$RUNTIME_DIR/pids"
}

command_for_pid() {
  ps -p "$1" -o command= 2>/dev/null || true
}

is_running() {
  local service="$1"
  local file
  file="$(pid_file "$service")"
  [[ -f "$file" ]] || return 1

  local pid
  pid="$(<"$file")"
  kill -0 "$pid" 2>/dev/null
}

normalise_env_file() {
  local requested="$1"
  local candidate
  if [[ "$requested" = /* ]]; then
    candidate="$requested"
  else
    candidate="$ROOT_DIR/$requested"
  fi

  case "$candidate" in
    "$RUNTIME_DIR"/*) ;;
    *)
      echo "Environment files must stay under runtime/. Refusing: $requested" >&2
      return 1
      ;;
  esac

  [[ -f "$candidate" ]] || {
    echo "Environment file not found: $candidate" >&2
    return 1
  }
  printf '%s\n' "$candidate"
}

start_service() {
  local service="$1"
  local entrypoint="$2"
  local env_file="$3"
  ensure_directories

  if is_running "$service"; then
    echo "$service is already running (PID $(<"$(pid_file "$service")"))."
    return 0
  fi

  local pid_path log_path
  pid_path="$(pid_file "$service")"
  log_path="$(log_file "$service")"
  rm -f "$pid_path"

  (
    cd "$ROOT_DIR"
    nohup bash -c 'set -a; source "$1"; set +a; exec node "$2"' bash "$env_file" "$entrypoint" \
      >> "$log_path" 2>&1 &
    echo $! > "$pid_path"
  )

  sleep 0.4
  if is_running "$service"; then
    echo "Started $service (PID $(<"$pid_path")). Logs: ${log_path#$ROOT_DIR/}"
  else
    rm -f "$pid_path"
    echo "$service stopped during startup. This is expected in some fault exercises." >&2
    tail -n 12 "$log_path" >&2 || true
    return 1
  fi
}

start_port_occupier() {
  local service="port-occupier"
  ensure_directories
  if is_running "$service"; then
    echo "$service is already running (PID $(<"$(pid_file "$service")"))."
    return 0
  fi

  local pid_path log_path
  pid_path="$(pid_file "$service")"
  log_path="$(log_file "$service")"
  rm -f "$pid_path"
  (
    cd "$ROOT_DIR"
    nohup env PORT=3000 node "$ROOT_DIR/app/port-occupier.js" >> "$log_path" 2>&1 &
    echo $! > "$pid_path"
  )
  sleep 0.4
  if is_running "$service"; then
    echo "Port 3000 is now deliberately occupied (PID $(<"$pid_path"))."
  else
    rm -f "$pid_path"
    echo "Could not occupy port 3000; inspect $(log_file "$service")." >&2
    return 1
  fi
}

stop_service() {
  local service="$1"
  local expected="$2"
  local pid_path pid command
  pid_path="$(pid_file "$service")"

  [[ -f "$pid_path" ]] || {
    echo "$service is not tracked as running."
    return 0
  }
  pid="$(<"$pid_path")"

  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$pid_path"
    echo "$service already stopped; removed its stale PID file."
    return 0
  fi

  command="$(command_for_pid "$pid")"
  case "$command" in
    *"$expected"*) ;;
    *)
      echo "Refusing to stop PID $pid: it is not this lab's $service process." >&2
      echo "Observed command: $command" >&2
      return 1
      ;;
  esac

  kill -TERM "$pid"
  for _ in {1..10}; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.1
  done
  rm -f "$pid_path"
  echo "Stopped $service (PID $pid)."
}

show_status() {
  ensure_directories
  for service in backend web port-occupier; do
    if is_running "$service"; then
      local pid
      pid="$(<"$(pid_file "$service")")"
      printf '%-14s running  PID %s\n' "$service" "$pid"
    else
      printf '%-14s stopped\n' "$service"
    fi
  done
}

show_logs() {
  local service="$1"
  local count="${2:-30}"
  [[ "$count" =~ ^[0-9]+$ ]] || {
    echo "Log line count must be a number." >&2
    return 1
  }
  ensure_directories
  tail -n "$count" "$(log_file "$service")" 2>/dev/null || {
    echo "No log exists for $service yet." >&2
    return 1
  }
}

prepare_scenario() {
  local scenario="$1"
  ensure_directories
  local output="$RUNTIME_DIR/scenarios/$scenario.web.env"

  case "$scenario" in
    healthy)
      cp "$RUNTIME_DIR/web.env" "$output"
      ;;
    missing-env)
      awk '!/^SUPABASE_ANON_KEY=/' "$RUNTIME_DIR/web.env" > "$output"
      ;;
    wrong-supabase-url)
      sed 's#^SUPABASE_URL=.*#SUPABASE_URL=http://127.0.0.1:4000/wrong-rest#' \
        "$RUNTIME_DIR/web.env" > "$output"
      ;;
    *)
      echo "Unknown scenario: $scenario" >&2
      echo "Use: healthy, missing-env, wrong-supabase-url" >&2
      return 1
      ;;
  esac
  echo "Prepared ${output#$ROOT_DIR/}"
}

break_profile_permissions() {
  ensure_directories
  chmod 000 "$RUNTIME_DIR/data/profile.json"
  echo "Removed all permissions from runtime/data/profile.json for this lab only."
}

fix_profile_permissions() {
  ensure_directories
  chmod 600 "$RUNTIME_DIR/data/profile.json"
  echo "Restored owner read/write permissions to runtime/data/profile.json."
}

usage() {
  cat <<'EOF'
Usage: bash scripts/labctl.sh <command>

  bootstrap
  start backend
  start web [runtime/web.env or a prepared scenario file]
  stop backend|web|port-occupier|all
  status
  logs backend|web|port-occupier [line-count]
  prepare healthy|missing-env|wrong-supabase-url
  occupy-port
  release-port
  break-profile-permissions
  fix-profile-permissions

This controller only starts or stops PIDs whose command belongs to this lab.
EOF
}

main() {
  local command="${1:-}"
  case "$command" in
    bootstrap)
      bootstrap
      ;;
    start)
      case "${2:-}" in
        backend)
          ensure_directories
          start_service backend "$ROOT_DIR/app/mock-backend.js" "$RUNTIME_DIR/backend.env"
          ;;
        web)
          ensure_directories
          local env_file
          env_file="$(normalise_env_file "${3:-runtime/web.env}")"
          start_service web "$ROOT_DIR/app/web-service.js" "$env_file"
          ;;
        *) usage; return 1 ;;
      esac
      ;;
    stop)
      case "${2:-}" in
        backend) stop_service backend "app/mock-backend.js" ;;
        web) stop_service web "app/web-service.js" ;;
        port-occupier) stop_service port-occupier "app/port-occupier.js" ;;
        all)
          stop_service web "app/web-service.js"
          stop_service backend "app/mock-backend.js"
          stop_service port-occupier "app/port-occupier.js"
          ;;
        *) usage; return 1 ;;
      esac
      ;;
    status) show_status ;;
    logs) show_logs "${2:-}" "${3:-30}" ;;
    prepare) prepare_scenario "${2:-}" ;;
    occupy-port) start_port_occupier ;;
    release-port) stop_service port-occupier "app/port-occupier.js" ;;
    break-profile-permissions) break_profile_permissions ;;
    fix-profile-permissions) fix_profile_permissions ;;
    *) usage; return 1 ;;
  esac
}

main "$@"
