#!/usr/bin/env bash
# Dual-state forwarder to modular tests
exec "$(dirname "$0")/tests/test_mc_bot.sh" "$@"
