"""Freeze an offline design bundle. No network, credentials, services or Agent runs."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

from preflight import prepare
from workbook_oracle import compare_workbooks

HERE = Path(__file__).resolve().parent
ARCHIVE = Path('/Users/lsmax/Coder/phase6-artifacts/outputs/business-preflight-uo9rAx68/verified-proxy.tar.gz')
SOURCE = Path('/Users/lsmax/Coder/phase6-artifacts/outputs/business-xlsx-memory-20260831-r4')
OLD_TASKS = {'141-20', '343-20', '379-36', '23-24', '477-45', '91-34'}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, data):
    with path.open('x') as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    path.chmod(0o600)


def file_hashes(root):
    return {str(p.relative_to(root)): digest(p) for p in sorted(root.rglob('*'))
            if p.is_file() and p.name != 'offline-freeze.json'}


def validate(root):
    frozen = json.loads((root / 'offline-freeze.json').read_text())
    if file_hashes(root) != frozen['files']:
        raise ValueError('OFFLINE_FREEZE_MISMATCH')
    return frozen


def validate_design(protocol):
    diagnostic, confirmation = protocol['diagnostic_tasks'], protocol['confirmation_tasks']
    selected = diagnostic + confirmation
    if len(selected) != len(set(selected)) or OLD_TASKS.intersection(selected):
        raise ValueError('TASK_ROLE_OVERLAP')
    for tasks, name in ((diagnostic, 'diagnostic'), (confirmation, 'confirmation')):
        expected = {f'{task}:{arm}' for task in tasks for arm in protocol['arms']}
        order = protocol[name + '_order']
        if len(order) != len(set(order)) or set(order) != expected:
            raise ValueError('INCOMPLETE_ARM_ORDER')
    if protocol['max_model_calls'] != 8 or protocol['timeout_seconds'] != 300:
        raise ValueError('UNEXPECTED_BUDGET_CHANGE')


def build(root):
    protocol = json.loads((HERE / 'protocol-scope-policy-v1.json').read_text())
    validate_design(protocol)
    if digest(SOURCE / 'memory-snapshot.json') != protocol['source_memory']['sha256']:
        raise ValueError('SOURCE_MEMORY_CHANGED')
    root.mkdir(mode=0o700)  # Never overwrite an existing design or failed admission.
    (root / 'runtime').mkdir(mode=0o700)
    (root / 'prepared').mkdir(mode=0o700)
    for name in ('protocol-scope-policy-v1.json', 'memory-context-policy.mjs',
                 'preview_memory_policy.mjs', 'prepare_scope_study.py', 'preflight.py', 'workbook_oracle.py'):
        shutil.copyfile(HERE / name, root / 'runtime' / name)
    shutil.copyfile(SOURCE / 'memory-snapshot.json', root / 'memory-snapshot.json')
    events = [json.loads(line) for line in (SOURCE / 'proxy-events.jsonl').read_text().splitlines()]
    recalls = [event for event in events if event['kind'] == 'recall']
    if not recalls or any(r['items'] != recalls[0]['items'] for r in recalls):
        raise ValueError('SOURCE_RECALL_NOT_STABLE')
    save(root / 'recall-selection.json', {'items': recalls[0]['items'], 'request': recalls[0]['request'],
         'origin': 'immutable r4 observed fixed-query recall; no current task/answer used',
         'future_admission': 'real recall must match these record IDs/order/content/background before rendering'})
    admissions = []
    for task_id in protocol['diagnostic_tasks'] + protocol['confirmation_tasks']:
        target = root / 'prepared' / task_id
        role = 'reserved_policy_confirmation' if task_id in protocol['confirmation_tasks'] else 'policy_diagnostic'
        manifest = prepare(ARCHIVE, target, task_id, data_role=role)
        inputs = [f for f in manifest['files'] if f['role'] == 'input']
        references = [f for f in manifest['files'] if f['role'] == 'reference']
        if len(inputs) != 1 or len(references) != 1 or any(f['inspection']['requires_recalculation'] for f in manifest['files']):
            raise ValueError('UNSUPPORTED_FIXTURE: ' + task_id)
        reference, original = target / references[0]['path'], target / inputs[0]['path']
        area = manifest['task']['answer_position']
        positive = compare_workbooks(reference, reference, area)
        negative = compare_workbooks(reference, original, area)
        if positive['status'] != 'TASK_PASS' or negative['status'] != 'TASK_FAIL':
            raise ValueError('ORACLE_ADMISSION_FAILED: ' + task_id)
        admissions.append({'task_id': task_id, 'role': role,
                           'oracle_identity_control': positive['status'], 'unchanged_input_control': negative['status'],
                           'target_cells': positive['checked_cells'], 'formula_free': True})
    save(root / 'offline-admission.json', {'status': 'PASS', 'model_calls': 0, 'tasks': admissions,
         'warning': 'Controls validate wiring, not Agent performance. Original embedded examples remain unchanged.'})
    subprocess.run(['node', str(root / 'runtime/preview_memory_policy.mjs'), str(root)], check=True)
    files = file_hashes(root)
    frozen = {'status': 'DESIGN_FROZEN_NOT_EXECUTED', 'model_calls': 0, 'files': files,
              'bundle_hash': hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest(),
              'runtime_admission': 'NOT_YET_MATERIALIZED; identities, actual runtime and services must be admitted before real calls',
              'network_checks': 'NOT_PERFORMED_BY_USER_REQUEST', 'historical_r4_unchanged': True}
    save(root / 'offline-freeze.json', frozen)
    validate(root)
    return frozen


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('stage', choices=['build', 'validate'])
    parser.add_argument('root', type=Path)
    args = parser.parse_args()
    result = build(args.root.resolve()) if args.stage == 'build' else validate(args.root.resolve())
    print(json.dumps({k: v for k, v in result.items() if k != 'files'}, indent=2))
