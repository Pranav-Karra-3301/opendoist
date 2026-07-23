#!/usr/bin/env bash
#
# End-to-end smoke test for the OpenTask container image.
#
# Runs in CI (the `smoke` job in .github/workflows/docker.yml, gating every publish) and
# locally via `pnpm smoke:docker` after `docker build -t opentask:smoke .`. Requires only
# docker + curl. Boots the image on a throwaway volume and exercises the real first-run path:
#   health -> instance info -> first-user sign-up -> API-token mint -> CLI add/list round-trip.
# Each stage prints a "… OK" checkpoint; any failure aborts non-zero and dumps container logs.
set -euo pipefail

IMAGE="${1:-opentask:smoke}"
NAME="opentask-smoke-$$"
PORT=17968
BASE="http://localhost:${PORT}"
COOKIES="$(mktemp)"

cleanup() {
  docker stop "$NAME" >/dev/null 2>&1 || true
  rm -f "$COOKIES"
}
trap cleanup EXIT

echo "smoke: starting $IMAGE as $NAME on :$PORT"
docker run -d --rm --name "$NAME" -p "${PORT}:7968" "$IMAGE" >/dev/null

# 1. Health — the server binds 0.0.0.0:7968; allow up to 60s for a fresh volume to migrate/boot.
for i in $(seq 1 30); do
  sleep 2
  if curl -fsS "${BASE}/api/health" | grep -q '"ok"'; then break; fi
  if [ "$i" -eq 30 ]; then
    echo "smoke: health never came up"
    docker logs "$NAME" || true
    exit 1
  fi
done
echo "health OK"

# 2. Public instance info must report the build version (truthful /api/v1/info for the release).
curl -fsS "${BASE}/api/v1/info" | grep -q '"version"' && echo "info OK"

# 3. First-user registration is open on a fresh volume (better-auth email sign-up; autoSignIn
#    default sets the session cookie we capture into the jar).
curl -fsS -X POST "${BASE}/api/auth/sign-up/email" \
  -H 'Content-Type: application/json' \
  -d '{"email":"smoke@test.local","password":"smoke-test-pass-1","name":"Smoke"}' \
  -c "$COOKIES" >/dev/null && echo "signup OK"

# 4. Mint a read_write API token with that session.
#    AS-BUILT: better-auth's HTTP /api/auth/api-key/create cannot set `permissions` (server-only),
#    so a key created that way is read-only and would 403 the `add` below. The app instead exposes
#    POST /api/v1/tokens, which applies the frozen {opentask:['read','read_write']} shape
#    server-side and returns the ot_… secret exactly once in the `token` field.
TOKEN_JSON="$(curl -sS -X POST "${BASE}/api/v1/tokens" \
  -b "$COOKIES" -H 'Content-Type: application/json' \
  -d '{"name":"smoke","scope":"read_write"}')"
TOKEN="$(printf '%s' "$TOKEN_JSON" | grep -o '"token":"ot_[^"]*"' | cut -d'"' -f4 || true)"
if [ -z "$TOKEN" ]; then
  echo "smoke: token mint failed: $TOKEN_JSON"
  exit 1
fi
echo "token OK"

# 5. CLI round-trip inside the container (the `opentask` binary is baked into the image).
docker exec -e OPENTASK_URL=http://localhost:7968 -e OPENTASK_TOKEN="$TOKEN" "$NAME" \
  opentask add "Smoke test task tomorrow p1" >/dev/null
if docker exec -e OPENTASK_URL=http://localhost:7968 -e OPENTASK_TOKEN="$TOKEN" "$NAME" \
  opentask list --json | grep -q "Smoke test task"; then
  echo "cli OK"
else
  echo "smoke: CLI round-trip failed — created task not found in list output"
  exit 1
fi

echo "smoke PASSED"
