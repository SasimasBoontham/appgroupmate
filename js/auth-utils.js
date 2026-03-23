export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function isLamduanEmail(value) {
  return /^[^@\s]+@lamduan\.mfu\.ac\.th$/i.test(String(value || '').trim());
}

export function isGenericEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value || '').trim());
}

export function generateResetCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
