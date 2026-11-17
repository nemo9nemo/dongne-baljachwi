#!/bin/sh
set -eu
# 새 영구 볼륨은 root 소유로 마운트되므로 시작 때 경로 소유권만 맞추고 권한을 낮춘다.
chown node:node /data
exec su-exec node:node "$@"
