"""Privacy regression tests (Kingdom 2.0, step 1). Run:  python -m unittest discover -s tests -v   (from ai-village/)

They check, at the helper's boundary, that personal material and another business's details can't reach an agent that
isn't cleared for them. The end-to-end tests run brain.reply() for real, with Claude Code swapped for a recorder, so they
prove what an agent's prompt and request would actually contain. No model is called and nothing on disk is changed.
"""
import json, pathlib, sys, tempfile, types, unittest

HELPER = pathlib.Path(__file__).resolve().parent.parent / "helper"
sys.path.insert(0, str(HELPER))
import privacy  # noqa: E402
import brain  # noqa: E402
import charter  # noqa: E402

# the agents, by their place in the chain of command (the public starter renames them)
O = charter.ORDER
COS, OPS, RND, KNOW, BIZ, FIN, TECH = O[0], O[1], O[2], O[3], O[4], O[5], O[6]
PERSONAL_AGENT = next(k for k, v in privacy.HOME.items() if v == "personal")
ORGS = sorted(privacy.ORG.items())  # this edition's businesses and ventures, if any: [(scope, [names])]

SECRET = "my dentist appointment for the tooth pain, and the anniversary dinner with my wife"
SECRET_WORDS = ("dentist", "tooth", "anniversary", "my wife")


def leaks(text):
    t = str(text).lower()
    return [w for w in SECRET_WORDS if w in t]


class Recorder:
    """Stands in for Claude Code: keeps the instructions and the request it would have been given."""
    def __init__(self):
        self.calls = []

    def __call__(self, args, input=None, **kw):
        prompt = ""
        if "--system-prompt-file" in args:
            prompt = pathlib.Path(args[args.index("--system-prompt-file") + 1]).read_text(encoding="utf-8")
        self.calls.append({"prompt": prompt, "ask": input or ""})
        out = "\n".join(json.dumps(x) for x in [{"type": "system", "subtype": "init", "apiKeySource": "none", "tools": [], "mcp_servers": []},
                                                {"type": "result", "result": "DONE\nok", "usage": {}}])
        return types.SimpleNamespace(stdout=out, stderr="", returncode=0)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.rec = Recorder()
        self._saved = {k: getattr(brain, k) for k in ("access_for", "uses_library", "my_tools", "connections", "USAGE_LOG", "LESSONS", "keep_learned")}
        self._run = brain.subprocess.run
        brain.subprocess.run = self.rec
        brain.access_for = lambda key, room="": ((), (), ())
        brain.uses_library = lambda key, room: False
        brain.my_tools = lambda key, room: {}
        brain.connections = lambda key=None, room="": []
        brain.USAGE_LOG = pathlib.Path(self.tmp.name) / "usage.jsonl"
        self._rundir = brain.RUN_DIR
        brain.RUN_DIR = pathlib.Path(self.tmp.name)
        brain.keep_learned = lambda key, text, room="", **kw: (text, [])
        brain.refresh_team()

    def tearDown(self):
        brain.subprocess.run = self._run
        brain.RUN_DIR = self._rundir
        for k, v in self._saved.items():
            setattr(brain, k, v)
        self.tmp.cleanup()

    def sent(self):
        """Everything the last model call would have seen."""
        c = self.rec.calls[-1]
        return c["prompt"] + "\n" + c["ask"]


class Classification(unittest.TestCase):
    def test_personal_is_found(self):
        self.assertIn("personal", privacy.classify(SECRET))
        self.assertIn("personal", privacy.classify("Remind me about mum's birthday"))

    def test_ordinary_work_is_not_personal(self):
        for t in ("Compare three memory tools", "Draft the client proposal", "Plan the week for the team", "Fix the helper when it's offline"):
            self.assertEqual(privacy.classify(t), set(), t)

    def test_business_names(self):
        for scope, names in ORGS:  # only where privacy_private.json names the businesses
            self.assertIn(scope, privacy.classify(f"A quote for {names[0]}"))

    def test_only_a_personal_home_sees_personal(self):
        self.assertTrue(privacy.may_see(PERSONAL_AGENT, {"personal"}))
        for a in [k for k in O if privacy.home(k) != "personal"]:
            self.assertFalse(privacy.may_see(a, {"personal"}), a)


class Leaks(Base):
    def test_chief_of_staff_digest_drops_private_chat(self):
        hint = ("The Chief's direct conversations with others today:\nShahi:\n  Chief: " + SECRET + "\n  Steward: Will do.\nWebb:\n  Chief: compare memory tools")
        brain.reply(COS, [{"from": "you", "text": "what is everyone doing?"}], "", hint)
        self.assertEqual(leaks(self.sent()), [])
        self.assertIn("compare memory tools", self.sent())

    def test_chief_of_staff_chat_redacts_a_personal_line(self):
        brain.reply(COS, [{"from": "you", "text": SECRET}, {"from": "you", "text": "and plan the team's week"}], "", "")
        self.assertEqual(leaks(self.sent()), [])
        self.assertIn("kept private", self.sent())
        self.assertIn("plan the team's week", self.sent())

    def test_routed_task_context_is_cleaned(self):
        ctx = "- " + SECRET + "\n- please plan next week's deadlines\nWebb:\n  Chief: compare memory tools"
        brain.reply(OPS, [], "task", "", {"text": "Plan next week's deadlines", "context": ctx})
        self.assertEqual(leaks(self.sent()), [])
        self.assertIn("deadlines", self.sent())

    def test_pass_to_with_personal_text_is_refused_without_a_model_call(self):
        out = brain.reply(OPS, [], "task", "", {"text": "Book a table for the anniversary dinner with my wife"})
        self.assertTrue(out.startswith("NEEDS THE CHIEF"))
        self.assertEqual(self.rec.calls, [])

    def test_passed_on_context_is_cleaned(self):
        ctx = "Passed on by Steward. Their part:\n" + SECRET + "\nHold two free evenings next week."
        brain.reply(OPS, [], "task", "", {"text": "Hold two free evenings next week", "context": ctx})
        self.assertEqual(leaks(self.sent()), [])

    def test_a_personal_question_to_a_colleague_is_refused(self):
        out = brain.reply(TECH, [], "consult", "", {"from": PERSONAL_AGENT, "task": "plan my week", "question": "Can you remind me about " + SECRET})
        self.assertIn("private garden", out)
        self.assertEqual(self.rec.calls, [])

    def test_private_notes_stay_out_of_shared_rooms(self):
        notes = (brain.AGENTS / PERSONAL_AGENT / "NOTES.md")
        real = notes.read_text(encoding="utf-8") if notes.exists() else ""
        for room, job in (("consult", {"from": OPS, "task": "plan the week", "question": "Any free evenings?"}), ("everyone", None)):
            brain.reply(PERSONAL_AGENT, [{"from": "you", "text": "Hello everyone"}], room, "", job)
            self.assertIn("notes aren't loaded here", self.rec.calls[-1]["prompt"], room)
            for line in [l for l in real.splitlines() if l.startswith("- ") and len(l) > 20][:5]:
                self.assertNotIn(line, self.rec.calls[-1]["prompt"], room)

    def test_meeting_redacts_the_chiefs_personal_remark_for_others(self):
        hist = [{"from": "you", "text": SECRET}, {"from": "you", "text": "Let's review the studio's plan"}]
        brain.reply(KNOW, hist, "everyone", "")
        self.assertEqual(leaks(self.sent()), [])
        self.assertIn("studio's plan", self.sent())

    def test_messages_tagged_personal_are_redacted_even_without_keywords(self):
        brain.reply(COS, [{"from": "you", "text": "the thing we talked about on Friday", "scope": "personal"}], "", "")
        self.assertNotIn("the thing we talked about on Friday", self.sent())

    def test_personal_agent_still_gets_everything(self):
        brain.reply(PERSONAL_AGENT, [], "task", "", {"text": "Book " + SECRET, "context": "Chief: " + SECRET})
        self.assertIn("dentist", self.sent())


class Lessons(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.saved = (brain.LESSONS, brain.AGENTS)
        root = pathlib.Path(self.tmp.name)
        (root / "agents" / OPS).mkdir(parents=True)
        (root / "agents" / OPS / "NOTES.md").write_text("# notes\n", encoding="utf-8")
        brain.LESSONS, brain.AGENTS = root / "agents" / "LESSONS.md", root / "agents"

    def tearDown(self):
        brain.LESSONS, brain.AGENTS = self.saved
        self.tmp.cleanup()

    def test_personal_or_named_lessons_stay_off_the_board(self):
        brain.keep_learned(OPS, "DONE\nLESSON: When the Chief mentions a dentist appointment, block the morning.", "task")
        if ORGS:
            brain.keep_learned(OPS, f"DONE\nLESSON: {ORGS[0][1][0]} clients want quotes in two parts.", "task")
        board = brain.LESSONS.read_text(encoding="utf-8") if brain.LESSONS.exists() else ""
        self.assertNotIn("dentist", board)
        if ORGS:
            self.assertNotIn(ORGS[0][1][0], board.lower())
        self.assertIn("dentist", (brain.AGENTS / OPS / "NOTES.md").read_text(encoding="utf-8"))  # kept in Keeper's own notes

    def test_general_lessons_still_go_on_the_board(self):
        brain.keep_learned(OPS, "DONE\nLESSON: Deliver the plan from what you can reach and name the gap.", "task")
        self.assertIn("name the gap", brain.LESSONS.read_text(encoding="utf-8"))

    def test_board_hides_an_old_personal_lesson(self):
        brain.LESSONS.write_text("# Lessons board\n\n- 2026-11-20, Keeper: Ask about the Chief's anniversary plans early.\n- 2026-11-21, Keeper: Name the gap.\n", encoding="utf-8")
        b = brain.board(KNOW)
        self.assertNotIn("anniversary", b)
        self.assertIn("Name the gap", b)


class Businesses(Base):
    def test_one_business_never_flows_into_anothers_task(self):
        biz = [n[0] for sc, n in ORGS if sc.startswith("business:")]
        if len(biz) < 2:
            self.skipTest("fewer than two businesses named in this edition")
        a, b = biz[0], biz[1]
        ctx = f"Chief: the {b} invoice is overdue\nChief: the {a} quote needs a support line"
        brain.reply(BIZ, [], "task", "", {"text": f"Finish the {a} quote", "context": ctx})
        self.assertNotIn(f"{b} invoice", self.sent())
        self.assertIn(f"{a} quote", self.sent())


if __name__ == "__main__":
    unittest.main(verbosity=2)
