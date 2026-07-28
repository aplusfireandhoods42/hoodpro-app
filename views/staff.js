const { esc, money, fmtDate } = require('../lib/layout');

function loginPage({ error }) {
  return `
  <div class="login-wrap">
    <div class="card">
      <h1>&#128293; HoodPro</h1>
      <p class="subtitle">Kitchen exhaust &amp; hood cleaning service management</p>
      ${error ? `<div class="flash error">${esc(error)}</div>` : ''}
      <form method="POST" action="/login">
        <label>Email</label>
        <input type="email" name="email" required autofocus>
        <label>Password</label>
        <input type="password" name="password" required>
        <div style="margin-top:18px;">
          <button class="btn" type="submit" style="width:100%;">Log In</button>
        </div>
      </form>
      <p class="help-text">Default admin login: admin@example.com / changeme123 (change this in Settings after first login).</p>
    </div>
  </div>`;
}

function dashboard({ upcoming, overdue, outstandingInvoices, stats }) {
  return `
  <h1>Dashboard</h1>
  <p class="subtitle">${fmtDate(new Date().toISOString().slice(0,10))}</p>

  <div class="grid grid-3">
    <div class="card stat"><div class="num">${stats.activeAgreements}</div><div class="label">Active Recurring Contracts</div></div>
    <div class="card stat"><div class="num">${stats.jobsThisWeek}</div><div class="label">Jobs This Week</div></div>
    <div class="card stat"><div class="num">${money(stats.outstandingTotal)}</div><div class="label">Outstanding Invoices</div></div>
  </div>

  <div class="grid grid-2">
    <div class="card">
      <h2>Upcoming &amp; Due Services</h2>
      ${upcoming.length ? `<table><thead><tr><th>Customer</th><th>Location</th><th>Due</th><th>Crew</th><th></th></tr></thead><tbody>
        ${upcoming.map(j => `<tr>
          <td>${esc(j.business_name)}</td>
          <td>${esc(j.label || j.address)}</td>
          <td>${fmtDate(j.scheduled_date)}</td>
          <td>${esc(j.crew_name || '&mdash;')}</td>
          <td><a class="btn small outline" href="/jobs/${j.id}">Open</a></td>
        </tr>`).join('')}
      </tbody></table>` : '<p class="muted">No upcoming jobs scheduled.</p>'}
    </div>
    <div class="card">
      <h2>Overdue Services</h2>
      ${overdue.length ? `<table><thead><tr><th>Customer</th><th>Location</th><th>Due</th><th></th></tr></thead><tbody>
        ${overdue.map(a => `<tr>
          <td>${esc(a.business_name)}</td>
          <td>${esc(a.label || a.address)}</td>
          <td style="color:var(--bad);">${fmtDate(a.next_due_date)}</td>
          <td><a class="btn small outline" href="/customers/${a.customer_id}">View</a></td>
        </tr>`).join('')}
      </tbody></table>` : '<p class="muted">Nothing overdue &mdash; nice work.</p>'}
    </div>
  </div>

  <div class="card">
    <h2>Outstanding Invoices</h2>
    ${outstandingInvoices.length ? `<table><thead><tr><th>Invoice #</th><th>Customer</th><th>Due</th><th class="num">Total</th><th>Status</th><th></th></tr></thead><tbody>
      ${outstandingInvoices.map(i => `<tr>
        <td>${esc(i.invoice_number)}</td>
        <td>${esc(i.business_name)}</td>
        <td>${fmtDate(i.due_date)}</td>
        <td class="num">${money(i.total)}</td>
        <td><span class="badge ${i.status}">${i.status}</span></td>
        <td><a class="btn small outline" href="/invoices/${i.id}">Open</a></td>
      </tr>`).join('')}
    </tbody></table>` : '<p class="muted">No outstanding invoices.</p>'}
  </div>
  `;
}

function customersList({ customers }) {
  return `
  <h1>Customers</h1>
  <p class="subtitle"><a class="btn ember" href="/customers/new">+ New Customer</a></p>
  <div class="card">
    <table><thead><tr><th>Business</th><th>Contact</th><th>Phone</th><th>Locations</th><th></th></tr></thead><tbody>
      ${customers.map(c => `<tr>
        <td>${esc(c.business_name)}</td>
        <td>${esc(c.contact_name || '')}</td>
        <td>${esc(c.phone || '')}</td>
        <td>${c.location_count}</td>
        <td><a class="btn small outline" href="/customers/${c.id}">Open</a></td>
      </tr>`).join('')}
    </tbody></table>
  </div>`;
}

function customerNew() {
  return `
  <h1>New Customer</h1>
  <div class="card">
    <form method="POST" action="/customers">
      <label>Business Name</label>
      <input name="business_name" required>
      <label>Contact Name</label>
      <input name="contact_name">
      <label>Email</label>
      <input type="email" name="email">
      <label>Phone</label>
      <input name="phone">
      <label>Billing Address</label>
      <textarea name="billing_address"></textarea>
      <div style="margin-top:18px;"><button class="btn" type="submit">Create Customer</button></div>
    </form>
  </div>`;
}

function customerDetail({ customer, locations, agreements, jobs, invoices }) {
  const portalUrl = `/portal/${customer.portal_token}`;
  return `
  <h1>${esc(customer.business_name)}</h1>
  <p class="subtitle">${esc(customer.contact_name || '')} ${customer.phone ? '&middot; ' + esc(customer.phone) : ''} ${customer.email ? '&middot; ' + esc(customer.email) : ''}</p>

  <div class="card">
    <h2>Customer Portal Link</h2>
    <p class="muted">Share this link with the customer to review reports, photos, and invoices, and to pay online.</p>
    <input readonly value="${esc(portalUrl)}" onclick="this.select()">
    <p class="help-text">Full link (once deployed): https://yourdomain.com${esc(portalUrl)}</p>
  </div>

  <div class="grid grid-2">
    <div class="card">
      <h2>Locations</h2>
      ${locations.map(l => `<div style="margin-bottom:10px;"><strong>${esc(l.label || 'Location')}</strong><br><span class="muted">${esc(l.address)}</span> &middot; ${l.hood_count} hood(s)</div>`).join('') || '<p class="muted">No locations yet.</p>'}
      <form method="POST" action="/customers/${customer.id}/locations">
        <label>Add Location &ndash; Label</label>
        <input name="label" placeholder="Main Kitchen">
        <label>Address</label>
        <input name="address" required>
        <label>Hood Count</label>
        <input name="hood_count" type="number" value="1" min="1">
        <label>Notes</label>
        <textarea name="notes" placeholder="Type I hoods, fryer + charbroiler, etc."></textarea>
        <div style="margin-top:14px;"><button class="btn small" type="submit">Add Location</button></div>
      </form>
    </div>

    <div class="card">
      <h2>Recurring Service Agreements</h2>
      ${agreements.map(a => `<div style="margin-bottom:10px;">
        <strong>${esc(a.service_type)}</strong> &middot; every ${a.frequency_months} mo &middot; ${money(a.price)}<br>
        <span class="muted">${esc(a.label || a.address)} &middot; next due ${fmtDate(a.next_due_date)}</span>
      </div>`).join('') || '<p class="muted">No recurring agreements yet.</p>'}
      ${locations.length ? `<form method="POST" action="/customers/${customer.id}/agreements">
        <label>Location</label>
        <select name="location_id">
          ${locations.map(l => `<option value="${l.id}">${esc(l.label || l.address)}</option>`).join('')}
        </select>
        <label>Service Type</label>
        <input name="service_type" value="Kitchen Exhaust Hood Cleaning">
        <label>Frequency</label>
        <select name="frequency_months">
          <option value="1">Monthly</option>
          <option value="3" selected>Quarterly</option>
          <option value="6">Semi-Annual</option>
          <option value="12">Annual</option>
        </select>
        <label>Price per Service</label>
        <input name="price" type="number" step="0.01" value="425.00">
        <label>First Service Date</label>
        <input name="next_due_date" type="date" required>
        <div style="margin-top:14px;"><button class="btn small" type="submit">Create Agreement</button></div>
      </form>` : '<p class="help-text">Add a location first.</p>'}
    </div>
  </div>

  <div class="card">
    <h2>Job History</h2>
    ${jobs.length ? `<table><thead><tr><th>Date</th><th>Location</th><th>Crew</th><th>Status</th><th></th></tr></thead><tbody>
      ${jobs.map(j => `<tr>
        <td>${fmtDate(j.scheduled_date)}</td>
        <td>${esc(j.label || j.address)}</td>
        <td>${esc(j.crew_name || '&mdash;')}</td>
        <td><span class="badge ${j.status}">${j.status.replace('_',' ')}</span></td>
        <td><a class="btn small outline" href="/jobs/${j.id}">Open</a></td>
      </tr>`).join('')}
    </tbody></table>` : '<p class="muted">No jobs yet.</p>'}
  </div>

  <div class="card">
    <h2>Invoices</h2>
    ${invoices.length ? `<table><thead><tr><th>Invoice #</th><th>Date</th><th class="num">Total</th><th>Status</th><th></th></tr></thead><tbody>
      ${invoices.map(i => `<tr>
        <td>${esc(i.invoice_number)}</td>
        <td>${fmtDate(i.created_at)}</td>
        <td class="num">${money(i.total)}</td>
        <td><span class="badge ${i.status}">${i.status}</span></td>
        <td><a class="btn small outline" href="/invoices/${i.id}">Open</a></td>
      </tr>`).join('')}
    </tbody></table>` : '<p class="muted">No invoices yet.</p>'}
  </div>
  `;
}

module.exports = { loginPage, dashboard, customersList, customerNew, customerDetail };
