function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function money(n) {
  const num = Number(n || 0);
  return '$' + num.toFixed(2);
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d + (d.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function staffLayout({ title, user, active, body, flash }) {
  const nav = [
    ['/', 'Dashboard'],
    ['/customers', 'Customers'],
    ['/proposals', 'Proposals'],
    ['/jobs', 'Jobs'],
    ['/invoices', 'Invoices'],
    ['/crews', 'Crews'],
    ['/settings', 'Settings']
  ];
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · HoodPro</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<div class="topbar">
  <div class="wrap">
    <a class="brand" href="/"><span class="flame">&#128293;</span> HoodPro</a>
    <nav>
      ${nav.map(([href, label]) => `<a href="${href}" class="${active === label ? 'active' : ''}">${label}</a>`).join('')}
      ${user ? `<a href="/logout">Logout (${esc(user.name)})</a>` : ''}
    </nav>
  </div>
</div>
<div class="main">
  <div class="wrap">
    ${flash ? renderFlash(flash) : ''}
    ${body}
  </div>
</div>
</body>
</html>`;
}

function renderFlash(flash) {
  const [type, msg] = flash;
  if (!msg) return '';
  return `<div class="flash ${type === 'error' ? 'error' : 'success'}">${esc(msg)}</div>`;
}

function portalLayout({ title, customer, active, body }) {
  const base = `/portal/${customer.portal_token}`;
  const tabs = [
    [base, 'Overview'],
    [base + '/reports', 'Service Reports'],
    [base + '/invoices', 'Invoices']
  ];
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(customer.business_name)}</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<div class="portal-header">
  <div class="wrap">
    <div class="muted" style="color:#cfe0ee;">${esc(customer.business_name)}'s Service Portal</div>
    <h1>&#128293; HoodPro</h1>
  </div>
</div>
<div class="main">
  <div class="wrap">
    <div class="tabs">
      ${tabs.map(([href, label]) => `<a href="${href}" class="${active === label ? 'active' : ''}">${label}</a>`).join('')}
    </div>
    ${body}
  </div>
</div>
</body>
</html>`;
}

function authLayout({ title, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · HoodPro</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<div class="main">
  <div class="wrap">
    ${body}
  </div>
</div>
</body>
</html>`;
}

module.exports = { esc, money, fmtDate, staffLayout, portalLayout, authLayout, renderFlash };
