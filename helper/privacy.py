"""Privacy scopes (Kingdom 2.0, step 1): one policy, enforced in the helper before any model sees a word.

Every piece of text an agent is about to receive (chat history, the village's hint, a task, its context, a colleague's
question, notes, lessons) is classified into scopes, and anything the recipient isn't cleared for is replaced with a short
"kept private" marker before the prompt is built. This doesn't rely on the browser leaving things out: the browser can
still be wrong, and the helper still refuses to pass it on.

Scopes
  kingdom             general work: everyone may see it
  personal            the Chief's private life: only agents whose home scope is personal (Steward) may see it
  business:<id>       one business; never mixed into work for a different business
  venture:<id>        one venture (a separate business, such as a studio); never mixed into work for a different business or venture

The personal markers are general and live here. The names of this Kingdom's own businesses and ventures live in
helper/privacy_private.json, which the public starter doesn't copy.
"""
import json, pathlib, re

HERE = pathlib.Path(__file__).resolve().parent

# Each agent's home scope. Agents not listed live in "kingdom". A home scope of "personal" means the agent may receive
# personal material, and that what it holds is personal: its notes stay out of rooms shared with others.
HOME = {"steward": "personal"}
SHARED_ROOMS = {"everyone", "consult", "minutes"}  # rooms whose words reach other agents

PERSONAL = [
    r"\bmy (wife|husband|partner'?s? (birthday|health)|girlfriend|boyfriend|fianc[eé]e?|kids?|children|son|daughter|baby|mum|mom|dad|mother|father|parents|brother|sister|family|grandma|grandpa|nan)\b",
    r"\b(birthday|anniversary|wedding|honeymoon|funeral|pregnan\w*|divorce)\b",
    r"\b(doctor|dentist|gp appointment|hospital|surgery|medical|medication|prescription|diagnos\w*|therap(y|ist)|psycholog\w*|counsell?ing|illness|sick|injur\w*|tooth|toothache|blood test|physio for me)\b",
    r"\b(my|our) (home|house|flat|apartment|rent|mortgage|bank account|salary|savings|tax return|super(annuation)?|health|weight|diet|mental health|relationship|dating)\b",
    r"\b(personal|private) (matter|life|errand|appointment|finances?)\b",
]
PERSONAL_RE = re.compile("|".join(PERSONAL), re.I)


def _private_names():
    try:
        d = json.loads((HERE / "privacy_private.json").read_text(encoding="utf-8"))
        return {str(k): [str(x) for x in v] for k, v in (d.get("scopes") or {}).items() if isinstance(v, list)}
    except (OSError, ValueError):
        return {}


def _buildings():
    try:
        d = json.loads((HERE / "privacy_private.json").read_text(encoding="utf-8"))
        return {str(k).lower(): str(v) for k, v in (d.get("buildings") or {}).items()}
    except (OSError, ValueError):
        return {}


BUILDINGS = _buildings()  # building name -> venture scope


def venture_of_building(name):
    return BUILDINGS.get(str(name or "").lower())


ORG = _private_names()  # {"business:<id>": ["<name>", ...], ...}
ORG_RE = {k: re.compile(r"\b(" + "|".join(re.escape(w) for w in v) + r")\b", re.I) for k, v in ORG.items() if v}


def home(agent):
    return HOME.get(agent, "kingdom")


def classify(text):
    """The scopes a piece of text belongs to (empty means plain kingdom work)."""
    t = str(text or "")
    out = {k for k, rx in ORG_RE.items() if rx.search(t)}
    if PERSONAL_RE.search(t):
        out.add("personal")
    return out


def org_of(scopes):
    return {s for s in scopes if s.startswith(("business:", "venture:"))}


def may_see(agent, scopes, task_scopes=frozenset()):
    """Can this agent receive text with these scopes, while working on something with task_scopes?"""
    if "personal" in scopes and home(agent) != "personal":
        return False
    item, task = org_of(scopes), org_of(task_scopes)
    if item and task and not (item & task):  # material from one business never goes into another's work
        return False
    return True


def marker(scopes):
    return "[personal: kept private]" if "personal" in scopes else "[another business's details: kept apart]"


def filter_lines(agent, text, task_scopes=frozenset()):
    """Line by line: keep what the agent may see, mark the rest."""
    out = []
    for line in str(text or "").split("\n"):
        sc = classify(line)
        out.append(line if may_see(agent, sc, task_scopes) else _keep_speaker(line, marker(sc)))
    return "\n".join(out)


def _keep_speaker(line, mark):
    m = re.match(r"^(\s*[-•]?\s*[A-Z][\w' .-]{0,30}:\s)", line)  # "Chief: ..." or "  Librarian: ..." keeps who spoke
    return (m.group(1) if m else "") + mark


def filter_history(agent, history, task_scopes=frozenset()):
    out = []
    for m in history or []:
        if not isinstance(m, dict):
            continue
        sc = classify(m.get("text", "")) | ({"personal"} if m.get("scope") == "personal" else set())
        out.append(m if may_see(agent, sc, task_scopes) else {**m, "text": marker(sc)})
    return out


def gate(agent, room, job, history, hint):
    """Clean everything the browser sent before it reaches the agent. Returns (job, history, hint, refusal):
    refusal is a ready reply when the job itself is something this agent may not see."""
    job = dict(job or {})
    task_scopes = frozenset(classify(job.get("text", "")) | classify(job.get("task", "")))
    if room in ("task", "review") and not may_see(agent, task_scopes):
        return job, [], "", ("NEEDS THE CHIEF\nISSUE: This task has personal details, so it can only be done in the private garden."
                             "\nNEEDED FROM THE CHIEF:\n- Give it to your personal assistant, or say it again without the personal details")
    if room == "consult" and not may_see(agent, classify(job.get("question", "")) | task_scopes):
        return job, [], "", "I can't help with that one: it has personal details, and those stay in the private garden."
    for f in ("context", "note", "instructions", "report", "feedback"):
        if job.get(f):
            job[f] = filter_lines(agent, job[f], task_scopes)
    if isinstance(job.get("consults"), list):
        job["consults"] = [{**c, "q": filter_lines(agent, c.get("q", ""), task_scopes), "a": filter_lines(agent, c.get("a", ""), task_scopes)}
                           for c in job["consults"] if isinstance(c, dict)]
    return job, filter_history(agent, history, task_scopes), filter_lines(agent, hint, task_scopes), None


def notes_for(agent, room, notes, task_scopes=frozenset()):
    """An agent's own notes: a personal agent's notes stay out of shared rooms; other notes keep only lines the
    current work may see (so one business's notes don't flow into another's task)."""
    if home(agent) == "personal" and room in SHARED_ROOMS:
        return "(Your private notes aren't loaded here: this conversation is shared with others. Say nothing personal.)"
    return filter_lines(agent, notes, task_scopes)


def lesson_ok(text):
    """A lesson goes on the board everyone reads only if it's general: nothing personal, no business or client names."""
    return not classify(text)


def policy():
    """What the browser needs to know (no keyword lists): each agent's home scope."""
    return {"home": HOME, "shared": sorted(SHARED_ROOMS)}
