#!/bin/sh
# Download the configured datasets on first start, then run the command.
set -e
triage pull
exec "$@"
