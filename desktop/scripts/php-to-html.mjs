// Turns the site's index.php into a plain static index.html for the desktop app.
//
// index.php only uses a small, regular slice of PHP: if / elseif / else / endif on the account's plan, and a handful of
// echoes. This converter understands exactly that slice and nothing more. In the desktop app the person is always "Pro" (the
// licence check arrives in a later phase), never on a trial, never an admin, and there is no billing banner.
//
// If index.php ever gains PHP this file does not know, it STOPS with a clear message instead of guessing — so a new
// feature on the website can never silently produce a broken desktop page.

// What the desktop page sees as "the account".
const ACCOUNT = { plan: 'pro' };

const VARS = {
  showUpgradeSuccess: false, showUpgradePending: false, showBillingError: false,
  autoTour: false, sheetPro: true,
};

// A PHP condition -> a JS boolean, using only names we know about.
function evalCondition(src) {
  let js = src
    .replace(/effectivePlan\(\$currentUser\)/g, 'PLAN')
    .replace(/\$currentUser\['plan'\]/g, 'PLAN')
    .replace(/isOnTrial\(\$currentUser\)/g, 'false')
    .replace(/isAdmin\(\$currentUser\)/g, 'false')
    .replace(/\$([A-Za-z_]+)/g, (m, name) => {
      if (!(name in VARS)) throw new Error(`index.php condition uses an unknown variable $${name}: ${src}`);
      return `VARS.${name}`;
    });
  if (/[A-Za-z_]+\s*\(/.test(js)) throw new Error(`index.php condition calls a function the converter does not know: ${src}`);
  // eslint-disable-next-line no-new-func
  return !!new Function('PLAN', 'VARS', `return (${js});`)(ACCOUNT.plan, VARS);
}

// An echo block -> the text it would print on the desktop.
function evalEcho(src) {
  const s = src.replace(/\s+/g, ' ').trim();
  const known = new Map([
    ["json_encode(csrfToken())", '"desktop"'],
    ["json_encode(effectivePlan($currentUser))", JSON.stringify(ACCOUNT.plan)],
    ["$autoTour ? 'true' : 'false'", 'false'],
    ["htmlspecialchars($currentUser['email'])", 'Account'],
    ["effectivePlan($currentUser) === 'pro' ? 'Pro' : 'Free'", 'Pro'],
  ]);
  if (known.has(s)) return known.get(s);
  if (s === "echo $sheetPro ? '(Pro)' : '(a Pro feature)';") return '(Pro)';
  throw new Error(`index.php prints something the converter does not know: <?= ${s} ?>`);
}

export function convertIndexPhp(php, { importMapJson, moduleSrc }) {
  const out = [];
  const stack = [];                 // { parentActive, taken, active }
  const active = () => stack.every(f => f.active);
  const re = /<\?(php|=)([\s\S]*?)\?>/g;
  let last = 0, m;
  while ((m = re.exec(php))) {
    if (active()) out.push(php.slice(last, m.index));
    last = re.lastIndex;
    const kind = m[1];
    const body = m[2].trim();

    if (kind === '=') {
      const flat = body.replace(/\s+/g, ' ');
      if (flat.startsWith("json_encode(['imports'")) { if (active()) out.push(importMapJson); continue; }
      if (flat === '$jsVer') { if (active()) out.push(moduleSrc.version); continue; }
      if (active()) out.push(evalEcho(body));
      continue;
    }

    // <?php ... ?> blocks
    if (/^declare\(strict_types/.test(body)) continue;                 // the login / setup block at the top
    if (/^\/\/ Every module is requested/.test(body)) continue;       // builds the import map: replaced above
    if (/^\/\*[\s\S]*\*\/$/.test(body)) continue;                      // a comment
    if (/^\$sheetPro\s*=/.test(body)) continue;                        // VARS.sheetPro is already true
    let c;
    if ((c = /^if \(([\s\S]*)\):$/.exec(body))) {
      const parentActive = active();
      const val = parentActive ? evalCondition(c[1]) : false;
      stack.push({ taken: val, active: val });
      continue;
    }
    if ((c = /^elseif \(([\s\S]*)\):$/.exec(body))) {
      const f = stack[stack.length - 1];
      const parentActive = stack.slice(0, -1).every(x => x.active);
      if (f.taken || !parentActive) { f.active = false; }
      else { const val = evalCondition(c[1]); f.active = val; f.taken = val; }
      continue;
    }
    if (body === 'else:') {
      const f = stack[stack.length - 1];
      const parentActive = stack.slice(0, -1).every(x => x.active);
      f.active = parentActive && !f.taken; f.taken = true;
      continue;
    }
    if (body === 'endif;') { stack.pop(); continue; }
    if (/^echo \$sheetPro/.test(body)) { if (active()) out.push(evalEcho(body)); continue; }
    throw new Error(`index.php contains PHP the converter does not know:\n${body.slice(0, 200)}`);
  }
  if (stack.length) throw new Error('index.php has an unbalanced if / endif');
  if (active()) out.push(php.slice(last));
  return out.join('');
}
