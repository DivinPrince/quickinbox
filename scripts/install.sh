#!/usr/bin/env bash
# Install the Quickinbox CLI from GitHub (no npm).
#   curl -fsSL https://raw.githubusercontent.com/DivinPrince/quickinbox/main/scripts/install.sh | sh
# Default QUICKINBOX_REF is main; QUICKMAIL_REF still works from before the rename.
# Piped `sh` is often dash; re-exec with bash before any bash-only syntax.
if [ -z "${BASH_VERSION:-}" ]; then
	command -v bash >/dev/null 2>&1 || { printf '%s\n' "Need bash."; exit 1; }
	if [ -f "$0" ] && [ -r "$0" ] && [ "${0##*/}" != "sh" ] && [ "${0##*/}" != "dash" ]; then
		exec bash "$0" "$@"
	fi
	exec bash -c "$(cat)" -- "$@"
fi
set -euo pipefail

say() { printf '%s\n' "$*"; }
ok() { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*"; }

REPO="DivinPrince/quickinbox"
REF="${QUICKINBOX_REF:-${QUICKMAIL_REF:-main}}"

case "$REF" in
	''|*..*|*[[:space:]]*|*@*|*'?'*|*#*|*'\\'*|*://*|/*)
		say "Invalid install ref: $REF"
		exit 1
		;;
esac
case "$REF" in
	[A-Za-z0-9]*) ;;
	*)
		say "Invalid install ref: $REF"
		exit 1
		;;
esac

RAW="https://raw.githubusercontent.com/${REPO}/${REF}"

ORIGIN="${QUICKINBOX_URL:-${QUICKMAIL_URL:-}}"
while [ -n "$ORIGIN" ] && [ "$ORIGIN" != "${ORIGIN%/}" ]; do
	ORIGIN="${ORIGIN%/}"
done

if [ -n "$ORIGIN" ]; then
	case "$ORIGIN" in
		*[[:space:]]*|*@*|*'?'*|*#*|*://*/*)
			say "Invalid install URL: $ORIGIN"
			exit 1
			;;
	esac

	host="${ORIGIN#*://}"
	if [ -z "$host" ]; then
		say "Invalid install URL: $ORIGIN"
		exit 1
	fi

	case "$ORIGIN" in
		https://*) ;;
		http://localhost|http://localhost:*|http://127.0.0.1|http://127.0.0.1:*) ;;
		http://*)
			say "HTTP is only allowed for localhost."
			exit 1
			;;
		*)
			say "Install URL must be http or https."
			exit 1
			;;
	esac
fi

if [ -z "${HOME:-}" ] || [ "$HOME" = "/" ]; then
	say "Refusing to install with HOME=${HOME:-unset}"
	exit 1
fi

case "$HOME" in
	/*) ;;
	*)
		say "HOME must be an absolute path."
		exit 1
		;;
esac

if [ "$(id -u)" -eq 0 ] && [ "$HOME" = "/" ]; then
	say "Refusing to run as root with HOME=/"
	exit 1
fi

CLI_DIR="$HOME/.quickinbox/cli"
BIN_DIR="$HOME/.local/bin"
LAUNCHER="$BIN_DIR/quickinbox"
LEGACY_LAUNCHER="$BIN_DIR/quickmail"

case "$CLI_DIR" in
	"$HOME"/*) ;;
	*)
		say "Refusing to install outside \$HOME"
		exit 1
		;;
esac

case "$LAUNCHER" in
	"$HOME"/*) ;;
	*)
		say "Refusing to install outside \$HOME"
		exit 1
		;;
esac

case "$LEGACY_LAUNCHER" in
	"$HOME"/*) ;;
	*)
		say "Refusing to install outside \$HOME"
		exit 1
		;;
esac

if [[ "$(uname -s)" == "MINGW"* || "$(uname -s)" == "MSYS"* || "$(uname -s)" == "CYGWIN"* ]]; then
	say "Install bun from https://bun.sh on Windows, then re-run this installer."
	exit 1
fi

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

has_bun() {
	command -v bun >/dev/null 2>&1
}

download() {
	local url="$1"
	local dest="$2"
	local tmp
	tmp="$(mktemp "${TMPDIR:-/tmp}/quickinbox.XXXXXX")"
	if command -v curl >/dev/null 2>&1; then
		if ! curl -fsSL "$url" -o "$tmp"; then
			rm -f "$tmp"
			say "Download failed: $url"
			exit 1
		fi
	elif command -v wget >/dev/null 2>&1; then
		if ! wget -qO "$tmp" "$url"; then
			rm -f "$tmp"
			say "Download failed: $url"
			exit 1
		fi
	else
		say "Need curl or wget."
		exit 1
	fi
	if [[ ! -s "$tmp" ]]; then
		rm -f "$tmp"
		say "Download failed (empty): $url"
		exit 1
	fi
	mv "$tmp" "$dest"
}

say ""
say "Quickinbox CLI"
say "  Installing from github.com/${REPO} @ ${REF}"
say ""

if ! has_bun; then
	warn "Bun is not installed. The CLI is TypeScript and needs bun."
	curl -fsSL https://bun.sh/install | bash
	export PATH="$BUN_INSTALL/bin:$PATH"
	if ! has_bun; then
		say "  Bun installed, but this shell cannot see it yet."
		say "  Add $BUN_INSTALL/bin to PATH and re-run this installer."
		exit 1
	fi
	ok "bun $(bun --version)"
else
	ok "bun $(bun --version)"
fi

umask 077
mkdir -p "$CLI_DIR" "$BIN_DIR"

download "$RAW/cli/main.ts" "$CLI_DIR/main.ts"
ok "main.ts"
download "$RAW/cli/client.ts" "$CLI_DIR/client.ts"
ok "client.ts"
download "$RAW/cli/config.ts" "$CLI_DIR/config.ts"
ok "config.ts"
download "$RAW/cli/mcp.ts" "$CLI_DIR/mcp.ts"
ok "mcp.ts"
download "$RAW/cli/package.json" "$CLI_DIR/package.json"
ok "package.json"

# Install MCP deps here so `quickinbox mcp` never auto-installs onto stdio.
if ! bun_out="$(cd "$CLI_DIR" && bun install --production 2>&1)"; then
	say "Failed to install MCP dependencies in $CLI_DIR"
	say "$bun_out"
	exit 1
fi
ok "mcp dependencies"

tmp_launcher="$(mktemp "${TMPDIR:-/tmp}/quickinbox.XXXXXX")"
cat > "$tmp_launcher" <<'EOF'
#!/usr/bin/env bash
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
exec bun "$HOME/.quickinbox/cli/main.ts" "$@"
EOF
chmod +x "$tmp_launcher"
cp "$tmp_launcher" "$LEGACY_LAUNCHER"
mv "$tmp_launcher" "$LAUNCHER"
ok "$LAUNCHER"
ok "$LEGACY_LAUNCHER (alias)"

case ":$PATH:" in
	*":$BIN_DIR:"*) ;;
	*)
		warn "Add $BIN_DIR to PATH, then open a new shell:"
		say "  export PATH=\"$BIN_DIR:\$PATH\""
		;;
esac

say ""
say "Next:"
if [ -n "$ORIGIN" ]; then
	say "  quickinbox login --url $ORIGIN --token <key from Settings>"
	say "  (quickmail still works as the same command)"
else
	say "  quickinbox login --url <https://your-instance> --token <key from Settings>"
	say "  (quickmail still works as the same command)"
fi
say ""
