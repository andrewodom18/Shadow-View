const API_BASE = import.meta.env.VITE_SHADOW_VIEW_API_BASE || '';

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

async function errorMessageFromResponse(response) {
  try {
    const payload = await response.json();
    return payload.error || payload.message || response.statusText;
  } catch {
    return response.statusText;
  }
}

function filenameFromDisposition(value, fallback) {
  if (!value) {
    return fallback;
  }

  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    return decodeURIComponent(utf8Match[1].trim());
  }

  const quotedMatch = value.match(/filename="([^"]+)"/i);
  if (quotedMatch) {
    return quotedMatch[1].trim();
  }

  const plainMatch = value.match(/filename=([^;]+)/i);
  return plainMatch ? plainMatch[1].trim() : fallback;
}

export async function fetchCleanerProfiles(signal) {
  const response = await fetch(apiUrl('/api/cleaners'), {signal});
  if (!response.ok) {
    throw new Error(await errorMessageFromResponse(response));
  }
  const payload = await response.json();
  return payload.cleaners ?? [];
}

export async function cleanCsvWithBackend({
  file,
  cleanerId,
  includeCsv,
  includeXlsx,
  includeHtml
}) {
  const form = new FormData();
  form.append('file', file);
  form.append('cleaner_id', cleanerId);
  form.append('include_csv', includeCsv ? 'true' : 'false');
  form.append('include_xlsx', includeXlsx ? 'true' : 'false');
  form.append('include_html', includeHtml ? 'true' : 'false');

  const response = await fetch(apiUrl('/api/clean'), {
    method: 'POST',
    body: form
  });

  if (!response.ok) {
    throw new Error(await errorMessageFromResponse(response));
  }

  const blob = await response.blob();
  return {
    blob,
    fileName: filenameFromDisposition(
      response.headers.get('Content-Disposition'),
      `${file.name.replace(/\.csv$/i, '') || 'shadow_view'}_shadow_view_outputs.zip`
    )
  };
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
