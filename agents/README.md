# The agents of Kingdom One

Every agent in the village has a folder here (guide steps 27 and 28):

- `CLAUDE.md` holds their instructions: who they are, their job, who they report to, who reports to them, and the ground rules. Claude Code reads this file automatically when it is started inside the folder.
- `NOTES.md` is their memory. They read it before every task and add a dated line when they learn something worth keeping.

## Vizier and the directors (10 director spots, 6 taken)

| Folder | Agent | Role | Reports to | Reports to them |
|---|---|---|---|---|
| `vizier/` | Vizier | Chief of Staff, the town hall | the Chief Human Officer | the six directors |
| `keeper/` | Keeper | Operations Manager | Vizier | Inbox |
| `librarian/` | Librarian | Knowledge & Learning Manager | Vizier | Projectionist, Media sorter |
| `merchant/` | Merchant | Business Manager | Vizier | Money |
| `scholar/` | Scholar | Research & Strategy Analyst | Vizier | Hub scout |
| `engineer/` | Engineer | Technology Lead | Vizier | Studio |
| `steward/` | Steward | Personal Assistant (private) | Vizier | Garden helper |

## Workers (wear the saffron bedaia, run on Sonnet 5.5, no tasks yet)

| Folder | Worker | Works in | Director |
|---|---|---|---|
| `youtube/` | Projectionist | Projectionist, the video shop (the media centre) | Librarian |
| `media/` | Media sorter | the Media sorter's darkroom | Librarian |
| `scout/` | Hub scout | the Hub scout's lookout | Scholar |
| `money/` | Money | the Money counting house | Merchant |
| `studio/` | Studio | the Studio workshop | Engineer |
| `inbox/` | Inbox | the Inbox post house | Keeper |
| `garden/` | Garden helper | the potting shed in the private garden | Steward |

Anyone added once the ten director spots are full is a worker.

**Access to your accounts:** none. You can give one agent read-only access to your mail and calendar later (see the main README).

**The chain of command and the library:** each agent's responsibilities, priorities, rules, skills and library shelves are in `CHARTER.md` (written by `helper/charter.py`). Everyone except the Garden helper can read the Kingdom Library (read only) and keeps what they learn in their `NOTES.md`.

Nothing here runs on its own. An agent is switched on only when the Chief Human Officer says so, and only on a subscription: no API keys and no pay-per-use services. Notes files must never hold tokens, passwords or `.env` values.
