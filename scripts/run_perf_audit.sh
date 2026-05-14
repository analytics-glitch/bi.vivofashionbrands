#!/usr/bin/env bash
# Section-1 performance audit — post-deploy smoke test.
#
# Exits non-zero on SLA regression so it can gate a release. Drop this
# into your CI's "post-deploy" step (GitHub Actions, GitLab, cron, …)
# pointing at the env you just shipped.
#
# Required env (export before invocation):
#   PERF_AUDIT_BASE_URL   Full URL of the deployed app (no trailing /)
#   PERF_AUDIT_EMAIL      Admin user with /api/auth/login access
#   PERF_AUDIT_PASSWORD   Password for above
#
# Optional:
#   PERF_AUDIT_WARMUP_SLEEP   Seconds to wait before the first call so
#                             the post-deploy warmup task can populate
#                             caches. Default 120.
#   PERF_AUDIT_REPORT         Where to write the JSON artifact.
#                             Default /tmp/audit_section1.json
#
# Example (GitHub Actions step):
#   - name: Section-1 perf audit
#     env:
#       PERF_AUDIT_BASE_URL: ${{ secrets.PROD_URL }}
#       PERF_AUDIT_EMAIL:    ${{ secrets.PERF_ADMIN_EMAIL }}
#       PERF_AUDIT_PASSWORD: ${{ secrets.PERF_ADMIN_PASSWORD }}
#       PERF_AUDIT_WARMUP_SLEEP: "120"
#     run: bash scripts/run_perf_audit.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

: "${PERF_AUDIT_BASE_URL:?PERF_AUDIT_BASE_URL must be set}"
: "${PERF_AUDIT_EMAIL:?PERF_AUDIT_EMAIL must be set}"
: "${PERF_AUDIT_PASSWORD:?PERF_AUDIT_PASSWORD must be set}"
: "${PERF_AUDIT_WARMUP_SLEEP:=120}"
: "${PERF_AUDIT_REPORT:=/tmp/audit_section1.json}"

export PERF_AUDIT_BASE_URL PERF_AUDIT_EMAIL PERF_AUDIT_PASSWORD
export PERF_AUDIT_WARMUP_SLEEP PERF_AUDIT_REPORT

# Minimal Python deps — `requests` is the only external lib the audit
# script touches. Install on demand so the script works in slim CI
# images that only have Python core.
if ! python3 -c "import requests" >/dev/null 2>&1; then
    echo "[perf-audit] installing requests …"
    python3 -m pip install --quiet requests
fi

cd "$REPO_ROOT"
python3 backend/tests/audit_section1_perf.py
