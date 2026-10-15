# Sourced by the candidate scripts from the repository root, after they
# set CONDUCTOR_RUN. Sets SIGIL to the compiler they run: $SIGIL if set,
# else `sigil` from PATH. Its version must be the one package.sgl pins
# (`sigil:`), so a candidate never builds or tests with another compiler;
# otherwise RESULT is SETUP-FAILED and the script exits 2.
sigil_pin="$(sed -n 's/^ *sigil: "\([^"]*\)".*/\1/p' package.sgl)"
sigil_want="${SIGIL:-sigil}"
SIGIL="$(command -v "$sigil_want")" || SIGIL=""
sigil_have=""
if [ -n "$SIGIL" ]; then
  sigil_have="$("$SIGIL" --version 2>/dev/null | grep -o '[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*' | head -n 1)"
fi
if [ -z "$sigil_pin" ] || [ "$sigil_have" != "$sigil_pin" ]; then
  printf 'RESULT: SETUP-FAILED (sigil %s at %s; package.sgl pins %s; set SIGIL to that compiler)\n' \
    "${sigil_have:-not found}" "${SIGIL:-$sigil_want}" "${sigil_pin:-none}" > "$CONDUCTOR_RUN/RESULT.tmp"
  mv "$CONDUCTOR_RUN/RESULT.tmp" "$CONDUCTOR_RUN/RESULT"
  cat "$CONDUCTOR_RUN/RESULT"
  exit 2
fi
