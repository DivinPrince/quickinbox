#!/usr/bin/env bash
# Install the QuickMail CLI from GitHub (no npm).
#   curl -fsSL https://raw.githubusercontent.com/DivinPrince/quickmail/main/scripts/install.sh | sh
# Default QUICKMAIL_REF is main; override to install from another ref.
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

REPO="DivinPrince/quickmail"
REF="${QUICKMAIL_REF:-main}"

case "$REF" in
	''|*..*|*[[:space:]]*|*@*|*'?'*|*#*|*'\\'*|*://*|/*)
		say "Invalid QUICKMAIL_REF: $REF"
		exit 1
		;;
esac
case "$REF" in
	[A-Za-z0-9]*) ;;
	*)
		say "Invalid QUICKMAIL_REF: $REF"
		exit 1
		;;
esac

RAW="https://raw.githubusercontent.com/${REPO}/${REF}"

ORIGIN="${QUICKMAIL_URL:-}"
while [ -n "$ORIGIN" ] && [ "$ORIGIN" != "${ORIGIN%/}" ]; do
	ORIGIN="${ORIGIN%/}"
done

if [ -n "$ORIGIN" ]; then
	case "$ORIGIN" in
		*[[:space:]]*|*@*|*'?'*|*#*|*://*/*)
			say "Invalid QUICKMAIL_URL: $ORIGIN"
			exit 1
			;;
	esac

	host="${ORIGIN#*://}"
	if [ -z "$host" ]; then
		say "Invalid QUICKMAIL_URL: $ORIGIN"
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
			say "QUICKMAIL_URL must be http or https."
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

CLI_DIR="$HOME/.quickmail/cli"
BIN_DIR="$HOME/.local/bin"
LAUNCHER="$BIN_DIR/quickmail"

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
	tmp="$(mktemp "${TMPDIR:-/tmp}/quickmail.XXXXXX")"
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
say "QuickMail CLI"
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

# Mail commands only — mcp.ts pulls in npm deps and is skipped on purpose.
download "$RAW/cli/main.ts" "$CLI_DIR/main.ts"
ok "main.ts"
download "$RAW/cli/client.ts" "$CLI_DIR/client.ts"
ok "client.ts"
download "$RAW/cli/config.ts" "$CLI_DIR/config.ts"
ok "config.ts"

tmp_launcher="$(mktemp "${TMPDIR:-/tmp}/quickmail.XXXXXX")"
cat > "$tmp_launcher" <<'EOF'
#!/usr/bin/env bash
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
exec bun "$HOME/.quickmail/cli/main.ts" "$@"
EOF
chmod +x "$tmp_launcher"
mv "$tmp_launcher" "$LAUNCHER"
ok "$LAUNCHER"

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
	say "  quickmail login --url $ORIGIN --token <key from Settings>"
else
	say "  quickmail login --url <https://your-instance> --token <key from Settings>"
fi
say ""
