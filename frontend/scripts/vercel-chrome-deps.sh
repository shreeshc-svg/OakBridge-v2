#!/usr/bin/env bash
#
# Install the shared libraries Chrome needs, on Vercel's build image.
#
# WHY THIS EXISTS
#
# `puppeteer browsers install chrome` downloads a Chrome binary but not its
# system dependencies. Vercel's build container (Amazon Linux 2023) is minimal
# and ships almost none of them, so the download succeeds and the launch dies:
#
#   .../chrome-linux64/chrome: error while loading shared libraries:
#   libnss3.so: cannot open shared object file: No such file or directory
#
# libnss3 is the first missing library alphabetically, not the only one — fixing
# it alone just moves the error to the next one. The list below is Chrome's full
# headless runtime set on AL2023.
#
# WHY IT DOES NOT `set -e` ON THE INSTALL
#
# If dnf is unavailable or refuses, we let the build continue to the launch and
# fail THERE, with Chrome's own error naming the exact missing library. That is
# a far more useful message than "dnf exited 1", and it keeps this script from
# becoming the thing that breaks a build for an unrelated reason.
#
# IF THIS APPROACH FAILS
#
# The fallback is @sparticuz/chromium — a Chromium built for Lambda with its
# libraries bundled, used via puppeteer-core with an explicit executablePath.
# It needs no system packages at all. It is a bigger change (new dependency,
# code change in prerender.js, an older pinned Chromium), which is why it is
# the fallback and not the first attempt.

set -u

echo "--- Installing Chrome runtime libraries ---"

PKGS="
nss
nspr
atk
at-spi2-atk
at-spi2-core
cups-libs
libdrm
libX11
libXcomposite
libXdamage
libXext
libXfixes
libXrandr
libxcb
libxkbcommon
mesa-libgbm
pango
alsa-lib
"

if command -v dnf >/dev/null 2>&1; then
    dnf install -y --setopt=install_weak_deps=False --quiet $PKGS 2>&1 | tail -5 \
        || echo "dnf install reported a problem — continuing; Chrome will name what is missing."
elif command -v yum >/dev/null 2>&1; then
    yum install -y --quiet $PKGS 2>&1 | tail -5 \
        || echo "yum install reported a problem — continuing."
elif command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq && apt-get install -y -qq libnss3 libnspr4 libatk1.0-0 \
        libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
        libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libasound2 2>&1 | tail -5 \
        || echo "apt-get install reported a problem — continuing."
else
    echo "No package manager found — skipping. If Chrome fails to launch, see the note above about @sparticuz/chromium."
fi

echo "--- Chrome runtime libraries step complete ---"
