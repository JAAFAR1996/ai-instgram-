import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

// Escape special characters for use in RegExp
function escapeRegex(str: string): string {
  return str.replace(/([.*+?^${}()|[\]\\])/g, '\\$1');
}

function interpolate(template: string, variables: Record<string, string>): string {
  let result = template;

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

// Mock Instagram API client and database layer
const sendMessageMock = mock(async () => ({ success: true, messageId: 'msg123' }));

mock.module('../services/instagram-api.js', () => ({
  getInstagramClient: () => ({
    loadMerchantCredentials: mock(async () => ({})),
    validateCredentials: mock(async () => {}),
    sendMessage: sendMessageMock
  }),
  clearInstagramClient: () => {}
}));

mock.module('../database/connection.js', () => ({
  getDatabase: () => ({
    getSQL: () => async (strings: TemplateStringsArray, ...params: any[]) => {
      const [templateId, merchantId] = params;
      if (templateId === 'tpl1' && merchantId === 'merchant1') {
        return [
          {
            id: 'tpl1',
            name: 'Order',
            type: 'ORDER_UPDATE',
            content: 'Hi {{name}}',
            variables: '[]',
            approved: true,
            created_at: new Date(),
            updated_at: new Date()
          }
        ];
      }
      return [];
    }
  })
}));
