"""Kingdom Core, phase 1: the persistent store (Kingdom 2.0).

One SQLite file (data/kingdom.db, WAL) is the source of truth for organisations, who belongs to them, conversations and
messages, tasks, model runs and their usage, operational controls, the audit log, lessons (with provenance) and the
deliverable registry. The village keeps its look; its chats, to-dos and other state are written through to here and read
back from here.

Organisation isolation is a property of the records, not of keywords: every conversation, message and task belongs to
an organisation, and an agent may read a record only if it is a member of that organisation or is assigned the task the
record belongs to. Keyword classification (privacy.py) stays as a second, supplementary check.
"""
import datetime, hashlib, json, pathlib, sqlite3, threading, time

import privacy

HERE = pathlib.Path(__file__).resolve().parent
AGENTS = HERE.parent / "agents"
LOCK = threading.RLock()
_DB = None
DB_PATH = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS orgs(id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, parent TEXT, head TEXT);
CREATE TABLE IF NOT EXISTS members(org TEXT NOT NULL, agent TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', PRIMARY KEY(org, agent));
CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY, agent TEXT, room TEXT NOT NULL, org TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, conv TEXT NOT NULL, sender TEXT NOT NULL, text TEXT NOT NULL,
  org TEXT NOT NULL, scope TEXT, at TEXT NOT NULL, digest TEXT NOT NULL, UNIQUE(conv, at, sender, digest));
CREATE INDEX IF NOT EXISTS messages_conv ON messages(conv, at);
CREATE INDEX IF NOT EXISTS messages_digest ON messages(digest);
CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, org TEXT NOT NULL, owner TEXT, status TEXT, priority INTEGER NOT NULL DEFAULT 2,
  parent TEXT, depth INTEGER NOT NULL DEFAULT 0, runs INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS docs(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runs(id INTEGER PRIMARY KEY, at TEXT NOT NULL, agent TEXT, room TEXT, task_id TEXT, org TEXT, provider TEXT, model TEXT,
  kind TEXT, input INTEGER, cache_read INTEGER, cache_write INTEGER, output INTEGER, ms INTEGER, turns INTEGER, instr TEXT, outcome TEXT);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT, org TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS controls(key TEXT PRIMARY KEY, value TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lessons(id INTEGER PRIMARY KEY, at TEXT NOT NULL, agent TEXT NOT NULL, text TEXT NOT NULL, org TEXT NOT NULL,
  scope TEXT, status TEXT NOT NULL DEFAULT 'provisional', source TEXT, task_id TEXT, version INTEGER NOT NULL DEFAULT 1, supersedes INTEGER);
CREATE TABLE IF NOT EXISTS deliverables(id INTEGER PRIMARY KEY, at TEXT NOT NULL, agent TEXT, task_id TEXT, org TEXT NOT NULL, title TEXT,
  kind TEXT, path TEXT, status TEXT NOT NULL DEFAULT 'draft');
CREATE TABLE IF NOT EXISTS instructions(agent TEXT NOT NULL, hash TEXT NOT NULL, at TEXT NOT NULL, size INTEGER, PRIMARY KEY(agent, hash));
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
"""
SCHEMA_VERSION = "1"


def now():
    return datetime.datetime.now().isoformat(timespec="seconds")


def open_db(path):
    """Open (or create) the store. Called once by the helper; tests open their own copy."""
    global _DB, DB_PATH
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL"); db.execute("PRAGMA foreign_keys=ON"); db.execute("PRAGMA busy_timeout=5000")
    db.executescript(SCHEMA)
    db.execute("INSERT OR REPLACE INTO meta(key, value) VALUES('schema', ?)", (SCHEMA_VERSION,))
    _DB, DB_PATH = db, path
    return db


def db():
    if _DB is None:
        raise RuntimeError("the Core store isn't open")
    return _DB


def q(sql, args=()):
    with LOCK:
        return db().execute(sql, args).fetchall()


def x(sql, args=()):
    with LOCK:
        return db().execute(sql, args)


# ---------- organisations and who belongs to them ----------
def seed(charter_mod, heads_list=(), hires=(), buildings=()):
    """Create the organisations and memberships from the Kingdom's own records. Safe to run on every start."""
    orgs = {"kingdom": ("kingdom", "Kingdom One (the staff)", None, "vizier"), "personal": ("personal", "The private garden", None, None)}
    for scope in privacy.ORG:
        kind, _, name = scope.partition(":")
        orgs[scope] = (kind, name.replace("-", " ").title(), "kingdom", None)
    with LOCK:
        for oid, (kind, name, parent, head) in orgs.items():
            x("INSERT INTO orgs(id, kind, name, parent, head) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, name=excluded.name", (oid, kind, name, parent, head))
        want = set()
        for k in charter_mod.ORDER:
            want.add(("personal" if privacy.home(k) == "personal" else "kingdom", k, "member"))
            if privacy.home(k) == "personal":
                want.add(("kingdom", k, "reader"))  # the garden can read general work, never the other way round
        # businesses: the business director, finance and the chief of staff (oversight)
        for scope in privacy.ORG:
            if scope.startswith("business:"):
                for k, role in (("merchant", "lead"), ("money", "member"), ("vizier", "oversight")):
                    if k in charter_mod.CHARTER:
                        want.add((scope, k, role))
        # ventures: each venture's building head, its crew, the chief of staff, the technology lead (review) and commercial
        vmap = privacy.venture_of_building
        for h in heads_list:
            v = vmap(h.get("buildingName", ""))
            if not v:
                continue
            x("UPDATE orgs SET head=? WHERE id=?", (h["key"], v))
            want.add((v, h["key"], "head"))
            for k in h.get("crew") or []:
                want.add((v, k, "crew"))
            for k, role in (("vizier", "oversight"), ("engineer", "review"), ("merchant", "commercial"), ("money", "finance")):
                want.add((v, k, role))
            want.add(("kingdom", h["key"], "member"))
        for w in hires:
            if w.get("released"):
                continue
            boss_v = next((vmap(h.get("buildingName", "")) for h in heads_list if h.get("key") == w.get("boss")), None)
            want.add((boss_v or "kingdom", w.get("key"), "member"))
        x("DELETE FROM members")
        for org, agent, role in want:
            if agent:
                x("INSERT OR REPLACE INTO members(org, agent, role) VALUES(?,?,?)", (org, agent, role))


def orgs_of(agent):
    return {r["org"] for r in q("SELECT org FROM members WHERE agent=?", (agent,))}


def home_org(agent):
    if privacy.home(agent) == "personal":
        return "personal"
    rows = [r["org"] for r in q("SELECT org FROM members WHERE agent=? AND role='head'", (agent,))]
    return rows[0] if rows else "kingdom"


def may_read(agent, org, task=None):
    """The primary boundary: membership of the record's organisation, or being assigned the task it belongs to.
    Personal records are for personal members only, whatever else is true."""
    if org == "personal":
        return "personal" in orgs_of(agent)
    if org in orgs_of(agent):
        return True
    return bool(task) and task.get("owner") == agent and task.get("org") == org


# ---------- conversations and messages ----------
def conv_org(conv):
    """A conversation belongs to its agent's home organisation (meetings belong to the Kingdom)."""
    r = q("SELECT org FROM conversations WHERE id=?", (conv,))
    if r:
        return r[0]["org"]
    org = "kingdom" if conv in ("everyone", "vizier") else home_org(conv)
    x("INSERT OR IGNORE INTO conversations(id, agent, room, org) VALUES(?,?,?,?)", (conv, None if conv == "everyone" else conv, "everyone" if conv == "everyone" else "chat", org))
    return org


def _digest(text):
    return hashlib.sha256(" ".join(str(text).split()).encode("utf-8")).hexdigest()[:24]  # whitespace doesn't matter


def message_org(conv, text, scope=None):
    """The organisation a message belongs to: its conversation's, made stricter by an explicit tag or (as a second
    check) by what it says. Never looser than the conversation."""
    org = conv_org(conv)
    if org == "personal" or scope == "personal":
        return "personal"
    sc = privacy.classify(text)
    if "personal" in sc:
        return "personal"
    named = sorted(privacy.org_of(sc))
    if org == "kingdom" and len(named) == 1:
        return named[0]
    return org


def put_messages(conv, items):
    """Write a conversation's messages (idempotent: the same message twice is stored once)."""
    n = 0
    with LOCK:
        for m in items or []:
            if not isinstance(m, dict) or not str(m.get("text", "")).strip():
                continue
            text, sender, at = str(m["text"])[:20000], str(m.get("from", "?"))[:40], str(m.get("at") or now())[:40]
            org = message_org(conv, text, m.get("scope"))
            cur = x("INSERT OR IGNORE INTO messages(conv, sender, text, org, scope, at, digest) VALUES(?,?,?,?,?,?,?)",
                    (conv, sender, text, org, m.get("scope"), at, _digest(text)))
            n += cur.rowcount
    return n


def org_of_text(text):
    """If this exact text is a stored message, the organisation it belongs to (the record decides, not keywords)."""
    t = str(text).strip()
    if len(t) < 3:
        return None
    r = q("SELECT org FROM messages WHERE digest=? ORDER BY CASE org WHEN 'personal' THEN 0 ELSE 1 END LIMIT 1", (_digest(t),))
    return r[0]["org"] if r else None


def readable_messages(agent, conv, limit=40):
    rows = q("SELECT sender, text, org, scope, at FROM messages WHERE conv=? ORDER BY at DESC, id DESC LIMIT ?", (conv, limit))
    out = []
    for r in reversed(rows):
        ok = may_read(agent, r["org"])
        out.append({"from": r["sender"], "text": r["text"] if ok else privacy.marker({"personal"} if r["org"] == "personal" else {"business:x"}),
                    "at": r["at"], "org": r["org"]})
    return out


def digest_for(agent, day=None, names=None, per_conv=6, max_convs=6):
    """Today's direct conversations the agent may read, built from the store (Vizier's overview). Conversations of
    organisations it isn't a member of never appear, not even as a summary."""
    day = day or datetime.date.today().isoformat()
    names = names or {}
    convs = [r["id"] for r in q("SELECT id FROM conversations WHERE room='chat' AND id NOT IN (?, 'everyone')", (agent,))]
    out = []
    for c in convs:
        if not may_read(agent, conv_org(c)):
            continue
        rows = [r for r in q("SELECT sender, text, org FROM messages WHERE conv=? AND substr(at,1,10)=? ORDER BY at", (c, day)) if may_read(agent, r["org"])]
        if rows:
            who = lambda s: "Chief" if s == "you" else names.get(s, s)
            out.append(f"{names.get(c, c)}:\n" + "\n".join(f"  {who(r['sender'])}: {' '.join(r['text'].split())[:220]}" for r in rows[-per_conv:]))
    return ("The Chief's direct conversations with others today (most recent last; you weren't in them, but keep track and coordinate):\n"
            + "\n".join(out[-max_convs:])) if out else ""


# ---------- tasks ----------
def task_org(t):
    """Which organisation a task belongs to: an explicit org, its parent's, its owner's home, or (supplementary) what it names."""
    if t.get("org"):
        return t["org"]
    if t.get("parent"):
        r = q("SELECT org FROM tasks WHERE id=?", (t["parent"],))
        if r and r[0]["org"] == "personal":
            return "personal"
    owner = t.get("by") or t.get("to") or "vizier"
    home = home_org(owner)
    if home != "kingdom":
        return home
    sc = privacy.classify(t.get("text", ""))
    if "personal" in sc:
        return "personal"
    named = sorted(privacy.org_of(sc))
    return named[0] if len(named) == 1 else "kingdom"


def put_tasks(items):
    with LOCK:
        for t in items or []:
            if not isinstance(t, dict) or not t.get("id"):
                continue
            old = q("SELECT org FROM tasks WHERE id=?", (str(t["id"]),))
            org = old[0]["org"] if old else task_org(t)
            x("""INSERT INTO tasks(id, org, owner, status, priority, parent, depth, data, updated) VALUES(?,?,?,?,?,?,?,?,?)
                 ON CONFLICT(id) DO UPDATE SET owner=excluded.owner, status=excluded.status, priority=excluded.priority, data=excluded.data, updated=excluded.updated""",
              (str(t["id"]), org, t.get("by"), t.get("status"), int(t.get("priority", 2) or 2), t.get("parent"), int(t.get("depth", 0) or 0),
               json.dumps(t, ensure_ascii=False)[:400000], now()))


def get_task(tid):
    r = q("SELECT org, owner, status, runs, depth FROM tasks WHERE id=?", (str(tid),)) if tid else []
    return dict(r[0]) if r else None


def all_tasks():
    out = []
    for r in q("SELECT data, org FROM tasks ORDER BY rowid"):
        try:
            t = json.loads(r["data"]); t["org"] = r["org"]; out.append(t)
        except ValueError:
            pass
    return out


def count_run(tid):
    if tid:
        x("UPDATE tasks SET runs = runs + 1 WHERE id=?", (str(tid),))


# ---------- the village's other state (quests, Vizier's log, meetings...) ----------
def put_doc(key, value):
    x("INSERT INTO docs(key, value, updated) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated=excluded.updated",
      (key, json.dumps(value, ensure_ascii=False)[:2_000_000], now()))


def get_docs():
    out = {}
    for r in q("SELECT key, value FROM docs"):
        try:
            out[r["key"]] = json.loads(r["value"])
        except ValueError:
            pass
    return out


def chats():
    out = {}
    for r in q("SELECT conv, sender, text, scope, at FROM messages ORDER BY at, id"):
        m = {"from": r["sender"], "text": r["text"], "at": r["at"]}
        if r["scope"]:
            m["scope"] = r["scope"]
        out.setdefault(r["conv"], []).append(m)
    return {k: v[-60:] for k, v in out.items()}


# ---------- runs, usage, instructions ----------
def instr_version(agent):
    f = AGENTS / agent / "CLAUDE.md"
    try:
        b = f.read_bytes()
    except OSError:
        return None
    h = hashlib.sha256(b).hexdigest()[:16]
    x("INSERT OR IGNORE INTO instructions(agent, hash, at, size) VALUES(?,?,?,?)", (agent, h, now(), len(b)))
    return h


def log_run(**kw):
    cols = ("at", "agent", "room", "task_id", "org", "provider", "model", "kind", "input", "cache_read", "cache_write", "output", "ms", "turns", "instr", "outcome")
    kw.setdefault("at", now())
    x(f"INSERT INTO runs({', '.join(cols)}) VALUES({', '.join('?' * len(cols))})", tuple(kw.get(c) for c in cols))


def usage(by="agent", since=None):
    col = {"agent": "agent", "task": "task_id", "org": "org", "model": "model"}.get(by, "agent")
    sql = f"SELECT {col} AS k, COUNT(*) AS runs, SUM(COALESCE(input,0)+COALESCE(cache_read,0)+COALESCE(cache_write,0)+COALESCE(output,0)) AS tokens, SUM(COALESCE(output,0)) AS output FROM runs"
    args = ()
    if since:
        sql += " WHERE at >= ?"; args = (since,)
    return [dict(r) for r in q(sql + f" GROUP BY {col} ORDER BY tokens DESC", args)]


# ---------- operational controls ----------
def set_control(key, value, actor="chief"):
    if value in (None, False, "", "off"):
        x("DELETE FROM controls WHERE key=?", (key,))
    else:
        x("INSERT OR REPLACE INTO controls(key, value, at) VALUES(?,?,?)", (key, json.dumps(value), now()))
    audit(actor, "control", key, None, json.dumps(value))


def controls():
    return {r["key"]: json.loads(r["value"]) for r in q("SELECT key, value FROM controls")}


def blocked(agent, orgs=()):
    """Why this agent can't run right now (emergency stop, paused, provider resting), or None."""
    c = controls()
    if c.get("stop"):
        return "Everything is stopped (emergency stop). The Chief can start the Kingdom again from Team & usage."
    if c.get(f"pause:agent:{agent}"):
        return "This agent is paused by the Chief."
    for o in orgs:
        if c.get(f"pause:org:{o}"):
            return f"Work for {o} is paused by the Chief."
    until = c.get("provider:claude:until")
    if until and until > time.time():
        mins = max(1, int((until - time.time()) / 60))
        return f"Claude's usage limit was reached; the Kingdom waits about {mins} more minute(s) before trying again."
    return None


# ---------- audit, lessons, deliverables ----------
def audit(actor, action, target=None, org=None, detail=None):
    x("INSERT INTO audit(at, actor, action, target, org, detail) VALUES(?,?,?,?,?,?)", (now(), actor, action, target, org, (detail or "")[:2000]))


def add_lesson(agent, text, org, task_id=None, source="task"):
    """Lessons always start as provisional. Only the Chief changes a lesson's status; an agent can't promote its own."""
    x("INSERT INTO lessons(at, agent, text, org, scope, status, source, task_id) VALUES(?,?,?,?,?,?,?,?)",
      (now(), agent, text, org, ",".join(sorted(privacy.classify(text))) or None, "provisional", source, task_id))


def set_lesson_status(lesson_id, status, actor):
    if actor != "chief":
        raise PermissionError("only the Chief can change a lesson's status")
    if status not in ("provisional", "verified", "superseded", "disputed"):
        raise ValueError("unknown status")
    x("UPDATE lessons SET status=?, version=version+1 WHERE id=?", (status, int(lesson_id)))
    audit(actor, "lesson", str(lesson_id), None, status)


def counts():
    out = {}
    for t in ("orgs", "members", "conversations", "messages", "tasks", "docs", "runs", "audit", "lessons", "deliverables", "instructions"):
        out[t] = q(f"SELECT COUNT(*) AS n FROM {t}")[0]["n"]
    return out
