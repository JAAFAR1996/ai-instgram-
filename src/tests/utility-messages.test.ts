import { describe, expect, test, mock, afterAll } from 'bun:test';
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

// Mock Instagram API client and database layer
const sendMessageMock = mock(async () => ({ success: true, messageId: 'msg123' }));

mock.module('../services/instagram-api.js', () => ({
  getInstagramClient: () => ({
    initialize: mock(async () => {}),
    sendMessage: sendMessageMock
  })
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

mock.module('../config/environment.js', () => ({
  getConfig: () => ({})
}));

const { UtilityMessagesService } = await import('../services/utility-messages.js');

describe('UtilityMessagesService', () => {
  afterAll(() => mock.restore());

  test('prevents template reuse between merchants', async () => {
    const service = new UtilityMessagesService();

    const payload = {
      recipient_id: 'user1',
      template_id: 'tpl1',
      variables: {},
      message_type: 'ORDER_UPDATE'
    } as const;

    const ok = await service.sendUtilityMessage('merchant1', payload);
    expect(ok.success).toBe(true);

    const fail = await service.sendUtilityMessage('merchant2', payload);
    expect(fail.success).toBe(false);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
  });
});