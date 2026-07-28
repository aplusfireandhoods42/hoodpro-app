const https = require('https');

function postJson(hostname, urlPath, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(bodyObj));
    const req = https.request({
      hostname, path: urlPath, method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': data.length }, headers)
    }, res => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function postForm(hostname, urlPath, headers, formObj) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(new URLSearchParams(formObj).toString());
    const req = https.request({
      hostname, path: urlPath, method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': data.length }, headers)
    }, res => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Sends via SendGrid's REST API directly (no SDK). Returns { demo: true } if no key configured.
async function sendEmail({ apiKey, fromEmail, fromName, to, subject, text }) {
  if (!apiKey || !fromEmail || !to) return { demo: true, ok: false };
  try {
    const payload = {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: fromEmail, name: fromName || undefined },
      subject,
      content: [{ type: 'text/plain', value: text }]
    };
    const res = await postJson('api.sendgrid.com', '/v3/mail/send', { Authorization: `Bearer ${apiKey}` }, payload);
    return { demo: false, ok: res.status >= 200 && res.status < 300, status: res.status, body: res.body };
  } catch (err) {
    return { demo: false, ok: false, error: String(err) };
  }
}

// Sends via Twilio's REST API directly (no SDK). Returns { demo: true } if no credentials configured.
async function sendSms({ accountSid, authToken, fromNumber, to, body }) {
  if (!accountSid || !authToken || !fromNumber || !to) return { demo: true, ok: false };
  try {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const res = await postForm('api.twilio.com', `/2010-04-01/Accounts/${accountSid}/Messages.json`, { Authorization: `Basic ${auth}` }, { To: to, From: fromNumber, Body: body });
    return { demo: false, ok: res.status >= 200 && res.status < 300, status: res.status, body: res.body };
  } catch (err) {
    return { demo: false, ok: false, error: String(err) };
  }
}

module.exports = { sendEmail, sendSms };
