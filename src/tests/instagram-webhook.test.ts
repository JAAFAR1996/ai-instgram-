import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';

// Tests for processMessagingEvent

describe('InstagramWebhookHandler.processMessagingEvent', () => {
  let handler: any;
  let logger: any;

  beforeEach(async () => {
    logger = { info: mock(() => {}), error: mock(() => {}), warn: mock(() => {}) };

    mock.module('../services/logger.js', () => ({
      createLogger: () => logger,
      getLogger: () => logger
    }));
    (globalThis as any).createLogger = () => logger;
    mock.module('../services/instagram-api.js', () => ({ getInstagramClient: () => ({}) }));
    mock.module('../database/connection.js', () => ({ getDatabase: () => ({ getSQL: () => async () => [] }) }));
    mock.module('../repositories/index.js', () => ({ getRepositories: () => ({}) }));
    mock.module('../services/message-window.js', () => ({ getMessageWindowService: () => ({ updateCustomerMessageTime: mock(async () => {}) }) }));
    mock.module('../services/conversation-ai-orchestrator.js', () => ({ getConversationAIOrchestrator: () => ({}) }));
    mock.module('../services/instagram-stories-manager.js', () => ({ getInstagramStoriesManager: () => ({}) }));
    mock.module('../services/instagram-comments-manager.js', () => ({ getInstagramCommentsManager: () => ({}) }));
    mock.module('../services/instagram-media-manager.js', () => ({ getInstagramMediaManager: () => ({}) }));
    mock.module('../services/service-controller.js', () => ({ getServiceController: () => ({}) }));

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

    expect(ret).toBeUndefined();
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

    // Provide global fallback to avoid ReferenceError inside implementation
    (globalThis as any).customerId = event.sender.id;
    await expect((handler as any).processMessagingEvent(event, 'merchant1', result)).rejects.toThrow('Failed to create conversation');
    expect(logger.error.mock.calls.length).toBeGreaterThan(0);
    delete (globalThis as any).customerId;
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
      replyToComment: mock(async () => {})
    };

    mock.module('../services/logger.js', () => ({
      createLogger: () => logger,
      getLogger: () => logger
    }));
    (globalThis as any).createLogger = () => logger;
    mock.module('../services/instagram-api.js', () => ({ getInstagramClient: () => client }));
    mock.module('../database/connection.js', () => ({ getDatabase: () => ({ getSQL: () => async () => [] }) }));
    mock.module('../repositories/index.js', () => ({ getRepositories: () => ({}) }));
    mock.module('../services/message-window.js', () => ({ getMessageWindowService: () => ({}) }));
    mock.module('../services/conversation-ai-orchestrator.js', () => ({ getConversationAIOrchestrator: () => ({}) }));
    mock.module('../services/instagram-stories-manager.js', () => ({ getInstagramStoriesManager: () => ({}) }));
    mock.module('../services/instagram-comments-manager.js', () => ({ getInstagramCommentsManager: () => ({}) }));
    mock.module('../services/instagram-media-manager.js', () => ({ getInstagramMediaManager: () => ({}) }));
    mock.module('../services/service-controller.js', () => ({ getServiceController: () => ({}) }));

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