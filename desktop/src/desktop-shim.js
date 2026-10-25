/* SchematicStudio desktop shim
 *
 * The website's front end talks to the server with fetch() (projects, parts library, title block designs, symbol libraries, a
 * keep-alive ping). In the desktop app there is no server, so this file answers those same requests locally, with the same
 * response shapes. The editor code is therefore byte-for-byte the website's.
 *
 * Where data lives:
 *   Tauri app    Documents/SchematicStudio/projects/<id>.ssproj   one file per project (plain JSON)
 *                AppData (per user)/parts.json, titleblocks.json
 *   Browser      localStorage (only so the page can be tried without building the app)
 *
 * It also gives the editor a native "Save as" dialog (showSaveFilePicker), a print window that works without pop-ups, and
 * opens website links in the system browser.
 */
(function () {
  'use strict';

  var T = window.__TAURI__ || null;
  var DESKTOP = !!(T && T.core);
  var SITE = 'https://schematicstudio.co.uk';
  window.SS_DESKTOP = true;
  window.SS_DESKTOP_NATIVE = DESKTOP;

  // ------------------------------------------------------------------ storage

  // Everything goes through four calls: get(rel) -> text|null, put(rel, text), del(rel), list(dir) -> [names].
  // Writes are queued so two saves never interleave.
  var queue = Promise.resolve();
  function serial(fn) { var run = queue.then(fn, fn); queue = run.catch(function () {}); return run; }

  var store;
  if (DESKTOP && T.fs && T.path) {
    var roots = null;
    var rootsPromise = function () {
      if (!roots) roots = Promise.all([T.path.documentDir(), T.path.appDataDir()]).then(function (r) {
        return Promise.all([T.path.join(r[0], 'SchematicStudio'), T.path.join(r[1])]).then(function (j) {
          return { docs: j[0], app: j[1] };
        });
      });
      return roots;
    };
    var isProject = function (rel) { return rel === 'projects' || rel.indexOf('projects/') === 0; };
    var absolute = function (rel) {
      return rootsPromise().then(function (r) {
        var base = isProject(rel) ? r.docs : r.app;
        var parts = rel.split('/');
        return T.path.join.apply(T.path, [base].concat(parts));
      });
    };
    var ensureDir = function (abs) { return T.fs.mkdir(abs, { recursive: true }).catch(function () {}); };
    var dirOf = function (abs) { return abs.replace(/[\\/][^\\/]*$/, ''); };
    store = {
      get: function (rel) {
        return absolute(rel).then(function (p) {
          return T.fs.exists(p).then(function (ok) { return ok ? T.fs.readTextFile(p) : null; });
        });
      },
      put: function (rel, text) {
        return serial(function () {
          return absolute(rel).then(function (p) {
            return ensureDir(dirOf(p)).then(function () { return T.fs.writeTextFile(p, text); });
          });
        });
      },
      del: function (rel) {
        return serial(function () {
          return absolute(rel).then(function (p) { return T.fs.remove(p).catch(function () {}); });
        });
      },
      list: function (dir) {
        return absolute(dir).then(function (p) {
          // a folder that does not exist yet simply has nothing in it
          return T.fs.readDir(p).then(function (es) {
            return es.filter(function (e) { return e.isFile !== false; }).map(function (e) { return e.name; });
          }, function () { return []; });
        });
      },
    };
  } else {
    var PFX = 'ssdesk:';
    var safe = function (fn, dflt) { try { return fn(); } catch (e) { return dflt; } };
    store = {
      get: function (rel) { return Promise.resolve(safe(function () { return localStorage.getItem(PFX + rel); }, null)); },
      put: function (rel, text) { return Promise.resolve().then(function () { localStorage.setItem(PFX + rel, text); }); },
      del: function (rel) { return Promise.resolve(safe(function () { localStorage.removeItem(PFX + rel); })); },
      list: function (dir) {
        return Promise.resolve(safe(function () {
          var out = [], pre = PFX + dir + '/';
          for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (k.indexOf(pre) === 0) out.push(k.slice(pre.length));
          }
          return out;
        }, []));
      },
    };
  }

  function readJson(rel, dflt) {
    return store.get(rel).then(function (t) {
      if (!t) return dflt;
      try { return JSON.parse(t); } catch (e) { return dflt; }
    });
  }
  function writeJson(rel, obj) { return store.put(rel, JSON.stringify(obj)); }

  // ------------------------------------------------------------------ helpers

  function respond(obj, status) {
    return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
  }
  function fail(status, error, message) { return respond({ success: false, error: error, message: message }, status); }
  function now() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function squash(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max); }
  function cleanFolder(v) { var s = squash(v, 120); return s === '' ? '' : s; }
  var STATUSES = ['draft', 'review', 'issued', 'archived'];
  function cleanStatus(v) { v = String(v || '').trim().toLowerCase(); return STATUSES.indexOf(v) >= 0 ? v : 'draft'; }
  function cleanTags(v) {
    var parts = Array.isArray(v) ? v : String(v || '').split(/[,;]+/), out = [], seen = {};
    for (var i = 0; i < parts.length && out.length < 8; i++) {
      var t = squash(parts[i], 30);
      if (t === '' || seen[t.toLowerCase()]) continue;
      seen[t.toLowerCase()] = 1; out.push(t);
    }
    return out;
  }
  function schematicSheets(sheets) {
    if (!Array.isArray(sheets)) return 0;
    return sheets.filter(function (s) { return (s && s.pageType || 'schematic') === 'schematic'; }).length;
  }

  // ------------------------------------------------------------------ projects

  // One file per project: { format, id, name, folder, status, tags, isTemplate, updatedAt, data }.
  // projects/index.json is only a cache of everything except `data`; it is rebuilt from the files if it is missing or out of step.
  var PROJ_DIR = 'projects';
  var indexCache = null;

  function metaOf(rec) {
    return { id: rec.id, name: rec.name, folder: rec.folder || '', status: rec.status || 'draft', tags: rec.tags || [],
      isTemplate: !!rec.isTemplate, updated_at: rec.updatedAt, sheet_count: schematicSheets(rec.data && rec.data.sheets) };
  }
  function fileFor(id) { return PROJ_DIR + '/' + id + '.ssproj'; }

  var indexPromise = null;
  // One shared load: several requests arrive together at start-up, and each must see the SAME index object.
  function loadIndex() {
    if (!indexPromise) indexPromise = readIndexFromDisk().then(function (idx) { indexCache = idx; return idx; }, function (e) { indexPromise = null; throw e; });
    return indexPromise;
  }
  function readIndexFromDisk() {
    return Promise.all([readJson(PROJ_DIR + '/index.json', null), store.list(PROJ_DIR)]).then(function (r) {
      var idx = r[0], names = r[1].filter(function (n) { return /\.ssproj$/.test(n); });
      var ids = names.map(function (n) { return parseInt(n, 10); }).filter(function (n) { return n > 0; });
      var inSync = idx && Array.isArray(idx.projects) && idx.projects.length === ids.length &&
        idx.projects.every(function (p) { return ids.indexOf(p.id) >= 0; });
      if (inSync) return idx;
      // rebuild from the files (a project was added or removed outside the app, or this is the first run)
      return Promise.all(ids.map(function (id) { return readJson(fileFor(id), null); })).then(function (recs) {
        var projects = recs.filter(Boolean).map(metaOf);
        var next = Math.max.apply(null, [0].concat(ids, (idx && idx.next ? [idx.next - 1] : []))) + 1;
        var rebuilt = { next: next, projects: projects };
        return writeJson(PROJ_DIR + '/index.json', rebuilt).then(function () { return rebuilt; });
      });
    });
  }
  function saveIndex() { return writeJson(PROJ_DIR + '/index.json', indexCache); }

  function writeProject(rec) {
    return store.put(fileFor(rec.id), JSON.stringify(rec)).then(function () {
      var i = indexCache.projects.findIndex(function (p) { return p.id === rec.id; });
      var m = metaOf(rec);
      if (i >= 0) indexCache.projects[i] = m; else indexCache.projects.push(m);
      return saveIndex();
    });
  }
  function readProject(id) { return readJson(fileFor(id), null); }

  function body(init) { try { return JSON.parse(init && init.body || '{}'); } catch (e) { return null; } }

  var projectApi = {
    list: function () {
      return loadIndex().then(function (idx) {
        var rows = idx.projects.slice().sort(function (a, b) { return String(b.updated_at).localeCompare(String(a.updated_at)) || b.id - a.id; });
        var strip = function (m) { return { id: m.id, name: m.name, updated_at: m.updated_at, sheet_count: m.sheet_count, folder: m.folder, status: m.status, tags: m.tags }; };
        return respond({ success: true, projects: rows.filter(function (m) { return !m.isTemplate; }).map(strip),
          templates: rows.filter(function (m) { return m.isTemplate; }).map(strip), organise: true });
      });
    },
    load: function (u) {
      var id = parseInt(u.searchParams.get('id'), 10);
      if (!(id > 0)) return Promise.resolve(fail(400, 'invalid_request'));
      return readProject(id).then(function (rec) {
        return rec ? respond({ success: true, id: rec.id, name: rec.name, data: rec.data }) : fail(404, 'not_found', 'Project not found.');
      });
    },
    save: function (init) {
      var b = body(init);
      if (!b) return Promise.resolve(fail(400, 'invalid_request', 'Malformed request body.'));
      var name = String(b.name == null ? '' : b.name).trim();
      if (!name) return Promise.resolve(fail(400, 'invalid_name', 'Project name is required.'));
      if (!b.data || !Array.isArray(b.data.sheets)) return Promise.resolve(fail(400, 'invalid_data', 'Project data is missing or malformed.'));
      return loadIndex().then(function () {
        var id = b.id != null ? parseInt(b.id, 10) : null;
        if (id) {
          return readProject(id).then(function (rec) {
            if (!rec) return fail(404, 'not_found', 'Project not found.');
            rec.name = name; rec.data = b.data; rec.updatedAt = now();
            return writeProject(rec).then(function () { return respond({ success: true, id: id }); });
          });
        }
        var nid = indexCache.next++;
        var rec = { format: 'ssproj', id: nid, name: name, folder: '', status: 'draft', tags: [], isTemplate: false, updatedAt: now(), data: b.data };
        return writeProject(rec).then(function () { return respond({ success: true, id: nid }); });
      });
    },
    remove: function (init) {
      var b = body(init), id = b && parseInt(b.id, 10);
      if (!(id > 0)) return Promise.resolve(fail(400, 'invalid_request'));
      return loadIndex().then(function () {
        if (!indexCache.projects.some(function (p) { return p.id === id; })) return fail(404, 'not_found', 'Project not found.');
        return store.del(fileFor(id)).then(function () {
          indexCache.projects = indexCache.projects.filter(function (p) { return p.id !== id; });
          return saveIndex().then(function () { return respond({ success: true }); });
        });
      });
    },
    organise: function (init) {
      var b = body(init);
      if (!b) return Promise.resolve(fail(400, 'invalid_request', 'Malformed request body.'));
      var id = parseInt(b.id, 10) || 0;
      var needName = function () { var n = squash(b.name, 191); return n; };
      return loadIndex().then(function () {
        switch (b.action) {
          case 'details':
            return readProject(id).then(function (rec) {
              if (!rec) return fail(404, 'not_found', 'Project not found.');
              if ('name' in b) { var n = needName(); if (!n) return fail(400, 'invalid_name', 'A name is required.'); rec.name = n; }
              if ('folder' in b) rec.folder = cleanFolder(b.folder);
              if ('status' in b) rec.status = cleanStatus(b.status);
              if ('tags' in b) rec.tags = cleanTags(b.tags);
              return writeProject(rec).then(function () { return respond({ success: true }); });   // the "last saved" time is deliberately left alone, as on the server
            });
          case 'renameFolder': {
            var from = cleanFolder(b.from), to = cleanFolder(b.to);
            if (!from) return fail(400, 'invalid_request', 'Which folder?');
            var hits = indexCache.projects.filter(function (p) { return p.folder === from; });
            return Promise.all(hits.map(function (m) {
              return readProject(m.id).then(function (rec) { if (rec) { rec.folder = to; return writeProject(rec); } });
            })).then(function () { return respond({ success: true }); });
          }
          case 'duplicate':
          case 'useTemplate':
            return readProject(id).then(function (rec) {
              if (!rec || (b.action === 'useTemplate' && !rec.isTemplate)) return fail(404, 'not_found', b.action === 'useTemplate' ? 'Template not found.' : 'Project not found.');
              var n = needName(); if (!n) return fail(400, 'invalid_name', 'A name is required.');
              var nid = indexCache.next++;
              var copy = { format: 'ssproj', id: nid, name: n, folder: b.action === 'useTemplate' ? cleanFolder(b.folder) : (rec.folder || ''),
                status: 'draft', tags: rec.tags || [], isTemplate: false, updatedAt: now(), data: rec.data };
              return writeProject(copy).then(function () { return respond({ success: true, id: nid }); });
            });
          case 'saveTemplate': {
            if (!b.data || !Array.isArray(b.data.sheets)) return fail(400, 'invalid_data', 'Project data is missing or malformed.');
            var tn = needName(); if (!tn) return fail(400, 'invalid_name', 'A name is required.');
            var tid = indexCache.next++;
            var t = { format: 'ssproj', id: tid, name: tn, folder: '', status: 'draft', tags: [], isTemplate: true, updatedAt: now(), data: b.data };
            return writeProject(t).then(function () { return respond({ success: true, id: tid }); });
          }
          case 'deleteTemplate':
            if (!indexCache.projects.some(function (p) { return p.id === id && p.isTemplate; })) return fail(404, 'not_found', 'Template not found.');
            return store.del(fileFor(id)).then(function () {
              indexCache.projects = indexCache.projects.filter(function (p) { return p.id !== id; });
              return saveIndex().then(function () { return respond({ success: true }); });
            });
          default:
            return fail(400, 'invalid_request', 'Unknown action.');
        }
      });
    },
  };

  // ------------------------------------------------------------------ parts library

  var PARTS_MAX = 2000, PARTS_IMPORT_MAX = 1000;
  // A part's auxiliary items and contact assignments (the `extra` column on the website): only the known shape is kept.
  var PARTS_EXTRA_MAX = 40000, CONTACT_KINDS = ['no', 'nc', 'p3', 'lamp', 'sol'];
  function cleanContacts(list) {
    var out = [];
    (Array.isArray(list) ? list.slice(0, 40) : []).forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      var terms = squash(c.terms, 40);
      if (terms !== '') out.push({ kind: CONTACT_KINDS.indexOf(c.kind) >= 0 ? c.kind : 'no', terms: terms });
    });
    return out;
  }
  function cleanExtra(raw) {
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { return null; } }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    var x = {}, own = cleanContacts(raw.contacts);
    if (own.length) x.contacts = own;
    var aux = [];
    (Array.isArray(raw.auxItems) ? raw.auxItems.slice(0, 30) : []).forEach(function (a) {
      if (!a || typeof a !== 'object') return;
      var item = { type: squash(a.type, 60), make: squash(a.make, 120), modelNo: squash(a.modelNo, 120), description: squash(a.description, 255),
        qty: Math.max(1, Math.min(999, parseInt(a.qty, 10) || 1)), contacts: cleanContacts(a.contacts) };
      if (item.type || item.make || item.modelNo || item.description || item.contacts.length) aux.push(item);
    });
    if (aux.length) x.auxItems = aux;
    var sc = raw.selfContact;
    if (sc && typeof sc === 'object' && (sc.set === 'own' || sc.set === 'aux')) {
      x.selfContact = { set: sc.set, n: Math.max(0, parseInt(sc.n, 10) || 0) };
      if (sc.set === 'aux') x.selfContact.aux = Math.max(0, parseInt(sc.aux, 10) || 0);
    }
    if (!Object.keys(x).length) return null;
    return JSON.stringify(x).length > PARTS_EXTRA_MAX ? null : x;
  }
  function cleanPart(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var p = { category: squash(raw.category, 60), make: squash(raw.make, 120), model_no: squash(raw.model_no != null ? raw.model_no : raw.modelNo, 120),
      description: squash(raw.description, 255), value: squash(raw.value, 80), extra: cleanExtra(raw.extra) };
    return (!p.make && !p.model_no && !p.description) ? null : p;
  }
  function partKey(p) { return String(p.make).toLowerCase() + '|' + String(p.model_no).toLowerCase(); }
  function loadParts() { return readJson('parts.json', { next: 1, parts: [] }); }

  var partsApi = {
    get: function () {
      return loadParts().then(function (db) {
        var rows = db.parts.slice().sort(function (a, b) {
          return (a.category || '').localeCompare(b.category || '') || (a.make || '').localeCompare(b.make || '') || (a.model_no || '').localeCompare(b.model_no || '');
        });
        return respond({ success: true, parts: rows.map(function (r) { return Object.assign({ extra: null }, r); }), max: PARTS_MAX });
      });
    },
    post: function (init) {
      var b = body(init);
      if (!b) return Promise.resolve(fail(400, 'invalid_request', 'Malformed request.'));
      return loadParts().then(function (db) {
        var byKey = function () { var m = {}; db.parts.forEach(function (p) { m[partKey(p)] = p.id; }); return m; };
        var done = function (obj) { return writeJson('parts.json', db).then(function () { return respond(obj); }); };
        if (b.action === 'delete') {
          var id = parseInt(b.id, 10) || 0, n = db.parts.length;
          db.parts = db.parts.filter(function (p) { return p.id !== id; });
          return db.parts.length === n ? fail(404, 'not_found', 'That part is no longer in the library.') : done({ success: true });
        }
        if (b.action === 'save') {
          var p = cleanPart(b);
          if (!p) return fail(400, 'invalid_part', 'Enter at least a make, a model / part number or a description.');
          var pid = parseInt(b.id, 10) || 0, same = byKey()[partKey(p)] || 0;
          if (pid > 0) {
            if (same && same !== pid) db.parts = db.parts.filter(function (x) { return x.id !== same; });
            var cur = db.parts.find(function (x) { return x.id === pid; });
            if (cur) Object.assign(cur, p); else db.parts.push(Object.assign({ id: pid }, p));
            return done({ success: true, id: pid, replaced: true });
          }
          if (same) {
            var ex = db.parts.find(function (x) { return x.id === same; });
            ex.category = p.category; ex.description = p.description; ex.value = p.value;
            if (p.extra) ex.extra = p.extra;   // like the website: a save with no extra keeps the one already stored
            return done({ success: true, id: same, replaced: true });
          }
          if (db.parts.length >= PARTS_MAX) return fail(403, 'limit', 'The library holds up to ' + PARTS_MAX + ' parts. Delete some you no longer use.');
          var nid = db.next++;
          db.parts.push(Object.assign({ id: nid }, p));
          return done({ success: true, id: nid, replaced: false });
        }
        if (b.action === 'import') {
          if (!Array.isArray(b.parts)) return fail(400, 'invalid_request', 'There are no parts to import.');
          var keys = byKey(), added = 0, updated = 0, skipped = 0;
          b.parts.slice(0, PARTS_IMPORT_MAX).forEach(function (raw) {
            var q = cleanPart(raw);
            if (!q) { skipped++; return; }
            var k = partKey(q);
            if (keys[k]) {
              var e = db.parts.find(function (x) { return x.id === keys[k]; });
              e.category = q.category; e.description = q.description; e.value = q.value; if (q.extra) e.extra = q.extra; updated++;
            } else if (db.parts.length >= PARTS_MAX) { skipped++; }
            else { var i2 = db.next++; db.parts.push(Object.assign({ id: i2 }, q)); keys[k] = i2; added++; }
          });
          return done({ success: true, added: added, updated: updated, skipped: skipped });
        }
        return fail(400, 'invalid_request', 'Unknown action.');
      });
    },
  };

  // ------------------------------------------------------------------ title block designs

  var TB_MAX = 25, TB_BYTES = 120000;
  var tbApi = {
    get: function () {
      return readJson('titleblocks.json', { next: 1, templates: [] }).then(function (db) {
        var rows = db.templates.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
        return respond({ success: true, templates: rows, max: TB_MAX });
      });
    },
    post: function (init) {
      var b = body(init);
      if (!b) return Promise.resolve(fail(400, 'invalid_request', 'Malformed request.'));
      return readJson('titleblocks.json', { next: 1, templates: [] }).then(function (db) {
        var done = function (obj) { return writeJson('titleblocks.json', db).then(function () { return respond(obj); }); };
        if (b.action === 'delete') {
          var id = parseInt(b.id, 10) || 0, n = db.templates.length;
          db.templates = db.templates.filter(function (t) { return t.id !== id; });
          return db.templates.length === n ? fail(404, 'not_found', 'That design is no longer saved.') : done({ success: true });
        }
        if (b.action === 'save') {
          var name = String(b.name == null ? '' : b.name).trim().slice(0, 80);
          if (!name) return fail(400, 'invalid_name', 'Give the design a name.');
          var d = b.data;
          if (!d || !d.layouts || typeof d.layouts !== 'object' || !d.layouts['default']) return fail(400, 'invalid_data', 'That is not a title block design.');
          if (JSON.stringify(d).length > TB_BYTES) return fail(400, 'too_large', 'That design is too large to save.');
          var ex = db.templates.find(function (t) { return t.name === name; });
          if (ex) { ex.data = d; ex.updated_at = now(); return done({ success: true, id: ex.id, replaced: true }); }
          if (db.templates.length >= TB_MAX) return fail(403, 'limit', 'You can keep up to ' + TB_MAX + ' saved designs. Delete one to save another.');
          var nid = db.next++;
          db.templates.push({ id: nid, name: name, updated_at: now(), data: d });
          return done({ success: true, id: nid, replaced: false });
        }
        return fail(400, 'invalid_request', 'Unknown action.');
      });
    },
  };

  // ------------------------------------------------------------------ symbol libraries (bundled with the app)

  var realFetch = window.fetch.bind(window);
  function local(rel) { return new URL(rel, document.baseURI).href; }
  var libApi = {
    list: function () {
      return realFetch(local('symbol-libraries/index.json')).then(function (r) { return r.json(); }).then(function (j) {
        return respond({ success: true, libraries: j.libraries });
      });
    },
    get: function (u) {
      var file = u.searchParams.get('file') || '';
      if (!/^[A-Za-z0-9][A-Za-z0-9 ._()\-]*\.json$/.test(file) || file === 'index.json') return Promise.resolve(fail(400, 'invalid_request', 'That library could not be found.'));
      return realFetch(local('symbol-libraries/' + encodeURIComponent(file))).then(function (r) {
        return r.ok ? r.text().then(function (t) { return new Response(t, { status: 200, headers: { 'Content-Type': 'application/json' } }); })
                    : fail(404, 'not_found', 'That library could not be found.');
      });
    },
  };

  // ------------------------------------------------------------------ the fetch router

  window.fetch = function (input, init) {
    var url;
    try { url = new URL(typeof input === 'string' ? input : input.url, document.baseURI); } catch (e) { return realFetch(input, init); }
    var method = String((init && init.method) || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
    var p = url.pathname.replace(/^.*?(?=\/(auth|projects|parts|titleblocks|symbol-libraries)\/)/, '');
    var out = null;
    switch (p) {
      case '/auth/ping.php': out = Promise.resolve(respond({ success: true, csrf: 'desktop' })); break;
      case '/auth/tour.php': out = Promise.resolve(respond({ success: true })); break;
      case '/projects/list.php': out = projectApi.list(); break;
      case '/projects/load.php': out = projectApi.load(url); break;
      case '/projects/save.php': out = projectApi.save(init); break;
      case '/projects/delete.php': out = projectApi.remove(init); break;
      case '/projects/organise.php': out = projectApi.organise(init); break;
      case '/parts/api.php': out = method === 'GET' ? partsApi.get() : partsApi.post(init); break;
      case '/titleblocks/api.php': out = method === 'GET' ? tbApi.get() : tbApi.post(init); break;
      case '/symbol-libraries/list.php': out = libApi.list(); break;
      case '/symbol-libraries/get.php': out = libApi.get(url); break;
      default: return realFetch(input, init);
    }
    return out.catch(function (err) {
      console.error('[desktop shim]', p, err);
      return fail(500, 'local_error', 'The app could not read or write its local data: ' + (err && err.message ? err.message : err));
    });
  };

  // ------------------------------------------------------------------ native file dialog

  if (DESKTOP && T.dialog && T.fs) {
    window.showSaveFilePicker = function (opts) {
      opts = opts || {};
      var types = opts.types || [];
      var filters = types.map(function (t) {
        var exts = [];
        Object.keys(t.accept || {}).forEach(function (k) { (t.accept[k] || []).forEach(function (e) { exts.push(String(e).replace(/^\./, '')); }); });
        return { name: t.description || 'File', extensions: exts.length ? exts : ['*'] };
      });
      return T.dialog.save({ defaultPath: opts.suggestedName, filters: filters }).then(function (path) {
        if (!path) { var e = new Error('cancelled'); e.name = 'AbortError'; throw e; }
        return {
          createWritable: function () {
            var chunks = [];
            return Promise.resolve({
              write: function (c) { chunks.push(c); return Promise.resolve(); },
              close: function () { return T.fs.writeTextFile(path, chunks.join('')); },
            });
          },
        };
      });
    };
  }

  // ------------------------------------------------------------------ links and windows

  function openExternal(url) {
    if (DESKTOP && T.opener && T.opener.openUrl) return T.opener.openUrl(url);
    window.open(url, '_blank', 'noopener');
    return Promise.resolve();
  }
  window.SS_openExternal = openExternal;

  // /auth/..., /help/ and any http(s) link open on the website, in the system browser
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    var target = null;
    if (/^https?:\/\//i.test(href)) target = href;
    else if (/^\/(auth|help|terms|privacy|cookies)(\/|$)/.test(href)) target = SITE + href;
    if (!target) return;
    ev.preventDefault();
    openExternal(target);
  }, true);

  // window.open: a blank window is the print preview; a real URL opens in the system browser
  var realOpen = window.open.bind(window);
  window.open = function (url, name, features) {
    if (url && url !== 'about:blank') {
      var target = /^https?:\/\//i.test(url) ? url : SITE + url;
      openExternal(target);
      return null;
    }
    if (!DESKTOP) return realOpen(url, name, features);
    return makePrintWindow();
  };

  // The editor writes its print pages into window.open('') and calls print() on it. The app's webview has no pop-up
  // windows, so the same calls are answered by a full-window frame laid over the editor, with a Close button.
  function makePrintWindow() {
    var wrap = document.createElement('div');
    wrap.id = 'ssPrintOverlay';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#fff;display:flex;flex-direction:column;';
    var bar = document.createElement('div');
    bar.className = 'ss-print-bar';
    bar.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px 12px;background:#0f1720;color:#fff;font:13px system-ui,sans-serif;';
    var printBtn = document.createElement('button'), closeBtn = document.createElement('button');
    printBtn.textContent = 'Print'; closeBtn.textContent = 'Close preview';
    [printBtn, closeBtn].forEach(function (b) { b.style.cssText = 'padding:5px 12px;font:inherit;cursor:pointer;'; });
    bar.appendChild(printBtn); bar.appendChild(closeBtn);
    var frame = document.createElement('iframe');
    frame.style.cssText = 'flex:1;border:0;width:100%;background:#fff;';
    wrap.appendChild(bar); wrap.appendChild(frame);
    document.body.appendChild(wrap);

    var proxy = { onload: null, onafterprint: null, closed: false };
    var closeIt = function () { if (proxy.closed) return; proxy.closed = true; wrap.remove(); };
    var doPrint = function () {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { window.print(); }
      if (typeof proxy.onafterprint === 'function') { /* the preview stays open so a second copy can be printed */ }
    };
    printBtn.onclick = doPrint; closeBtn.onclick = closeIt;
    proxy.document = {
      write: function (html) { frame.contentDocument.write(html); },
      close: function () {
        frame.contentDocument.close();
        // the editor's own onload handler would print at once; here the person presses Print when ready
        setTimeout(function () { if (typeof proxy.onload === 'function') { /* deliberately not called: see above */ } }, 0);
      },
    };
    proxy.focus = function () {};
    proxy.print = doPrint;
    proxy.close = closeIt;
    return proxy;
  }
})();
