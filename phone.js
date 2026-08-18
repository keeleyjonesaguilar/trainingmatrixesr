// Employee "Employee Number" field is now used to track a phone number (Keeley's request).
// Normalizes to the standard US format (xxx) xxx-xxxx whenever the input has exactly 10
// digits, regardless of how it was typed/pasted/imported (dashes, dots, parens, spaces).
// Anything that isn't a clean 10-digit number (extensions, international numbers, partial
// entries) is left exactly as given rather than guessing at a format.
function formatPhoneNumber(value) {
  if (value === null || value === undefined) return value;
  const raw = String(value).trim();
  if (!raw) return raw;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    const d = digits.slice(1);
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return raw;
}

module.exports = { formatPhoneNumber };
