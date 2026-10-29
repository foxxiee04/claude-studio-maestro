#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash scripts/scaffold.sh <project-dir> [options]

Options:
  --name <package-name>  package.json name (default: project folder name in kebab-case)
  --port <port>          dev server port written to .claude/launch.json (default: 3100)
  --skip-icons           skip installing itshover animated icons
  -h, --help             show this help
EOF
}

die() {
  printf 'scaffold: %s\n' "$*" >&2
  exit 1
}

PROJECT_DIR=""
PKG_NAME=""
PORT=3100
SKIP_ICONS=0
CURRENT_STEP="startup"
TMP_ROOT=""

cleanup() {
  if [[ -n "$TMP_ROOT" && -d "$TMP_ROOT" ]]; then
    rm -rf "$TMP_ROOT"
  fi
}
on_error() {
  local code=$?
  printf '\n' >&2
  printf 'scaffold: FAILED at step: %s\n' "$CURRENT_STEP" >&2
  printf 'scaffold: command: %s\n' "${BASH_COMMAND}" >&2
  printf 'scaffold: exit code: %s\n' "$code" >&2
  if [[ -n "$PROJECT_DIR" && -f "$PROJECT_DIR/package.json" ]]; then
    printf 'scaffold: %s was left partially set up; remove it or fix the issue and rerun into a clean folder.\n' "$PROJECT_DIR" >&2
  fi
}
trap on_error ERR
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)
      [[ $# -ge 2 ]] || die "--name needs a value"
      PKG_NAME="$2"
      shift 2
      ;;
    --port)
      [[ $# -ge 2 ]] || die "--port needs a value"
      PORT="$2"
      shift 2
      ;;
    --skip-icons)
      SKIP_ICONS=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      die "unknown option: $1 (try --help)"
      ;;
    *)
      [[ -z "$PROJECT_DIR" ]] || die "unexpected extra argument: $1"
      PROJECT_DIR="$1"
      shift
      ;;
  esac
done

[[ -n "$PROJECT_DIR" ]] || { usage; exit 1; }
[[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT >= 1 && PORT <= 65535 )) || die "--port must be a number between 1 and 65535 (got: $PORT)"
if [[ -n "$PKG_NAME" ]]; then
  [[ "$PKG_NAME" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || die "--name must be a valid npm package name, e.g. my-app (got: $PKG_NAME)"
fi

for tool in node npx pnpm; do
  command -v "$tool" >/dev/null 2>&1 || die "required tool not found on PATH: $tool"
done

kebab() {
  local out
  out="$(printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -e 's/[^a-z0-9._-][^a-z0-9._-]*/-/g' \
          -e 's/^[-._]*//' \
          -e 's/[-._]*$//')"
  [[ -n "$out" ]] || out="app"
  printf '%s' "$out"
}

CURRENT_STEP="1/9 prepare project directory"
mkdir -p "$PROJECT_DIR"
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd -P)"

found=()
[[ -e "$PROJECT_DIR/package.json" ]] && found+=("package.json")
[[ -d "$PROJECT_DIR/src" ]] && found+=("src/")
if (( ${#found[@]} > 0 )); then
  die "refusing to scaffold into '$PROJECT_DIR': found existing ${found[*]}"
fi

if [[ -z "$PKG_NAME" ]]; then
  PKG_NAME="$(kebab "$(basename "$PROJECT_DIR")")"
fi

printf '==> project: %s\n' "$PROJECT_DIR"
printf '==> package name: %s\n' "$PKG_NAME"
printf '==> port: %s\n' "$PORT"
printf '==> icons: %s\n' "$([[ $SKIP_ICONS -eq 1 ]] && echo skipped || echo itshover)"

CURRENT_STEP="2/9 create-next-app + copy template"
TMP_ROOT="$(mktemp -d)"
(
  cd "$TMP_ROOT"
  npx --yes create-next-app@latest app \
    --ts --tailwind --eslint --app --src-dir --import-alias "@/*" \
    --use-pnpm --turbopack --disable-git --yes < /dev/null
)

shopt -s nullglob
for item in "$TMP_ROOT"/app/* "$TMP_ROOT"/app/.[!.]* "$TMP_ROOT"/app/..?*; do
  base="$(basename "$item")"
  case "$base" in
    node_modules|.git) continue ;;
  esac
  cp -R "$item" "$PROJECT_DIR/"
done
shopt -u nullglob

[[ -f "$PROJECT_DIR/package.json" ]] || die "copy failed: $PROJECT_DIR/package.json is missing"
node -e '
const fs = require("fs");
const [, file, name] = process.argv;
const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
pkg.name = name;
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
' "$PROJECT_DIR/package.json" "$PKG_NAME"

rm -rf "$TMP_ROOT"
TMP_ROOT=""

CURRENT_STEP="3/9 pnpm install"
( cd "$PROJECT_DIR" && pnpm install )

CURRENT_STEP="4/9 shadcn init + add components"
( cd "$PROJECT_DIR" && pnpm dlx shadcn@latest init -d -b radix -y )
( cd "$PROJECT_DIR" && pnpm dlx shadcn@latest add \
  card input label textarea badge avatar table tabs dialog sheet dropdown-menu select \
  separator tooltip switch checkbox scroll-area progress sonner chart sidebar calendar \
  popover skeleton toggle-group -y )

CURRENT_STEP="5/9 add motion + lenis"
( cd "$PROJECT_DIR" && pnpm add motion lenis )

ICON_NAMES=(
  coffee heart star sparkles gear users shopping-cart home layout-dashboard map-pin
  clock send refresh user flame bookmark like
)
ICON_COUNT=0

if [[ $SKIP_ICONS -eq 0 ]]; then
  CURRENT_STEP="6/9 itshover animated icons"
  ICON_URLS=()
  for n in "${ICON_NAMES[@]}"; do
    ICON_URLS+=("https://www.itshover.com/r/${n}-icon.json")
  done
  if ( cd "$PROJECT_DIR" && pnpm dlx shadcn@latest add "${ICON_URLS[@]}" -y -o ); then
    if [[ -d "$PROJECT_DIR/src/components/ui" ]]; then
      ICON_COUNT=$(find "$PROJECT_DIR/src/components/ui" -maxdepth 1 -type f -name '*-icon.tsx' | wc -l | tr -d ' ')
    fi
  else
    printf '\nscaffold: WARNING - itshover icon install failed; continuing without icons.\n' >&2
    printf 'scaffold: retry later with the shadcn add command in the summary.\n\n' >&2
    ICON_COUNT=0
  fi
else
  CURRENT_STEP="6/9 itshover animated icons (skipped)"
fi

CURRENT_STEP="7/9 design + public folders"
mkdir -p "$PROJECT_DIR/design" "$PROJECT_DIR/public/images"
RECIPES="$HOME/.claude/skills/premium-motion/references/recipes.md"
BRIEF_TPL="$HOME/.claude/skills/ui-template-picker/assets/design-brief-template.md"
[[ -f "$RECIPES" ]] || die "missing motion recipes file: $RECIPES"
[[ -f "$BRIEF_TPL" ]] || die "missing design brief template: $BRIEF_TPL"
cp "$RECIPES" "$PROJECT_DIR/design/motion-recipes.md"
cp "$BRIEF_TPL" "$PROJECT_DIR/design/design-brief-template.md"

CURRENT_STEP="8/9 .claude/launch.json"
node - "$PROJECT_DIR/.claude/launch.json" "$PORT" <<'NODE'
const fs = require("fs");
const path = require("path");
const file = process.argv[2];
const portArg = process.argv[3];
const port = Number(portArg);
let data = { version: "0.0.1", configurations: [] };

if (fs.existsSync(file)) {
  const raw = fs.readFileSync(file, "utf8").trim();
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch (err) {
      console.error(`scaffold: ${file} is not valid JSON: ${err.message}`);
      process.exit(1);
    }
  }
}

if (!data || typeof data !== "object" || Array.isArray(data)) data = { configurations: [] };
if (!Array.isArray(data.configurations)) data.configurations = [];

const config = {
  name: "dev",
  runtimeExecutable: "pnpm",
  runtimeArgs: ["dev", "--port", String(port)],
  port,
};
const index = data.configurations.findIndex((c) => c && c.name === "dev");
if (index >= 0) data.configurations[index] = config;
else data.configurations.push(config);

fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
NODE

CURRENT_STEP="9/9 typecheck"
( cd "$PROJECT_DIR" && pnpm exec tsc --noEmit )

NEXT_VERSION="unknown"
if [[ -f "$PROJECT_DIR/node_modules/next/package.json" ]]; then
  NEXT_VERSION="$(node -p 'require(process.argv[1]).version' "$PROJECT_DIR/node_modules/next/package.json")"
fi

SHADCN_COUNT=0
if [[ -d "$PROJECT_DIR/src/components/ui" ]]; then
  SHADCN_COUNT=$(find "$PROJECT_DIR/src/components/ui" -maxdepth 1 -type f -name '*.tsx' ! -name '*-icon.tsx' | wc -l | tr -d ' ')
fi

CURRENT_STEP="done"
cat <<EOF

Scaffold complete.

  project:      $PROJECT_DIR
  package:      $PKG_NAME
  Next.js:      $NEXT_VERSION
  shadcn/ui:    $SHADCN_COUNT components
  icons:        $ICON_COUNT itshover icons
  motion:       motion + lenis
  design:       design/motion-recipes.md, design/design-brief-template.md

Next steps:
  cd "$PROJECT_DIR"
  pnpm dev --port $PORT
EOF

if [[ $SKIP_ICONS -eq 0 && $ICON_COUNT -eq 0 ]]; then
  printf '\nNote: no animated icons were installed.\n'
  printf 'Retry with:\n  pnpm dlx shadcn@latest add %s -y -o\n\n' \
    "https://www.itshover.com/r/coffee-icon.json"
fi
