#!/usr/bin/env bash
#
# Linux/macOS counterpart of scripts/build.ps1.
# Packages the extension into dist/ as:
#   dist/chrome/volume-control-chrome-v<version>.zip  (placed at dist/volume-control-chrome-v<version>.zip)
#   dist/firefox/volume-control-firefox-v<version>.zip (placed at dist/volume-control-firefox-v<version>.zip)
#
# Usage:
#   ./scripts/build.sh [output-dir]
#   ./scripts/build.sh --output-dir dist
#
# Requires: bash, python3 (stdlib only: json, re, zipfile, pathlib).

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT_PATH="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
OUTPUT_DIR="dist"

usage() {
    echo "Usage: $(basename "$0") [output-dir]" >&2
    echo "       $(basename "$0") --output-dir <dir>" >&2
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        -o|--output-dir|--output|--out)
            [[ $# -ge 2 ]] || { echo "error: $1 requires a value" >&2; exit 1; }
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --output-dir=*|--output=*|--out=*)
            OUTPUT_DIR="${1#*=}"
            shift
            ;;
        -*)
            echo "error: unknown option: $1" >&2
            usage
            exit 1
            ;;
        *)
            OUTPUT_DIR="$1"
            shift
            ;;
    esac
done

[[ -n "$OUTPUT_DIR" ]] || { echo "error: output dir must not be empty" >&2; exit 1; }

# Resolve OUTPUT_ROOT against the repo root when relative (mirrors Join-Path $RootPath $OutputDir).
if [[ "$OUTPUT_DIR" = /* ]]; then
    OUTPUT_ROOT="$OUTPUT_DIR"
else
    OUTPUT_ROOT="$ROOT_PATH/$OUTPUT_DIR"
fi
# Normalise (no requirement that it exists yet).
OUTPUT_ROOT="$(python3 -c 'import os,sys; print(os.path.normpath(sys.argv[1]))' "$OUTPUT_ROOT")"

command -v python3 >/dev/null 2>&1 || { echo "error: python3 is required but not on PATH" >&2; exit 1; }

assert_in_repo() {
    # Prints the canonical path if (and only if) it lives inside the repo.
    local path="$1"
    local full
    full="$(python3 -c 'import os,sys; print(os.path.normpath(os.path.join(sys.argv[1], sys.argv[2])))' "$ROOT_PATH" "$path")"
    # For absolute $path, os.path.join discards ROOT_PATH -- same as Join-Path semantics we want to guard.
    if [[ "$path" = /* ]]; then
        full="$(python3 -c 'import os,sys; print(os.path.normpath(sys.argv[1]))' "$path")"
    fi
    case "$full" in
        "$ROOT_PATH"/*|"$ROOT_PATH")
            printf '%s\n' "$full"
            ;;
        *)
            echo "error: refusing to operate outside repo: $full" >&2
            exit 1
            ;;
    esac
}

remove_directory_in_repo() {
    local full
    full="$(assert_in_repo "$1")"
    if [[ -e "$full" ]]; then
        rm -rf -- "$full"
    fi
}

new_extension_zip() {
    local source_dir="$1" zip_path="$2"
    local source_full zip_full
    source_full="$(assert_in_repo "$source_dir")"
    zip_full="$(assert_in_repo "$zip_path")"
    rm -f -- "$zip_full"
    python3 - "$source_full" "$zip_full" <<'PY'
import os, sys, zipfile
source_root = os.path.normpath(sys.argv[1])
zip_path = sys.argv[2]
names = []
for dirpath, _dirnames, filenames in os.walk(source_root):
    for name in filenames:
        full = os.path.join(dirpath, name)
        rel = os.path.relpath(full, source_root).replace(os.sep, "/")
        names.append((full, rel))
names.sort(key=lambda t: t[1])
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for full, rel in names:
        zf.write(full, rel)
PY
}

optimize_source_file() {
    python3 - "$1" <<'PY'
import re, sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8-sig", newline="") as f:
    content = f.read()
ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
if ext == "js":
    # Mirrors build.ps1: strings (group 1) kept intact, block (group 2)
    # and line (group 3) comments removed.
    pattern = re.compile(
        r'("(?:[^"\\]|\\.)*"|\'(?:[^\'\\]|\\.)*\'|`(?:[^`\\]|\\.)*`)|(/\*[\s\S]*?\*/)|(//.*)'
    )
    def _repl(m):
        if m.group(2) is not None or m.group(3) is not None:
            return ""
        return m.group(0)
    content = pattern.sub(_repl, content)
    content = re.sub(r'(?m)^\s*\r?\n', '', content)
elif ext == "css":
    content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)
    content = re.sub(r'(?m)^\s*\r?\n', '', content)
elif ext == "html":
    # NOTE: build.ps1 intends to strip HTML comments here but its pattern
    # ('(?s)') is a no-op typo; the Linux port strips real comments.
    content = re.sub(r'<!--.*?-->', '', content, flags=re.DOTALL)
    content = re.sub(r'(?m)^\s*\r?\n', '', content)
with open(path, "w", encoding="utf-8", newline="\n") as f:
    f.write(content)
PY
}

copy_extension_files() {
    local package_dir="$1" icon_file="$2"
    local src dest
    shopt -s nullglob
    for src in "$ROOT_PATH"/*.js "$ROOT_PATH"/*.html "$ROOT_PATH"/*.css "$ROOT_PATH"/LICENSE; do
        [[ -f "$src" ]] || continue
        dest="$package_dir/$(basename "$src")"
        cp -f -- "$src" "$dest"
        # Minify pass: strip comments and empty lines.
        optimize_source_file "$dest"
    done
    shopt -u nullglob
    cp -f -- "$ROOT_PATH/$icon_file" "$package_dir/"
}

new_manifest_variant() {
    # Writes the per-browser manifest to $3.
    local browser="$1" icon_file="$2" dest="$3"
    python3 - "$ROOT_PATH/manifest.json" "$browser" "$icon_file" "$dest" <<'PY'
import json, sys
src, browser, icon_file, dest = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
with open(src, "r", encoding="utf-8-sig") as f:
    manifest = json.load(f)
if browser == "chrome":
    manifest["icons"] = {"128": icon_file}
    manifest.pop("browser_specific_settings", None)
    bg = manifest.get("background")
    if isinstance(bg, dict):
        bg.pop("scripts", None)
else:  # firefox
    manifest["icons"] = {"96": icon_file}
    bg = manifest.get("background")
    if isinstance(bg, dict):
        background_script = bg.pop("service_worker", "background.js")
        scripts = bg.get("scripts")
        if not isinstance(scripts, list):
            bg["scripts"] = ["shared.js", background_script]
        elif "shared.js" not in scripts:
            bg["scripts"] = ["shared.js"] + list(scripts)
    else:
        manifest["background"] = {"scripts": ["shared.js", "background.js"]}
action = manifest.get("action")
if isinstance(action, dict):
    action["default_icon"] = icon_file
# Mirror ConvertTo-Json unescaping of <, >, &.
text = json.dumps(manifest, indent=2, ensure_ascii=False)
text = text.replace("\\u003c", "<").replace("\\u003e", ">").replace("\\u0026", "&")
with open(dest, "w", encoding="utf-8", newline="\n") as f:
    f.write(text + "\n")
# Fail loudly on invalid JSON, like build.ps1 does.
with open(dest, "r", encoding="utf-8") as f:
    json.load(f)
PY
}

write_package() {
    local browser="$1" icon_file="$2" version="$3"
    local package_dir zip_path
    package_dir="$(assert_in_repo "$OUTPUT_ROOT/$browser")"
    mkdir -p -- "$package_dir"
    copy_extension_files "$package_dir" "$icon_file"
    new_manifest_variant "$browser" "$icon_file" "$package_dir/manifest.json"
    zip_path="$(assert_in_repo "$OUTPUT_ROOT/volume-control-$browser-v$version.zip")"
    new_extension_zip "$package_dir" "$zip_path"
    echo "Created $zip_path"
}

main() {
    cd -- "$ROOT_PATH"
    for required in manifest.json icon.svg chrome.png; do
        [[ -f "$ROOT_PATH/$required" ]] || { echo "error: required file is missing: $required" >&2; exit 1; }
    done
    local version
    version="$(python3 -c 'import json; print(json.load(open("manifest.json", encoding="utf-8-sig"))["version"])')"
    remove_directory_in_repo "$OUTPUT_ROOT"
    mkdir -p -- "$OUTPUT_ROOT"
    write_package "firefox" "icon.svg" "$version"
    write_package "chrome" "chrome.png" "$version"
}

main "$@"
