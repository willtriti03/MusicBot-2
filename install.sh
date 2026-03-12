#!/bin/bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")" || {
    echo "Could not change directory to MusicBot."
    exit 1
}

NODE_REQUIRED_MAJOR=22
NODE_REQUIRED_MINOR=12
AUTO_INSTALL_SYSTEM_PACKAGES=1

log() {
    echo "==> $*"
}

warn() {
    echo "Warning: $*" >&2
}

die() {
    echo "Error: $*" >&2
    exit 1
}

have_command() {
    command -v "$1" > /dev/null 2>&1
}

usage() {
    cat <<'EOF'
Usage: ./install.sh [--skip-system-packages]

Default behavior:
  - Installs Node.js 22.12+ if needed
  - Installs ffmpeg and yt-dlp if missing
  - Installs npm dependencies and builds ts-bot

Options:
  --skip-system-packages   Skip apt/brew package installation and only build the app
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-system-packages)
            AUTO_INSTALL_SYSTEM_PACKAGES=0
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            die "Unknown argument: $1"
            ;;
    esac
done

run_as_root() {
    if [[ "${EUID}" -eq 0 ]]; then
        "$@"
        return
    fi

    if ! have_command sudo; then
        die "sudo is required to install system packages automatically."
    fi

    sudo "$@"
}

node_version_supported() {
    if ! have_command node; then
        return 1
    fi

    node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > ${NODE_REQUIRED_MAJOR} || (major === ${NODE_REQUIRED_MAJOR} && minor >= ${NODE_REQUIRED_MINOR}) ? 0 : 1)"
}

detect_package_manager() {
    if have_command apt-get; then
        echo "apt"
        return
    fi
    if have_command brew; then
        echo "brew"
        return
    fi
    echo "unknown"
}

APT_UPDATED=0

apt_update_once() {
    if [[ "${APT_UPDATED}" -eq 1 ]]; then
        return
    fi

    log "Updating apt package index..."
    run_as_root env DEBIAN_FRONTEND=noninteractive apt-get update
    APT_UPDATED=1
}

apt_install() {
    apt_update_once
    log "Installing apt packages: $*"
    run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
}

ensure_nodesource_repo_apt() {
    apt_install ca-certificates curl gnupg

    local keyring_dir="/etc/apt/keyrings"
    local keyring_file="${keyring_dir}/nodesource.gpg"
    local list_file="/etc/apt/sources.list.d/nodesource.list"
    local temp_key
    temp_key="$(mktemp)"

    log "Configuring NodeSource repository for Node.js 22.x..."
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key -o "${temp_key}"
    run_as_root install -d -m 0755 "${keyring_dir}"
    run_as_root gpg --yes --dearmor -o "${keyring_file}" "${temp_key}"
    printf '%s\n' "deb [signed-by=${keyring_file}] https://deb.nodesource.com/node_22.x nodistro main" | run_as_root tee "${list_file}" > /dev/null
    rm -f "${temp_key}"
    APT_UPDATED=0
}

ensure_node_apt() {
    if node_version_supported; then
        log "Node.js $(node --version) already satisfies the requirement."
        return
    fi

    ensure_nodesource_repo_apt
    apt_install nodejs

    if ! node_version_supported; then
        die "Node.js is still below ${NODE_REQUIRED_MAJOR}.${NODE_REQUIRED_MINOR} after installation."
    fi

    log "Installed Node.js $(node --version)."
}

ensure_ffmpeg_apt() {
    if have_command ffmpeg; then
        return
    fi
    apt_install ffmpeg
}

ensure_ytdlp_apt() {
    if have_command yt-dlp; then
        return
    fi

    apt_update_once
    if apt-cache show yt-dlp > /dev/null 2>&1; then
        apt_install yt-dlp
        return
    fi

    apt_install python3 python3-pip
    log "Installing yt-dlp via pip..."
    python3 -m pip install --user --upgrade yt-dlp
    export PATH="${HOME}/.local/bin:${PATH}"
}

ensure_build_toolchain_apt() {
    apt_install build-essential python3 make g++
}

ensure_node_brew() {
    if node_version_supported; then
        log "Node.js $(node --version) already satisfies the requirement."
        return
    fi

    log "Installing Node.js 22 with Homebrew..."
    brew install node@22

    local node22_bin
    node22_bin="$(brew --prefix node@22)/bin"
    export PATH="${node22_bin}:${PATH}"

    if ! node_version_supported; then
        die "Homebrew installed node@22, but the current shell still does not see Node.js ${NODE_REQUIRED_MAJOR}.${NODE_REQUIRED_MINOR}+."
    fi
}

ensure_ffmpeg_brew() {
    if have_command ffmpeg; then
        return
    fi
    brew install ffmpeg
}

ensure_ytdlp_brew() {
    if have_command yt-dlp; then
        return
    fi
    brew install yt-dlp
}

ensure_system_packages() {
    if [[ "${AUTO_INSTALL_SYSTEM_PACKAGES}" -eq 0 ]]; then
        return
    fi

    case "$(detect_package_manager)" in
        apt)
            ensure_build_toolchain_apt
            ensure_node_apt
            ensure_ffmpeg_apt
            ensure_ytdlp_apt
            ;;
        brew)
            ensure_node_brew
            ensure_ffmpeg_brew
            ensure_ytdlp_brew
            ;;
        *)
            warn "Automatic system package installation is only implemented for apt and Homebrew."
            warn "Install Node.js ${NODE_REQUIRED_MAJOR}.${NODE_REQUIRED_MINOR}+, ffmpeg, and yt-dlp manually or rerun with --skip-system-packages."
            ;;
    esac
}

ensure_system_packages

if ! have_command node; then
    die "Node.js is required."
fi

if ! have_command npm; then
    die "npm is required."
fi

if ! node_version_supported; then
    die "Node.js ${NODE_REQUIRED_MAJOR}.${NODE_REQUIRED_MINOR} or newer is required."
fi

if ! have_command ffmpeg; then
    warn "'ffmpeg' is not installed. Music playback will fail until it is available in PATH."
fi

if ! have_command yt-dlp; then
    warn "'yt-dlp' is not installed. Music playback will fail until it is available in PATH."
fi

log "Installing ts-bot dependencies..."
npm install --prefix ts-bot

log "Building ts-bot..."
npm run build --prefix ts-bot

if [[ ! -f ".env" ]]; then
    cp "config/musicbot.env.example" ".env"
fi

echo ""
echo "Install complete."
echo "Next steps:"
echo "  1. Edit .env or /etc/musicbot/musicbot.env"
echo "  2. Review config/config.json"
echo "  3. Run: ./run.sh"
echo "  4. For systemd deployment, copy this repo to /opt/musicbot and install musicbot.service"
