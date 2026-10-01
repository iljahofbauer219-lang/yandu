#!/usr/bin/env python3
"""通过 SSH 执行真实生产验收并保存脱敏 JSON；不转存账号、密码或令牌。"""
import argparse
import json
import pathlib
import shlex
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/erp-production'
parser = argparse.ArgumentParser()
parser.add_argument('mode', choices=['preflight', 'verify', 'cleanup'])
args = parser.parse_args()
script = ROOT / 'tools' / ('erp-production-preflight.mjs' if args.mode == 'preflight' else 'verify-erp-production.mjs')
command = 'docker exec -i -w /erp '
if args.mode == 'cleanup':
    previous = json.loads((OUT / 'verify.json').read_text())
    org_id = previous['isolation']['orgId']
    assert org_id.startswith('erp-deploy-')
    command += '-e ERP_CLEANUP_ORG_ID=' + shlex.quote(org_id) + ' '
command += 'yandu-app node --input-type=module - mode=' + args.mode
ssh = ['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', 'root@114.55.149.192', command]
result = subprocess.run(ssh, input=script.read_bytes(), stdout=subprocess.PIPE, timeout=900)
try:
    report = json.loads(result.stdout)
except Exception:
    print('未得到有效脱敏验收 JSON，未打印原始输出。')
    raise SystemExit(1)
if args.mode == 'preflight':
    template = '{{.Name}}|{{.State.Status}}|{{.RestartCount}}|{{.Config.Image}}|{{.Config.WorkingDir}}|{{.State.StartedAt}}'
    status = subprocess.run(ssh[:-1] + ['docker inspect --format ' + shlex.quote(template) + ' yandu-app yandu-db'], capture_output=True, text=True, timeout=30)
    report['containers'] = [dict(zip(['name', 'state', 'restartCount', 'image', 'workingDirectory', 'startedAt'], line.split('|'))) for line in status.stdout.strip().splitlines()] if status.returncode == 0 else []
    nginx = subprocess.run(ssh[:-1] + ['systemctl is-active nginx'], capture_output=True, text=True, timeout=30)
    report['nginx'] = {'active': nginx.returncode == 0 and nginx.stdout.strip() == 'active'}
OUT.mkdir(parents=True, exist_ok=True)
(OUT / (args.mode + '.json')).write_text(json.dumps(report, ensure_ascii=False, indent=2))
summary = {'mode': args.mode, 'exitCode': result.returncode, 'report': str(OUT / (args.mode + '.json'))}
if args.mode == 'preflight':
    summary['erpTables'] = len(report.get('erpTables', []))
    summary['aiCatalog'] = report.get('aiCatalog')
else:
    summary['summary'] = report.get('summary')
    summary['failedChecks'] = [row for row in report.get('checks', []) if row['status'] == 'FAIL']
print(json.dumps(summary, ensure_ascii=False, indent=2))
raise SystemExit(result.returncode)
