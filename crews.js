const { esc } = require('../lib/layout');

function crewsList({ crews }) {
  return `
  <h1>Crews</h1>
  <p class="subtitle">4 teams of 2, matching your field staffing.</p>
  <div class="grid grid-2">
    ${crews.map(c => `<div class="card">
      <h2>${esc(c.name)}</h2>
      ${c.members.length ? `<ul>${c.members.map(m => `<li>${esc(m.name)} &middot; ${esc(m.email)}</li>`).join('')}</ul>` : '<p class="muted">No users assigned to this crew yet. Add techs in Settings.</p>'}
      <p class="muted">Jobs this week: ${c.jobCount}</p>
    </div>`).join('')}
  </div>`;
}

module.exports = { crewsList };
