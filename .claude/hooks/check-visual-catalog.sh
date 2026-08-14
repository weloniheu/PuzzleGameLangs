#!/usr/bin/env bash
# Stop hook: reminds/blocks when a change touches a player-facing visual/behavioral
# surface (new keybinding, new classList.add/toggle, new setTimeout duration, new CSS
# class/@keyframes) but VISUAL_CATALOG.md was not updated in the same working-tree diff.
#
# Loop guard: hashes the relevant diff text and remembers the last hash it blocked on
# (.claude/.visual-catalog-hook-state, gitignored). It only blocks again once that diff
# actually changes — so declining to update the catalog does not trap Claude in a loop,
# but any NEW relevant change re-surfaces the reminder.
set -euo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" || exit 0
command -v git >/dev/null 2>&1 || exit 0

STATE_FILE=".claude/.visual-catalog-hook-state"

# Every file that differs from HEAD (tracked, modified or staged) plus untracked new files.
CHANGED=$( { git diff --name-only HEAD -- . 2>/dev/null; git ls-files --others --exclude-standard; } | sort -u)
[ -z "$CHANGED" ] && exit 0

# VISUAL_CATALOG.md already part of this change → nothing to remind about.
echo "$CHANGED" | grep -qx "VISUAL_CATALOG.md" && exit 0

# Candidate surface files: the keybindings map, the stylesheet, or any engine/puzzle .ts.
CANDIDATES=$(echo "$CHANGED" | grep -E \
  '^src/engine/core/keybindings\.ts$|^src/style\.css$|^src/(engine|puzzles)/.*\.ts$' || true)
[ -z "$CANDIDATES" ] && exit 0

DIFF_TEXT=""
HIT=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    CONTENT=$(git diff HEAD -- "$f" 2>/dev/null || true)
  else
    # Untracked new file: every line is effectively "added".
    CONTENT=$(sed 's/^/+/' "$f" 2>/dev/null || true)
  fi
  [ -z "$CONTENT" ] && continue

  case "$f" in
    src/engine/core/keybindings.ts)
      # Any change here is a control-surface change by definition.
      HIT=1
      ;;
    src/style.css)
      if echo "$CONTENT" | grep -qE '^\+\s*(\.[a-zA-Z][a-zA-Z0-9_-]*|\@keyframes\s)'; then
        HIT=1
      fi
      ;;
    *)
      if echo "$CONTENT" | grep -qE '^\+.*(classList\.(add|toggle)\(|setTimeout\([^,]+,\s*[0-9]+\s*\))'; then
        HIT=1
      fi
      ;;
  esac
  DIFF_TEXT="$DIFF_TEXT
### $f
$CONTENT"
done <<< "$CANDIDATES"

[ "$HIT" -eq 0 ] && exit 0

HASH=$(printf '%s' "$DIFF_TEXT" | shasum -a 256 2>/dev/null | cut -d' ' -f1)
[ -z "$HASH" ] && HASH=$(printf '%s' "$DIFF_TEXT" | cksum | cut -d' ' -f1)

mkdir -p .claude
PREV=""
[ -f "$STATE_FILE" ] && PREV=$(cat "$STATE_FILE")

if [ "$HASH" = "$PREV" ]; then
  exit 0 # already reminded about exactly this diff; don't loop forever
fi
echo "$HASH" > "$STATE_FILE"

FILES_LIST=$(echo "$CANDIDATES" | tr '\n' ' ')
REASON="VISUAL_CATALOG.md tracks every player-facing visual/behavioral surface (see the file's own header). The current diff touches: $FILES_LIST — and looks like it added a keybinding, a CSS class/@keyframes, or a new classList/setTimeout call, but VISUAL_CATALOG.md was not updated in the same diff. Check whether the new surface belongs in the action table, the drop/overlay tables, the transient-effects list, or the timing-constants table, and update it (or note explicitly why it doesn't apply) before finishing."

printf '{"decision":"block","reason":%s,"systemMessage":"Reminder: check VISUAL_CATALOG.md against this diff."}\n' \
  "$(printf '%s' "$REASON" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '%s' "\"$REASON\"")"
