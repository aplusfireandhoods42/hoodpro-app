const { esc, money, fmtDate } = require('../lib/layout');

function overview({ customer, locations, agreements, recentJobs }) {
  return `
  <h1>Welcome, ${esc(customer.contact_name || customer.business_name)}</h1>
  <p class="subtitle">Here's the latest on your kitchen exhaust service.</p>

  <div class="grid grid-2">
    <div class="card">
      <h2>Your Locations</h2>
      ${locations.map(l => `<div style="margin-bottom:10px;"><strong>${esc(l.label || 'Location')}</strong><br><span class="muted">${esc(l.address)}</span></div>`).join('') || '<p class="muted">No locations on file.</p>'}
    </div>
    <div class="card">
      <h2>Upcoming Service</h2>
      ${agreements.map(a => `<div style="margin-bottom:10px;">
        <strong>${esc(a.service_type)}</strong><br>
        <span class="muted">${esc(a.label || a.address)} &middot; next due ${fmtDate(a.next_due_date)} &middot; every ${a.frequency_months} mo</span>
      </div>`).join('') || '<p class="muted">No recurring service scheduled.</p>'}
    </div>
  </div>

  <div class="card">
    <h2>Recent Service Visits</h2>
    ${recentJobs.length ? `<table><thead><tr><th>Date</th><th>Location</th><th>Status</th><th></th></tr></thead><tbody>
      ${recentJobs.map(j => `<tr>
        <td>${fmtDate(j.scheduled_date)}</td>
        <td>${esc(j.label || j.address)}</td>
        <td><span class="badge ${j.status}">${j.status.replace('_',' ')}</span></td>
        <td>${j.status === 'completed' ? `<a class="btn small outline" href="/portal/${customer.portal_token}/reports/${j.id}">View Report</a>` : ''}</td>
      </tr>`).join('')}
    </tbody></table>` : '<p class="muted">No service visits yet.</p>'}
  </div>`;
}

function reportsList({ customer, jobs }) {
  return `
  <h1>Service Reports</h1>
  <div class="card">
    ${jobs.length ? `<table><thead><tr><th>Date</th><th>Location</th><th></th></tr></thead><tbody>
      ${jobs.map(j => `<tr>
        <td>${fmtDate(j.completed_at || j.scheduled_date)}</td>
        <td>${esc(j.label || j.address)}</td>
        <td><a class="btn small outline" href="/portal/${customer.portal_token}/reports/${j.id}">View</a></td>
      </tr>`).join('')}
    </tbody></table>` : '<p class="muted">No completed service reports yet.</p>'}
  </div>`;
}

function reportDetail({ customer, job, photos, checklist }) {
  const beforePhotos = photos.filter(p => p.photo_type === 'before');
  const afterPhotos = photos.filter(p => p.photo_type === 'after');
  const deficiencyPhotos = photos.filter(p => p.photo_type === 'deficiency');
  return `
  <h1>Service Report &mdash; ${fmtDate(job.completed_at || job.scheduled_date)}</h1>
  <p class="subtitle">${esc(job.label || job.address)} &middot; ${esc(job.service_type)}</p>

  <div class="card">
    <h2>NFPA 96 Service Checklist</h2>
    <ul>${checklist.map(c => `<li>${c.done ? '&#9989;' : '&#9744;'} ${esc(c.text)}</li>`).join('')}</ul>
    ${job.tech_notes ? `<div class="divider"></div><h2>Technician Notes</h2><p>${esc(job.tech_notes)}</p>` : ''}
  </div>

  <div class="card">
    <h2>Before</h2>
    <div class="photo-grid">${beforePhotos.map(photoFig).join('') || '<p class="muted">No photos.</p>'}</div>
    <h2 style="margin-top:18px;">After</h2>
    <div class="photo-grid">${afterPhotos.map(photoFig).join('') || '<p class="muted">No photos.</p>'}</div>
    ${deficiencyPhotos.length ? `<h2 style="margin-top:18px;">Deficiencies Noted</h2><div class="photo-grid">${deficiencyPhotos.map(photoFig).join('')}</div>` : ''}
  </div>`;
}

function photoFig(p) {
  return `<figure><img src="/uploads/${esc(p.file_path)}" alt="${esc(p.caption||'')}"><figcaption>${esc(p.caption || '')}</figcaption></figure>`;
}

function invoicesList({ customer, invoices }) {
  return `
  <h1>Invoices</h1>
  <div class="card">
    ${invoices.length ? `<table><thead><tr><th>Invoice #</th><th>Date</th><th class="num">Total</th><th>Status</th><th></th></tr></thead><tbody>
      ${invoices.map(i => `<tr>
        <td>${esc(i.invoice_number)}</td>
        <td>${fmtDate(i.created_at)}</td>
        <td class="num">${money(i.total)}</td>
        <td><span class="badge ${i.status === 'paid' ? 'paid' : (i.due_date && i.due_date < todayStr() ? 'overdue' : i.status)}">${i.status === 'paid' ? 'paid' : (i.due_date && i.due_date < todayStr() ? 'overdue' : i.status)}</span></td>
        <td><a class="btn small outline" href="/portal/${customer.portal_token}/invoices/${i.id}">View</a></td>
      </tr>`).join('')}
    </tbody></table>` : '<p class="muted">No invoices yet.</p>'}
  </div>`;
}

function todayStr() { return new Date().toISOString().slice(0,10); }

function invoiceDetail({ customer, invoice, lineItems, paypalClientId, stripeConfigured }) {
  const isPaid = invoice.status === 'paid';
  return `
  <h1>Invoice ${esc(invoice.invoice_number)}</h1>
  <p class="subtitle"><span class="badge ${invoice.status}">${invoice.status}</span> ${invoice.due_date ? '&middot; due ' + fmtDate(invoice.due_date) : ''}</p>

  <div class="grid grid-2">
    <div class="card">
      <table class="line-items"><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>
        ${lineItems.map(li => `<tr><td>${esc(li.description)}</td><td class="num">${li.qty}</td><td class="num">${money(li.rate)}</td><td class="num">${money(li.qty * li.rate)}</td></tr>`).join('')}
      </tbody></table>
      <div class="divider"></div>
      <table>
        <tr><td class="right muted">Subtotal</td><td class="num" style="width:120px;">${money(invoice.subtotal)}</td></tr>
        <tr><td class="right muted">Tax</td><td class="num">${money(invoice.tax_amount)}</td></tr>
        <tr><td class="right"><strong>Total</strong></td><td class="num"><strong>${money(invoice.total)}</strong></td></tr>
      </table>
    </div>

    <div class="card">
      <h2>Payment</h2>
      ${isPaid ? `<p style="color:var(--good);"><strong>Paid in full.</strong> Thank you!</p>` : `
      <div class="pay-buttons">
        <form method="POST" action="/portal/${customer.portal_token}/invoices/${invoice.id}/pay/card">
          <button class="btn ember" type="submit" style="width:100%;">Pay ${money(invoice.total)} by Card${stripeConfigured ? '' : ' (demo)'}</button>
        </form>
        <div id="paypal-button-container"></div>
        <form method="POST" action="/portal/${customer.portal_token}/invoices/${invoice.id}/pay/paypal" id="paypal-demo-form">
          <input type="hidden" name="method" value="paypal">
          <button class="btn outline" type="submit" style="width:100%;">Pay with PayPal${paypalClientId ? '' : ' (demo)'}</button>
        </form>
        <form method="POST" action="/portal/${customer.portal_token}/invoices/${invoice.id}/pay/venmo">
          <button class="btn outline" type="submit" style="width:100%;">Pay with Venmo${paypalClientId ? '' : ' (demo)'}</button>
        </form>
      </div>
      <p class="help-text">${stripeConfigured || paypalClientId ? 'Payments are processed securely.' : 'Payment processing keys are not yet configured &mdash; the business owner can add Stripe and PayPal keys in Settings to accept real card, PayPal, and Venmo payments here.'}</p>
      `}
    </div>
  </div>`;
}

module.exports = { overview, reportsList, reportDetail, invoicesList, invoiceDetail };
