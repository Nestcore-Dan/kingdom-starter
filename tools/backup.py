"""Kingdom Core backup with a verified restore (Kingdom 2.0, phase 1).

    python tools/backup.py            make a backup, then restore it into a temporary folder and check it
    python tools/backup.py --verify   check the newest backup only (restore + compare)

What's in a backup: the store (data/kingdom.db, copied with SQLite's online backup, so it's consistent while the
Kingdom runs), the settings, every agent's notes, the lessons board, the team files and this Kingdom's private privacy
names. Backups go to ../Kingdom-private-backup/auto/ (outside the repository); the newest 14 are kept.

"Verified" means: the zip opens, every file's checksum matches its manifest, the restored store passes SQLite's
integrity check, and its row counts match the manifest. A backup that fails any check is reported as failed.
"""
import datetime, hashlib, json, pathlib, sqlite3, sys, tempfile, zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT.parent.parent / "Kingdom-private-backup" / "auto"
KEEP = 14
TABLES = ("orgs", "members", "conversations", "messages", "tasks", "docs", "runs", "audit", "lessons", "deliverables", "instructions")


def files():
    yield from (p for p in [DATA / "settings.json", ROOT / "agents" / "LESSONS.md", ROOT / "agents" / "heads.json",
                            ROOT / "agents" / "hires.json", ROOT / "helper" / "privacy_private.json"] if p.exists())
    yield from sorted((ROOT / "agents").glob("*/NOTES.md"))
    yield from sorted((ROOT / "agents").glob("head-*/ROLE.md"))


def sha(b):
    return hashlib.sha256(b).hexdigest()


def counts(db_path):
    con = sqlite3.connect(str(db_path))
    try:
        return {t: con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in TABLES
                if con.execute("SELECT 1 FROM sqlite_master WHERE name=?", (t,)).fetchone()}
    finally:
        con.close()


def make():
    OUT.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    target = OUT / f"kingdom-{stamp}.zip"
    manifest = {"made": stamp, "files": {}, "db": None}
    with tempfile.TemporaryDirectory() as tmp, zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        live = DATA / "kingdom.db"
        if live.exists():
            snap = pathlib.Path(tmp) / "kingdom.db"
            src, dst = sqlite3.connect(str(live)), sqlite3.connect(str(snap))
            with dst:
                src.backup(dst)
            src.close(); dst.close()
            b = snap.read_bytes()
            z.writestr("data/kingdom.db", b)
            manifest["db"] = {"sha": sha(b), "counts": counts(snap)}
        for f in files():
            rel = f.relative_to(ROOT).as_posix()
            b = f.read_bytes()
            z.writestr(rel, b)
            manifest["files"][rel] = sha(b)
        z.writestr("manifest.json", json.dumps(manifest, indent=1))
    for old in sorted(OUT.glob("kingdom-*.zip"))[:-KEEP]:
        old.unlink()
    return target


def verify(zpath):
    problems = []
    with tempfile.TemporaryDirectory() as tmp, zipfile.ZipFile(zpath) as z:
        bad = z.testzip()
        if bad:
            return [f"damaged entry in the zip: {bad}"]
        man = json.loads(z.read("manifest.json"))
        z.extractall(tmp)
        root = pathlib.Path(tmp)
        for rel, want in man["files"].items():
            p = root / rel
            if not p.exists() or sha(p.read_bytes()) != want:
                problems.append(f"{rel}: missing or changed")
        if man.get("db"):
            db = root / "data" / "kingdom.db"
            if sha(db.read_bytes()) != man["db"]["sha"]:
                problems.append("kingdom.db: checksum differs")
            con = sqlite3.connect(str(db))
            ok = con.execute("PRAGMA integrity_check").fetchone()[0]
            con.close()
            if ok != "ok":
                problems.append(f"kingdom.db integrity check: {ok}")
            if counts(db) != man["db"]["counts"]:
                problems.append("kingdom.db: row counts differ from the manifest")
        n = len(man["files"]) + (1 if man.get("db") else 0)
    return problems, n, man


if __name__ == "__main__":
    if "--verify" in sys.argv:
        zs = sorted(OUT.glob("kingdom-*.zip"))
        if not zs:
            sys.exit("No backups yet.")
        target = zs[-1]
    else:
        target = make()
    res = verify(target)
    if isinstance(res, list):
        print(f"FAILED {target.name}: " + "; ".join(res)); sys.exit(1)
    problems, n, man = res
    if problems:
        print(f"FAILED {target.name}: " + "; ".join(problems)); sys.exit(1)
    rows = (man.get("db") or {}).get("counts", {})
    print(f"OK {target.name}: restored {n} files into a temporary folder; checksums match; store integrity ok; "
          f"rows {sum(rows.values())} ({', '.join(f'{k} {v}' for k, v in rows.items() if v)}).")
