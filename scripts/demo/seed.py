"""Seed the isolated demo instance (http://localhost:8095) used for README media.

The story: a product team building and releasing an application.
"""
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
    return subprocess.run(['docker', 'exec', 'lajurops-demo-db', 'psql', '-U', 'planner', '-d', 'planner', '-tAc', sql],
                          capture_output=True, text=True, check=True).stdout.strip()


call('GET', '/me')  # creates the (auth-disabled) dev user
people = {'maya': 'Maya Chen', 'leo': 'Leo Martins', 'nina': 'Nina Kowalski', 'omar': 'Omar Haddad'}
for u, name in people.items():
    psql(f"INSERT INTO users (keycloak_sub, username, email, display_name) VALUES ('demo-{u}', '{u}', '{u}@example.com', '{name}') ON CONFLICT DO NOTHING")
U = {u: psql(f"SELECT id FROM users WHERE username = '{u}'") for u in people}

ws = call('POST', '/workspaces', {'key': 'APP', 'name': 'Product Engineering', 'description': 'Web and mobile product development'})
call('POST', '/workspaces', {'key': 'GROW', 'name': 'Growth Experiments'})
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
    colors = {'Dev': 'green', 'QA': 'blue', 'Staging': 'amber', 'Production': 'red'}
    return {e['name']: e['id'] for e in call('PUT', f'/tasks/{project}/environments', [{'name': n, 'color': colors[n]} for n in names])}


def dep(task_id, waits_for):
    call('POST', f'/tasks/{task_id}/dependencies', {'depends_on_id': waits_for})


def comment(task_id, body):
    call('POST', f'/tasks/{task_id}/comments', {'body': body})


# --- Customer Portal v2 (long, KPI) ---
p1 = task(title='Customer Portal v2', type='project', project_kind='long', project_category_id=cats['KPI Project'],
          assignees=['maya', 'leo'], priority='high', start_at=d('09-01'), end_at=d('12-18'),
          description='Rebuild the customer portal: new sign-up, orders and self-service billing.')['id']
e1 = envs(p1, ['Dev', 'QA', 'Staging', 'Production'])
task(parent_id=p1, title='Design new sign-up flow', type='daily', status='done', environment_id=e1['Dev'], assignees=['nina'], start_at=d('09-22'), end_at=d('09-25'))
task(parent_id=p1, title='Build orders REST API', type='daily', status='done', environment_id=e1['Dev'], assignees=['leo'], start_at=d('09-23'), end_at=d('09-26'))
e2e = task(parent_id=p1, title='Write end-to-end tests', type='daily', status='in_progress', environment_id=e1['QA'], assignees=['nina'], start_at=d('09-28'), end_at=d('10-03'))['id']
stg = task(parent_id=p1, title='Set up staging environment', type='daily', status='in_progress', environment_id=e1['Staging'], assignees=['omar'], start_at=d('09-29'), end_at=d('10-01'))['id']
rc = task(parent_id=p1, title='Deploy release candidate to Staging', type='daily', environment_id=e1['Staging'], assignees=['omar'], start_at=d('10-01'), end_at=d('10-03'), priority='high')['id']
task(parent_id=rc, title='Run database migrations', type='hourly', environment_id=e1['Staging'], assignees=['omar'], start_at=t('10-02', '09:00'), end_at=t('10-02', '11:00'))
demo = task(parent_id=p1, title='Stakeholder demo on Staging', type='hourly', environment_id=e1['Staging'], assignees=['maya', 'leo'], start_at=t('10-03', '14:00'), end_at=t('10-03', '15:30'))['id']
release = task(parent_id=p1, title='Production release window', type='hourly', environment_id=e1['Production'], assignees=['maya', 'leo', 'omar'], priority='urgent', start_at=t('10-09', '20:00'), end_at=t('10-09', '23:00'))['id']
dep(rc, stg)
dep(demo, e2e)
dep(release, rc)
comment(release, '''### Release checklist

1. Announce the release window in `#releases` at **19:30**
2. Run `npm run release -- --tag v2.0.0`
3. Smoke tests:
   - [x] Sign-up and login
   - [ ] Place an order
   - [ ] Download an invoice

> Rollback: redeploy `v1.9.4` (about 5 minutes)''')
comment(e2e, 'Two flaky tests in the **checkout** suite, fixing them in [PR #214](https://example.com). Should be green by Thursday.')

# --- Mobile App Launch (short, Enhancement) ---
p2 = task(title='Mobile App Launch', type='project', project_kind='short', project_category_id=cats['Enhancement Project'],
          assignees=['nina'], start_at=d('09-21'), end_at=d('10-17'))['id']
e2 = envs(p2, ['Dev', 'QA', 'Production'])
task(parent_id=p2, title='Finalize onboarding screens', type='daily', status='done', environment_id=e2['Dev'], assignees=['nina'], start_at=d('09-21'), end_at=d('09-24'))
beta = task(parent_id=p2, title='Beta test with 50 users', type='daily', status='in_review', environment_id=e2['QA'], assignees=['nina', 'maya'], start_at=d('09-30'), end_at=d('10-03'))['id']
store = task(parent_id=p2, title='App Store submission', type='hourly', environment_id=e2['Production'], assignees=['nina'], start_at=t('10-05', '10:00'), end_at=t('10-05', '12:00'))['id']
dep(store, beta)

# --- Checkout Hotfix (short, Ad Hoc) ---
p3 = task(title='Checkout Hotfix', type='project', project_kind='short', project_category_id=cats['Ad Hoc Project'],
          assignees=['leo'], priority='urgent', start_at=d('09-29'), end_at=d('10-03'))['id']
repro = task(parent_id=p3, title='Reproduce payment timeout bug', type='daily', status='in_progress', assignees=['leo'], start_at=d('09-29'), end_at=d('10-01'))['id']
fix = task(parent_id=p3, title='Patch and add a regression test', type='daily', assignees=['leo'], start_at=d('10-01'), end_at=d('10-03'))['id']
dep(fix, repro)

# --- Independent work ---
task(title='On-call: login outage', type='hourly', status='done', assignees=['leo'], priority='urgent', start_at=t('09-29', '14:00'), end_at=t('09-29', '16:30'))
task(title='Pair programming session', type='hourly', status='in_progress', assignees=['nina', 'omar'], start_at=t('09-30', '19:00'), end_at=t('09-30', '21:00'))
task(title='Dependency upgrades', type='hourly', assignees=['omar'], start_at=t('10-01', '20:00'), end_at=t('10-01', '22:00'))
task(title='Update API documentation', type='daily', assignees=['omar'], start_at=d('10-01'), end_at=d('10-03'))
task(title='Sprint planning', type='hourly', status='done', assignees=['maya'], start_at=t('09-28', '10:00'), end_at=t('09-28', '12:00'))
task(title='Accessibility audit', type='daily', status='done', assignees=['maya'], start_at=d('09-28'), end_at=d('09-30'))

print(W)
