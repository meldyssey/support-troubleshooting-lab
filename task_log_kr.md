# Support Troubleshooting Lab Record

실습 기록  
명령어 전체 출력이나 API 키는 붙이지 않는다. **증상 → 증거 → 원인 → 복구 → 검증**만 짧고 구체적으로 쓴다.

## 0. Baseline: 정상 서비스

- 실행한 날짜: 2026-10-01
- `backend` PID: `13073`
- `web` PID: `13192`
- `curl -i /health` 결과: `HTTP/1.1 200 OK` — web service가 정상 실행 중임을 확인
- `curl -i /api/profile` 결과: `HTTP/1.1 200 OK` — web service에서 backend까지의 호출이 정상 동작함을 확인
- 로그 증거: `runtime/logs/web.log`에서 `server_started`, `request_received`, `profile_request_succeeded` event를 확인
- 정상이라고 판단한 근거: `status` 명령을 통한 process 상태, `curl -i` 명령을 통한 HTTP 응답, `web log`를 함께 확인했을 때 서비스 시작과 backend 연동이 모두 정상

## 1. 환경변수 누락으로 서비스 시작 실패

- 증상: `web` 서비스가 시작 직후 종료됨
- 첫 확인 명령: `bash scripts/labctl.sh status`, `bash scripts/labctl.sh logs web 30`
- 핵심 로그 event / 오류 코드: `config_error` event와 `missingVariables: ["SUPABASE_ANON_KEY"]`를 확인
- 로그에서 확인한 원인: `SUPABASE_ANON_KEY`가 환경 파일에 없음
- 실제 변수 없음 확인: `grep -q` 명령으로 해당 환경 파일 확인
- 복구: `bash scripts/labctl.sh start web`으로 기본 환경 파일을 사용해 web service를 다시 시작
- 검증: `status`에서 `backend`와 `web`이 모두 `running`인 것을 확인, `/health`, `/api/profile`은 모두 `HTTP 200`을 반환, `web log`에서 `profile_request_succeeded` event를 확인

## 2. 포트 충돌

- 증상: web service가 `3000`번 port에서 시작하지 못하고 종료
- 포트를 점유한 PID와 process command: PID `22518`, `node .../app/port-occupier.js`
- 확인 명령: `lsof -nP -iTCP:3000 -sTCP:LISTEN`, `ps -p 22518 -o pid,ppid,command`
- 핵심 로그 event / 오류 코드: `server_listen_failed`, `EADDRINUSE` — `127.0.0.1:3000` 주소가 이미 사용 중이라는 오류를 확인
- 조치와 조치 근거: PID `22518`이 이 실습의 `port-occupier` process임을 확인한 뒤 `bash scripts/labctl.sh release-port`로 해당 process만 정상 종료
- 복구: `bash scripts/labctl.sh start web`으로 web service를 다시 시작
- 복구 검증: `status`에서 `web`이 `running` 확인, `/health`가 `HTTP 200`을 반환 확인

## 3. 잘못된 API endpoint

- 증상: `/api/profile`이 `HTTP 502`를 반환
- browser/client에서 보인 HTTP 상태: `HTTP/1.1 502 Bad Gateway`
- web log의 upstream URL / status: `upstream_http_error` event에서 upstream URL은 `http://127.0.0.1:4000/wrong-rest/rest/v1/profiles?user_id=demo-user`였고, upstream status는 `404`
- backend log에서 찾은 단서: `backend`가 같은 `/wrong-rest/rest/v1/profiles` path 요청을 받은 뒤 `route_not_found` event를 기록
- 원인 가설과 확정 근거: 환경 변수 `SUPABASE_URL`에 잘못된 `/wrong-rest` path가 포함되어 있었고 web service가 여기에 `/rest/v1/profiles`를 덧붙여 존재하지 않는 endpoint를 호출, `web`과 `backend` log에서 같은 잘못된 path 및 `404`를 확인해 원인을 확정
- 복구와 검증: fault 설정으로 실행 중인 web service를 종료하고 기본 환경 파일로 재시작. `status`에서 `backend`와 `web`이 모두 `running`인 것을 확인, `/health`와 `/api/profile`은 모두 `HTTP 200`을 반환, `web log`에서 `profile_request_succeeded` event를 확인

## 4. 파일 권한 오류

- 증상: `/health`는 `HTTP 200`을 반환했지만 `/api/profile`은 `HTTP 500`을 반환
- web log의 error code: `profile_read_failed` event와 `EACCES` error code를 확인했고, `EACCES: permission denied, open 'runtime/data/profile.json'` 메시지를 확인
- `ls -l runtime/data/profile.json` 결과: profile 파일의 permission mode가 `000`이었고, owner·group·other 모두 읽기/쓰기/실행 권한이 없었음
- 원인: 실행 사용자가 profile 파일을 읽을 수 없는 파일 권한 문제로, 사용자나 group 설정이 아니라 모든 권한이 제거된 permission mode `000`이 직접 원인
- 최소 권한 복구 조치: `bash scripts/labctl.sh fix-profile-permissions`로 profile 파일을 `600`(owner read/write)으로 복구
- 검증: `ls -l runtime/data/profile.json`에서 permission mode가 `600`으로 바뀐 것을 확인, `/api/profile`은 `HTTP 200`을 반환, `web log`에서 `profile_request_succeeded` event를 확인

## 5. upstream process down

- 증상: `/api/profile`이 `HTTP 502`를 반환
- browser/client에서 보인 HTTP 상태: `HTTP/1.1 502 Bad Gateway`
- web log의 event: `upstream_network_error` event와 `ECONNREFUSED` 오류가 기록
- backend PID/process 상태: `status`에서 `backend`는 `stopped`, `web`은 `running`이었고, `4000`번 port를 확인했을 때 listen 중인 backend process가 없었음
- 네트워크인지, upstream process down인지 판단한 증거: web service와 `3000`번 port는 `/health`의 `HTTP 200`으로 정상임을 확인. backend가 사용하던 `127.0.0.1:4000`에는 listener가 없었고 `ECONNREFUSED`가 발생
- 판단: DNS나 외부 network 문제가 아니라 backend process down으로 판단
- 복구와 검증: `bash scripts/labctl.sh start backend`로 backend를 다시 시작, `status`에서 `backend`와 `web`이 모두 `running`인 것을 확인, `/api/profile`은 `HTTP 200`을 반환, `backend log`의 `request_received`와 `web log`의 `profile_request_succeeded` event를 확인