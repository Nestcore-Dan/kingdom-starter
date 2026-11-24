"""Kingdom Core phase 1 tests. Run:  python -m unittest discover -s tests -v   (from ai-village/)

Each test opens its own temporary store, so nothing real is touched, and Claude Code is replaced by a recorder.
"""
import http.client, json, pathlib, sys, tempfile, threading, time, types, unittest
from http.server import ThreadingHTTPServer

HELPER = pathlib.Path(__file__).resolve().parent.parent / "helper"
sys.path.insert(0, str(HELPER))
import privacy, core, brain, charter  # noqa: E402

O = charter.ORDER
COS, OPS, BIZ, FIN, TECH = O[0], O[1], O[4], O[5], O[6]
PA = next(k for k, v in privacy.HOME.items() if v == "personal")
BUSINESSES = [s for s in privacy.ORG if s.startswith("business:")]
QUIET = "the thing we talked about on Friday, at the usual place"  # no personal keywords at all


class Fake:
    def __init__(self, result="DONE\nok", error=False):
        self.calls, self.result, self.error = [], result, error

    def __call__(self, args, input=None, **kw):
        prompt = pathlib.Path(args[args.index("--system-prompt-file") + 1]).read_text(encoding="utf-8") if "--system-prompt-file" in args else ""
        self.calls.append(prompt + "\n" + (input or ""))
        res = {"type": "result", "result": self.result, "usage": {"input_tokens": 10, "output_tokens": 5}, "is_error": self.error, "duration_ms": 5}
        init = {"type": "system", "subtype": "init", "apiKeySource": "none", "tools": [], "mcp_servers": [], "model": "claude-opus-test"}
        return types.SimpleNamespace(stdout=json.dumps(init) + "\n" + json.dumps(res), stderr="", returncode=0)


class CoreBase(unittest.TestCase):
    heads = [{"key": "head-test1", "name": "Testa", "buildingName": "Software Studio", "crew": [OPS, TECH]}]

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        core.open_db(pathlib.Path(self.tmp.name) / "kingdom.db")
        core.seed(charter, self.heads, [])
        self.fake = Fake()
        self.saved = {k: getattr(brain, k) for k in ("access_for", "uses_library", "my_tools", "connections", "USAGE_LOG", "RUN_DIR", "LESSONS", "refresh_team")}
        self._run = brain.subprocess.run
        brain.subprocess.run = self.fake
        brain.access_for = lambda key, room="": ((), (), ())
        brain.uses_library = lambda key, room: False
        brain.my_tools = lambda key, room: {}
        brain.connections = lambda key=None, room="": []
        brain.USAGE_LOG = pathlib.Path(self.tmp.name) / "usage.jsonl"
        brain.RUN_DIR = pathlib.Path(self.tmp.name)
        brain.LESSONS = pathlib.Path(self.tmp.name) / "LESSONS.md"
        brain.refresh_team = lambda: None  # keep the test's own organisations

    def tearDown(self):
        brain.subprocess.run = self._run
        for k, v in self.saved.items():
            setattr(brain, k, v)
        core._DB.close(); core._DB = None
        self.tmp.cleanup()


class Organisations(CoreBase):
    def test_memberships(self):
        self.assertEqual(core.orgs_of(PA), {"personal", "kingdom"})
        self.assertNotIn("personal", core.orgs_of(COS))
        for b in BUSINESSES:
            self.assertIn(b, core.orgs_of(BIZ))
            self.assertNotIn(b, core.orgs_of(OPS))
        if privacy.venture_of_building("Software Studio"):
            v = privacy.venture_of_building("Software Studio")
            self.assertIn(v, core.orgs_of("head-test1"))
            self.assertIn(v, core.orgs_of(OPS))  # crew

    def test_record_ownership_not_keywords_is_the_boundary(self):
        """A message in the personal assistant's chat is personal because of where it lives, even with no keywords."""
        core.put_messages(PA, [{"from": "you", "text": QUIET, "at": "2026-11-24T09:00:00"}])
        self.assertEqual(core.org_of_text(QUIET), "personal")
        self.assertEqual(privacy.classify(QUIET), set())  # the keyword check alone would have missed it
        self.assertNotIn(QUIET, core.digest_for(COS, day="2026-11-24"))
        self.assertNotIn(QUIET, brain.record_filter(OPS, "Chief: " + QUIET))
        self.assertIn(QUIET, brain.record_filter(PA, "Chief: " + QUIET))

    def test_quoted_private_message_cant_reach_another_agent_in_a_task(self):
        core.put_messages(PA, [{"from": "you", "text": QUIET, "at": "2026-11-24T09:00:00"}])
        brain.reply(OPS, [], "task", "", {"text": "Plan next week", "context": "Chief: " + QUIET + "\nChief: plan next week"})
        self.assertNotIn(QUIET, self.fake.calls[-1])
        self.assertIn("plan next week", self.fake.calls[-1])

    def test_business_records_stay_with_their_members(self):
        if not BUSINESSES:
            self.skipTest("no businesses named in this edition")
        name = privacy.ORG[BUSINESSES[0]][0]
        line = f"the {name} retainer renews in March at the old rate"
        core.put_messages(BIZ, [{"from": "you", "text": line, "at": "2026-11-24T09:00:00"}])
        self.assertEqual(core.org_of_text(line), BUSINESSES[0])
        self.assertNotIn(line, brain.record_filter(OPS, "Chief: " + line))
        self.assertIn(line, brain.record_filter(BIZ, "Chief: " + line))

    def test_an_assigned_task_grants_access_to_its_own_organisation_only(self):
        if not BUSINESSES:
            self.skipTest("no businesses named in this edition")
        task = {"owner": TECH, "org": BUSINESSES[0]}
        self.assertTrue(core.may_read(TECH, BUSINESSES[0], task))
        self.assertFalse(core.may_read(TECH, "personal", task))
        if len(BUSINESSES) > 1:
            self.assertFalse(core.may_read(TECH, BUSINESSES[1], task))

    def test_chief_of_staff_digest_is_built_from_records(self):
        core.put_messages(OPS, [{"from": "you", "text": "move the review to Thursday", "at": core.now()}])
        core.put_messages(PA, [{"from": "you", "text": QUIET, "at": core.now()}])
        d = core.digest_for(COS, names=brain.NAMES)
        self.assertIn("move the review to Thursday", d)
        self.assertNotIn(QUIET, d)


class Controls(CoreBase):
    def test_emergency_stop_and_pauses_block_without_a_model_call(self):
        core.set_control("stop", True)
        with self.assertRaises(brain.Blocked):
            brain.reply(OPS, [{"from": "you", "text": "hello"}], "", "")
        core.set_control("stop", None)
        core.set_control(f"pause:agent:{OPS}", True)
        with self.assertRaises(brain.Blocked):
            brain.reply(OPS, [{"from": "you", "text": "hello"}], "", "")
        brain.reply(TECH, [{"from": "you", "text": "hello"}], "", "")  # others still run
        core.set_control(f"pause:agent:{OPS}", None)
        brain.reply(OPS, [{"from": "you", "text": "hello"}], "", "")
        self.assertEqual(len(self.fake.calls), 2)
        self.assertTrue(core.q("SELECT 1 FROM audit WHERE action='control' AND target='stop'"))

    def test_task_run_budget_stops_loops(self):
        core.put_tasks([{"id": "t1", "text": "Plan next week", "by": OPS, "status": "working"}])
        core.x("UPDATE tasks SET runs=? WHERE id='t1'", (brain.MAX_TASK_RUNS,))
        with self.assertRaises(brain.Blocked):
            brain.reply(OPS, [], "task", "", {"text": "Plan next week", "taskId": "t1"})
        self.assertEqual(self.fake.calls, [])

    def test_a_usage_limit_rests_the_provider(self):
        brain.subprocess.run = Fake(result="Claude usage limit reached. Resets 3pm.", error=True)
        with self.assertRaises(brain.Blocked):
            brain.reply(OPS, [{"from": "you", "text": "hello"}], "", "")
        self.assertIn("provider:claude:until", core.controls())
        brain.subprocess.run = self.fake
        with self.assertRaises(brain.Blocked):  # resting: no model call until the time passes
            brain.reply(TECH, [{"from": "you", "text": "hello"}], "", "")
        self.assertEqual(self.fake.calls, [])


class Records(CoreBase):
    def test_runs_are_attributed_to_agent_task_and_organisation_with_instruction_version(self):
        core.put_tasks([{"id": "t2", "text": "Plan next week", "by": OPS, "status": "working"}])
        brain.reply(OPS, [], "task", "", {"text": "Plan next week", "taskId": "t2"})
        r = core.q("SELECT agent, task_id, org, kind, instr, output FROM runs")[0]
        self.assertEqual((r["agent"], r["task_id"], r["org"], r["kind"]), (OPS, "t2", "kingdom", "subscription"))
        self.assertTrue(r["instr"])
        self.assertEqual(core.get_task("t2")["runs"], 1)
        self.assertEqual(core.usage("task")[0]["k"], "t2")

    def test_lessons_have_provenance_and_only_the_chief_changes_status(self):
        brain.keep_learned(OPS, "DONE\nLESSON: Deliver the plan from what you can reach and name the gap.", "task", task={"org": "kingdom"}, task_id="t3")
        row = core.q("SELECT agent, org, status, task_id, source FROM lessons")[0]
        self.assertEqual((row["agent"], row["org"], row["status"], row["task_id"], row["source"]), (OPS, "kingdom", "provisional", "t3", "task"))
        with self.assertRaises(PermissionError):
            core.set_lesson_status(1, "verified", OPS)
        core.set_lesson_status(1, "verified", "chief")
        self.assertEqual(core.q("SELECT status, version FROM lessons")[0]["version"], 2)

    def test_import_is_idempotent_and_removals_are_audited(self):
        items = {"kingdom-one-chats": {OPS: [{"from": "you", "text": "hello", "at": "2026-11-24T09:00:00"}], PA: [{"from": "you", "text": QUIET, "at": "2026-11-24T09:01:00"}]},
                 "kingdom-one-todo": [{"id": "a", "text": "one", "by": OPS, "status": "waiting"}, {"id": "b", "text": "two", "by": PA, "status": "waiting"}],
                 "kingdom-one-quests": {"keeper": "done"}, "kingdom-one-sound": "on"}
        brain.core_write(items); brain.core_write(items)
        c = core.counts()
        self.assertEqual((c["messages"], c["tasks"], c["docs"]), (2, 2, 1))  # the sound setting stays in the browser
        self.assertEqual(core.get_task("b")["org"], "personal")
        brain.core_write({"kingdom-one-todo": [items["kingdom-one-todo"][0]]})
        self.assertIsNone(core.get_task("b"))
        self.assertTrue(core.q("SELECT 1 FROM audit WHERE action='task removed' AND target='b'"))
        st = brain.core_state()["state"]
        self.assertEqual(len(st["kingdom-one-todo"]), 1)
        self.assertEqual(st["kingdom-one-chats"][PA][0]["text"], QUIET)  # the Chief's own view has everything


class Authentication(unittest.TestCase):
    def test_requests_without_the_token_are_refused(self):
        srv = ThreadingHTTPServer(("127.0.0.1", 0), brain.Handler)
        port = srv.server_address[1]
        saved = set(brain.HOSTS)
        brain.HOSTS.add(f"127.0.0.1:{port}")
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            def get(path, token=None):
                c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
                c.request("GET", path, headers={"X-Kingdom-Token": token} if token else {})
                return c.getresponse().status
            self.assertEqual(get("/privacy"), 401)
            self.assertEqual(get("/privacy", "0" * 64), 401)
            self.assertEqual(get("/privacy", brain.TOKEN), 200)
        finally:
            srv.shutdown(); brain.HOSTS.clear(); brain.HOSTS.update(saved)


if __name__ == "__main__":
    unittest.main(verbosity=2)
