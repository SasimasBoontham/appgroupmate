export function normalizeGroupId(rawValue) {
  return (rawValue || '').trim();
}

export function buildUniqueGroupId({ preferredId = '', usedIds, generateFallback }) {
  let candidate = normalizeGroupId(preferredId);
  if (!candidate) {
    do {
      candidate = generateFallback();
    } while (usedIds.has(candidate));
    return candidate;
  }

  if (!usedIds.has(candidate)) {
    return candidate;
  }

  let suffix = 1;
  let uniqueCandidate = `${candidate}-${suffix}`;
  while (usedIds.has(uniqueCandidate)) {
    suffix += 1;
    uniqueCandidate = `${candidate}-${suffix}`;
  }
  return uniqueCandidate;
}
