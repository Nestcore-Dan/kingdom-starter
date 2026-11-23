# Kingdom One

A walkable Moroccan oasis village where your own AI agents live and work: a chief of staff in the town hall, six
directors in their houses and their workers in the workshops. You give orders, they plan and write, and nothing is
sent, spent, published or run without your click.

Everything starts neutral: no names, data, accounts or tools of anyone else's. On first launch a short setup lets you
name your world and your agents, or keep the defaults.

## What you need
- Python 3.11 or newer (only the standard library).
- A modern browser (Edge, Chrome or Firefox).
- Optional, for agents that really answer: Claude Code signed in with your own Claude subscription (Pro or Max), at
  `%USERPROFILE%\.local\bin\claude.exe` on Windows. No API key is used or needed. Without it, agents reply from a script
  and nothing is ever done for real.

## Run it
```
python helper/serve.py          # the village, at http://127.0.0.1:8765/
python helper/brain.py          # optional: the AI helper, on the next port up (8766)
```
Open http://127.0.0.1:8765/ and follow the setup. To run a second copy alongside, set `KINGDOM_ONE_PORT` (for example
`8775`) for both commands: each copy keeps its own settings and its own browser data.

## Your data
- Your settings (world name, agent names) are saved by `serve.py` in `data/settings.json`. `data/` is never committed.
- Your to-do list, chats and the villager log are kept in this browser, for this address.
- Agents keep what they learn in `agents/<id>/NOTES.md`.

## Change it later
- **Settings → Personalisation** (top menu): the world's name, your name and the agents' names. **Restore display
  defaults** resets those names only. Renaming never changes an agent's ID, role, instructions, permissions or tasks.
- **Settings → Connections:** list the tools, projects and accounts your agents could work with: tools on this
  computer (including ones your agents build), online repositories (GitHub, GitLab, Codeberg), accounts such as Gmail
  through your own Claude connectors, social media (drafts only) and custom APIs. Adding one only records it. Kingdom
  never stores a password, key or token: an API key stays in an environment variable you name.
- **Run setup again:** stop `serve.py`, delete `data/settings.json`, start it again and open a fresh browser profile
  (or clear this site's data). Your agents' notes are kept.

## Optional connections, all off by default
- **Your own tools:** list local tools in `helper/tools.json`. Agents can read them; any action waits for your Approve.
- **A knowledge base:** set `KINGDOM_ONE_LIBRARY` to the Docker container of a kb service to give agents read-only access.
- **Mail and calendar (read only):** set `ACCESS` in `helper/brain.py` for one agent and connect the claude.ai
  connectors in Claude Code.

## Updating
Get the new version (pull, or unpack a new release over this folder) and keep `data/` and `agents/*/NOTES.md`. Your
settings are loaded with defaults for anything new.

## Safety
Agents can only think, plan, write and answer. Sending, spending, publishing and posting are blocked in code; email is
always a draft; every finished task and every tool action waits for your own click. See the comments in
`helper/brain.py`.

## Make it your own
Fork this repository (or download it), then run it as above: the first launch walks you through naming your world and
your agents and connecting your tools. Your settings and reports stay on your computer (`data/` and `reports/` are
never committed). The agents' notes (`agents/*/NOTES.md`) start empty and fill up as they learn about your work: keep
your fork private once they do, or if you add anything personal to the agents' instructions.

## Licence
MIT: see `LICENSE`. It includes three.js (MIT, `vendor/three.LICENSE`).
