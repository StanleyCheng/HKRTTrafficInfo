#!/usr/bin/env bash
set -euo pipefail

expected_sha="${1:?expected verified SHA required}"
current_sha="$(git ls-remote origin refs/heads/main | cut -f1)"
if [[ -z "$current_sha" ]]; then
  echo "::error::Could not verify the current main revision."
  exit 1
fi
if [[ "$current_sha" != "$expected_sha" ]]; then
  echo "Skipping superseded revision $expected_sha; main is $current_sha."
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then echo 'eligible=false' >> "$GITHUB_OUTPUT"; exit 0; fi
  exit 2
fi
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then echo 'eligible=true' >> "$GITHUB_OUTPUT"; fi
