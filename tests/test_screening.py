import json
import os
import sqlite3
import tempfile
import threading
import time
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import httpx
from app import analysis, checks, config, db, deepseek, keychain, review, settings_store
from app.screening_pool import ScreeningKeyPool


def evidence(**overrides):
    return dict(result="suspect", reason="主要人物双眼清楚可见且意外闭合", region="中",
                severity="severe", confidence="high", subject="main", **overrides) if not overrides else {
                    **evidence(), **overrides}


class ClassificationTests(unittest.TestCase):
    def classify(self, item, key="closed_eye", mode="strict"):
        parsed = checks.parse_response(json.dumps({"checks": {key: item}}), [key])
        return checks.suggestion(parsed, {key: mode})[0]

    def test_clear_severe_primary_defect(self):
        self.assertEqual(self.classify(evidence()), "reject")

    def test_uncertainty_never_rejects(self):
        for update in ({"confidence": "low"},
                       {"subject": "unknown"}, {"reason": ""},
                       {"result": "uncertain"}, {"confidence": []}, {"reason": {}}, {"result": []}):
            with self.subTest(update=update):
                self.assertEqual(self.classify(evidence(**update)), "uncertain")

    def test_reminder_obeys_user_rule_but_strict_is_decisive(self):
        self.assertEqual(self.classify(evidence(), mode="remind"), "keep")
        self.assertEqual(self.classify(evidence(), key="composition", mode="remind"), "keep")
        self.assertEqual(self.classify(evidence(), key="composition"), "reject")
        self.assertEqual(self.classify(evidence(confidence="medium")), "reject")

    def test_usable_photos_are_not_sent_for_review(self):
        self.assertEqual(self.classify(evidence(severity="minor")), "keep")
        self.assertEqual(self.classify(evidence(subject="peripheral")), "keep")
        self.assertEqual(self.classify(evidence(result="ok", severity="none", confidence="low",
                                              applicability="not_applicable", reason="远景小脸，本项不适用")), "keep")
        # A non-applicable label cannot excuse a contradictory, real severe defect.
        self.assertEqual(self.classify(evidence(applicability="not_applicable")), "reject")

    def test_warning_does_not_override_clear_good_or_bad(self):
        parsed = {"composition": evidence(severity="minor"), "focus": evidence(result="ok", severity="none")}
        modes = {"composition":"remind", "focus":"strict"}
        self.assertEqual(checks.suggestion(parsed,modes)[0], "keep")
        parsed['focus'] = evidence(confidence="medium")
        self.assertEqual(checks.suggestion(parsed,modes)[0], "reject")

    def test_missing_legacy_and_inconsistent_are_pending(self):
        self.assertEqual(self.classify({"result": "suspect", "reason": "闭眼"}), "uncertain")
        self.assertEqual(self.classify(evidence(result="ok")), "uncertain")
        for raw in ({}, {"closed_eye": None}, {"closed_eye": "ok"}):
            parsed = checks.parse_response(json.dumps({"checks": raw}), ["closed_eye"])
            self.assertEqual(checks.suggestion(parsed, {"closed_eye": "strict"})[0], "uncertain")
        self.assertEqual(checks.suggestion({}, {"focus": "strict"})[0], "uncertain")
        self.assertEqual(checks.suggestion({}, {})[0], "uncertain")

    def test_skipped_items_do_not_affect_keep(self):
        parsed = {"focus": evidence(result="ok", severity="none"), "composition": evidence()}
        self.assertEqual(checks.suggestion(parsed, {"focus": "strict", "composition": "skip"}), ("keep", []))


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"LOCALAPPDATA": self.temp.name})
        self.env.start()
        db.init_db()
        with db.db() as conn:
            conn.execute("INSERT INTO activities(id,name,created_at,updated_at) VALUES ('a','Test','now','now')")
            conn.execute("INSERT INTO sources(id,activity_id,root_path,label,added_at) VALUES ('s','a',?,'Test','now')", (self.temp.name,))
            conn.execute("INSERT INTO photos(id,activity_id,source_id,rel_path,file_name,ext,form,created_at) VALUES ('p','a','s','p.jpg','p.jpg','jpg','jpeg','now')")

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def test_evidence_roundtrip_preserves_manual_decision(self):
        with db.db() as conn:
            conn.execute("INSERT INTO decisions(photo_id,activity_id,verdict,updated_at) VALUES ('p','a','keep','now')")
        analysis._save_success('p', {"closed_eye": evidence()}, {"closed_eye": "strict"}, settings_store.DEFAULTS)
        analysis._save_success('p', {"closed_eye": evidence(confidence="low")}, {"closed_eye": "strict"}, settings_store.DEFAULTS)
        self.assertEqual(review._checks('p')['closed_eye']['evidence']['confidence'], 'low')
        with db.db() as conn:
            self.assertEqual(conn.execute("SELECT verdict FROM decisions WHERE photo_id='p'").fetchone()[0], 'keep')
            self.assertEqual(conn.execute("SELECT ai_suggestion FROM photos WHERE id='p'").fetchone()[0], 'uncertain')

    def test_additive_migration_old_checks_survive(self):
        with db.db() as conn:
            conn.execute("ALTER TABLE checks DROP COLUMN evidence_json")
            conn.execute("INSERT INTO checks(photo_id,check_type,result) VALUES ('p','focus','ok')")
        db.init_db()
        self.assertEqual(review._checks('p')['focus']['result'], 'ok')
        self.assertEqual(review._checks('p')['focus']['evidence'], {})

    def test_keys_encrypted_masked_deduplicated_and_separate(self):
        main, extra = 'sk-test-main-not-real', 'sk-test-extra-not-real'
        keychain.save_api_key(main)
        keychain.add_screening_key(extra)
        self.assertEqual(keychain.screening_credentials(), [main, extra])
        self.assertNotIn(extra.encode(), Path(keychain._pool_path()).read_bytes())
        public = settings_store.public_settings()
        self.assertNotIn(extra, json.dumps(public))
        self.assertNotIn(main, json.dumps(public))
        with self.assertRaises(ValueError): keychain.add_screening_key(main)
        with self.assertRaises(ValueError): keychain.add_screening_key(extra)
        keychain.remove_screening_key(public['screening_keys'][0]['id'])
        self.assertEqual(keychain.load_api_key(), main)
        self.assertEqual(keychain.load_screening_keys(), [])

    def test_damaged_pool_does_not_get_overwritten(self):
        Path(keychain._pool_path()).write_bytes(b'corrupt')
        with self.assertRaises(ValueError): keychain.add_screening_key('sk-test-not-real-123')
        self.assertEqual(Path(keychain._pool_path()).read_bytes(), b'corrupt')

    def test_invalid_key_failover_redacts_errors(self):
        pool = ScreeningKeyPool(['first-secret', 'second-secret'])
        path = Path(config.ai_path('a', 'p')); path.write_bytes(b'placeholder')
        calls = []
        def analyze(*args, **kwargs):
            calls.append(kwargs['api_key'])
            if len(calls) == 1:
                raise deepseek.DeepSeekError('bad first-secret', status_code=401)
            return {'focus': evidence(result='ok', severity='none')}, {}
        with patch.object(deepseek, 'analyze_image', side_effect=analyze):
            result = analysis._analyze_photo('p','a',None,['focus'],{'focus':'strict'},'',settings_store.DEFAULTS,'', key_pool=pool)
        self.assertTrue(result['ok'])
        self.assertEqual(calls, ['first-secret','second-secret'])
        with db.db() as conn:
            errors = [row[0] for row in conn.execute('SELECT error FROM ai_requests')]
        self.assertNotIn('first-secret', str(errors))


class SchedulingTests(unittest.TestCase):
    def test_trial_can_fit_budget_when_whole_library_cannot(self):
        with patch.object(analysis, '_activity', return_value={'rule_json':'{}','kind':'custom','budget_limit_cny':50}), \
             patch.object(analysis, '_pending_rows', return_value=[{'ai_quick_json':None,'ai_quick_signature':None} for _ in range(100)]), \
             patch.object(analysis, 'used_cost', return_value=5), \
             patch.object(checks, 'per_photo_cost', return_value=1), \
             patch.object(settings_store, 'load_settings', return_value=settings_store.DEFAULTS), \
             patch.object(keychain, 'screening_credentials', return_value=['test']):
            result=analysis.estimate('a')
        self.assertFalse(result['can_afford'])
        self.assertTrue(result['can_afford_trial'])

    def run_job(self, worker, budget=None, pause_after_first=False):
        state = {'status': 'queued'}
        saves, progress = [], []
        def update(_id, **fields):
            state.update(fields)
            if 'done_count' in fields:
                progress.append(fields['done_count'])
                if pause_after_first and state['done_count'] == 1: state['status'] = 'pausing'
        with ExitStack() as stack:
            for obj, name, replacement in [
                (analysis, '_set_job', update), (analysis, '_job_row', lambda _: dict(state)),
                (analysis, '_activity', lambda _: {'budget_limit_cny':budget}),
                (analysis, 'used_cost', lambda _: len(saves)),
                (analysis, '_save_success', lambda photo,*_: saves.append(photo)),
                (analysis, '_analyze_photo', worker), (db, 'log_event', lambda *_:None),
                (keychain, 'screening_credentials', lambda:['test-key']),
                (settings_store, 'load_settings', lambda:{**settings_store.DEFAULTS, 'screening_concurrency':2}),
                (checks, 'per_photo_cost', lambda _:1),
            ]: stack.enter_context(patch.object(obj,name,replacement))
            analysis._run_analysis('j','a',list('abcd'),['focus'],{'focus':'strict'},'')
        return state, saves, progress

    def test_fast_worker_refills_before_slow_photo_finishes(self):
        slow_done = threading.Event()
        starts = {}
        def worker(photo, *args, **kwargs):
            starts[photo] = slow_done.is_set()
            time.sleep(.18 if photo == 'a' else .015)
            if photo == 'a': slow_done.set()
            return {'ok':True, 'parsed':{}}
        state, saves, progress = self.run_job(worker)
        self.assertFalse(starts['c'])
        self.assertEqual(saves[0], 'b')
        self.assertEqual(state['status'], 'done')
        self.assertIn(1, progress)
        self.assertEqual(set(saves), set('abcd'))

    def test_budget_reserves_inflight_requests(self):
        state, saves, _ = self.run_job(lambda *a,**k:{'ok':True,'parsed':{}}, budget=2)
        self.assertEqual(len(saves),2)
        self.assertEqual(state['status'],'paused')

    def test_pause_drains_only_inflight_work(self):
        def worker(*a,**k):
            time.sleep(.015)
            return {'ok':True,'parsed':{}}
        state, saves, _ = self.run_job(worker, pause_after_first=True)
        self.assertEqual(len(saves),2)
        self.assertEqual(state['status'],'paused')

    def test_pool_rotation_limits_and_cooldown(self):
        pool = ScreeningKeyPool(['one','two','one'])
        first = pool.acquire(); second = pool.acquire()
        self.assertNotEqual(first[0],second[0])
        pool.release(first[0],429); pool.release(second[0])
        index, _ = pool.acquire()
        self.assertEqual(index,second[0])
        pool.release(index,401)
        with patch('app.screening_pool.time.monotonic',return_value=time.monotonic()+20):
            index,_ = pool.acquire(); pool.release(index,401)
        with self.assertRaises(ValueError): pool.acquire()

    def test_shared_http_client_contract(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'preview.jpg'; path.write_bytes(b'test')
            def respond(request):
                data = json.loads(request.content)
                self.assertEqual(request.headers['authorization'], 'Bearer test-key')
                self.assertIn('confidence', data['messages'][1]['content'][0]['text'])
                return httpx.Response(200, json={'choices':[{'message':{'content':json.dumps({'checks':{'focus':evidence(result='ok',severity='none')}})},'finish_reason':'stop'}], 'usage':{'prompt_tokens':10,'completion_tokens':5}})
            with httpx.Client(transport=httpx.MockTransport(respond)) as client:
                parsed, usage = deepseek.analyze_image(str(path),['focus'],{'focus':'strict'},api_key='test-key',model='test',base_url='https://example.test',client=client)
                self.assertFalse(client.is_closed)
                self.assertEqual(parsed['focus']['result'],'ok')
                self.assertEqual(usage['completion_tokens'],5)


if __name__ == '__main__': unittest.main()
