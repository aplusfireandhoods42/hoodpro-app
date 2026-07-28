// Minimal multipart/form-data parser (no external deps).
// Returns { fields: {name: value}, files: [{name, filename, mimetype, buffer}] }

function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  const boundary = match ? (match[1] || match[2]) : null;
  const result = { fields: {}, files: [] };
  if (!boundary) return result;

  const boundaryBuf = Buffer.from(`--${boundary}`);
  let start = buffer.indexOf(boundaryBuf);
  while (start !== -1) {
    let next = buffer.indexOf(boundaryBuf, start + boundaryBuf.length);
    if (next === -1) break;
    let part = buffer.slice(start + boundaryBuf.length, next);
    // strip leading CRLF and trailing CRLF before next boundary
    if (part.slice(0, 2).toString() === '\r\n') part = part.slice(2);
    if (part.slice(-2).toString() === '\r\n') part = part.slice(0, -2);

    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headerText = part.slice(0, headerEnd).toString('utf8');
      const body = part.slice(headerEnd + 4);

      const nameMatch = /name="([^"]+)"/i.exec(headerText);
      const filenameMatch = /filename="([^"]*)"/i.exec(headerText);
      const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerText);
      const fieldName = nameMatch ? nameMatch[1] : null;

      if (fieldName) {
        if (filenameMatch && filenameMatch[1]) {
          result.files.push({
            name: fieldName,
            filename: filenameMatch[1],
            mimetype: typeMatch ? typeMatch[1].trim() : 'application/octet-stream',
            buffer: body
          });
        } else {
          if (!result.fields[fieldName]) result.fields[fieldName] = body.toString('utf8');
          else {
            // support repeated fields as arrays
            if (!Array.isArray(result.fields[fieldName])) result.fields[fieldName] = [result.fields[fieldName]];
            result.fields[fieldName].push(body.toString('utf8'));
          }
        }
      }
    }
    start = next;
  }
  return result;
}

module.exports = { parseMultipart };
