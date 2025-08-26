import { describe, test, expect, beforeEach, afterEach, mock } from 'vitest';

// Tests for processMessagingEvent

describe('InstagramWebhookHandler.processMessagingEvent', () => {
  let handler: any;
  let logger: any;

  beforeEach(async () => {
    logger = { info: mock(() => {}), error: mock(() => {}), warn: mock(() => {}) };

    vi.mock('../services/logger.js', () => ({
      createLogger: () => logger,
      getLogger: () => logger
    }));
    (globalThis as any).createLogger = () => logger;
    vi.mock('../services/instagram-api.js', () => ({ getInstagramClient: () => ({}) }));
    vi.mock('../database/connection.js', () => ({ getDatabase: () => ({ getSQL: () => async () => [] }) }));
    vi.mock('../repositories/index.js', () => ({ getRepositories: () => ({}) }));
    vi.mock('../services/message-window.js', () => ({ getMessageWindowService: () => ({ updateCustomerMessageTime: mock(async () => {}) }) }));
    vi.mock('../services/conversation-ai-orchestrator.js', () => ({ getConversationAIOrchestrator: () => ({}) }));
    vi.mock('../services/instagram-stories-manager.js', () => ({ getInstagramStoriesManager: () => ({}) }));
    vi.mock('../services/instagram-comments-manager.js', () => ({ getInstagramCommentsManager: () => ({}) }));
    vi.mock('../services/instagram-media-manager.js', () => ({ getInstagramMediaManager: () => ({}) }));
    vi.mock('../services/service-controller.js', () => ({ getServiceController: () => ({}) }));

    const mod = await import('../services/instagram-webhook.ts');
    handler = new mod.InstagramWebhookHandler();

    (handler as any).findOrCreateConversation = mock(async () => ({ id: 'conv1', isNew: false }));
    (handler as any).storeIncomingMessage = mock(async () => {});
    (handler as any).generateAIResponse = mock(async () => {});
  });

  afterEach(() => {
    mock.restore();
    delete (globalThis as any).createLogger;
  });

  test('handles message successfully', async () => {
    const event = {
      sender: { id: 'user1' },
      recipient: { id: 'page1' },
      timestamp: Date.now(),
      message: { mid: 'm1', text: 'hello' }
    };
    const result = { success: true, eventsProcessed: 0, conversationsCreated: 0, messagesProcessed: 0, errors: [] };

    const ret = await (handler as any).processMessagingEvent(event, 'merchant1', result);

    expect(ret).toBe(1);
    expect(result.messagesProcessed).toBe(1);
    expect(logger.error.mock.calls.length).toBe(0);
  });

  test('logs error when conversation creation fails', async () => {
    (handler as any).findOrCreateConversation = mock(async () => null);

    const event = {
      sender: { id: 'user1' },
      recipient: { id: 'page1' },
      timestamp: Date.now(),
      message: { mid: 'm1', text: 'hello' }
    };
    const result = { success: true, eventsProcessed: 0, conversationsCreated: 0, messagesProcessed: 0, errors: [] };
    await expect((handler as any).processMessagingEvent(event, 'merchant1', result)).rejects.toThrow('Failed to create conversation');
    expect(logger.error.mock.calls.length).toBeGreaterThan(0);
  });
});

// Tests for inviteCommentToDM

describe('InstagramWebhookHandler.inviteCommentToDM', () => {
  let handler: any;
  let logger: any;
  let client: any;

  beforeEach(async () => {
    logger = { info: mock(() => {}), error: mock(() => {}) };
    client = {
      loadMerchantCredentials: mock(async () => ({ token: 't' })),
      validateCredentials: mock(async () => {}),
      replyToComment: mock(async () => ({ success: true }))
    };

    vi.mock('../services/logger.js', () => ({
      createLogger: () => logger,
      getLogger: () => logger
    }));
    (globalThis as any).createLogger = () => logger;
    vi.mock('../services/instagram-api.js', () => ({ getInstagramClient: () => client }));
    vi.mock('../database/connection.js', () => ({ getDatabase: () => ({ getSQL: () => async () => [] }) }));
    vi.mock('../repositories/index.js', () => ({ getRepositories: () => ({}) }));
    vi.mock('../services/message-window.js', () => ({ getMessageWindowService: () => ({}) }));
    vi.mock('../services/conversation-ai-orchestrator.js', () => ({ getConversationAIOrchestrator: () => ({}) }));
    vi.mock('../services/instagram-stories-manager.js', () => ({ getInstagramStoriesManager: () => ({}) }));
    vi.mock('../services/instagram-comments-manager.js', () => ({ getInstagramCommentsManager: () => ({}) }));
    vi.mock('../services/instagram-media-manager.js', () => ({ getInstagramMediaManager: () => ({}) }));
    vi.mock('../services/service-controller.js', () => ({ getServiceController: () => ({}) }));

    const mod = await import('../services/instagram-webhook.ts');
    handler = new mod.InstagramWebhookHandler();
  });

  afterEach(() => {
    mock.restore();
    delete (globalThis as any).createLogger;
  });

  test('sends DM invitation successfully', async () => {
    await (handler as any).inviteCommentToDM('merchant1', 'comment1', 'user1');
    expect(client.replyToComment.mock.calls.length).toBe(1);
    expect(logger.info.mock.calls[0][0]).toBe('DM invitation sent');
  });

  test('logs error if reply fails', async () => {
    client.replyToComment = mock(async () => { throw new Error('fail'); });
    await (handler as any).inviteCommentToDM('merchant1', 'comment1', 'user1');
    expect(logger.error.mock.calls.length).toBe(1);
  });
});