import { describe, test, expect, beforeEach, afterAll, mock } from 'bun:test';

const sendImageMessage = mock(async (_recipient: string, _url: string, _caption: string) => ({
  success: true,
  messageId: 'msg123'
}));

mock.module('../services/instagram-api.js', () => ({
  getInstagramClient: () => ({
    initialize: mock(async () => {}),
    sendImageMessage
  })
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

    const result = await manager.sendMediaMessage('user1', 'image', 'temp1', undefined, undefined, 'merchant1');
    expect(result.success).toBe(true);
    expect(sendImageMessage).toHaveBeenCalledWith('user1', 'https://example.com/template.jpg', 'generated caption');
  });

  test('sends media using custom url', async () => {
    const manager = new InstagramMediaManager();
    const result = await manager.sendMediaMessage('user1', 'image', undefined, 'https://example.com/custom.jpg', 'custom caption', 'merchant1');
    expect(result.success).toBe(true);
    expect(sendImageMessage).toHaveBeenCalledWith('user1', 'https://example.com/custom.jpg', 'custom caption');
  });
});