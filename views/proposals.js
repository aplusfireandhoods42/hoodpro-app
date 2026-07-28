const { esc, fmtDate } = require('../lib/layout');

const FAN_TYPES = [
  'Upblast Centrifugal – Direct Drive',
  'Upblast Centrifugal – Belt Drive',
  'Upblast Utility / Belt-Driven Utility Set',
  'Inline Centrifugal',
  'Inline Utility Set',
  'Downblast (Make-Up Air Unit)',
  'Backward Inclined Centrifugal',
  'Radial Blade Centrifugal',
  'Tubeaxial',
  'Vaneaxial',
  'Wall-Mounted Propeller / Exhaust Fan',
  'Mushroom Cap Exhaust Fan',
  'Roof Curb-Mounted Exhaust Fan',
  'PRV / ESP (Pollution Control / Electrostatic Precipitator)',
  'Other'
];

const KEY_ACCESS_TYPES = ['Lock Box', 'Keys Provided', 'Meet On-Site', 'Unlocked / No Access Needed', 'Other'];
const WATER_ACCESS_OPTIONS = ['Yes', 'No', 'Unknown'];

function fanTypeOptions(selected) {
  return FAN_TYPES.map(t => `<option value="${esc(t)}" ${t === selected ? 'selected' : ''}>${esc(t)}</option>`).join('');
}
function keyAccessOptions(selected) {
  return KEY_ACCESS_TYPES.map(t => `<option value="${esc(t)}" ${t === selected ? 'selected' : ''}>${esc(t)}</option>`).join('');
}
function waterAccessOptions(selected) {
  return WATER_ACCESS_OPTIONS.map(t => `<option value="${esc(t)}" ${t === selected ? 'selected' : ''}>${esc(t)}</option>`).join('');
}

function proposalsList({ proposals }) {
  return `
  <h1>Proposals</h1>
  <p class="subtitle"><a class="btn ember" href="/proposals/new">+ New Proposal</a></p>
  <div class="card">
    ${proposals.length ? `<table><thead><tr><th>Business</th><th>Site Address</th><th>Hoods</th><th>Stories</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>
      ${proposals.map(p => `<tr>
        <td>${esc(p.business_name)}</td>
        <td>${esc(p.site_address || '')}</td>
        <td>${p.hood_count ?? ''}</td>
        <td>${p.building_stories ?? ''}</td>
        <td><span class="badge ${p.status}">${p.status}</span></td>
        <td>${fmtDate(p.created_at)}</td>
        <td><a class="btn small outline" href="/proposals/${p.id}">Open</a></td>
      </tr>`).join('')}
    </tbody></table>` : '<p class="muted">No proposals yet. Techs can create one from a site visit to capture measurements and access details.</p>'}
  </div>`;
}

function proposalForm({ proposal, customers, error, formAction, submitLabel }) {
  const p = proposal || {};
  return `
  <div class="card">
    ${error ? `<div class="flash error">${esc(error)}</div>` : ''}
    <form method="POST" action="${formAction}">
      <h2>Site Info</h2>
      <div class="grid grid-2">
        <div>
          <label>Existing Customer (optional)</label>
          <select name="customer_id">
            <option value="">&mdash; New / Prospective &mdash;</option>
            ${customers.map(c => `<option value="${c.id}" ${String(p.customer_id) === String(c.id) ? 'selected' : ''}>${esc(c.business_name)}</option>`).join('')}
          </select>
          <label>Business Name</label>
          <input name="business_name" value="${esc(p.business_name || '')}" required>
          <label>Contact Name</label>
          <input name="contact_name" value="${esc(p.contact_name || '')}">
        </div>
        <div>
          <label>Site Address</label>
          <input name="site_address" value="${esc(p.site_address || '')}">
          <label>Contact Phone</label>
          <input name="contact_phone" value="${esc(p.contact_phone || '')}">
          <label>Contact Email</label>
          <input type="email" name="contact_email" value="${esc(p.contact_email || '')}">
        </div>
      </div>
      <label>How Many Stories Is the Building?</label>
      <input name="building_stories" type="number" min="1" style="max-width:160px;" value="${p.building_stories ?? ''}">

      <div class="divider"></div>
      <h2>Hoods, Filters &amp; Duct Work</h2>
      <div class="grid grid-3">
        <div>
          <label>Number of Hoods</label>
          <input name="hood_count" type="number" min="0" value="${p.hood_count ?? ''}">
        </div>
        <div>
          <label>Total Hood Length (ft)</label>
          <input name="hood_length_ft" type="number" step="0.5" min="0" value="${p.hood_length_ft ?? ''}">
        </div>
        <div>
          <label>Number of Filters</label>
          <input name="filter_count" type="number" min="0" value="${p.filter_count ?? ''}">
        </div>
      </div>
      <div class="grid grid-3">
        <div>
          <label>Access Panels</label>
          <input name="access_panel_count" type="number" min="0" value="${p.access_panel_count ?? ''}">
        </div>
        <div>
          <label>Vertical Duct Work Length (ft)</label>
          <input name="duct_vertical_length_ft" type="number" step="0.5" min="0" value="${p.duct_vertical_length_ft ?? ''}">
        </div>
        <div>
          <label>Horizontal Duct Length (ft)</label>
          <input name="duct_horizontal_length_ft" type="number" step="0.5" min="0" value="${p.duct_horizontal_length_ft ?? ''}">
        </div>
      </div>

      <div class="divider"></div>
      <h2>Exhaust Fan</h2>
      <div class="grid grid-2">
        <div>
          <label>Fan Type</label>
          <select name="fan_type">
            <option value="">&mdash; Select &mdash;</option>
            ${fanTypeOptions(p.fan_type)}
          </select>
        </div>
        <div>
          <label>Fan Notes (brand, CFM, quantity, condition, etc.)</label>
          <input name="fan_notes" value="${esc(p.fan_notes || '')}">
        </div>
      </div>

      <div class="divider"></div>
      <h2>Access &amp; Security</h2>
      <div class="grid grid-2">
        <div>
          <label>Water Access on Roof/Site</label>
          <select name="water_access">
            <option value="">&mdash; Select &mdash;</option>
            ${waterAccessOptions(p.water_access)}
          </select>
          <label>Water Access Notes</label>
          <input name="water_access_notes" value="${esc(p.water_access_notes || '')}" placeholder="e.g. hose bib on north wall">
        </div>
        <div>
          <label>Key / Lock Box Access</label>
          <select name="key_access_type">
            <option value="">&mdash; Select &mdash;</option>
            ${keyAccessOptions(p.key_access_type)}
          </select>
          <label>Key / Lock Box Notes</label>
          <input name="key_access_notes" value="${esc(p.key_access_notes || '')}" placeholder="e.g. lock box code, key location">
        </div>
      </div>
      <label>Security Access Notes</label>
      <input name="security_access_notes" value="${esc(p.security_access_notes || '')}" placeholder="e.g. check in with manager, gate code, escort required">
      <label>Alarm Code</label>
      <input name="alarm_code" value="${esc(p.alarm_code || '')}">

      <div class="divider"></div>
      <label>Other Notes</label>
      <textarea name="notes">${esc(p.notes || '')}</textarea>

      <div style="margin-top:18px;"><button class="btn" type="submit">${esc(submitLabel)}</button></div>
    </form>
  </div>`;
}

function proposalNew({ customers, error }) {
  return `
  <h1>New Proposal</h1>
  <p class="subtitle">Capture site measurements and access details from a walkthrough or site visit.</p>
  ${proposalForm({ proposal: null, customers, error, formAction: '/proposals', submitLabel: 'Create Proposal' })}`;
}

function proposalEdit({ proposal, customers, error }) {
  return `
  <h1>Edit Proposal &mdash; ${esc(proposal.business_name)}</h1>
  ${proposalForm({ proposal, customers, error, formAction: `/proposals/${proposal.id}`, submitLabel: 'Save Changes' })}`;
}

function field(label, value) {
  if (value === null || value === undefined || value === '') return '';
  return `<div style="margin-bottom:8px;"><span class="muted">${esc(label)}:</span> ${esc(String(value))}</div>`;
}

function proposalDetail({ proposal, customerLink }) {
  const p = proposal;
  return `
  <h1>${esc(p.business_name)} <span class="badge ${p.status}">${p.status}</span></h1>
  <p class="subtitle">Proposal #${p.id} &middot; created ${fmtDate(p.created_at)} ${customerLink ? `&middot; <a href="${customerLink}">View Customer</a>` : ''}</p>

  <div class="card">
    <h2>Update Status</h2>
    <form method="POST" action="/proposals/${p.id}/status" class="inline">
      <div class="grid grid-2" style="align-items:end;">
        <div>
          <label>Status</label>
          <select name="status">
            ${['draft', 'sent', 'won', 'lost'].map(s => `<option value="${s}" ${s === p.status ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('')}
          </select>
        </div>
        <div><button class="btn small" type="submit">Update Status</button></div>
      </div>
    </form>
    <p class="help-text"><a href="/proposals/${p.id}/edit">Edit all proposal details</a></p>
  </div>

  <div class="grid grid-2">
    <div class="card">
      <h2>Site Info</h2>
      ${field('Contact', p.contact_name)}
      ${field('Phone', p.contact_phone)}
      ${field('Email', p.contact_email)}
      ${field('Site Address', p.site_address)}
      ${field('Building Stories', p.building_stories)}
    </div>
    <div class="card">
      <h2>Hoods, Filters &amp; Duct Work</h2>
      ${field('Number of Hoods', p.hood_count)}
      ${field('Total Hood Length (ft)', p.hood_length_ft)}
      ${field('Number of Filters', p.filter_count)}
      ${field('Access Panels', p.access_panel_count)}
      ${field('Vertical Duct Work Length (ft)', p.duct_vertical_length_ft)}
      ${field('Horizontal Duct Length (ft)', p.duct_horizontal_length_ft)}
    </div>
  </div>

  <div class="grid grid-2">
    <div class="card">
      <h2>Exhaust Fan</h2>
      ${field('Fan Type', p.fan_type)}
      ${field('Fan Notes', p.fan_notes)}
      ${(!p.fan_type && !p.fan_notes) ? '<p class="muted">No fan info captured.</p>' : ''}
    </div>
    <div class="card">
      <h2>Access &amp; Security</h2>
      ${field('Water Access', p.water_access)}
      ${field('Water Access Notes', p.water_access_notes)}
      ${field('Key / Lock Box', p.key_access_type)}
      ${field('Key / Lock Box Notes', p.key_access_notes)}
      ${field('Security Access Notes', p.security_access_notes)}
      ${field('Alarm Code', p.alarm_code)}
    </div>
  </div>

  ${p.notes ? `<div class="card"><h2>Other Notes</h2><p>${esc(p.notes)}</p></div>` : ''}
  `;
}

module.exports = { proposalsList, proposalNew, proposalEdit, proposalDetail, FAN_TYPES };
