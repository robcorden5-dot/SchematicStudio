"""Exercises desktop-shim.js in headless Chromium against the synced src/ folder.

Two runs: (1) browser mode (localStorage back end), (2) "desktop" mode with a fake window.__TAURI__ that keeps files in memory,
which is what the Tauri plugins provide in the real app. Needs: `npm run serve` is started by this script itself.
Usage: python3 test/shim.test.py   (Playwright for Python and a Chromium are required)
"""
import json, subprocess, sys, time, os, signal
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8124
CHROME = os.environ.get('CHROMIUM', '/opt/pw-browsers/chromium')

FAKE_TAURI = r"""
(() => {
  const files = new Map();          // path -> text
  const dirs = new Set();
  const calls = { open: [], save: [] };
  window.__fakeFs = files; window.__calls = calls;
  const norm = p => p.replace(/\\/g, '/');
  window.__TAURI__ = {
    core: { invoke: async () => null },
    path: {
      documentDir: async () => '/home/u/Documents',
      appDataDir: async () => '/home/u/.local/share/app',
      join: async (...p) => norm(p.join('/')).replace(/\/+/g, '/'),
    },
    fs: {
      exists: async p => files.has(norm(p)) || dirs.has(norm(p)),
      readTextFile: async p => { if (!files.has(norm(p))) throw new Error('ENOENT ' + p); return files.get(norm(p)); },
      writeTextFile: async (p, t) => { files.set(norm(p), t); },
      mkdir: async p => { dirs.add(norm(p)); },
      remove: async p => { files.delete(norm(p)); },
      readDir: async p => { const pre = norm(p) + '/'; if (![...files.keys()].some(k => k.startsWith(pre)) && !dirs.has(norm(p))) throw new Error('ENOENT'); return [...files.keys()].filter(k => k.startsWith(pre) && !k.slice(pre.length).includes('/')).map(k => ({ name: k.slice(pre.length), isFile: true, isDirectory: false })); },
    },
    dialog: { save: async o => { calls.save.push(o); return o.defaultPath === 'CANCEL.json' ? null : '/home/u/out/' + o.defaultPath; } },
    opener: { openUrl: async u => { calls.open.push(u); } },
  };
})();
"""

API_TEST = r"""
async () => {
  const j = async (url, body, method) => {
    const r = await fetch(url, body === undefined ? {} : { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, ...(await r.json()) };
  };
  const out = {};
  const sheets = [{ pageType: 'schematic', components: [], wires: [] }, { pageType: 'panel' }, { pageType: 'schematic' }];
  out.ping = await j('/auth/ping.php');
  out.list0 = await j('/projects/list.php');
  out.saveBlankName = await j('/projects/save.php', { name: '  ', data: { sheets } });
  out.saveBadData = await j('/projects/save.php', { name: 'x', data: {} });
  const a = await j('/projects/save.php', { id: null, name: 'Alpha', data: { sheets, marker: 1 } });
  const b = await j('/projects/save.php', { id: null, name: 'Beta', data: { sheets } });
  out.ids = [a.id, b.id];
  out.load = await j('/projects/load.php?id=' + a.id);
  out.loadMissing = await j('/projects/load.php?id=999');
  out.update = await j('/projects/save.php', { id: a.id, name: 'Alpha 2', data: { sheets, marker: 2 } });
  out.updateMissing = await j('/projects/save.php', { id: 999, name: 'x', data: { sheets } });
  out.details = await j('/projects/organise.php', { action: 'details', id: a.id, folder: '  Pumps  ', status: 'review', tags: 'a, b; A, c' });
  out.badStatus = await j('/projects/organise.php', { action: 'details', id: b.id, status: 'nonsense' });
  const dup = await j('/projects/organise.php', { action: 'duplicate', id: a.id, name: 'Alpha copy' });
  const tpl = await j('/projects/organise.php', { action: 'saveTemplate', name: 'Tpl', data: { sheets } });
  const use = await j('/projects/organise.php', { action: 'useTemplate', id: tpl.id, name: 'From tpl', folder: 'Jobs' });
  out.ren = await j('/projects/organise.php', { action: 'renameFolder', from: 'Pumps', to: 'Pumps & Valves' });
  out.useNotTemplate = await j('/projects/organise.php', { action: 'useTemplate', id: a.id, name: 'x' });
  const l1 = await j('/projects/list.php');
  out.list1 = { projects: l1.projects.map(p => [p.id, p.name, p.folder, p.status, p.tags.join('|'), p.sheet_count]), templates: l1.templates.map(p => p.name), organise: l1.organise };
  out.delTemplate = await j('/projects/organise.php', { action: 'deleteTemplate', id: tpl.id });
  out.del = await j('/projects/delete.php', { id: b.id });
  out.delAgain = await j('/projects/delete.php', { id: b.id });
  const l2 = await j('/projects/list.php');
  out.list2 = l2.projects.map(p => p.name); out.templates2 = l2.templates.length;
  // parts
  out.parts0 = (await j('/parts/api.php')).parts.length;
  const p1 = await j('/parts/api.php', { action: 'save', make: 'Siemens', model_no: '3RT2015', description: 'Contactor', category: 'Contactors', value: '' });
  const p1b = await j('/parts/api.php', { action: 'save', make: 'siemens', model_no: '3rt2015', description: 'Contactor 2', category: 'Contactors', value: '' });
  out.partsDedupe = [p1.replaced, p1b.replaced, p1.id === p1b.id];
  // aux items and contact assignments ride along with a part, are cleaned, and survive a save that sends none
  const px = await j('/parts/api.php', { action: 'save', make: 'Allen', model_no: 'CR1', description: 'Relay', category: 'Relays', value: '',
    extra: { contacts: [{ kind: 'nc', terms: ' 11-12 ' }, { kind: 'bogus', terms: '' }], auxItems: [{ type: 'Aux block', make: 'A', modelNo: 'B', qty: 5000, contacts: [{ kind: 'p3', terms: '1-2' }] }, {}], selfContact: { set: 'aux', n: 1, aux: 0 } } });
  await j('/parts/api.php', { action: 'save', make: 'allen', model_no: 'cr1', description: 'Relay', category: 'Relays', value: '' });
  const pxr = (await j('/parts/api.php')).parts.find(p => p.make === 'Allen');
  out.partsExtra = [JSON.stringify(pxr.extra)];
  out.partsEmpty = await j('/parts/api.php', { action: 'save' });
  out.import = await j('/parts/api.php', { action: 'import', parts: [{ make: 'ABB', modelNo: 'X1' }, { make: 'Siemens', model_no: '3RT2015', description: 'Updated' }, {}] });
  const pl = await j('/parts/api.php');
  out.parts1 = pl.parts.map(p => [p.make, p.model_no, p.description]);
  out.partDel = await j('/parts/api.php', { action: 'delete', id: p1.id });
  out.partDelAgain = await j('/parts/api.php', { action: 'delete', id: p1.id });
  // title blocks
  const design = { layouts: { default: { items: [] } } };
  out.tbBad = await j('/titleblocks/api.php', { action: 'save', name: 'N', data: {} });
  const t1 = await j('/titleblocks/api.php', { action: 'save', name: 'Mine', data: design });
  const t2 = await j('/titleblocks/api.php', { action: 'save', name: 'Mine', data: design });
  out.tb = [t1.replaced, t2.replaced, t1.id === t2.id, (await j('/titleblocks/api.php')).templates.length];
  out.tbDel = await j('/titleblocks/api.php', { action: 'delete', id: t1.id });
  // libraries
  const libs = await j('/symbol-libraries/list.php');
  out.libs = libs.libraries.map(l => [l.filename, l.symbolCount > 0]);
  const g = await fetch('/symbol-libraries/get.php?file=pneumatic.json');
  const gj = await g.json();
  out.libGet = [g.status, gj.libraryName, Object.keys(gj.symbols).length > 5];
  out.libBad = (await fetch('/symbol-libraries/get.php?file=../x.json')).status;
  out.libMissing = (await fetch('/symbol-libraries/get.php?file=nope.json')).status;
  out.libIndexHidden = (await fetch('/symbol-libraries/get.php?file=index.json')).status;
  out.other = (await fetch('/images/studioLogo.svg')).status;     // not intercepted
  return out;
}
"""

def run(browser, desktop):
    ctx = browser.new_context()
    page = ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.route('**/accounts.google.com/**', lambda r: r.abort())
    if desktop:
        page.add_init_script(FAKE_TAURI)
    page.goto(f'http://127.0.0.1:{PORT}/', wait_until='domcontentloaded')
    page.wait_for_timeout(1500)
    res = {'errors': errs, 'flags': page.evaluate('[window.SS_DESKTOP, window.SS_DESKTOP_NATIVE, window.currentUser.plan, window.autoTour]')}
    res['api'] = page.evaluate(API_TEST)
    if desktop:
        res['files'] = sorted(page.evaluate('[...window.__fakeFs.keys()]'))
        sample = page.evaluate("window.__fakeFs.get('/home/u/Documents/SchematicStudio/projects/1.ssproj')")
        res['file1'] = (lambda d: [d['format'], d['id'], d['name'], d['folder'], d['status'], d['data'].get('marker')])(json.loads(sample))
        # native save dialog + external links
        res['dialog'] = page.evaluate("""async () => {
          const s = await import('/js/1_config_state.js');
          const ok = await s.saveTextFile('hello,world', 'test.csv', 'text/csv', 'Test (CSV)');
          const cancelled = await s.saveTextFile('x', 'CANCEL.json', 'application/json', 'Cancelled');
          return { ok, cancelled, saved: window.__fakeFs.get('/home/u/out/test.csv'), dialog: window.__calls.save[0] };
        }""")
        res['links'] = page.evaluate("""() => {
          const a = document.createElement('a'); a.href = '/auth/account.php'; a.textContent = 'x'; document.body.appendChild(a); a.click();
          const h = document.createElement('a'); h.href = '/help/'; h.target = '_blank'; document.body.appendChild(h); h.click();
          return window.__calls.open;
        }""")
        res['print'] = page.evaluate("""() => {
          const w = window.open('', '_blank');
          w.document.write('<html><body><p id="p">hi</p></body></html>'); w.document.close();
          const has = !!document.getElementById('ssPrintOverlay');
          const text = document.querySelector('#ssPrintOverlay iframe').contentDocument.getElementById('p').textContent;
          w.close();
          return [has, text, !!document.getElementById('ssPrintOverlay')];
        }""")
    # the real app flow: open "My Projects" and see the saved project
    res['ui'] = page.evaluate("""async () => {
      await window.openMyProjectsModal();
      await new Promise(r => setTimeout(r, 300));
      return document.getElementById('myProjectsList').innerText.replace(/\\s+/g, ' ').slice(0, 160);
    }""")
    ctx.close()
    return res

def main():
    srv = subprocess.Popen(['node', os.path.join(ROOT, 'scripts', 'serve.mjs'), str(PORT)], stdout=subprocess.DEVNULL)
    time.sleep(1)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox', '--disable-gpu'])
            for desktop in (False, True):
                print('==== ' + ('desktop (fake Tauri)' if desktop else 'browser (localStorage)'))
                print(json.dumps(run(b, desktop), indent=1, ensure_ascii=False))
            b.close()
    finally:
        srv.send_signal(signal.SIGTERM)

main()
