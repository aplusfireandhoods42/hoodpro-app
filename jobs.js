const { esc, money, fmtDate } = require('../lib/layout');

const DEFAULT_CHECKLIST = [
  'Removed and degreased all filters',
  'Cleaned hood interior and exterior surfaces',
  'Cleaned accessible ductwork sections',
  'Cleaned exhaust fan housing and blades',
  'Inspected fire suppression nozzles for grease blockage',
  'Verified fan belt / motor condition',
  'Placed NFPA 96 inspection sticker with service date',
  'Removed grease debris from rooftop / curb area'
];

function jobsList({ jobs, crews, filterCrew, filterStatus }) {
  return `
  <h1>Jobs</h1>
  <div class="card">
    <form method="GET" action="/jobs" style="display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap;">
      <div style="flex:1; min-width:160px;">
        <label>Crew</label>
        <select name="crew_id">
          <option value="">All Crews</option>
          ${crews.map(c => `<option value="${c.id}" ${String(filterCrew)===String(c.id)?'selected':''}>${esc(c.name)}</option>`).join('')}
        </select>
      </div>
      <div style="flex:1; min-width:160px;">
        <label>Status</label>
        <select name="status">
          <option value="">All</option>
          ${['scheduled','in_progress','completed','canceled'].map(s => `<option value="${s}" ${filterStatus===s?'selected':''}>${s.replace('_',' ')}</option>`).join('')}
        </select>
      </div>
      <div><button class="btn outline" type="submit">Filter</button></div>
    </form>
  </div>
  <div class="card">
    <table><thead><tr><th>Date</th><th>Customer</th><th>Location</th><th>Crew</th><th>Status</th><th></th></tr></thead><tbody>
      ${jobs.map(j => `<tr>
        <td>${fmtDate(j.scheduled_date)}</td>
        <td>${esc(j.business_name)}</td>
        <td>${esc(j.label || j.address)}</td>
        <td>${esc(j.crew_name || '&mdash;')}</td>
        <td><span class="badge ${j.status}">${j.status.replace('_',' ')}</span></td>
        <td><a class="btn small outline" href="/jobs/${j.id}">Open</a></td>
      </tr>`).join('')}
    </tbody></table>
  </div>`;
}

function formatDuration(mins) {
  if (mins == null) return '';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function timeEntryRows(entries) {
  if (!entries.length) return '<p class="muted">No time logged yet.</p>';
  let totalMins = 0;
  const rows = entries.map(e => {
    const inD = new Date(e.clock_in);
    const outD = e.clock_out ? new Date(e.clock_out) : null;
    const mins = outD ? (outD - inD) / 60000 : null;
    if (mins != null) totalMins += mins;
    return `<tr>
      <td>${esc(e.tech_name)}</td>
      <td>${inD.toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })}</td>
      <td>${outD ? outD.toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) : '<span class="badge in_progress">clocked in</span>'}</td>
      <td>${mins != null ? formatDuration(mins) : ''}</td>
    </tr>`;
  }).join('');
  return `<table><thead><tr><th>Tech</th><th>Clock in</th><th>Clock out</th><th>Duration</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted" style="margin-top:8px;">Total logged: ${formatDuration(totalMins)}</p>`;
}

function jobDetail({ job, photos, crews, hasInvoice, user, timeEntries, myOpenEntry, sentMessages, customer }) {
  let checklist = [];
  try { checklist = job.checklist_json ? JSON.parse(job.checklist_json) : DEFAULT_CHECKLIST.map(t => ({ text: t, done: false })); }
  catch (e) { checklist = DEFAULT_CHECKLIST.map(t => ({ text: t, done: false })); }

  const beforePhotos = photos.filter(p => p.photo_type === 'before');
  const afterPhotos = photos.filter(p => p.photo_type === 'after');
  const deficiencyPhotos = photos.filter(p => p.photo_type === 'deficiency');

  return `
  <h1>${esc(job.business_name)} &mdash; ${esc(job.service_type)}</h1>
  <p class="subtitle">${esc(job.label || job.address)} &middot; Scheduled ${fmtDate(job.scheduled_date)} &middot; <span class="badge ${job.status}">${job.status.replace('_',' ')}</span></p>

  <div class="grid grid-2">
    <div class="card">
      <h2>Job Details</h2>
      <p><strong>Crew:</strong> ${esc(job.crew_name || 'Unassigned')}</p>
      <form method="POST" action="/jobs/${job.id}/assign">
        <label>Reassign Crew</label>
        <select name="crew_id">
          <option value="">Unassigned</option>
          ${crews.map(c => `<option value="${c.id}" ${job.crew_id===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}
        </select>
        <div style="margin-top:10px;"><button class="btn small outline" type="submit">Update</button></div>
      </form>

      <div class="divider"></div>
      ${job.status === 'completed' ? `<p class="muted">Completed ${fmtDate(job.completed_at)}.</p>
        ${hasInvoice ? '<p class="muted">Invoice already generated for this job.</p>' : `<form method="POST" action="/jobs/${job.id}/invoice"><button class="btn" type="submit">Generate Invoice</button></form>`}
      ` : `<p class="muted">Not yet completed.</p>`}
    </div>

    <div class="card">
      <h2>Time Tracking</h2>
      <p class="muted">Clocked in as ${esc(user.name)}.</p>
      ${myOpenEntry
        ? `<form method="POST" action="/jobs/${job.id}/clock-out"><button class="btn ember" type="submit">Clock Out</button></form>`
        : (job.status === 'completed' ? '' : `<form method="POST" action="/jobs/${job.id}/clock-in"><button class="btn" type="submit">Clock In</button></form>`)
      }
      <div class="divider"></div>
      ${timeEntryRows(timeEntries)}
    </div>
  </div>

  <div class="card">
    <h2>Service Checklist (NFPA 96)</h2>
    ${job.status === 'completed' ? `
      <ul>${checklist.map(c => `<li>${c.done ? '&#9989;' : '&#9744;'} ${esc(c.text)}</li>`).join('')}</ul>
    ` : `
    <form method="POST" action="/jobs/${job.id}/complete">
      ${checklist.map((c, i) => `<div class="checklist-item">
        <input type="checkbox" name="check_${i}" id="check_${i}" ${c.done ? 'checked' : ''}>
        <label for="check_${i}" style="margin:0;">${esc(c.text)}</label>
      </div>`).join('')}
      <label>Technician Notes / Deficiencies</label>
      <textarea name="tech_notes" placeholder="Note any deficiencies, worn gaskets, damaged fan belts, recommended repairs, etc.">${esc(job.tech_notes || '')}</textarea>
      <p class="help-text">Marking the job complete will automatically clock out anyone still clocked in.</p>
      <div style="margin-top:14px;"><button class="btn" type="submit">Mark Job Completed</button></div>
    </form>`}
  </div>

  <div class="card">
    <h2>Photos</h2>
    <p class="help-text">On a phone, the photo button opens your camera directly.</p>
    <form method="POST" action="/jobs/${job.id}/photos" enctype="multipart/form-data" style="display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap;">
      <div>
        <label>Type</label>
        <select name="photo_type">
          <option value="before">Before</option>
          <option value="after">After</option>
          <option value="deficiency">Deficiency</option>
        </select>
      </div>
      <div>
        <label>Caption</label>
        <input name="caption" placeholder="e.g. Hood filters before cleaning">
      </div>
      <div>
        <label>Take / Choose Photo</label>
        <input type="file" name="photo" accept="image/*" capture="environment" required>
      </div>
      <div><button class="btn small" type="submit">Upload</button></div>
    </form>

    <div class="divider"></div>
    <h2 style="font-size:1rem;">Before</h2>
    <div class="photo-grid">${beforePhotos.map(photoFig).join('') || '<p class="muted">No before photos yet.</p>'}</div>
    <h2 style="font-size:1rem; margin-top:18px;">After</h2>
    <div class="photo-grid">${afterPhotos.map(photoFig).join('') || '<p class="muted">No after photos yet.</p>'}</div>
    ${deficiencyPhotos.length ? `<h2 style="font-size:1rem; margin-top:18px;">Deficiencies</h2><div class="photo-grid">${deficiencyPhotos.map(photoFig).join('')}</div>` : ''}
  </div>

  ${job.status === 'completed' ? `
  <div class="card">
    <h2>Send Report to Customer</h2>
    <p class="muted">Sends the customer a link to this service report on their portal.</p>
    <div style="display:flex; gap:10px; flex-wrap:wrap;">
      <form method="POST" action="/jobs/${job.id}/send-report">
        <input type="hidden" name="channel" value="email">
        <button class="btn small outline" type="submit" ${customer.email ? '' : 'disabled'}>Email Report${customer.email ? '' : ' (no email on file)'}</button>
      </form>
      <form method="POST" action="/jobs/${job.id}/send-report">
        <input type="hidden" name="channel" value="sms">
        <button class="btn small outline" type="submit" ${customer.phone ? '' : 'disabled'}>Text Report${customer.phone ? '' : ' (no phone on file)'}</button>
      </form>
    </div>
    ${sentMessages.length ? `<div class="divider"></div><p class="muted" style="font-size:0.85rem;">${sentMessages.map(m => `Sent ${esc(m.channel)} to ${esc(m.recipient)} on ${fmtDate(m.created_at)} &mdash; ${m.status === 'demo' ? '<em>demo mode, not actually delivered</em>' : m.status}`).join('<br>')}</p>` : ''}
  </div>` : ''}
  `;
}

function photoFig(p) {
  return `<figure><img src="/uploads/${esc(p.file_path)}" alt="${esc(p.caption||'')}"><figcaption>${esc(p.caption || '')}</figcaption></figure>`;
}

module.exports = { jobsList, jobDetail, DEFAULT_CHECKLIST };
