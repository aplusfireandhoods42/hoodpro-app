const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const db = require('./db');
const { hashPassword, verifyPassword, randomToken } = require('./lib/auth');
const { getSession, createSession, destroySession } = require('./lib/session');
const { parseMultipart } = require('./lib/multipart');
const { staffLayout, portalLayout, money, fmtDate } = require('./lib/layout');
const notify = require('./lib/notify');
const quickbooks = require('./lib/quickbooks');

const staffViews = require('./views/staff');
const jobViews = require('./views/jobs');
const invoiceViews = require('./views/invoices');
const crewViews = require('./views/crews');
const settingsViews = require('./views/settings');
const portalViews = require('./views/portal');

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- helpers ----------

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 25 * 1024 * 1024) { reject(new Error('Payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseQuerystring(str) {
  const out = {};
  new URLSearchParams(str).forEach((v, k) => { out[k] = v; });
  return out;
}

async function parseBody(req) {
  const contentType = req.headers['content-type'] || '';
  const raw = await readBody(req);
  if (contentType.includes('multipart/form-data')) {
    return { isMultipart: true, ...parseMultipart(raw, contentType) };
  }
  if (contentType.includes('application/json')) {
    try { return { isMultipart: false, fields: JSON.parse(raw.toString('utf8') || '{}'), files: [] }; }
    catch (e) { return { isMultipart: false, fields: {}, files: [] }; }
  }
  // default: urlencoded
  return { isMultipart: false, fields: parseQuerystring(raw.toString('utf8')), files: [] };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, headers));
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function notFound(res) { send(res, 404, '<h1>404 Not Found</h1><p><a href="/">Home</a></p>'); }

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = {};
  rows.forEach(r => { s[r.key] = r.value; });
  return s;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

function nextInvoiceNumber() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM invoices').get().c;
  const year = new Date().getFullYear();
  return `INV-${year}-${String(count + 1).padStart(4, '0')}`;
}

function addMonths(dateStr, months) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function baseUrl(req, settings) {
  if (settings.public_base_url) return settings.public_base_url.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${req.headers.host}`;
}

// ---------- QuickBooks Online helpers ----------

function qboConnected(settings) {
  return !!(settings.qbo_realm_id && settings.qbo_refresh_token);
}

async function ensureQboAccessToken() {
  const settings = getSettings();
  const expiresAt = Number(settings.qbo_access_expires_at || 0);
  if (settings.qbo_access_token && Date.now() < expiresAt - 60000) {
    return { accessToken: settings.qbo_access_token, settings };
  }
  if (!settings.qbo_refresh_token) throw new Error('QuickBooks is not connected. Connect it in Settings first.');
  const tokens = await quickbooks.refreshTokens({
    clientId: settings.qbo_client_id,
    clientSecret: settings.qbo_client_secret,
    refreshToken: settings.qbo_refresh_token
  });
  setSetting('qbo_access_token', tokens.access_token);
  setSetting('qbo_refresh_token', tokens.refresh_token);
  setSetting('qbo_access_expires_at', String(Date.now() + tokens.expires_in * 1000));
  return { accessToken: tokens.access_token, settings: getSettings() };
}

async function qboImportCustomers() {
  const settings = getSettings();
  if (!qboConnected(settings)) throw new Error('QuickBooks is not connected. Connect it in Settings first.');
  const { accessToken } = await ensureQboAccessToken();
  const environment = settings.qbo_environment || 'sandbox';
  const realmId = settings.qbo_realm_id;
  let startPosition = 1;
  const pageSize = 100;
  let imported = 0, updated = 0;
  for (;;) {
    const query = `select * from Customer startposition ${startPosition} maxresults ${pageSize}`;
    const res = await quickbooks.apiRequest({ environment, realmId, accessToken, method: 'GET', path: `/query?query=${encodeURIComponent(query)}` });
    if (res.status < 200 || res.status >= 300) throw new Error(`QuickBooks customer query failed (${res.status}): ${res.text}`);
    const custs = (res.json && res.json.QueryResponse && res.json.QueryResponse.Customer) || [];
    for (const c of custs) {
      const email = (c.PrimaryEmailAddr && c.PrimaryEmailAddr.Address) || null;
      const phone = (c.PrimaryPhone && c.PrimaryPhone.FreeFormNumber) || null;
      const addr = c.BillAddr ? [c.BillAddr.Line1, c.BillAddr.City, c.BillAddr.CountrySubDivisionCode, c.BillAddr.PostalCode].filter(Boolean).join(', ') : null;
      const existing = db.prepare('SELECT id FROM customers WHERE qbo_customer_id = ?').get(String(c.Id));
      if (existing) {
        db.prepare('UPDATE customers SET business_name = ?, email = COALESCE(?, email), phone = COALESCE(?, phone), billing_address = COALESCE(?, billing_address), qbo_sync_token = ? WHERE id = ?')
          .run(c.DisplayName, email, phone, addr, c.SyncToken, existing.id);
        updated++;
      } else {
        db.prepare('INSERT INTO customers (business_name, contact_name, email, phone, billing_address, portal_token, qbo_customer_id, qbo_sync_token) VALUES (?,?,?,?,?,?,?,?)')
          .run(c.DisplayName, null, email, phone, addr, randomToken(), String(c.Id), c.SyncToken);
        imported++;
      }
    }
    if (custs.length < pageSize) break;
    startPosition += pageSize;
  }
  return { imported, updated };
}

async function qboEnsureCustomer(localCustomerId) {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(localCustomerId);
  if (customer.qbo_customer_id) return customer.qbo_customer_id;
  const { accessToken, settings } = await ensureQboAccessToken();
  const environment = settings.qbo_environment || 'sandbox';
  const realmId = settings.qbo_realm_id;
  const payload = { DisplayName: `${customer.business_name} (HoodPro #${customer.id})` };
  if (customer.email) payload.PrimaryEmailAddr = { Address: customer.email };
  if (customer.phone) payload.PrimaryPhone = { FreeFormNumber: customer.phone };
  const res = await quickbooks.apiRequest({ environment, realmId, accessToken, method: 'POST', path: '/customer', body: payload });
  if (res.status < 200 || res.status >= 300) throw new Error(`Failed to create customer in QuickBooks (${res.status}): ${res.text}`);
  const qc = res.json.Customer;
  db.prepare('UPDATE customers SET qbo_customer_id = ?, qbo_sync_token = ? WHERE id = ?').run(String(qc.Id), qc.SyncToken, customer.id);
  return String(qc.Id);
}

async function qboEnsureServiceItem() {
  const settings = getSettings();
  if (settings.qbo_service_item_id) return settings.qbo_service_item_id;
  const { accessToken } = await ensureQboAccessToken();
  const environment = settings.qbo_environment || 'sandbox';
  const realmId = settings.qbo_realm_id;

  const findQuery = `select * from Item where Name = 'Hood Cleaning Service'`;
  const findRes = await quickbooks.apiRequest({ environment, realmId, accessToken, method: 'GET', path: `/query?query=${encodeURIComponent(findQuery)}` });
  const found = findRes.json && findRes.json.QueryResponse && findRes.json.QueryResponse.Item && findRes.json.QueryResponse.Item[0];
  if (found) { setSetting('qbo_service_item_id', String(found.Id)); return String(found.Id); }

  const acctQuery = `select * from Account where AccountType = 'Income' maxresults 1`;
  const acctRes = await quickbooks.apiRequest({ environment, realmId, accessToken, method: 'GET', path: `/query?query=${encodeURIComponent(acctQuery)}` });
  const account = acctRes.json && acctRes.json.QueryResponse && acctRes.json.QueryResponse.Account && acctRes.json.QueryResponse.Account[0];
  if (!account) throw new Error('No income account found in your QuickBooks company to attach a service item to.');

  const createRes = await quickbooks.apiRequest({
    environment, realmId, accessToken, method: 'POST', path: '/item',
    body: { Name: 'Hood Cleaning Service', Type: 'Service', IncomeAccountRef: { value: account.Id } }
  });
  if (createRes.status < 200 || createRes.status >= 300) throw new Error(`Failed to create QuickBooks service item (${createRes.status}): ${createRes.text}`);
  const item = createRes.json.Item;
  setSetting('qbo_service_item_id', String(item.Id));
  return String(item.Id);
}

async function qboSyncInvoice(localInvoiceId) {
  const settings = getSettings();
  if (!qboConnected(settings)) throw new Error('QuickBooks is not connected. Connect it in Settings first.');
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(localInvoiceId);
  if (!invoice) throw new Error('Invoice not found');

  const qboCustomerId = await qboEnsureCustomer(invoice.customer_id);
  const itemId = await qboEnsureServiceItem();
  const { accessToken, settings: freshSettings } = await ensureQboAccessToken();
  const environment = freshSettings.qbo_environment || 'sandbox';
  const realmId = freshSettings.qbo_realm_id;
  const lineItems = JSON.parse(invoice.line_items_json);

  let qboInvoiceId = invoice.qbo_invoice_id;
  if (!qboInvoiceId) {
    const payload = {
      CustomerRef: { value: qboCustomerId },
      Line: lineItems.map(li => ({
        DetailType: 'SalesItemLineDetail',
        Amount: Math.round(li.qty * li.rate * 100) / 100,
        Description: li.description,
        SalesItemLineDetail: { ItemRef: { value: itemId }, Qty: li.qty, UnitPrice: li.rate }
      }))
    };
    const res = await quickbooks.apiRequest({ environment, realmId, accessToken, method: 'POST', path: '/invoice', body: payload });
    if (res.status < 200 || res.status >= 300) throw new Error(`Failed to create QuickBooks invoice (${res.status}): ${res.text}`);
    const qi = res.json.Invoice;
    qboInvoiceId = String(qi.Id);
    db.prepare(`UPDATE invoices SET qbo_invoice_id = ?, qbo_sync_status = 'synced', qbo_synced_at = ? WHERE id = ?`)
      .run(qboInvoiceId, new Date().toISOString(), invoice.id);
  }

  if (invoice.status === 'paid') {
    // A payment row may already exist (customer paid through the portal), or may not
    // (staff marked the invoice paid manually) — handle both so we don't lose track
    // of what's already been pushed to QuickBooks and don't double-create there.
    const existingPayment = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY created_at DESC LIMIT 1').get(invoice.id);
    if (!existingPayment || !existingPayment.qbo_payment_id) {
      const payRes = await quickbooks.apiRequest({
        environment, realmId, accessToken, method: 'POST', path: '/payment',
        body: {
          CustomerRef: { value: qboCustomerId },
          TotalAmt: invoice.total,
          Line: [{ Amount: invoice.total, LinkedTxn: [{ TxnId: qboInvoiceId, TxnType: 'Invoice' }] }]
        }
      });
      if (payRes.status < 200 || payRes.status >= 300) throw new Error(`Failed to create QuickBooks payment (${payRes.status}): ${payRes.text}`);
      const qp = payRes.json.Payment;
      if (existingPayment) {
        db.prepare('UPDATE payments SET qbo_payment_id = ? WHERE id = ?').run(String(qp.Id), existingPayment.id);
      } else {
        db.prepare('INSERT INTO payments (invoice_id, amount, method, status, qbo_payment_id) VALUES (?,?,?,?,?)')
          .run(invoice.id, invoice.total, 'manual', 'completed', String(qp.Id));
      }
    }
  }
  return qboInvoiceId;
}

// ---------- static file serving ----------

const MIME = { '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

function serveStatic(req, res, dir, urlPrefix) {
  const rel = decodeURIComponent(req.url.slice(urlPrefix.length).split('?')[0]);
  const filePath = path.join(dir, rel);
  if (!filePath.startsWith(dir)) { notFound(res); return true; }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) { notFound(res); return true; }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

// ---------- auth middleware ----------

function currentUser(req) {
  const s = getSession(req);
  if (!s || !s.userId) return null;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(s.userId);
}

// ---------- route handler ----------

async function handle(req, res) {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname === '/style.css' || pathname.startsWith('/public/')) {
    return serveStatic(req, res, path.join(__dirname, 'public'), pathname.startsWith('/public/') ? '/public' : '/');
  }
  if (pathname.startsWith('/uploads/')) {
    return serveStatic(req, res, UPLOAD_DIR, '/uploads');
  }

  // ---- Public: login ----
  if (pathname === '/login' && method === 'GET') {
    return send(res, 200, staffViews.loginPage({ error: parsedUrl.searchParams.get('error') }));
  }
  if (pathname === '/login' && method === 'POST') {
    const { fields } = await parseBody(req);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get((fields.email || '').trim().toLowerCase());
    if (!user || !verifyPassword(fields.password || '', user.password)) {
      return redirect(res, '/login?error=' + encodeURIComponent('Invalid email or password'));
    }
    createSession(res, { userId: user.id });
    return redirect(res, '/');
  }
  if (pathname === '/logout') {
    destroySession(req, res);
    return redirect(res, '/login');
  }

  // ---- Public: customer portal (token-based, no login) ----
  if (pathname.startsWith('/portal/')) {
    return handlePortal(req, res, pathname, method, parsedUrl);
  }

  // ---- Everything else requires staff login ----
  const user = currentUser(req);
  if (!user) return redirect(res, '/login');

  return handleStaff(req, res, pathname, method, parsedUrl, user);
}

// ---------- staff routes ----------

async function handleStaff(req, res, pathname, method, parsedUrl, user) {
  const flashSuccess = parsedUrl.searchParams.get('success');
  const flashError = parsedUrl.searchParams.get('error');
  const flash = flashError ? ['error', flashError] : (flashSuccess ? ['success', flashSuccess] : null);

  const page = (title, active, body) => send(res, 200, staffLayout({ title, user, active, body, flash }));

  // Dashboard
  if (pathname === '/' && method === 'GET') {
    const today = new Date().toISOString().slice(0, 10);
    const in14 = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

    const upcoming = db.prepare(`
      SELECT j.*, c.business_name, l.label, l.address, cr.name as crew_name
      FROM jobs j
      JOIN customers c ON c.id = j.customer_id
      JOIN locations l ON l.id = j.location_id
      LEFT JOIN crews cr ON cr.id = j.crew_id
      WHERE j.status IN ('scheduled','in_progress') AND j.scheduled_date <= ?
      ORDER BY j.scheduled_date ASC LIMIT 20
    `).all(in14);

    const overdue = db.prepare(`
      SELECT a.*, c.business_name, l.label, l.address, a.customer_id
      FROM service_agreements a
      JOIN customers c ON c.id = a.customer_id
      JOIN locations l ON l.id = a.location_id
      WHERE a.active = 1 AND a.next_due_date < ?
      ORDER BY a.next_due_date ASC
    `).all(today);

    const outstandingInvoices = db.prepare(`
      SELECT i.*, c.business_name FROM invoices i JOIN customers c ON c.id = i.customer_id
      WHERE i.status IN ('sent','draft') ORDER BY i.due_date ASC LIMIT 20
    `).all();

    const stats = {
      activeAgreements: db.prepare('SELECT COUNT(*) c FROM service_agreements WHERE active = 1').get().c,
      jobsThisWeek: db.prepare(`SELECT COUNT(*) c FROM jobs WHERE scheduled_date BETWEEN ? AND ?`).get(today, new Date(Date.now() + 7*86400000).toISOString().slice(0,10)).c,
      outstandingTotal: db.prepare(`SELECT COALESCE(SUM(total),0) t FROM invoices WHERE status IN ('sent','draft')`).get().t
    };

    return page('Dashboard', 'Dashboard', staffViews.dashboard({ upcoming, overdue, outstandingInvoices, stats }));
  }

  // Customers
  if (pathname === '/customers' && method === 'GET') {
    const customers = db.prepare(`
      SELECT c.*, (SELECT COUNT(*) FROM locations l WHERE l.customer_id = c.id) as location_count
      FROM customers c ORDER BY c.business_name ASC
    `).all();
    return page('Customers', 'Customers', staffViews.customersList({ customers }));
  }
  if (pathname === '/customers/new' && method === 'GET') {
    return page('New Customer', 'Customers', staffViews.customerNew());
  }
  if (pathname === '/customers' && method === 'POST') {
    const { fields } = await parseBody(req);
    if (!fields.business_name) return redirect(res, '/customers/new?error=' + encodeURIComponent('Business name is required'));
    const info = db.prepare(`INSERT INTO customers (business_name, contact_name, email, phone, billing_address, portal_token) VALUES (?,?,?,?,?,?)`)
      .run(fields.business_name, fields.contact_name || null, fields.email || null, fields.phone || null, fields.billing_address || null, randomToken());
    return redirect(res, `/customers/${info.lastInsertRowid}?success=` + encodeURIComponent('Customer created'));
  }

  let m;
  if ((m = pathname.match(/^\/customers\/(\d+)$/)) && method === 'GET') {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(m[1]);
    if (!customer) return notFound(res);
    const locations = db.prepare('SELECT * FROM locations WHERE customer_id = ?').all(customer.id);
    const agreements = db.prepare(`
      SELECT a.*, l.label, l.address FROM service_agreements a JOIN locations l ON l.id = a.location_id
      WHERE a.customer_id = ? ORDER BY a.next_due_date ASC
    `).all(customer.id);
    const jobs = db.prepare(`
      SELECT j.*, l.label, l.address, cr.name as crew_name FROM jobs j
      JOIN locations l ON l.id = j.location_id LEFT JOIN crews cr ON cr.id = j.crew_id
      WHERE j.customer_id = ? ORDER BY j.scheduled_date DESC
    `).all(customer.id);
    const invoices = db.prepare('SELECT * FROM invoices WHERE customer_id = ? ORDER BY created_at DESC').all(customer.id);
    return page(customer.business_name, 'Customers', staffViews.customerDetail({ customer, locations, agreements, jobs, invoices }));
  }

  if ((m = pathname.match(/^\/customers\/(\d+)\/locations$/)) && method === 'POST') {
    const { fields } = await parseBody(req);
    db.prepare('INSERT INTO locations (customer_id, label, address, hood_count, notes) VALUES (?,?,?,?,?)')
      .run(m[1], fields.label || null, fields.address, Number(fields.hood_count || 1), fields.notes || null);
    return redirect(res, `/customers/${m[1]}?success=` + encodeURIComponent('Location added'));
  }

  if ((m = pathname.match(/^\/customers\/(\d+)\/agreements$/)) && method === 'POST') {
    const { fields } = await parseBody(req);
    db.prepare(`INSERT INTO service_agreements (customer_id, location_id, service_type, frequency_months, price, next_due_date) VALUES (?,?,?,?,?,?)`)
      .run(m[1], fields.location_id, fields.service_type || 'Kitchen Exhaust Hood Cleaning', Number(fields.frequency_months || 3), Number(fields.price || 0), fields.next_due_date);
    // auto-create the first scheduled job for this agreement
    const agreement = db.prepare('SELECT * FROM service_agreements WHERE id = last_insert_rowid()').get();
    db.prepare('INSERT INTO jobs (agreement_id, customer_id, location_id, scheduled_date, status) VALUES (?,?,?,?,?)')
      .run(agreement.id, m[1], fields.location_id, fields.next_due_date, 'scheduled');
    return redirect(res, `/customers/${m[1]}?success=` + encodeURIComponent('Recurring agreement created and first job scheduled'));
  }

  // Jobs
  if (pathname === '/jobs' && method === 'GET') {
    const crewId = parsedUrl.searchParams.get('crew_id') || '';
    const status = parsedUrl.searchParams.get('status') || '';
    let sql = `SELECT j.*, c.business_name, l.label, l.address, cr.name as crew_name FROM jobs j
      JOIN customers c ON c.id = j.customer_id JOIN locations l ON l.id = j.location_id
      LEFT JOIN crews cr ON cr.id = j.crew_id WHERE 1=1`;
    const params = [];
    if (crewId) { sql += ' AND j.crew_id = ?'; params.push(crewId); }
    if (status) { sql += ' AND j.status = ?'; params.push(status); }
    sql += ' ORDER BY j.scheduled_date DESC LIMIT 100';
    const jobs = db.prepare(sql).all(...params);
    const crews = db.prepare('SELECT * FROM crews ORDER BY name').all();
    return page('Jobs', 'Jobs', jobViews.jobsList({ jobs, crews, filterCrew: crewId, filterStatus: status }));
  }

  if ((m = pathname.match(/^\/jobs\/(\d+)$/)) && method === 'GET') {
    const job = getJobFull(m[1]);
    if (!job) return notFound(res);
    const photos = db.prepare('SELECT * FROM job_photos WHERE job_id = ? ORDER BY created_at').all(job.id);
    const crews = db.prepare('SELECT * FROM crews ORDER BY name').all();
    const hasInvoice = !!db.prepare('SELECT id FROM invoices WHERE job_id = ?').get(job.id);
    const timeEntries = db.prepare(`
      SELECT t.*, u.name as tech_name FROM time_entries t JOIN users u ON u.id = t.user_id
      WHERE t.job_id = ? ORDER BY t.clock_in ASC
    `).all(job.id);
    const myOpenEntry = db.prepare(`SELECT * FROM time_entries WHERE job_id = ? AND user_id = ? AND clock_out IS NULL`).get(job.id, user.id);
    const sentMessages = db.prepare(`SELECT * FROM messages_log WHERE job_id = ? ORDER BY created_at DESC`).all(job.id);
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(job.customer_id);
    return page('Job Detail', 'Jobs', jobViews.jobDetail({ job, photos, crews, hasInvoice, user, timeEntries, myOpenEntry, sentMessages, customer }));
  }

  if ((m = pathname.match(/^\/jobs\/(\d+)\/assign$/)) && method === 'POST') {
    const { fields } = await parseBody(req);
    db.prepare('UPDATE jobs SET crew_id = ? WHERE id = ?').run(fields.crew_id || null, m[1]);
    return redirect(res, `/jobs/${m[1]}?success=` + encodeURIComponent('Crew updated'));
  }

  if ((m = pathname.match(/^\/jobs\/(\d+)\/clock-in$/)) && method === 'POST') {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(m[1]);
    if (!job) return notFound(res);
    const already = db.prepare(`SELECT id FROM time_entries WHERE job_id = ? AND user_id = ? AND clock_out IS NULL`).get(job.id, user.id);
    if (!already) {
      db.prepare('INSERT INTO time_entries (job_id, user_id, clock_in) VALUES (?,?,?)').run(job.id, user.id, new Date().toISOString());
    }
    if (job.status === 'scheduled') {
      db.prepare(`UPDATE jobs SET status = 'in_progress', started_at = COALESCE(started_at, ?) WHERE id = ?`).run(new Date().toISOString(), job.id);
    }
    return redirect(res, `/jobs/${m[1]}?success=` + encodeURIComponent('Clocked in'));
  }

  if ((m = pathname.match(/^\/jobs\/(\d+)\/clock-out$/)) && method === 'POST') {
    const entry = db.prepare(`SELECT * FROM time_entries WHERE job_id = ? AND user_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1`).get(m[1], user.id);
    if (entry) {
      db.prepare('UPDATE time_entries SET clock_out = ? WHERE id = ?').run(new Date().toISOString(), entry.id);
      return redirect(res, `/jobs/${m[1]}?success=` + encodeURIComponent('Clocked out'));
    }
    return redirect(res, `/jobs/${m[1]}?error=` + encodeURIComponent('You are not clocked in on this job'));
  }

  if ((m = pathname.match(/^\/jobs\/(\d+)\/complete$/)) && method === 'POST') {
    const { fields } = await parseBody(req);
    const checklist = jobViews.DEFAULT_CHECKLIST.map((t, i) => ({ text: t, done: !!fields['check_' + i] }));
    db.prepare(`UPDATE jobs SET status = 'completed', completed_at = ?, checklist_json = ?, tech_notes = ? WHERE id = ?`)
      .run(new Date().toISOString(), JSON.stringify(checklist), fields.tech_notes || null, m[1]);

    // auto clock-out anyone still clocked in on this job
    const openEntries = db.prepare('SELECT * FROM time_entries WHERE job_id = ? AND clock_out IS NULL').all(m[1]);
    const now = new Date().toISOString();
    openEntries.forEach(e => db.prepare('UPDATE time_entries SET clock_out = ? WHERE id = ?').run(now, e.id));

    // advance the recurring agreement's next due date
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(m[1]);
    const agreement = db.prepare('SELECT * FROM service_agreements WHERE id = ?').get(job.agreement_id);
    if (agreement) {
      const newDue = addMonths(agreement.next_due_date, agreement.frequency_months);
      db.prepare('UPDATE service_agreements SET next_due_date = ? WHERE id = ?').run(newDue, agreement.id);
      db.prepare('INSERT INTO jobs (agreement_id, customer_id, location_id, crew_id, scheduled_date, status) VALUES (?,?,?,?,?,?)')
        .run(agreement.id, agreement.customer_id, agreement.location_id, job.crew_id, newDue, 'scheduled');
    }
    return redirect(res, `/jobs/${m[1]}?success=` + encodeURIComponent('Job completed. Next service auto-scheduled.'));
  }

  if ((m = pathname.match(/^\/jobs\/(\d+)\/photos$/)) && method === 'POST') {
    const { files, fields } = await parseBody(req);
    const photo = files.find(f => f.name === 'photo');
    if (photo && photo.buffer.length) {
      const ext = (path.extname(photo.filename) || '.jpg').slice(0, 5);
      const filename = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, filename), photo.buffer);
      db.prepare('INSERT INTO job_photos (job_id, file_path, photo_type, caption) VALUES (?,?,?,?)')
        .run(m[1], filename, fields.photo_type || 'before', fields.caption || null);
    }
    return redirect(res, `/jobs/${m[1]}?success=` + encodeURIComponent('Photo uploaded'));
  }

  if ((m = pathname.match(/^\/jobs\/(\d+)\/invoice$/)) && method === 'POST') {
    const job = getJobFull(m[1]);
    if (!job) return notFound(res);
    const settings = getSettings();
    const taxRate = Number(settings.tax_rate_pct || 0) / 100;
    const lineItems = [{ description: `${job.service_type} - ${job.label || job.address}`, qty: 1, rate: job.price }];
    const subtotal = lineItems.reduce((s, li) => s + li.qty * li.rate, 0);
    const taxAmount = subtotal * taxRate;
    const total = subtotal + taxAmount;
    const dueDate = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
    const info = db.prepare(`INSERT INTO invoices (invoice_number, customer_id, job_id, line_items_json, subtotal, tax_rate, tax_amount, total, status, due_date) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(nextInvoiceNumber(), job.customer_id, job.id, JSON.stringify(lineItems), subtotal, taxRate, taxAmount, total, 'sent', dueDate);
    return redirect(res, `/invoices/${info.lastInsertRowid}?success=` + encodeURIComponent('Invoice generated'));
  }

  if ((m = pathname.match(/^\/jobs\/(\d+)\/send-report$/)) && method === 'POST') {
    const { fields } = await parseBody(req);
    const job = getJobFull(m[1]);
    if (!job) return notFound(res);
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(job.customer_id);
    const settings = getSettings();
    const businessName = settings.business_name || 'HoodPro';
    const reportUrl = `${baseUrl(req, settings)}/portal/${customer.portal_token}/reports/${job.id}`;
    const channel = fields.channel === 'sms' ? 'sms' : 'email';
    const result = await sendJobOrInvoiceMessage({
      channel, settings, businessName,
      customer,
      subject: `Your service report from ${businessName}`,
      text: `Hi ${customer.contact_name || customer.business_name}, your kitchen exhaust service report from ${fmtDate(job.completed_at || job.scheduled_date)} is ready to view: ${reportUrl}`
    });
    logMessage({ customerId: customer.id, jobId: job.id, invoiceId: null, channel, recipient: result.recipient, subject: `Service report`, body: result.body, status: result.status });
    return redirect(res, `/jobs/${m[1]}?${result.ok ? 'success' : 'error'}=` + encodeURIComponent(result.message));
  }

  // Invoices
  if (pathname === '/invoices' && method === 'GET') {
    const invoices = db.prepare(`SELECT i.*, c.business_name FROM invoices i JOIN customers c ON c.id = i.customer_id ORDER BY i.created_at DESC`).all();
    return page('Invoices', 'Invoices', invoiceViews.invoicesList({ invoices }));
  }
  if ((m = pathname.match(/^\/invoices\/(\d+)$/)) && method === 'GET') {
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(m[1]);
    if (!invoice) return notFound(res);
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(invoice.customer_id);
    const lineItems = JSON.parse(invoice.line_items_json);
    const sentMessages = db.prepare(`SELECT * FROM messages_log WHERE invoice_id = ? ORDER BY created_at DESC`).all(invoice.id);
    const settings = getSettings();
    return page(`Invoice ${invoice.invoice_number}`, 'Invoices', invoiceViews.invoiceDetail({ invoice, customer, lineItems, sentMessages, qboConnected: qboConnected(settings) }));
  }
  if ((m = pathname.match(/^\/invoices\/(\d+)\/status$/)) && method === 'POST') {
    const { fields } = await parseBody(req);
    const paidAt = fields.status === 'paid' ? new Date().toISOString() : null;
    db.prepare('UPDATE invoices SET status = ?, paid_at = ? WHERE id = ?').run(fields.status, paidAt, m[1]);
    return redirect(res, `/invoices/${m[1]}?success=` + encodeURIComponent('Invoice updated'));
  }
  if ((m = pathname.match(/^\/invoices\/(\d+)\/send$/)) && method === 'POST') {
    const { fields } = await parseBody(req);
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(m[1]);
    if (!invoice) return notFound(res);
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(invoice.customer_id);
    const settings = getSettings();
    const businessName = settings.business_name || 'HoodPro';
    const invoiceUrl = `${baseUrl(req, settings)}/portal/${customer.portal_token}/invoices/${invoice.id}`;
    const channel = fields.channel === 'sms' ? 'sms' : 'email';
    const result = await sendJobOrInvoiceMessage({
      channel, settings, businessName,
      customer,
      subject: `Invoice ${invoice.invoice_number} from ${businessName}`,
      text: `Hi ${customer.contact_name || customer.business_name}, invoice ${invoice.invoice_number} for ${money(invoice.total)} is ready to view and pay: ${invoiceUrl}`
    });
    logMessage({ customerId: customer.id, jobId: null, invoiceId: invoice.id, channel, recipient: result.recipient, subject: `Invoice ${invoice.invoice_number}`, body: result.body, status: result.status });
    return redirect(res, `/invoices/${m[1]}?${result.ok ? 'success' : 'error'}=` + encodeURIComponent(result.message));
  }
  if ((m = pathname.match(/^\/invoices\/(\d+)\/sync-quickbooks$/)) && method === 'POST') {
    try {
      await qboSyncInvoice(m[1]);
      return redirect(res, `/invoices/${m[1]}?success=` + encodeURIComponent('Synced to QuickBooks'));
    } catch (err) {
      return redirect(res, `/invoices/${m[1]}?error=` + encodeURIComponent(err.message));
    }
  }

  // Crews
  if (pathname === '/crews' && method === 'GET') {
    const today = new Date().toISOString().slice(0,10);
    const weekEnd = new Date(Date.now() + 7*86400000).toISOString().slice(0,10);
    const crews = db.prepare('SELECT * FROM crews ORDER BY name').all().map(c => ({
      ...c,
      members: db.prepare('SELECT name, email FROM users WHERE crew_id = ?').all(c.id),
      jobCount: db.prepare('SELECT COUNT(*) c FROM jobs WHERE crew_id = ? AND scheduled_date BETWEEN ? AND ?').get(c.id, today, weekEnd).c
    }));
    return page('Crews', 'Crews', crewViews.crewsList({ crews }));
  }

  // Settings
  if (pathname === '/settings' && method === 'GET') {
    const users = db.prepare(`SELECT u.*, cr.name as crew_name FROM users u LEFT JOIN crews cr ON cr.id = u.crew_id ORDER BY u.name`).all();
    const crews = db.prepare('SELECT * FROM crews ORDER BY name').all();
    const settings = getSettings();
    return page('Settings', 'Settings', settingsViews.settingsPage({ users, crews, settings, qboConnected: qboConnected(settings) }));
  }
  if (pathname === '/settings/payments' && method === 'POST') {
    const { fields } = await parseBody(req);
    ['stripe_secret_key','stripe_publishable_key','paypal_client_id','paypal_client_secret'].forEach(k => setSetting(k, fields[k] || ''));
    return redirect(res, '/settings?success=' + encodeURIComponent('Payment settings saved'));
  }
  if (pathname === '/settings/notifications' && method === 'POST') {
    const { fields } = await parseBody(req);
    ['sendgrid_api_key','sendgrid_from_email','twilio_account_sid','twilio_auth_token','twilio_from_number'].forEach(k => setSetting(k, fields[k] || ''));
    return redirect(res, '/settings?success=' + encodeURIComponent('Notification settings saved'));
  }
  if (pathname === '/settings/business' && method === 'POST') {
    const { fields } = await parseBody(req);
    setSetting('tax_rate_pct', fields.tax_rate_pct || '0');
    setSetting('business_name', fields.business_name || 'HoodPro');
    setSetting('public_base_url', fields.public_base_url || '');
    return redirect(res, '/settings?success=' + encodeURIComponent('Business settings saved'));
  }
  if (pathname === '/settings/quickbooks' && method === 'POST') {
    const { fields } = await parseBody(req);
    setSetting('qbo_client_id', fields.qbo_client_id || '');
    setSetting('qbo_client_secret', fields.qbo_client_secret || '');
    setSetting('qbo_environment', fields.qbo_environment === 'production' ? 'production' : 'sandbox');
    setSetting('qbo_redirect_uri', fields.qbo_redirect_uri || '');
    return redirect(res, '/settings?success=' + encodeURIComponent('QuickBooks app settings saved'));
  }
  if (pathname === '/settings/users' && method === 'POST') {
    const { fields } = await parseBody(req);
    try {
      db.prepare('INSERT INTO users (name, email, password, role, crew_id) VALUES (?,?,?,?,?)')
        .run(fields.name, fields.email.toLowerCase(), hashPassword(fields.password), fields.role || 'tech', fields.crew_id || null);
      return redirect(res, '/settings?success=' + encodeURIComponent('Staff user added'));
    } catch (e) {
      return redirect(res, '/settings?error=' + encodeURIComponent('Could not add user (email may already exist)'));
    }
  }

  // QuickBooks OAuth + actions
  if (pathname === '/integrations/quickbooks/connect' && method === 'GET') {
    const settings = getSettings();
    if (!settings.qbo_client_id || !settings.qbo_client_secret) {
      return redirect(res, '/settings?error=' + encodeURIComponent('Add your QuickBooks Client ID and Secret first'));
    }
    const redirectUri = settings.qbo_redirect_uri || `${baseUrl(req, settings)}/integrations/quickbooks/callback`;
    const state = quickbooks.randomState();
    setSetting('qbo_oauth_state', state);
    const authUrl = quickbooks.getAuthUrl({ clientId: settings.qbo_client_id, redirectUri, state });
    res.writeHead(302, { Location: authUrl });
    return res.end();
  }

  if (pathname === '/integrations/quickbooks/callback' && method === 'GET') {
    const settings = getSettings();
    const code = parsedUrl.searchParams.get('code');
    const realmId = parsedUrl.searchParams.get('realmId');
    const state = parsedUrl.searchParams.get('state');
    if (!code || !realmId) return redirect(res, '/settings?error=' + encodeURIComponent('QuickBooks did not return an authorization code'));
    if (!state || state !== settings.qbo_oauth_state) return redirect(res, '/settings?error=' + encodeURIComponent('QuickBooks authorization state mismatch — please try connecting again'));
    const redirectUri = settings.qbo_redirect_uri || `${baseUrl(req, settings)}/integrations/quickbooks/callback`;
    try {
      const tokens = await quickbooks.exchangeCode({ clientId: settings.qbo_client_id, clientSecret: settings.qbo_client_secret, code, redirectUri });
      setSetting('qbo_access_token', tokens.access_token);
      setSetting('qbo_refresh_token', tokens.refresh_token);
      setSetting('qbo_access_expires_at', String(Date.now() + tokens.expires_in * 1000));
      setSetting('qbo_realm_id', realmId);
      setSetting('qbo_oauth_state', '');
      return redirect(res, '/settings?success=' + encodeURIComponent('QuickBooks connected'));
    } catch (err) {
      return redirect(res, '/settings?error=' + encodeURIComponent('QuickBooks connection failed: ' + err.message));
    }
  }

  if (pathname === '/integrations/quickbooks/disconnect' && method === 'POST') {
    ['qbo_access_token','qbo_refresh_token','qbo_access_expires_at','qbo_realm_id','qbo_service_item_id'].forEach(k => setSetting(k, ''));
    return redirect(res, '/settings?success=' + encodeURIComponent('QuickBooks disconnected'));
  }

  if (pathname === '/integrations/quickbooks/import-customers' && method === 'POST') {
    try {
      const result = await qboImportCustomers();
      return redirect(res, '/customers?success=' + encodeURIComponent(`Imported ${result.imported} new customers, updated ${result.updated} existing`));
    } catch (err) {
      return redirect(res, '/settings?error=' + encodeURIComponent('QuickBooks import failed: ' + err.message));
    }
  }

  return notFound(res);
}

function getJobFull(id) {
  return db.prepare(`
    SELECT j.*, c.business_name, l.label, l.address, cr.name as crew_name, a.service_type, a.price
    FROM jobs j
    JOIN customers c ON c.id = j.customer_id
    JOIN locations l ON l.id = j.location_id
    LEFT JOIN crews cr ON cr.id = j.crew_id
    LEFT JOIN service_agreements a ON a.id = j.agreement_id
    WHERE j.id = ?
  `).get(id);
}

function logMessage({ customerId, jobId, invoiceId, channel, recipient, subject, body, status }) {
  db.prepare(`INSERT INTO messages_log (customer_id, job_id, invoice_id, channel, recipient, subject, body, status) VALUES (?,?,?,?,?,?,?,?)`)
    .run(customerId, jobId, invoiceId, channel, recipient || '', subject || '', body || '', status);
}

// Sends a report/invoice notification via email or SMS. Falls back to demo mode
// (logged, not delivered) if the channel isn't configured in Settings, or if the
// customer has no email/phone on file.
async function sendJobOrInvoiceMessage({ channel, settings, businessName, customer, subject, text }) {
  if (channel === 'email') {
    if (!customer.email) return { ok: false, message: 'This customer has no email on file', recipient: '', body: text, status: 'failed' };
    const result = await notify.sendEmail({
      apiKey: settings.sendgrid_api_key, fromEmail: settings.sendgrid_from_email, fromName: businessName,
      to: customer.email, subject, text
    });
    if (result.demo) return { ok: true, message: 'Email logged (demo mode — add a SendGrid key in Settings to actually deliver it)', recipient: customer.email, body: text, status: 'demo' };
    return { ok: result.ok, message: result.ok ? 'Email sent' : 'Email failed to send — check your SendGrid settings', recipient: customer.email, body: text, status: result.ok ? 'sent' : 'failed' };
  } else {
    if (!customer.phone) return { ok: false, message: 'This customer has no phone on file', recipient: '', body: text, status: 'failed' };
    const result = await notify.sendSms({
      accountSid: settings.twilio_account_sid, authToken: settings.twilio_auth_token, fromNumber: settings.twilio_from_number,
      to: customer.phone, body: text
    });
    if (result.demo) return { ok: true, message: 'Text logged (demo mode — add Twilio credentials in Settings to actually deliver it)', recipient: customer.phone, body: text, status: 'demo' };
    return { ok: result.ok, message: result.ok ? 'Text sent' : 'Text failed to send — check your Twilio settings', recipient: customer.phone, body: text, status: result.ok ? 'sent' : 'failed' };
  }
}

// ---------- portal (customer-facing) routes ----------

async function handlePortal(req, res, pathname, method, parsedUrl) {
  const parts = pathname.split('/').filter(Boolean); // ['portal', token, ...rest]
  const token = parts[1];
  const customer = token ? db.prepare('SELECT * FROM customers WHERE portal_token = ?').get(token) : null;
  if (!customer) return notFound(res);

  const rest = parts.slice(2);
  const page = (title, active, body) => send(res, 200, portalLayout({ title, customer, active, body }));

  if (rest.length === 0 && method === 'GET') {
    const locations = db.prepare('SELECT * FROM locations WHERE customer_id = ?').all(customer.id);
    const agreements = db.prepare(`SELECT a.*, l.label, l.address FROM service_agreements a JOIN locations l ON l.id = a.location_id WHERE a.customer_id = ? AND a.active = 1 ORDER BY a.next_due_date`).all(customer.id);
    const recentJobs = db.prepare(`SELECT j.*, l.label, l.address FROM jobs j JOIN locations l ON l.id = j.location_id WHERE j.customer_id = ? ORDER BY j.scheduled_date DESC LIMIT 10`).all(customer.id);
    return page('Overview', 'Overview', portalViews.overview({ customer, locations, agreements, recentJobs }));
  }

  if (rest[0] === 'reports' && rest.length === 1 && method === 'GET') {
    const jobs = db.prepare(`SELECT j.*, l.label, l.address FROM jobs j JOIN locations l ON l.id = j.location_id WHERE j.customer_id = ? AND j.status = 'completed' ORDER BY j.completed_at DESC`).all(customer.id);
    return page('Service Reports', 'Service Reports', portalViews.reportsList({ customer, jobs }));
  }

  if (rest[0] === 'reports' && rest.length === 2 && method === 'GET') {
    const job = db.prepare(`SELECT j.*, l.label, l.address, a.service_type FROM jobs j JOIN locations l ON l.id = j.location_id LEFT JOIN service_agreements a ON a.id = j.agreement_id WHERE j.id = ? AND j.customer_id = ?`).get(rest[1], customer.id);
    if (!job) return notFound(res);
    const photos = db.prepare('SELECT * FROM job_photos WHERE job_id = ?').all(job.id);
    let checklist = [];
    try { checklist = job.checklist_json ? JSON.parse(job.checklist_json) : []; } catch (e) { checklist = []; }
    return page('Service Report', 'Service Reports', portalViews.reportDetail({ customer, job, photos, checklist }));
  }

  if (rest[0] === 'invoices' && rest.length === 1 && method === 'GET') {
    const invoices = db.prepare('SELECT * FROM invoices WHERE customer_id = ? ORDER BY created_at DESC').all(customer.id);
    return page('Invoices', 'Invoices', portalViews.invoicesList({ customer, invoices }));
  }

  if (rest[0] === 'invoices' && rest.length === 2 && method === 'GET') {
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND customer_id = ?').get(rest[1], customer.id);
    if (!invoice) return notFound(res);
    const settings = getSettings();
    const lineItems = JSON.parse(invoice.line_items_json);
    return page(`Invoice ${invoice.invoice_number}`, 'Invoices', portalViews.invoiceDetail({
      customer, invoice, lineItems,
      paypalClientId: settings.paypal_client_id || '',
      stripeConfigured: !!(settings.stripe_secret_key)
    }));
  }

  const payMatch = rest.length === 4 && rest[0] === 'invoices' && rest[2] === 'pay';
  if (payMatch && method === 'POST') {
    const invoiceId = rest[1];
    const methodType = rest[3]; // card, paypal, venmo
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND customer_id = ?').get(invoiceId, customer.id);
    if (!invoice) return notFound(res);

    // Demo mode: record payment and mark invoice paid immediately.
    // To go live: wire this to a real Stripe Checkout Session (card) or PayPal Orders API
    // capture (paypal/venmo) using the keys saved in Settings, then only mark paid on
    // a verified webhook/callback instead of immediately.
    db.prepare('INSERT INTO payments (invoice_id, amount, method, status, transaction_ref) VALUES (?,?,?,?,?)')
      .run(invoice.id, invoice.total, methodType, 'completed', 'DEMO-' + randomToken(6));
    db.prepare(`UPDATE invoices SET status = 'paid', paid_at = ? WHERE id = ?`).run(new Date().toISOString(), invoice.id);
    return redirect(res, `/portal/${customer.portal_token}/invoices/${invoice.id}`);
  }

  return notFound(res);
}

// ---------- start server ----------

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    console.error(err);
    send(res, 500, `<h1>Something went wrong</h1><pre>${(err && err.stack) || err}</pre>`);
  });
});

server.listen(PORT, () => {
  console.log(`HoodPro running at http://localhost:${PORT}`);
  console.log(`Default login: admin@example.com / changeme123`);
});
