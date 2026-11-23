"""Kingdom One task reports (guide step 43): one PDF for every finished task on the to-do list.

The village sends the finished task (its text, who did what, the result) and the faces of the people involved.
This builds a page in the medina style and has Microsoft Edge, which comes with Windows, print it to PDF without
opening a window. Everything stays on this computer: nothing is fetched or uploaded, and the reports are saved
in ai-village/reports/, which git ignores because they hold your tasks.
"""
import base64, datetime, html, os, pathlib, re, subprocess, tempfile

HERE = pathlib.Path(__file__).resolve().parent
REPORTS = HERE.parent / "reports"
EDGE = [pathlib.Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Microsoft/Edge/Application/msedge.exe",
        pathlib.Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Microsoft/Edge/Application/msedge.exe"]
SAFE_NAME = re.compile(r"^[a-z0-9-]{1,120}\.pdf$")
STATUS = {"ready": ("Ready for your OK", "#b98a1e"), "done": ("Approved by you", "#3f7d5a"), "needs": ("Needs you", "#c98a2b"), "failed": ("Couldn't finish", "#b5523b")}
FACE = re.compile(r"^data:image/png;base64,[A-Za-z0-9+/=]{20,400000}$")

# the eight-pointed brass star and a zellige strip, drawn here so nothing is fetched
STAR = ('<svg viewBox="-50 -50 100 100" width="{s}" height="{s}"><g fill="#e8b04b">'
        '<rect x="-30" y="-30" width="60" height="60"/><rect x="-30" y="-30" width="60" height="60" transform="rotate(45)"/></g>'
        '<circle r="15" fill="#0f2a2e"/><circle r="8" fill="#e8b04b"/></svg>')
ZELLIGE = ('<svg width="100%" height="14" preserveAspectRatio="none"><defs><pattern id="z" width="28" height="14" patternUnits="userSpaceOnUse">'
           '<rect width="28" height="14" fill="#fbf6ec"/><path d="M0 7 L7 0 L14 7 L7 14Z" fill="#2b8a8a"/><path d="M14 7 L21 0 L28 7 L21 14Z" fill="#d9643f"/>'
           '<circle cx="7" cy="7" r="2" fill="#e8b04b"/><circle cx="21" cy="7" r="2" fill="#e8b04b"/></pattern></defs>'
           '<rect width="100%" height="14" fill="url(#z)"/></svg>')

CSS = """
@page { size: A4; margin: 14mm 0 14mm; }
@page :first { margin-top: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; color: #0f2a2e; background: #fff; font-size: 10.5pt; line-height: 1.5; }
.top { background: #0f2a2e; color: #fbf6ec; padding: 28px 40px 24px; display: flex; gap: 18px; align-items: center; }
.top .kicker { font-size: 8.5pt; letter-spacing: .18em; text-transform: uppercase; color: #e8b04b; }
.top h1 { font-family: Georgia, "Times New Roman", serif; font-weight: normal; font-size: 21pt; line-height: 1.2; margin: 4px 0 0; }
.body { padding: 22px 40px 30px; }
.pill { display: inline-block; padding: 3px 12px; border-radius: 99px; color: #fff; font-weight: 600; font-size: 9pt; }
.meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 16px 0 6px; }
.meta div { background: #fbf6ec; border: 1px solid #efd3ae; border-radius: 10px; padding: 9px 12px; }
.meta b { display: block; font-size: 8pt; letter-spacing: .1em; text-transform: uppercase; color: #8a6a3f; font-weight: 600; }
.people { display: flex; gap: 14px; margin: 14px 0 4px; }
.person { display: flex; align-items: center; gap: 9px; border: 1px solid #efd3ae; border-radius: 99px; padding: 4px 14px 4px 4px; background: #fbf6ec; }
.person img, .dot { width: 34px; height: 34px; border-radius: 50%; background: #efd3ae; }
.person small { display: block; color: #8a6a3f; font-size: 8pt; }
h2 { font-family: Georgia, serif; font-weight: normal; font-size: 14pt; margin: 22px 0 8px; display: flex; align-items: center; gap: 8px; }
.result { background: #fbf6ec; border-left: 4px solid #2b8a8a; border-radius: 0 12px 12px 0; padding: 14px 18px; white-space: pre-wrap; }
.steps { position: relative; margin-left: 6px; }
.step { position: relative; padding: 0 0 12px 30px; border-left: 2px solid #efd3ae; break-inside: avoid; }
.step:last-child { border-left-color: transparent; }
.step .n { position: absolute; left: -12px; top: 0; width: 22px; height: 22px; border-radius: 50%; background: #d9643f; color: #fff; font-size: 8.5pt; font-weight: 700; text-align: center; line-height: 22px; }
.step .who { font-weight: 600; }
.step .when { color: #8a6a3f; font-size: 8.5pt; margin-left: 6px; }
.step .text { white-space: pre-wrap; margin-top: 3px; color: #24464a; }
.foot { margin-top: 26px; padding-top: 10px; border-top: 1px solid #efd3ae; color: #8a6a3f; font-size: 8pt; display: flex; justify-content: space-between; }
"""


def _when(iso):
    try:
        return datetime.datetime.fromisoformat(str(iso).replace("Z", "+00:00")).astimezone().strftime("%d %b %Y, %H:%M")
    except ValueError:
        return ""


def _e(s):
    return html.escape(str(s or ""))


def build_html(task, names, faces):
    name = lambda k: names.get(k, k or "")
    label, colour = STATUS.get(task.get("status"), ("Reported", "#2b8a8a"))
    doer, checker = task.get("doneBy"), task.get("checkedBy")
    def person(k, role):
        f = faces.get(k, "")
        pic = f'<img src="{f}">' if f and FACE.match(f) else '<span class="dot"></span>'
        return f'<div class="person">{pic}<div>{_e(name(k))}<small>{role}</small></div></div>'
    people = [person("vizier", "passed it on")] if task.get("by") != "vizier" else []
    if task.get("by") and task.get("by") != doer:
        people.append(person(task["by"], "handed it over and checked it" if checker == task["by"] else "handed it over"))
    if doer:
        people.append(person(doer, "did the work"))
    if checker and checker != task.get("by"):
        people.append(person(checker, "checked it"))
    steps = [{"who": "vizier", "what": f"passed it to {name(task.get('by'))}", "text": "", "at": task.get("at")}] + list(task.get("steps") or [])
    rows = "".join(
        f'<div class="step"><span class="n">{i}</span><span class="who">{_e(name(s.get("who")))} {_e(s.get("what"))}</span>'
        f'<span class="when">{_e(_when(s.get("at")))}</span>' + (f'<div class="text">{_e(s.get("text"))}</div>' if s.get("text") else "") + "</div>"
        for i, s in enumerate(steps, 1))
    meta = [("Asked", _when(task.get("at"))), ("Finished", _when(task.get("doneAt"))),
            ("Done by", name(doer) + (f", checked by {name(checker)}" if checker else "")),
            ("Your OK", f"Approved {_when(task.get('approvedAt'))}" if task.get("approvedAt") else "Not yet: only you can approve it")]
    if task.get("toolAsk"):
        meta.append(("Tools", "A tool was missing: the result compares recommended options for you to choose"))
    if task.get("emailDraft"):
        meta.append(("Email", "Draft only. Not sent: nobody in the village can send email"))
    return f"""<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>{_e(task.get('text'))[:80]}</title><style>{CSS}</style></head><body>
<div class="top">{STAR.format(s=54)}<div><div class="kicker">Kingdom One · task report</div><h1>{_e(task.get('text'))}</h1></div></div>
{ZELLIGE}
<div class="body">
<span class="pill" style="background:{colour}">{label}</span>
<div class="meta">{''.join(f'<div><b>{k}</b>{_e(v)}</div>' for k, v in meta)}</div>
<div class="people">{''.join(people)}</div>
<h2>{STAR.format(s=16)} The result</h2>
<div class="result">{_e(task.get('report'))}</div>
<h2>{STAR.format(s=16)} Everything that was done</h2>
<div class="steps">{rows}</div>
<div class="foot"><span>Made on your computer by the Kingdom One brain helper. Talk-only agents on your Claude subscription.</span><span>{_e(datetime.datetime.now().strftime('%d %b %Y'))}</span></div>
</div></body></html>"""


def make_pdf(task, names, faces):
    edge = next((p for p in EDGE if p.exists()), None)
    if not edge:
        raise RuntimeError("Microsoft Edge wasn't found, so the PDF can't be made.")
    REPORTS.mkdir(exist_ok=True)
    slug = re.sub(r"[^a-z0-9]+", "-", str(task.get("text", "task")).lower()).strip("-")[:50] or "task"
    tid = re.sub(r"[^a-z0-9]", "", str(task.get("id", "")).lower())[:16] or "x"
    out = REPORTS / f"{datetime.date.today().isoformat()}-{slug}-{tid}.pdf"
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        page = pathlib.Path(tmp) / "report.html"
        page.write_text(build_html(task, names, faces), encoding="utf-8")
        args = [str(edge), "--headless=new", "--disable-gpu", "--no-first-run", "--no-pdf-header-footer", "--disable-extensions", "--disable-background-networking", "--disable-sync", "--no-default-browser-check",
                f"--user-data-dir={pathlib.Path(tmp) / 'edge'}", f"--print-to-pdf={out}", page.as_uri()]
        subprocess.run(args, capture_output=True, timeout=90)
    if not out.exists() or out.stat().st_size < 1000:
        raise RuntimeError("Edge didn't produce the PDF.")
    return out.name
