const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const { hashPassword, randomToken } = require('./lib/auth');

const DB_PATH = path.join(__dirname, 'data', 'hoodpro.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const isNew = !fs.existsSync(DB_PATH);

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS crews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'tech', -- 'admin' or 'tech'
  crew_id INTEGER REFERENCES crews(id)
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  billing_address TEXT,
  portal_token TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  label TEXT,
  address TEXT NOT NULL,
  hood_count INTEGER DEFAULT 1,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS service_agreements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  service_type TEXT NOT NULL DEFAULT 'Kitchen Exhaust Hood Cleaning',
  frequency_months INTEGER NOT NULL DEFAULT 3, -- 1,3,6,12
  price REAL NOT NULL DEFAULT 0,
  next_due_date TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agreement_id INTEGER NOT NULL REFERENCES service_agreements(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  crew_id INTEGER REFERENCES crews(id),
  scheduled_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled, in_progress, completed, canceled
  checklist_json TEXT,
  tech_notes TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS job_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  file_path TEXT NOT NULL,
  photo_type TEXT NOT NULL DEFAULT 'before', -- before, after, deficiency
  caption TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT UNIQUE NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  job_id INTEGER REFERENCES jobs(id),
  line_items_json TEXT NOT NULL,
  subtotal REAL NOT NULL,
  tax_rate REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- draft, sent, paid, void
  due_date TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  amount REAL NOT NULL,
  method TEXT NOT NULL, -- card, paypal, venmo, manual
  status TEXT NOT NULL DEFAULT 'completed',
  transaction_ref TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  clock_in TEXT NOT NULL,
  clock_out TEXT
);

CREATE TABLE IF NOT EXISTS messages_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  job_id INTEGER REFERENCES jobs(id),
  invoice_id INTEGER REFERENCES invoices(id),
  channel TEXT NOT NULL, -- email, sms
  recipient TEXT NOT NULL,
  subject TEXT,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'demo', -- sent, demo, failed
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id),
  business_name TEXT NOT NULL,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  site_address TEXT,
  building_stories INTEGER,
  hood_count INTEGER,
  hood_length_ft REAL,
  filter_count INTEGER,
  access_panel_count INTEGER,
  duct_vertical_length_ft REAL,
  duct_horizontal_length_ft REAL,
  fan_type TEXT,
  fan_notes TEXT,
  water_access TEXT,
  water_access_notes TEXT,
  security_access_notes TEXT,
  alarm_code TEXT,
  key_access_type TEXT,
  key_access_notes TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft', -- draft, sent, won, lost
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// ---- lightweight migrations: add columns to tables that already existed before this feature ----
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn('customers', 'qbo_customer_id', 'qbo_customer_id TEXT');
ensureColumn('customers', 'qbo_sync_token', 'qbo_sync_token TEXT');
ensureColumn('invoices', 'qbo_invoice_id', 'qbo_invoice_id TEXT');
ensureColumn('invoices', 'qbo_sync_status', 'qbo_sync_status TEXT');
ensureColumn('invoices', 'qbo_synced_at', 'qbo_synced_at TEXT');
ensureColumn('payments', 'qbo_payment_id', 'qbo_payment_id TEXT');

function seed() {
  const crewCount = db.prepare('SELECT COUNT(*) AS c FROM crews').get().c;
  if (crewCount === 0) {
    const insCrew = db.prepare('INSERT INTO crews (name) VALUES (?)');
    ['Team 1', 'Team 2', 'Team 3', 'Team 4'].forEach(n => insCrew.run(n));
  }

  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount === 0) {
    const insUser = db.prepare('INSERT INTO users (name, email, password, role, crew_id) VALUES (?,?,?,?,?)');
    insUser.run('Owner Admin', 'admin@example.com', hashPassword('changeme123'), 'admin', null);
    insUser.run('Team 1 Tech', 'team1@example.com', hashPassword('changeme123'), 'tech', 1);
  }

  const custCount = db.prepare('SELECT COUNT(*) AS c FROM customers').get().c;
  if (custCount === 0) {
    const insCust = db.prepare(`INSERT INTO customers (business_name, contact_name, email, phone, billing_address, portal_token) VALUES (?,?,?,?,?,?)`);
    const info = insCust.run('Main Street Diner', 'Jamie Rivera', 'manager@mainstreetdiner.example', '555-0142', '123 Main St, Springfield', randomToken());
    const customerId = Number(info.lastInsertRowid);

    const insLoc = db.prepare(`INSERT INTO locations (customer_id, label, address, hood_count, notes) VALUES (?,?,?,?,?)`);
    const locInfo = insLoc.run(customerId, 'Main Kitchen', '123 Main St, Springfield', 2, 'Two Type I hoods over fryers and charbroiler.');
    const locationId = Number(locInfo.lastInsertRowid);

    const nextDue = new Date();
    nextDue.setDate(nextDue.getDate() + 7);
    const insAgreement = db.prepare(`INSERT INTO service_agreements (customer_id, location_id, service_type, frequency_months, price, next_due_date) VALUES (?,?,?,?,?,?)`);
    const agInfo = insAgreement.run(customerId, locationId, 'Kitchen Exhaust Hood Cleaning', 3, 425.00, nextDue.toISOString().slice(0, 10));
    const agreementId = Number(agInfo.lastInsertRowid);

    const insJob = db.prepare(`INSERT INTO jobs (agreement_id, customer_id, location_id, crew_id, scheduled_date, status) VALUES (?,?,?,?,?,?)`);
    insJob.run(agreementId, customerId, locationId, 1, nextDue.toISOString().slice(0, 10), 'scheduled');
  }
}

seed();

module.exports = db;
