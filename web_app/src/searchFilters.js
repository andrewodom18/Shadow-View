export function searchTerm(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function countBySeverity(threats) {
  return {
    all: threats.length,
    high: threats.filter((threat) => threat.severity === 'high').length,
    medium: threats.filter((threat) => threat.severity === 'medium').length,
    low: threats.filter((threat) => threat.severity === 'low').length
  };
}

export function threatMatchesSearch(threat, term) {
  const normalizedTerm = searchTerm(term);
  if (!normalizedTerm) {
    return true;
  }

  return [threat?.bssid, ...(threat?.ssids ?? []), threat?.reason].join(' ').toLowerCase().includes(normalizedTerm);
}

export function deviceMatchesSearch(device, threat, term) {
  const normalizedTerm = searchTerm(term);
  if (!normalizedTerm) {
    return true;
  }

  return [
    device?.id,
    device?.label,
    threat?.severity ?? '',
    ...(threat?.ssids ?? [])
  ]
    .join(' ')
    .toLowerCase()
    .includes(normalizedTerm);
}
