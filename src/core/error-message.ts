export function normalizeErrorMessage(message: string): string {
  return message.replace(/\bdoes not exists\b/gi, 'does not exist');
}
