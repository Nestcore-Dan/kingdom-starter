"""Kingdom One hiring (guide step 46): Vizier finds a candidate, you interview them in the town hall, and only on
your yes does this write their agent folder (CLAUDE.md and NOTES.md), add them to their director's instructions
and to agents/hires.json, which the village reads when it loads. Nothing here runs unless you click Hire.
"""
import datetime, json, pathlib, re

HERE = pathlib.Path(__file__).resolve().parent
AGENTS = HERE.parent / "agents"
HIRES = AGENTS / "hires.json"
DIRECTORS = {"keeper": "Keeper", "librarian": "Librarian", "merchant": "Merchant", "scholar": "Scholar", "engineer": "Engineer", "steward": "Steward"}
CLEAN_NAME = re.compile(r"^[A-Z][a-z]+(?:[ '-][A-Z][a-z]+)?$")
KEY = re.compile(r"^[a-z][a-z0-9-]{1,19}$")
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
LOOK_WORDS = re.compile(r"^[a-z]{1,12}$")


def active_heads():
    """The heads of the Chief's buildings (helper/heads.py), who can take on project workers too."""
    try:
        data = json.loads((AGENTS / "heads.json").read_text(encoding="utf-8"))
        return {h["key"]: h for h in data if isinstance(h, dict) and h.get("key") and not h.get("retired")}
    except (OSError, ValueError):
        return {}


MAX_PROJECT_WORKERS = 4  # per head, to spare the Chief's subscription


def load_hires():
    try:
        data = json.loads(HIRES.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def short(text, n):
    """One clean line: no markup, headings or code marks (guide step 49), so an agent's words can't become page code
    or new instructions in a hire's CLAUDE.md."""
    return re.sub(r"\s+", " ", re.sub(r"[<>`#*\\{}\[\]|]", "", str(text or ""))).strip()[:n]


def check(c, names_taken):
    """The candidate as the village sent it, checked field by field. Raises ValueError if anything is off."""
    name, key, boss = str(c.get("name", "")), str(c.get("key", "")), str(c.get("boss", ""))
    if not CLEAN_NAME.match(name) or len(name) > 20:
        raise ValueError("the name isn't one clean name")
    if not KEY.match(key) or (AGENTS / key).exists():
        raise ValueError("that agent folder already exists")
    if name.lower() in names_taken:
        raise ValueError("someone in the village already has that name")
    heads = active_heads()
    if boss not in DIRECTORS and boss not in heads:
        raise ValueError("unknown director")
    if boss in heads and sum(1 for x in load_hires() if x.get("boss") == boss and not x.get("released")) >= MAX_PROJECT_WORKERS:
        raise ValueError(f"{heads[boss]['name']} already has {MAX_PROJECT_WORKERS} project workers: let one go first")
    look = {}
    for k, v in (c.get("look") or {}).items():
        if k in ("skin", "hairColor", "beardColor", "headColor", "color", "brows") and HEX.match(str(v)):
            look[k] = str(v)
        elif k in ("hair", "beard", "head", "kit") and LOOK_WORDS.match(str(v)):
            look[k] = str(v)
        elif k in ("glasses", "smile") and isinstance(v, bool):
            look[k] = v
    return {"key": key, "name": name, "boss": boss, "role": short(c.get("role"), 80), "job": short(c.get("job"), 300),
            "personality": short(c.get("personality"), 160), "quirk": short(c.get("quirk"), 160), "look": look,
            "hired": datetime.date.today().isoformat()}


def release(key):
    """Let a project worker go (feedback round 3), only when the Chief clicks to. Their folder and notes are kept, with a
    dated line saying so; they leave the village and their head's list."""
    hires = load_hires()
    h = next((x for x in hires if x.get("key") == key and not x.get("released")), None)
    if not h or h.get("boss") not in active_heads():
        raise ValueError("only a building head's project workers can be let go here")
    today = datetime.date.today().isoformat()
    h["released"] = today
    notes = AGENTS / key / "NOTES.md"
    if notes.exists():
        notes.write_text(notes.read_text(encoding="utf-8").rstrip("\n") + f"\n- {today}: Let go when the project was done, on the Chief's Approve. Folder and notes kept.\n", encoding="utf-8")
    HIRES.write_text(json.dumps(hires, indent=1), encoding="utf-8")
    return h


def ground_rules():
    """The same ground rules every worker has, copied from an existing worker so they never drift apart."""
    for src in ("media", "scout", "money"):
        f = AGENTS / src / "CLAUDE.md"
        if f.exists():
            s = f.read_text(encoding="utf-8")
            a = s.find("## How you work")
            if a >= 0:
                return s[a:].strip()
    raise ValueError("couldn't find a worker's instructions to copy the ground rules from")


def hire(c, names_taken):
    h = check(c, names_taken)
    head = active_heads().get(h["boss"])
    boss = head["name"] if head else DIRECTORS[h["boss"]]
    where = f"in {head['buildingName']}, for {head['name']}, its head" if head else f"at {boss}'s house"
    folder = AGENTS / h["key"]
    folder.mkdir()
    (folder / "CLAUDE.md").write_text(f"""# {h['name']}, {h['role']}

You are {h['name']}, a worker in Kingdom One, the Chief Human Officer's AI village. You were hired at the town hall on {h['hired']}, after an interview with the Chief Human Officer (guide step 46). You work {where}, and you wear the saffron bedaia, the vest every worker wears.{" You're a project worker: taken on for this building's projects, and let go when they're done (only on the Chief's Approve)." if head else ""}

## Who you are
- {h['personality'] or 'New, keen and careful.'}
- {h['quirk'] or 'Still learning where everything is.'}

## Your job
{h['job']}

## Who you report to
{boss}, your director (folder `../{h['boss']}/`). Every task comes from them, and they check every piece of your work before it counts as complete.

## Who reports to you
Nobody. Workers don't manage anyone.

{ground_rules()}
""", encoding="utf-8")
    (folder / "NOTES.md").write_text(f"# {h['name']}'s notes\n\nWhat I've learned, newest last. Read before every task.\n\n"
                                     f"- {h['hired']}: Hired at the town hall after the Chief's interview. Work for {boss}, {where}. No tasks yet.\n",
                                     encoding="utf-8")
    if head:  # a head's instructions are rebuilt from the buildings (helper/heads.py), and list their project workers there
        HIRES.write_text(json.dumps(load_hires() + [h], indent=1), encoding="utf-8")
        return h
    # the director's instructions list their new worker
    d = AGENTS / h["boss"] / "CLAUDE.md"
    s = d.read_text(encoding="utf-8")
    line = (f"- {h['name']}, works at your house (hired {h['hired']}): {h['job']} Sonnet 5.5, wears the saffron vest, folder `../{h['key']}/`. "
            "Gets tasks from you through the to-do list (guide step 42): hand them clear, self-contained work and check it before it counts.\n")
    head = s.find("## Who reports to you")
    if head >= 0:
        nxt = s.find("\n## ", head + 5)
        nxt = len(s) if nxt < 0 else nxt + 1
        s = s[:nxt].rstrip("\n") + "\n" + line + "\n" + s[nxt:]
    else:
        s = s.rstrip("\n") + "\n\n## Who reports to you: your workers\n" + line
    d.write_text(s, encoding="utf-8")
    hires = load_hires() + [h]
    HIRES.write_text(json.dumps(hires, indent=1), encoding="utf-8")
    return h


SCOUT_RULES = """## Finding a candidate (guide step 46)
You're always looking for ways to make the team better. The Chief has asked you to find a candidate to help one of the directors.
Propose exactly one new worker: a new AI agent who would run on Sonnet 5.5 on the Chief's subscription and, like every agent here,
can only think, plan, write and answer (no files, no running anything, no sending, no spending). Pick the director who most needs
help from the request and the team list, and a job that is clear, self-contained and doesn't overlap an existing worker.
Reply in exactly this form, nothing before or after, plain text:
FOR: <the director's name>
NAME: <one first name only, a single word, nothing else>
ROLE: <three to six words>
JOB: <one sentence>
PERSONALITY: <one short sentence>
QUIRK: <one short sentence>
PITCH: <two sentences the candidate would say to introduce themselves in the interview>
"""


def candidate_prompt(c):
    boss = DIRECTORS.get(str(c.get("boss", "")), "a director")
    return f"""You are {short(c.get('name'), 20)}, a candidate for a job in Kingdom One, the Chief Human Officer's AI village. Vizier, the
chief of staff, found you and brought you to the town hall. The Chief Human Officer is interviewing you now.

- The job: {short(c.get('role'), 80)}, working for {boss}. {short(c.get('job'), 300)}
- Who you are: {short(c.get('personality'), 160)} {short(c.get('quirk'), 160)}
- What you'd be: a new AI agent on Sonnet 5.5, on the Chief's Claude subscription. Like every agent here you can only think,
  plan, write and answer: no files, no running anything, no sending or spending. Your director would give you every task and check it.
- You are not hired. Only the Chief decides. Don't claim past jobs, clients or experience you don't have, and don't pressure the Chief.
- Reply in character, in your own voice: one to three short sentences, plain words, no lists or headings.
"""
