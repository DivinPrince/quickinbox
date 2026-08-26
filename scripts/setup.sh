#!/usr/bin/env bash
# Bootstrap Quickinbox setup: install bun if needed, install deps, run the wizard.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

say() { printf '%s\n' "$*"; }
ok() { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*"; }

has_bun() {
	command -v bun >/dev/null 2>&1
}

has_node() {
	command -v node >/dev/null 2>&1
}

node_major() {
	node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1
}

ask_yes() {
	# $1 prompt, default yes
	local reply
	if [[ ! -t 0 ]]; then
		return 0
	fi
	read -r -p "  $1 [Y/n] " reply || true
	reply="$(printf '%s' "$reply" | tr '[:upper:]' '[:lower:]')"
	[[ -z "$reply" || "$reply" == y || "$reply" == yes ]]
}

say ""
say "Quickinbox setup"
say "  Installing anything that's missing, then the domain wizard."
say ""

if ! has_bun; then
	warn "Bun is not installed. Quickinbox's build and deploy scripts use bun."
	if ask_yes "Install bun now?"; then
		if [[ "$(uname -s)" == "MINGW"* || "$(uname -s)" == "MSYS"* || "$(uname -s)" == "CYGWIN"* ]]; then
			say "  Install bun from https://bun.sh on Windows, then re-run: bash scripts/setup.sh"
			exit 1
		fi
		curl -fsSL https://bun.sh/install | bash
		export PATH="$BUN_INSTALL/bin:$PATH"
		if ! has_bun; then
			say "  Bun installed, but this shell cannot see it yet."
			say "  Add $BUN_INSTALL/bin to PATH and re-run: bash scripts/setup.sh"
			exit 1
		fi
		ok "bun $(bun --version)"
	elif has_node; then
		major="$(node_major)"
		if [[ -n "$major" && "$major" -ge 20 ]]; then
			warn "Continuing with Node $(node -v). Some package.json scripts still call bun."
		else
			say "  Need bun (https://bun.sh) or Node 20+ (https://nodejs.org)."
			exit 1
		fi
	else
		say "  Need bun (https://bun.sh) or Node 20+ (https://nodejs.org)."
		exit 1
	fi
else
	ok "bun $(bun --version)"
fi

if has_bun; then
	bun install
	ok "dependencies installed"
	exec bun "$ROOT/scripts/setup.mjs" "$@"
fi

npm install
ok "dependencies installed"
exec node "$ROOT/scripts/setup.mjs" "$@"
