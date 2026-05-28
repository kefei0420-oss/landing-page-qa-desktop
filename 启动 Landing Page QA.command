#!/bin/zsh
cd "$(dirname "$0")"
PORT="${PORT:-3002}"
open "http://localhost:${PORT}"
node server.js
