import { describe, expect, test } from 'bun:test';
// Simple interpolation function mirroring UtilityMessagesService logic
function interpolate(template: string, variables: Record<string, string>): string {
  let result = template;
  const escapeRegex = (str: string) => str.replace(/([.*+?^${}()|\[\]\\])/g, '\\$1');

  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    const escaped = escapeRegex(placeholder);
    result = result.replace(new RegExp(escaped, 'g'), value);
  }

  return result;
}

describe('interpolate', () => {
  test('handles variable names with regex special characters', () => {
    const template = 'User: {{user.name}}; Alt: {{userXname}}. Order: {{order*id}}; Alt: {{orderid}}';
    const result = interpolate(template, {
      'user.name': 'Ali',
      'order*id': '123'
    });

    expect(result).toBe('User: Ali; Alt: {{userXname}}. Order: 123; Alt: {{orderid}}');
  });
});