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
                          capture_output=True, text=True, check=True).stdout.strip().partition(chr(10))[0]


ME = call('GET', '/me')['id']  # creates the (auth-disabled) dev user, who records the demos
people = {'maya': 'Maya Chen', 'leo': 'Leo Martins', 'nina': 'Nina Kowalski', 'omar': 'Omar Haddad'}
for u, name in people.items():
    psql(f"INSERT INTO users (keycloak_sub, username, email, display_name) VALUES ('demo-{u}', '{u}', '{u}@example.com', '{name}') ON CONFLICT DO NOTHING")
U = {u: psql(f"SELECT id FROM users WHERE username = '{u}'") for u in people}
U['me'] = ME

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
task(title='Rotate TLS certificates', type='hourly', start_at=t('10-01', '14:00'), end_at=t('10-01', '15:00'))  # nobody yet: the Unassigned row

# --- The demo user's own week (Weekly Commitment; a daily task of up to 7 days is committed automatically) ---
task(title='Review checkout analytics', type='daily', status='in_progress', assignees=['me'], start_at=d('09-29'), end_at=d('10-01'))
notes = task(title='Write release notes for v2.0', type='daily', assignees=['me'], start_at=d('10-01'), end_at=d('10-02'))['id']
task(title='Prepare Q4 roadmap', type='daily', assignees=['me', 'maya'], start_at=d('09-28'), end_at=d('10-09'))
task(title='Interview backend candidates', type='daily', assignees=['me'])
sync = task(title='Stakeholder sync', type='hourly', assignees=['me', 'maya'], start_at=t('09-30', '10:45'), end_at=t('09-30', '11:15'))['id']

# --- Runbook for the production release ---
before = call('POST', f'/tasks/{release}/runbook/sections', {'name': 'Before the window'})['id']
during = call('POST', f'/tasks/{release}/runbook/sections', {'name': 'During the window'})['id']
call('POST', f'/runbook/sections/{before}/steps', {'title': 'Prepare the rollback plan', 'task': {'day': '2026-10-07', 'end_day': '2026-10-08', 'tz': 'Asia/Jakarta'}})
call('POST', f'/runbook/sections/{before}/steps', {'title': 'Freeze merges to main', 'start_at': t('10-09', '19:00'), 'duration_minutes': 15})
call('POST', f'/runbook/sections/{before}/steps', {'title': 'Announce the window in #releases', 'start_at': t('10-09', '19:30'), 'duration_minutes': 10})
call('POST', f'/runbook/sections/{during}/steps', {'title': 'Deploy v2.0.0 to Production', 'start_at': t('10-09', '20:00'), 'duration_minutes': 45})
call('POST', f'/runbook/sections/{during}/steps', {'title': 'Run the smoke tests', 'start_at': t('10-09', '20:45'), 'duration_minutes': 30})
call('POST', f'/runbook/sections/{during}/steps', {'title': 'Watch error rates and latency', 'start_at': t('10-09', '21:15'), 'duration_minutes': 60})

# --- Comments from teammates, and the demo user's notifications (as of 2026-09-30 10:30) ---
def comment_as(user, task_id, body, at):
    body = body.replace("'", "''")
    return psql(f"INSERT INTO task_comments (task_id, author_id, body, created_at, updated_at) VALUES ('{task_id}', '{U[user]}', '{body}', '{at}', '{at}') RETURNING id")


def notify(typ, task_id, actor, at, data='{}'):
    actor = f"'{U[actor]}'" if actor else 'NULL'
    psql(f"INSERT INTO notifications (user_id, type, task_id, actor_id, data, created_at, updated_at) VALUES ('{ME}', '{typ}', '{task_id}', {actor}, '{data}', '{at}', '{at}')")


c = comment_as('leo', release, '@dev can you double-check the rollback steps in the runbook before Friday?', '2026-09-30T10:12:00+07:00')
notify('hourly_soon', sync, None, '2026-09-30T10:30:00+07:00', '{"start_at": "2026-09-30T10:45:00+07:00"}')
notify('mention', release, 'leo', '2026-09-30T10:12:00+07:00', '{"excerpt": "@dev can you double-check the rollback steps in the runbook before Friday?", "comment_id": "%s"}' % c)
notify('assigned', notes, 'maya', '2026-09-30T09:40:00+07:00')
comment_as('nina', e2e, 'Both flaky checkout tests are fixed, the suite is green again.', '2026-09-30T08:55:00+07:00')
notify('comment', e2e, 'nina', '2026-09-30T08:55:00+07:00', '{"changes": [{"kind": "comment", "excerpt": "Both flaky checkout tests are fixed, the suite is green again."}]}')
notify('unblocked', fix, 'leo', '2026-09-29T16:20:00+07:00', '{"blocker": {"key": "%s", "title": "Reproduce payment timeout bug"}}' % call('GET', f'/tasks/{repro}')['key'])

# Look as if the work was planned over the past weeks, not created today.
psql("""UPDATE tasks SET created_at = LEAST(COALESCE(start_at, '2026-09-28 09:00+07') - interval '4 days', '2026-09-29 15:00+07')
        + (random() * interval '8 hours'), updated_at = created_at""")
psql("UPDATE task_comments SET created_at = '2026-09-29 14:20+07', updated_at = '2026-09-29 14:20+07' WHERE created_at > '2026-10-01'")
for table in ['users', 'workspaces', 'task_dependencies', 'project_environments', 'project_categories', 'runbook_sections', 'runbook_steps']:
    psql(f"UPDATE {table} SET created_at = '2026-08-28 09:00+07' WHERE created_at > '2026-10-01'")

print(W)
