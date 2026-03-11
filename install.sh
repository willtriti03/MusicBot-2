#!/bin/bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")" || {
    echo "Could not change directory to MusicBot."
    exit 1
}

PySupported=("3.10" "3.11" "3.12" "3.13")
PyBins=("python3")

for Ver in "${PySupported[@]}" ; do
    PyBins+=("python${Ver}")
    PyBins+=("python${Ver//./}")
done

PyBins+=("python")

Python_Bin=""

for PyBin in "${PyBins[@]}" ; do
    if ! command -v "$PyBin" > /dev/null 2>&1 ; then
        continue
    fi

    PY_VER=($($PyBin -c "import sys; print('%s %s' % sys.version_info[:2])" || { echo "0 0"; }))
    if [[ "${PY_VER[0]}" != "3" ]]; then
        continue
    fi

    Candidate="${PY_VER[0]}.${PY_VER[1]}"
    for Supported in "${PySupported[@]}" ; do
        if [[ "$Candidate" == "$Supported" ]]; then
            Python_Bin="$PyBin"
            break 2
        fi
    done
done

if [[ -z "$Python_Bin" ]]; then
    echo "Python 3.10 through 3.13 is required to install MusicBot."
    exit 1
fi

echo "Using '${Python_Bin}' to install MusicBot dependencies..."
"$Python_Bin" -m pip install --upgrade -r requirements.lock

if [[ ! -f "config/options.ini" ]]; then
    cp "config/1_options.ini" "config/options.ini"
fi

echo ""
echo "Install complete."
echo "Next steps:"
echo "  1. Edit config/options.ini"
echo "  2. Run: ${Python_Bin} run.py"
