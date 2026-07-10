# CLI Hub Local Bridge

Companion extension for [CLI Hub](https://marketplace.visualstudio.com/items?itemName=MasonHuang.cli-hub) when working over Remote SSH with a local iTerm2 window.

## When You Need It

Install Local Bridge on your local machine when all of the following apply:

- VS Code or Cursor is connected to a remote workspace through Remote SSH.
- CLI Hub is configured with `clihub.pathSendTarget` set to `iterm2`.
- Path context should be sent to the current session of iTerm2 running on your Mac.

## Setup

1. Install CLI Hub in the remote extension host.
2. Install CLI Hub Local Bridge locally.
3. Set `clihub.pathSendTarget` to `iterm2` in CLI Hub settings.
4. Allow macOS Automation access when prompted.

Local Bridge works automatically after installation. It has no commands or settings of its own.
