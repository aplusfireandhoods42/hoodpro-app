const { esc, money, fmtDate } = require('../lib/layout');

function invoicesList({ invoices }) {
  return `
  <h1>Invoices</h1>
  <div class="card">
    <table><thead><tr><th>Invoice #</th><th>Customer</th><th>Date</th><th>Due</th><th class="num">Total</th><th>Status</th><th></th></tr></thead><tbody>
      ${invoices.map(i => `<tr>
        <td>${esc(i.invoice_number)}</td>
        <td>${esc(i.business_name)}</td>
        <td>${fmtDate(i.created_at)}</td>
        <td>${fmtDate(i.due_date)}</td>
        <td class="num">${money(i.total)}</td>
        <td><span class="badge ${i.status}">${i.status}</span></td>
        <td><a class="btn small outline" href="/invoices/${i.id}">Open</a></td>
      </tr>`).join('')}
    </tbody></table>
  </div>`;
}

function invoiceDetail({ invoice, customer, lineItems, sentMessages, qboConnected }) {
  return `
  <h1>Invoice ${esc(invoice.invoice_number)}</h1>
  <p class="subtitle">${esc(customer.business_name)} &middot; <span class="badge ${invoice.status}">${invoice.status}</span></p>

  <div class="card">
    <table class="line-items"><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>
      ${lineItems.map(li => `<tr><td>${esc(li.description)}</td><td class="num">${li.qty}</td><td class="num">${money(li.rate)}</td><td class="num">${money(li.qty * li.rate)}</td></tr>`).join('')}
    </tbody></table>
    <div class="divider"></div>
    <table>
      <tr><td class="right muted">Subtotal</td><td class="num" style="width:120px;">${money(invoice.subtotal)}</td></tr>
      <tr><td class="right muted">Tax (${(invoice.tax_rate*100).toFixed(2)}%)</td><td class="num">${money(invoice.tax_amount)}</td></tr>
      <tr><td class="right"><strong>Total</strong></td><td class="num"><strong>${money(invoice.total)}</strong></td></tr>
    </table>
  </div>

  <div class="card">
    <h2>Status</h2>
    <form method="POST" action="/invoices/${invoice.id}/status">
      <select name="status">
        ${['draft','sent','paid','void'].map(s => `<option value="${s}" ${invoice.status===s?'selected':''}>${s}</option>`).join('')}
      </select>
      <div style="margin-top:10px;"><button class="btn small outline" type="submit">Update Status</button></div>
    </form>
    <p class="help-text" style="margin-top:14px;">Customer-facing payment link: /portal/${esc(customer.portal_token)}/invoices/${invoice.id}</p>
  </div>

  <div class="card">
    <h2>Send Invoice to Customer</h2>
    <p class="muted">Sends the customer a link to view and pay this invoice on their portal.</p>
    <div style="display:flex; gap:10px; flex-wrap:wrap;">
      <form method="POST" action="/invoices/${invoice.id}/send">
        <input type="hidden" name="channel" value="email">
        <button class="btn small outline" type="submit" ${customer.email ? '' : 'disabled'}>Email Invoice${customer.email ? '' : ' (no email on file)'}</button>
      </form>
      <form method="POST" action="/invoices/${invoice.id}/send">
        <input type="hidden" name="channel" value="sms">
        <button class="btn small outline" type="submit" ${customer.phone ? '' : 'disabled'}>Text Invoice${customer.phone ? '' : ' (no phone on file)'}</button>
      </form>
    </div>
    ${sentMessages.length ? `<div class="divider"></div><p class="muted" style="font-size:0.85rem;">${sentMessages.map(m => `Sent ${esc(m.channel)} to ${esc(m.recipient)} on ${fmtDate(m.created_at)} &mdash; ${m.status === 'demo' ? '<em>demo mode, not actually delivered</em>' : m.status}`).join('<br>')}</p>` : ''}
  </div>

  <div class="card">
    <h2>QuickBooks Online</h2>
    ${invoice.qbo_invoice_id
      ? `<p style="color:var(--good);">Synced to QuickBooks (Invoice #${esc(invoice.qbo_invoice_id)})${invoice.qbo_synced_at ? ' on ' + fmtDate(invoice.qbo_synced_at) : ''}.</p>`
      : qboConnected
        ? `<p class="muted">Not yet synced.</p><form method="POST" action="/invoices/${invoice.id}/sync-quickbooks"><button class="btn small outline" type="submit">Sync to QuickBooks</button></form>`
        : `<p class="muted">Connect QuickBooks in Settings to sync invoices and payments automatically.</p>`
    }
  </div>`;
}

module.exports = { invoicesList, invoiceDetail };
