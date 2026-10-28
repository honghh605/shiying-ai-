import json
import os
import tempfile
import unittest
from unittest.mock import patch

from app import analysis, checks, db, review, settings_store, two_stage


class OnePassTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'LOCALAPPDATA': self.temp.name})
        self.env.start()
        db.init_db()
        self.modes = {'focus': 'strict', 'exposure': 'strict', 'composition': 'remind'}
        self.settings = {**settings_store.DEFAULTS, 'screening_concurrency': 1}
        with db.db() as c:
            c.execute(
                "INSERT INTO activities(id,name,rule_json,created_at,updated_at) VALUES ('a','Test',?,'now','now')",
                (json.dumps({'checks': {k: {'mode': v} for k, v in self.modes.items()}}),),
            )
            c.execute(
                "INSERT INTO sources(id,activity_id,root_path,label,added_at) VALUES ('s','a',?,'Test','now')",
                (self.temp.name,),
            )
            for pid in 'abc':
                c.execute(
                    "INSERT INTO photos(id,activity_id,source_id,rel_path,file_name,ext,form,preview_state,created_at) "
                    "VALUES (?,'a','s',?,?,'jpg','jpeg','ok','now')",
                    (pid, pid + '.jpg', pid + '.jpg'),
                )
                c.execute("INSERT INTO decisions(photo_id,activity_id,origin) VALUES (?,'a','unassigned')", (pid,))
        self.job('j')

    def job(self, name):
        with db.db() as c:
            c.execute(
                "INSERT INTO jobs(id,activity_id,kind,status,total,created_at,updated_at) "
                "VALUES (?,'a','analyze','queued',3,'now','now')",
                (name,),
            )

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def full(self, reject=False):
        return {
            'focus': {
                'result': 'suspect' if reject else 'ok',
                'reason': '主体明显重影' if reject else '主体清楚',
                'region': '中',
                'severity': 'severe' if reject else 'none',
                'confidence': 'high',
                'subject': 'main',
            }
        }

    def run_job(self, worker, name='j', ids=None, burst=None):
        if burst is None:
            burst = (set(), set(), set(), list(ids or 'abc'))
        with patch.object(settings_store, 'load_settings', return_value=self.settings), \
             patch('app.keychain.screening_credentials', return_value=['test-only']), \
             patch.object(two_stage, '_burst_plan', return_value=burst), \
             patch.object(analysis, '_analyze_photo', side_effect=worker):
            two_stage.run(name, 'a', ids or list('abc'), ['focus'], {'focus': 'strict'}, 'custom')
        return dict(analysis._job_row(name))

    def test_short_response_validation(self):
        for text in ['{}', 'null', '[]', '{"verdict":"keep"}', '{"verdict":"reject","issue":[]}', 'broken']:
            self.assertEqual(checks.parse_quick(text, ['focus'], self.modes)['verdict'], 'refine')

    def test_single_api_pass_checks_all_non_burst(self):
        calls = []

        def worker(pid, *args, quick=False, **kwargs):
            calls.append((pid, quick))
            return {'ok': True, 'parsed': self.full(pid == 'a')}

        result = self.run_job(worker)
        self.assertEqual(result['status'], 'done')
        self.assertEqual(sorted(calls), [('a', False), ('b', False), ('c', False)])
        payload = json.loads(result['result_json'])
        self.assertEqual(payload['refine_total'], 3)
        self.assertEqual(payload['refine_done'], 3)
        self.assertNotIn('quick_done', payload)

    def test_burst_duplicates_are_skipped_before_api(self):
        calls = []

        def worker(pid, *args, quick=False, **kwargs):
            calls.append(pid)
            return {'ok': True, 'parsed': self.full()}

        burst = ({'a', 'b'}, {'a'}, {'b'}, ['c'])
        result = self.run_job(worker, ids=list('abc'), burst=burst)
        self.assertEqual(result['status'], 'done')
        self.assertEqual(sorted(calls), ['a', 'c'])
        with db.db() as c:
            self.assertEqual(c.execute("SELECT ai_stage FROM photos WHERE id='b'").fetchone()[0], 'burst_duplicate')
            self.assertEqual(c.execute("SELECT verdict FROM decisions WHERE photo_id='b'").fetchone()[0], 'uncertain')

    def test_refine_failure_is_recorded_and_not_retried_as_quick(self):
        def worker(pid, *args, quick=False, **kwargs):
            if pid == 'b':
                return {'ok': False, 'error': 'local mock failure'}
            return {'ok': True, 'parsed': self.full()}

        result = self.run_job(worker)
        self.assertEqual(result['status'], 'done')
        self.assertEqual(result['failed_count'], 1)
        with db.db() as c:
            self.assertEqual(c.execute("SELECT ai_stage FROM photos WHERE id='b'").fetchone()[0], 'refine_failed')

    def test_resume_after_pause_uses_pending_photos(self):
        def worker(pid, *args, quick=False, **kwargs):
            analysis._set_job('j', status='pausing')
            return {'ok': True, 'parsed': self.full()}

        self.assertEqual(self.run_job(worker)['status'], 'paused')
        self.job('j2')
        calls = []

        def resumed(pid, *args, quick=False, **kwargs):
            calls.append(pid)
            return {'ok': True, 'parsed': self.full()}

        self.assertEqual(self.run_job(resumed, 'j2')['status'], 'done')
        self.assertEqual(sorted(calls), ['a', 'b', 'c'])

    def test_manual_decision_is_not_overwritten(self):
        review.set_decision('b', 'keep')
        with patch.object(two_stage, '_burst_plan', return_value=(set(), set(), set(), list('abc'))), \
             patch.object(settings_store, 'load_settings', return_value=self.settings), \
             patch('app.keychain.screening_credentials', return_value=['test-only']), \
             patch.object(analysis, '_analyze_photo', return_value={'ok': True, 'parsed': self.full(True)}):
            two_stage.run('j', 'a', list('abc'), ['focus'], {'focus': 'strict'}, 'custom')
        with db.db() as c:
            self.assertEqual(c.execute("SELECT verdict FROM decisions WHERE photo_id='b'").fetchone()[0], 'keep')

    def test_budget_pauses_before_overrun(self):
        calls = []

        def worker(pid, *args, quick=False, **kwargs):
            calls.append(pid)
            return {'ok': True, 'parsed': self.full()}

        with patch.object(analysis, 'used_cost', side_effect=lambda _: len(calls)), \
             patch.object(checks, 'per_photo_cost', return_value=1):
            with db.db() as c:
                c.execute("UPDATE activities SET budget_limit_cny=2 WHERE id='a'")
            result = self.run_job(worker)
        self.assertEqual(result['status'], 'paused')
        self.assertEqual(json.loads(result['result_json'])['reason'], 'budget')
        self.assertLessEqual(len(calls), 2)

    def test_estimated_cost_is_one_pass(self):
        rows = [{'id': 'a'}, {'id': 'b'}]
        cost = two_stage.estimated_cost(rows, ['focus'], {'focus': 'strict'}, 'custom', self.settings)
        self.assertAlmostEqual(cost, checks.per_photo_cost(self.settings) * 2)

    def test_restart_unlocks_interrupted_job(self):
        analysis._set_job('j', status='running')
        analysis.recover_interrupted()
        self.assertEqual(analysis._job_row('j')['status'], 'paused')


if __name__ == '__main__':
    unittest.main()
