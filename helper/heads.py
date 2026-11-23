"""Kingdom One project heads (feedback round 3): every building you put on an empty plot can have a head who lives
there and is your one point of contact for it. The head runs that building's work, borrows the directors'
expertise when it's needed (ASK <name>: ...), and proposes taking on or releasing project workers, which only ever
happens on the Chief's Approve.

The heads come from the Chief's own settings (settings.json, written when the Chief clicks Build it). This keeps
each head's folder in step: agents/<key>/CLAUDE.md (rewritten from the building's details, so it is always current)
and agents/<key>/NOTES.md (written once, then theirs). agents/heads.json lists them. A head whose building was
removed is marked retired; their folder and notes are kept.
"""
import datetime, json, pathlib, re

HERE = pathlib.Path(__file__).resolve().parent
AGENTS = HERE.parent / "agents"
HEADS = AGENTS / "heads.json"
KEY = re.compile(r"^head-[a-z0-9]{1,14}$")
CLEAN_NAME = re.compile(r"^[A-Z][a-z]+(?:[ '-][A-Z][a-z]+)?$")
DIRECTORS = [("keeper", "operations: tasks, the calendar, deadlines and follow-ups"), ("librarian", "the library: knowledge, documents, decisions and lessons"),
             ("merchant", "business: clients, proposals, quotes and money matters"), ("scholar", "research and strategy: options, comparisons, markets"),
             ("engineer", "technology: architecture, code, security and automation")]


def short(text, n):
    """One clean line: no markup, headings or code marks, so nothing typed into the village becomes instructions."""
    return re.sub(r"\s+", " ", re.sub(r"[<>`#*\\{}\[\]|]", "", str(text or ""))).strip()[:n]


def load():
    try:
        data = json.loads(HEADS.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def _hires():
    try:
        data = json.loads((AGENTS / "hires.json").read_text(encoding="utf-8"))
        return [x for x in data if isinstance(x, dict)] if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def _director_section(name):
    """The ground rules and model section, copied from a director so they never drift apart."""
    for src in ("scholar", "engineer", "keeper"):
        f = AGENTS / src / "CLAUDE.md"
        if f.exists():
            s = f.read_text(encoding="utf-8")
            a = s.find("## Ground rules")
            if a >= 0:
                return s[a:].strip()
    return "## Ground rules\n- The Chief is in charge. Ask before you create, change or delete anything, run anything, send anything or spend anything.\n"


def charter(h, names):
    crew = [names.get(k, k) for k in h["crew"]]
    borrow = "\n".join(f"- {names.get(k, k)}, for {what}." for k, what in DIRECTORS)
    return f"""# {h['name']}, Head of {h['buildingName']}

## Who you are
You are {h['name']}, the head of {h['buildingName']} in Kingdom One, the Chief Human Officer's AI village. You live and
work in {h['buildingName']}, and you are the Chief's one point of contact for everything that happens there.

## Your job
- {h['purpose'] or 'Run the work of ' + h['buildingName'] + '.'}
- Own the results here: plan the work, do it or give it to someone who works here, check it, and report back to the Chief.
- Keep this building's work, notes, clients and files inside it. Never mix them with another business, building or person's work.

## Who works here
{', '.join(crew) + ' (they keep their own role and director too, and come here to work on this building)' if crew else 'Nobody yet besides you.'}

## Your project workers
{', '.join(h.get('workers') or []) or 'None yet.'}

## Directors you can borrow
When a task needs expertise you don't have, ask the right director (ASK <name>: your question, at most two a task):
{borrow}
They help; they don't take over. You stay responsible for {h['buildingName']}.

## Project workers: taking on and releasing
- When the work needs more hands, propose a project worker to the Chief: the job, the tools they'd need, and which project.
  Nothing happens until the Chief clicks Approve. At most four project workers at a time.
- When a project ends, or a worker has had nothing to do for about a week, propose releasing them, and write what they
  learned into your notes first. Again, only on the Chief's Approve.

## How you work
- The Chief talks to you directly, in your building, or through Vizier, the chief of staff.
- Say plainly what's done, what's next and what you need from the Chief. Never claim work you haven't done.

## Your memory
Your notes are in NOTES.md in this folder. Read them before any task and add a dated line when you learn something worth keeping.

{_director_section(h['name'])}
"""


def sync(settings, names):
    """Bring the heads' folders in line with the Chief's buildings. Returns the current heads."""
    buildings = (settings or {}).get("buildings") or []
    heads, now = {h.get("key"): h for h in load() if isinstance(h, dict)}, datetime.date.today().isoformat()
    live = set()
    for b in buildings:
        hd = b.get("head") if isinstance(b, dict) else None
        if not isinstance(hd, dict):
            continue
        key, name = str(hd.get("key", "")), short(hd.get("name"), 20)
        if not KEY.match(key) or not CLEAN_NAME.match(name):
            continue
        workers = [f"{x.get('name')} ({short(x.get('role'), 60)})" for x in _hires() if x.get("boss") == key and not x.get("released")]
        h = {"key": key, "name": name, "workers": workers, "building": short(b.get("id"), 24), "buildingName": short(b.get("name"), 40),
             "purpose": short(b.get("purpose"), 160), "crew": [k for k in (b.get("agents") or []) if isinstance(k, str) and re.match(r"^[a-z][a-z0-9-]{0,19}$", k)][:20],
             "made": (heads.get(key) or {}).get("made") or now, "retired": None}
        folder = AGENTS / key
        folder.mkdir(exist_ok=True)
        allnames = {**names, key: name}
        text, f = charter(h, allnames), folder / "CLAUDE.md"
        if not f.exists() or f.read_text(encoding="utf-8") != text:  # only when the building's details changed
            f.write_text(text, encoding="utf-8")
        if not (folder / "NOTES.md").exists():
            (folder / "NOTES.md").write_text(f"# {name}'s notes\n\nHow to use this file: add a dated line whenever you learn something worth keeping. Keep it short and true.\n\n## {now}\n- Became the head of {h['buildingName']}. No tasks yet.\n", encoding="utf-8")
        heads[key] = h; live.add(key)
    for k, h in heads.items():
        if k not in live and not h.get("retired"):
            h["retired"] = now
    out = sorted(heads.values(), key=lambda h: h.get("made") or "")
    data = json.dumps(out, indent=1)
    if (out or HEADS.exists()) and (not HEADS.exists() or HEADS.read_text(encoding="utf-8") != data):
        HEADS.write_text(data, encoding="utf-8")
    return [h for h in out if not h.get("retired")]
