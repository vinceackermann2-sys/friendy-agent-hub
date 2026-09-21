FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates coreutils python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# The VM starts this image with an explicit numeric user, a read-only root,
# no capabilities, no network, and only the task workspace mounted writable.
