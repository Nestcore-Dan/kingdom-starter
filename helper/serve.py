"""Serves the Kingdom One village page on this computer only (guide step 49).

Run it with:  python ai-village/helper/serve.py      then open http://127.0.0.1:8765/

Unlike `python -m http.server`, it only serves what the page needs (the page, its scripts, the art, vendor
libraries and agents/hires.json), never the agents' notes, the helper, reports or anything else in the folder, and
it refuses any request whose Host isn't this computer, so a web page can't reach it through DNS rebinding.
"""
import json, os, pathlib, re, tempfile, threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = int(os.environ.get("KINGDOM_ONE_PORT", "8765"))  # the brain helper listens on the next port up
HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
ALLOWED = re.compile(r"^/(?:|index\.html|[a-z0-9_-]+\.js|(?:art|vendor)/[A-Za-z0-9_./-]+|agents/hires\.json)$")
ORIGINS = {f"http://{h}" for h in HOSTS}
# This instance's personalisation (world.js): one versioned record, saved whole and atomically, so a repeated or
# retried save never creates a second world. Kept in data/ next to the village, which is never committed.
DATA = pathlib.Path(os.environ.get("KINGDOM_ONE_DATA", ROOT / "data"))
SETTINGS = DATA / "settings.json"
LOCK = threading.Lock()
KEY = re.compile(r"^[a-z][a-z0-9-]{0,19}$")


def clean(v, n):
    return re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\x7f<>]", "", str(v or ""))).strip()[:n]


KINDS = {"local", "repo", "account", "social", "api"}
OPTIONS = {"account": {"Gmail", "Google Calendar", "Google Drive", "Google Sheets", "Outlook", "Slack", "Notion", "Xero", "Other"},
           "social": {"X", "LinkedIn", "Instagram", "Facebook", "YouTube", "TikTok", "Other"}}
LOCAL_RE = re.compile(r"^http://(127\.0\.0\.1|localhost):\d{2,5}(/[^\s?#]*)?$")
REPO_RE = re.compile(r"^https://(github\.com|gitlab\.com|codeberg\.org)/[\w.-]+/[\w.-]+/?$")
API_RE = re.compile(r"^https://[a-z0-9.-]+\.[a-z]{2,}(:\d{2,5})?(/[^\s?#]*)?$", re.I)
ENV_RE = re.compile(r"^[A-Z][A-Z0-9_]{1,40}$")
SECRET_RE = re.compile(r"(sk-|ghp_|gho_|github_pat_|xox[abprs]-|AIza|AKIA|Bearer\s)|(?=[A-Za-z0-9_+-]*\d)(?=[A-Za-z0-9_+-]*[A-Za-z])[A-Za-z0-9_+-]{32,}|[?&](key|token|secret|password|api_key)=|//[^/]*@", re.I)


def conns(items):
    """Connections the Chief listed (world.js). Records only: no secrets, and nothing here is ever called."""
    out = []
    for c in (items if isinstance(items, list) else [])[:30]:
        if not isinstance(c, dict) or c.get("kind") not in KINDS:
            raise ValueError("bad connection")
        k, d, n, env = c["kind"], clean(c.get("detail"), 200), clean(c.get("name"), 40), clean(c.get("env"), 41)
        ok = {"local": LOCAL_RE.match(d), "repo": REPO_RE.match(d), "api": API_RE.match(d)}.get(k) if k not in OPTIONS else d in OPTIONS[k]
        if not ok or any(SECRET_RE.search(v) for v in (d, n, env) if v) or (env and (k != "api" or not ENV_RE.match(env))):
            raise ValueError("bad connection: no keys or passwords, and a valid address")
        agents = [a for a in (c.get("agents") if isinstance(c.get("agents"), list) else []) if isinstance(a, str) and (a == "*" or KEY.match(a))][:40]
        free = bool(c.get("free")) if k == "api" else False
        on = bool(c.get("on")) and bool(agents) and (k != "api" or free)  # an API is only used once the Chief says it's free or already paid for
        auth = c.get("auth") if c.get("auth") in ("bearer", "header", "query") else "bearer"
        out.append({"id": clean(c.get("id"), 24), "kind": k, "detail": d, "name": n or d, "env": env, "added": clean(c.get("added"), 40),
                    "on": on, "agents": agents, "free": free, "auth": auth})
    return out


def check(rec):
    """Only the known fields, as plain text within their limits."""
    if not isinstance(rec, dict):
        raise ValueError("not a settings record")
    agents = rec.get("agents") or {}
    if not isinstance(agents, dict) or len(agents) > 80:
        raise ValueError("bad agent names")
    out = {"version": 1, "setupDone": bool(rec.get("setupDone")), "worldName": clean(rec.get("worldName"), 40),
           "ownerName": clean(rec.get("ownerName"), 30), "tourDone": bool(rec.get("tourDone")), "migrated": bool(rec.get("migrated")),
           "agents": {k: clean(v, 24) for k, v in agents.items() if KEY.match(str(k)) and clean(v, 24)},
           "connections": conns(rec.get("connections")), "updatedAt": clean(rec.get("updatedAt"), 40)}
    d = rec.get("draft")
    if isinstance(d, dict):
        out["draft"] = {"step": max(0, min(int(d.get("step") or 0), 5)), "connections": conns(d.get("connections")), "worldName": clean(d.get("worldName"), 40), "ownerName": clean(d.get("ownerName"), 30),
                        "agents": {k: clean(v, 24) for k, v in (d.get("agents") or {}).items() if KEY.match(str(k)) and clean(v, 24)}}
    else:
        out["draft"] = None
    return out


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def _ok(self):
        path = self.path.split("?", 1)[0].split("#", 1)[0]
        return self.headers.get("Host", "") in HOSTS and ".." not in path and bool(ALLOWED.match(path))

    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body)))
        self.end_headers(); self.wfile.write(body)

    def do_PUT(self):
        if self.path.split("?", 1)[0] != "/api/settings" or self.headers.get("Host", "") not in HOSTS or self.headers.get("Origin", "") not in ORIGINS:
            return self.send_error(403)
        try:
            rec = check(json.loads(self.rfile.read(min(int(self.headers.get("Content-Length", 0)), 60_000))))
            with LOCK:
                DATA.mkdir(parents=True, exist_ok=True)
                fd, tmp = tempfile.mkstemp(dir=DATA, suffix=".tmp")
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    json.dump(rec, f, indent=1)
                os.replace(tmp, SETTINGS)
            return self._json(200, {"ok": True, "settings": rec})
        except Exception as e:
            return self._json(400, {"error": str(e)[:200]})

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/api/settings" and self.headers.get("Host", "") in HOSTS:
            if not SETTINGS.exists():
                return self._json(404, {"error": "no settings yet"})
            try:
                return self._json(200, json.loads(SETTINGS.read_text(encoding="utf-8")))
            except ValueError:
                return self._json(404, {"error": "unreadable settings: starting fresh"})
        if not self._ok():
            return self.send_error(404)
        return super().do_GET()

    def do_HEAD(self):
        if not self._ok():
            return self.send_error(404)
        return super().do_HEAD()

    def list_directory(self, path):  # never list folders
        self.send_error(404)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    print(f"Kingdom One village on http://127.0.0.1:{PORT}/ (this computer only). Close this window to stop.")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
