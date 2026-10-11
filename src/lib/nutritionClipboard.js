// Mobile browsers and embedded tabs can reject the Clipboard API. Keep a
// user-initiated fallback, then leave the selectable setup text available.
export async function copyNutritionText(text) {
  try { await navigator.clipboard.writeText(text); return; } catch { /* try selection-based copy */ }
  const selection = document.createElement('textarea');
  selection.value = text;
  selection.readOnly = true;
  selection.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none';
  document.body.appendChild(selection);
  selection.select();
  selection.setSelectionRange(0, text.length);
  let copied = false;
  try { copied = document.execCommand('copy'); } catch { /* selectable text remains available */ } finally { selection.remove(); }
  if (!copied) throw new Error('Select and copy the displayed text. Clipboard access is unavailable in this browser.');
}
