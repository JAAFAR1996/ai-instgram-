import { describe, test, expect, beforeEach, afterAll, mock } from 'bun:test';

const sendImageMessage = mock(async (_recipient: string, _url: string, _caption: string) => ({
  success: true,
  messageId: 'msg123'
}));

mock.module('../services/instagram-api.js', () => ({
  getInstagramClient: () => ({
    initialize: mock(async () => {}),
    sendImageMessage,
    loadMerchantCredentials: mock(async () => ({ tokenExpiresAt: new Date(Date.now() + 3600_000) })),
    validateCredentials: mock(async () => {})
  }),
  clearInstagramClient: () => {}
}));

mock.module('../database/connection.js', () => ({
  getDatabase: () => ({ getSQL: () => ({}) })
}));

mock.module('../services/conversation-ai-orchestrator.js', () => ({
  getConversationAIOrchestrator: () => ({})
}));

const { InstagramMediaManager } = await import('../services/instagram-media-manager.js');

describe('InstagramMediaManager.sendMediaMessage', () => {
  beforeEach(() => {
    sendImageMessage.mockClear();
  });

  afterAll(() => {
    mock.restore();
  });

  test('sends media using template', async () => {
    const manager = new InstagramMediaManager();
    try {
      (manager as any).getMediaTemplate = async () => ({
        id: 'temp1',
        name: 'template',
        category: 'promo',
        mediaType: 'image',
        templateUrl: 'https://example.com/template.jpg',
        overlayElements: {},
        usageCount: 0,
        isActive: true
      });
      (manager as any).incrementTemplateUsage = async () => {};
      (manager as any).generateTemplateCaption = () => 'generated caption';

      const result = await manager.sendMediaMessage('user1', 'image', 'merchant1', 'temp1', undefined, undefined);
      expect(result.success).toBe(true);
      expect(sendImageMessage).toHaveBeenCalledWith(
        expect.anything(),
        'merchant1',
        'user1',
        'https://example.com/template.jpg',
        'generated caption'
      );
    } finally {
      manager.dispose();
    }
  });

  test('sends media using custom url', async () => {
    const manager = new InstagramMediaManager();
    try {
      const result = await manager.sendMediaMessage(
        'user1',
        'image',
        'merchant1',
        undefined,
        'https://example.com/custom.jpg',
        'custom caption'
      );
      expect(result.success).toBe(true);
      expect(sendImageMessage).toHaveBeenCalledWith(
        expect.anything(),
        'merchant1',
        'user1',
        'https://example.com/custom.jpg',
        'custom caption'
      );
    } finally {
      manager.dispose();
    }
  });
});