"""Seed the isolated demo instance (http://localhost:8095) used for README media."""
import json
import subprocess
import urllib.request

B = 'http://localhost:8095/api'


def call(method, path, body=None):
    req = urllib.request.Request(B + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or 'null')


def psql(sql):
    return subprocess.run(['docker', 'exec', 'opdemo-db', 'psql', '-U', 'planner', '-d', 'planner', '-tAc', sql],
                          capture_output=True, text=True, check=True).stdout.strip()


call('GET', '/me')  # creates the dev user
people = {
    'rina': 'Rina Wijaya', 'budi': 'Budi Santoso', 'sarah': 'Sarah Chen', 'arif': 'Arif Rahman',
}
for u, name in people.items():
    psql(f"INSERT INTO users (keycloak_sub, username, email, display_name) VALUES ('demo-{u}', '{u}', '{u}@example.com', '{name}') ON CONFLICT DO NOTHING")
U = {u: psql(f"SELECT id FROM users WHERE username = '{u}'") for u in people}

ws = call('POST', '/workspaces', {'key': 'OPS', 'name': 'Platform Operations', 'description': 'Infra, deployments and support'})
call('POST', '/workspaces', {'key': 'DATA', 'name': 'Data Platform'})
W = ws['id']
cats = {c['name']: c['id'] for c in call('GET', f'/workspaces/{W}/categories')}

TZ = '+07:00'


def d(day):  # date-based: local midnight
    return f'2026-{day}T00:00:00{TZ}'


def t(day, hm):
    return f'2026-{day}T{hm}:00{TZ}'


def task(**kw):
    kw.setdefault('workspace_id', W)
    if 'assignees' in kw:
        kw['assignee_ids'] = [U[a] for a in kw.pop('assignees')]
    return call('POST', '/tasks', kw)


def envs(project, names):
    colors = {'Dev': 'green', 'SIT': 'blue', 'UAT': 'amber', 'Pilot': 'violet', 'Production': 'red'}
    return {e['name']: e['id'] for e in call('PUT', f"/tasks/{project}/environments", [{'name': n, 'color': colors[n]} for n in names])}


def dep(task_id, waits_for):
    call('POST', f'/tasks/{task_id}/dependencies', {'depends_on_id': waits_for})


# --- Core Banking Upgrade (long, KPI) ---
p1 = task(title='Core Banking Upgrade v5', type='project', project_kind='long', project_category_id=cats['KPI Project'],
          assignees=['rina', 'budi'], priority='high', start_at=d('09-01'), end_at=d('12-20'),
          description='Upgrade the core banking platform to v5 across all environments.')['id']
e1 = envs(p1, ['Dev', 'SIT', 'UAT', 'Pilot', 'Production'])
task(parent_id=p1, title='Provision UAT servers', type='daily', status='done', environment_id=e1['UAT'], assignees=['arif'], start_at=d('09-22'), end_at=d('09-25'))
task(parent_id=p1, title='Request DB access for UAT', type='daily', status='done', environment_id=e1['UAT'], assignees=['rina'], start_at=d('09-23'), end_at=d('09-24'))
sit = task(parent_id=p1, title='SIT regression testing', type='daily', status='in_progress', environment_id=e1['SIT'], assignees=['sarah'], start_at=d('09-28'), end_at=d('10-03'))['id']
ips = task(parent_id=p1, title='Reserve production IPs', type='daily', status='in_progress', environment_id=e1['Production'], assignees=['arif'], start_at=d('09-29'), end_at=d('10-01'))['id']
vms = task(parent_id=p1, title='Create production VMs', type='daily', environment_id=e1['Production'], assignees=['arif'], start_at=d('10-01'), end_at=d('10-03'), priority='high')['id']
task(parent_id=vms, title='Install OS & hardening', type='hourly', environment_id=e1['Production'], assignees=['arif'], start_at=t('10-02', '09:00'), end_at=t('10-02', '12:00'))
pilot = task(parent_id=p1, title='Pilot branch deployment', type='hourly', environment_id=e1['Pilot'], assignees=['budi', 'rina'], start_at=t('10-03', '20:00'), end_at=t('10-03', '23:30'))['id']
golive = task(parent_id=p1, title='Production go-live window', type='hourly', environment_id=e1['Production'], assignees=['budi', 'rina', 'arif'], priority='urgent', start_at=t('10-10', '21:00'), end_at=t('10-11', '02:00'))['id']
dep(vms, ips)
dep(pilot, sit)
dep(golive, vms)
call('POST', f'/tasks/{golive}/comments', {'body': '''### Go-live runbook

1. Freeze changes at **20:30** and announce in `#ops-bridge`
2. Run `./deploy.sh --env prod --version 5.0.0`
3. Smoke tests:
   - [x] Login & balance inquiry
   - [ ] Transfers (intra-bank)
   - [ ] End-of-day batch

> Rollback: `helm rollback core-banking 41` (≈10 min)'''})
call('POST', f'/tasks/{sit}/comments', {'body': 'Found **2 blockers** in the payments module — tracked in [JIRA-4821](https://example.com). Retest scheduled for Thursday.'})

# --- Mobile App release (short, Enhancement) ---
p2 = task(title='Mobile App 3.2 Release', type='project', project_kind='short', project_category_id=cats['Enhancement Project'],
          assignees=['sarah'], start_at=d('09-21'), end_at=d('10-17'))['id']
e2 = envs(p2, ['Dev', 'UAT', 'Production'])
task(parent_id=p2, title='Feature freeze & build RC', type='daily', status='done', environment_id=e2['Dev'], assignees=['sarah'], start_at=d('09-21'), end_at=d('09-24'))
uat = task(parent_id=p2, title='UAT sign-off', type='daily', status='in_review', environment_id=e2['UAT'], assignees=['sarah', 'rina'], start_at=d('09-30'), end_at=d('10-03'))['id']
store = task(parent_id=p2, title='App store submission', type='hourly', environment_id=e2['Production'], assignees=['sarah'], start_at=t('10-05', '10:00'), end_at=t('10-05', '12:00'))['id']
dep(store, uat)

# --- Regulator audit (short, Ad Hoc) ---
p3 = task(title='Regulator Audit Request', type='project', project_kind='short', project_category_id=cats['Ad Hoc Project'],
          assignees=['budi'], priority='urgent', start_at=d('09-29'), end_at=d('10-10'))['id']
logs = task(parent_id=p3, title='Collect access logs', type='daily', status='in_progress', assignees=['budi'], start_at=d('09-29'), end_at=d('10-02'))['id']
pack = task(parent_id=p3, title='Prepare evidence pack', type='daily', assignees=['rina'], start_at=d('10-02'), end_at=d('10-07'))['id']
dep(pack, logs)

# --- Independent work ---
task(title='On-call: payment gateway incident', type='hourly', status='done', assignees=['budi'], priority='urgent', start_at=t('09-29', '14:00'), end_at=t('09-29', '17:30'))
task(title='DB failover drill', type='hourly', status='in_progress', assignees=['sarah', 'arif'], start_at=t('09-30', '19:00'), end_at=t('09-30', '21:00'))
task(title='Weekly patching window', type='hourly', assignees=['arif'], start_at=t('10-01', '22:00'), end_at=t('10-02', '01:00'))
task(title='Renew SSL certificates', type='daily', assignees=['arif'], start_at=d('10-01'), end_at=d('10-03'))
task(title='Support: branch printer rollout', type='hourly', status='done', assignees=['rina'], start_at=t('09-28', '09:00'), end_at=t('09-28', '15:00'))
task(title='Access request: new analyst', type='daily', status='done', assignees=['budi'], start_at=d('09-28'), end_at=d('09-29'))

print('workspace', W)
print('projects', p1, p2, p3)
