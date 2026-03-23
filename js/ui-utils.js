export async function copyText(text, { onSuccess, onError } = {}) {
  try {
    await navigator.clipboard.writeText(text);
    if (onSuccess) {
      onSuccess();
    }
  } catch {
    if (onError) {
      onError();
    }
  }
}

export function activateOnKeyboard(event, callback) {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }

  event.preventDefault();
  callback();
}
