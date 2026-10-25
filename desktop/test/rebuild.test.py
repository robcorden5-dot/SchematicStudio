"""The project index is only a cache: if files are added or removed outside the app, the list must follow the files."""
import json, os, subprocess, time, signal, sys
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8125
src = open(os.path.join(ROOT, 'test', 'shim.test.py')).read()
FAKE = src.split('FAKE_TAURI = r"""')[1].split('"""')[0]
def rec(i, name):
    return json.dumps({'format': 'ssproj', 'id': i, 'name': name, 'folder': '', 'status': 'draft', 'tags': [], 'isTemplate': False,
                       'updatedAt': '2026-01-0%d 10:00:00' % i, 'data': {'sheets': [{'pageType': 'schematic'}]}})
SEED = """
window.__fakeFs.set('/home/u/Documents/SchematicStudio/projects/7.ssproj', %s);
window.__fakeFs.set('/home/u/Documents/SchematicStudio/projects/9.ssproj', %s);
window.__fakeFs.set('/home/u/Documents/SchematicStudio/projects/index.json', %s);
""" % (json.dumps(rec(7, 'Seven')), json.dumps(rec(9, 'Nine')), json.dumps(json.dumps({'next': 9, 'projects': [{'id': 8, 'name': 'Ghost', 'updated_at': 'x', 'sheet_count': 1}]})))
srv = subprocess.Popen(['node', os.path.join(ROOT, 'scripts', 'serve.mjs'), str(PORT)], stdout=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox', '--disable-gpu'])
        pg = b.new_page()
        pg.add_init_script(FAKE + SEED)
        # stop the app's own start-up save so only the seeded files are in play
        pg.goto(f'http://127.0.0.1:{PORT}/', wait_until='domcontentloaded'); pg.wait_for_timeout(1500)
        out = pg.evaluate("""async () => {
          const r = await (await fetch('/projects/list.php')).json();
          const s = await (await fetch('/projects/save.php', { method:'POST', body: JSON.stringify({ name:'New', data:{sheets:[]} }) })).json();
          return { names: r.projects.map(p => p.id + ':' + p.name), newId: s.id };
        }""")
        print(out)
        b.close()
finally:
    srv.send_signal(signal.SIGTERM)
