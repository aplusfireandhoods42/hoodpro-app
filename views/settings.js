const { esc } = require('../lib/layout');

function settingsPage({ users, crews, settings, qboConnected }) {
  return `
  <h1>Settings</h1>

  <div class="card">
    <h2>Business Info</h2>
    <form method="POST" action="/settings/business">
      <label>Business Name (used in emails/texts to customers)</label>
      <input name="business_name" value="${esc(settings.business_name || 'HoodPro')}">
      <label>Public Web Address (once deployed, e.g. https://service.yourcompany.com)</label>
      <input name="public_base_url" value="${esc(settings.public_base_url || '')}" placeholder="https://your-domain.com">
      <p class="help-text">Used to build the links sent in report/invoice emails and texts. Leave blank to use whatever address this app is currently running on.</p>
      <label>Tax Rate (%)</label>
      <input name="tax_rate_pct" type="number" step="0.01" value="${esc(settings.tax_rate_pct || '0')}">
      <div style="margin-top:14px;"><button class="btn" type="submit">Save</button></div>
    </form>
  </div>

  <div class="card">
    <h2>Payment Integration Keys</h2>
    <p class="muted">Add real API keys from your Stripe and PayPal business accounts to accept live card, PayPal, and Venmo payments through the customer portal. Until these are set, the portal runs in demo mode (payments are recorded but not actually charged).</p>
    <form method="POST" action="/settings/payments">
      <label>Stripe Secret Key</label>
      <input name="stripe_secret_key" value="${esc(settings.stripe_secret_key || '')}" placeholder="sk_live_...">
      <label>Stripe Publishable Key</label>
      <input name="stripe_publishable_key" value="${esc(settings.stripe_publishable_key || '')}" placeholder="pk_live_...">
      <label>PayPal Client ID (enables PayPal + Venmo buttons)</label>
      <input name="paypal_client_id" value="${esc(settings.paypal_client_id || '')}" placeholder="Live PayPal REST app client ID">
      <label>PayPal Client Secret</label>
      <input name="paypal_client_secret" value="${esc(settings.paypal_client_secret || '')}" placeholder="Used server-side to capture payments">
      <div style="margin-top:14px;"><button class="btn" type="submit">Save Payment Settings</button></div>
    </form>
  </div>

  <div class="card">
    <h2>Email &amp; Text Notifications</h2>
    <p class="muted">Add a SendGrid account to send real report/invoice emails, and a Twilio account to send real text messages. Until these are set, sending runs in demo mode (the message is logged but nothing is actually delivered).</p>
    <form method="POST" action="/settings/notifications">
      <label>SendGrid API Key</label>
      <input name="sendgrid_api_key" value="${esc(settings.sendgrid_api_key || '')}" placeholder="SG.xxxxx">
      <label>From Email (must be a verified sender in SendGrid)</label>
      <input name="sendgrid_from_email" value="${esc(settings.sendgrid_from_email || '')}" placeholder="service@yourcompany.com">
      <div class="divider"></div>
      <label>Twilio Account SID</label>
      <input name="twilio_account_sid" value="${esc(settings.twilio_account_sid || '')}" placeholder="ACxxxxx">
      <label>Twilio Auth Token</label>
      <input name="twilio_auth_token" value="${esc(settings.twilio_auth_token || '')}">
      <label>Twilio From Number</label>
      <input name="twilio_from_number" value="${esc(settings.twilio_from_number || '')}" placeholder="+15555550123">
      <div style="margin-top:14px;"><button class="btn" type="submit">Save Notification Settings</button></div>
    </form>
  </div>

  <div class="card">
    <h2>QuickBooks Online</h2>
    ${qboConnected
      ? `<p style="color:var(--good);"><strong>Connected.</strong> Customer imports and invoice/payment syncing are live.</p>
         <div style="display:flex; gap:10px; flex-wrap:wrap;">
           <form method="POST" action="/integrations/quickbooks/import-customers">
             <button class="btn small" type="submit">Import Customers Now</button>
           </form>
           <form method="POST" action="/integrations/quickbooks/disconnect">
             <button class="btn small outline" type="submit">Disconnect</button>
           </form>
         </div>`
      : `<p class="muted">Connect your QuickBooks Online company to import your existing customer list, and automatically push invoices and payments as you create them here.</p>`
    }
    <div class="divider"></div>
    <p class="muted" style="font-size:0.85rem;">Requires a free app registered at <a href="https://developer.intuit.com" target="_blank" rel="noopener">developer.intuit.com</a>. See the README for the exact steps — you'll need a Client ID, Client Secret, and to register a redirect URI that matches what's saved below.</p>
    <form method="POST" action="/settings/quickbooks">
      <label>Client ID</label>
      <input name="qbo_client_id" value="${esc(settings.qbo_client_id || '')}" placeholder="From your Intuit developer app">
      <label>Client Secret</label>
      <input name="qbo_client_secret" value="${esc(settings.qbo_client_secret || '')}">
      <label>Environment</label>
      <select name="qbo_environment">
        <option value="sandbox" ${(settings.qbo_environment || 'sandbox') === 'sandbox' ? 'selected' : ''}>Sandbox (testing)</option>
        <option value="production" ${settings.qbo_environment === 'production' ? 'selected' : ''}>Production (real company data)</option>
      </select>
      <label>Redirect URI (must exactly match what's registered in your Intuit app)</label>
      <input name="qbo_redirect_uri" value="${esc(settings.qbo_redirect_uri || '')}" placeholder="https://your-domain.com/integrations/quickbooks/callback">
      <div style="margin-top:14px; display:flex; gap:10px; flex-wrap:wrap;">
        <button class="btn small outline" type="submit">Save QuickBooks App Settings</button>
      </div>
    </form>
    ${!qboConnected && settings.qbo_client_id && settings.qbo_client_secret ? `<div style="margin-top:10px;"><a class="btn small" href="/integrations/quickbooks/connect">Connect to QuickBooks</a></div>` : ''}
  </div>

  <div class="card">
    <h2>Staff Users</h2>
    <table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Crew</th></tr></thead><tbody>
      ${users.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td><td>${esc(u.crew_name || '&mdash;')}</td></tr>`).join('')}
    </tbody></table>
    <div class="divider"></div>
    <form method="POST" action="/settings/users">
      <label>Name</label>
      <input name="name" required>
      <label>Email</label>
      <input name="email" type="email" required>
      <label>Temporary Password</label>
      <input name="password" required>
      <label>Role</label>
      <select name="role"><option value="tech">Tech</option><option value="admin">Admin</option></select>
      <label>Crew</label>
      <select name="crew_id"><option value="">None</option>${crews.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      <div style="margin-top:14px;"><button class="btn small" type="submit">Add Staff User</button></div>
    </form>
  </div>`;
}

module.exports = { settingsPage };
