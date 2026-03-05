import { createDiscordAdapter } from '@chat-adapter/discord';
import { createIoRedisState } from '@chat-adapter/state-ioredis';
import { createTelegramAdapter } from '@chat-adapter/telegram';
import { Chat, ConsoleLogger } from 'chat';
import debug from 'debug';
import urlJoin from 'url-join';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { AiAgentService } from '@/server/services/aiAgent';

import { AgentBridgeService } from './AgentBridgeService';
import { LarkRestApi } from './larkRestApi';
import { setTelegramWebhook } from './platforms/telegram';
import { renderStart } from './replyTemplate';

const log = debug('lobe-server:bot:message-router');

interface ResolvedAgentInfo {
  agentId: string;
  userId: string;
}

interface StoredCredentials {
  [key: string]: string;
}

/**
 * Adapter factory: creates the correct Chat SDK adapter from platform + credentials.
 */
function createAdapterForPlatform(
  platform: string,
  credentials: StoredCredentials,
  applicationId: string,
): Record<string, any> | null {
  switch (platform) {
    case 'discord': {
      return {
        discord: createDiscordAdapter({
          applicationId,
          botToken: credentials.botToken,
          publicKey: credentials.publicKey,
        }),
      };
    }
    case 'telegram': {
      return {
        telegram: createTelegramAdapter({
          botToken: credentials.botToken,
          secretToken: credentials.secretToken,
        }),
      };
    }
    default: {
      return null;
    }
  }
}

/**
 * Routes incoming webhook events to the correct Chat SDK Bot instance
 * and triggers message processing via AgentBridgeService.
 */
export class BotMessageRouter {
  /** botToken → Chat instance (for Discord webhook routing via x-discord-gateway-token) */
  private botInstancesByToken = new Map<string, Chat<any>>();

  /** "platform:applicationId" → { agentId, userId } */
  private agentMap = new Map<string, ResolvedAgentInfo>();

  /** "platform:applicationId" → Chat instance */
  private botInstances = new Map<string, Chat<any>>();

  /** "platform:applicationId" → credentials */
  private credentialsByKey = new Map<string, StoredCredentials>();

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Get the webhook handler for a given platform.
   * Returns a function compatible with Next.js Route Handler: `(req: Request) => Promise<Response>`
   *
   * @param appId  Optional application ID for direct bot lookup (e.g. Telegram bot-specific endpoints).
   */
  getWebhookHandler(platform: string, appId?: string): (req: Request) => Promise<Response> {
    return async (req: Request) => {
      await this.ensureInitialized();

      switch (platform) {
        case 'discord': {
          return this.handleDiscordWebhook(req);
        }
        case 'telegram': {
          return this.handleTelegramWebhook(req, appId);
        }
        case 'lark':
        case 'feishu': {
          return this.handleLarkWebhook(req, platform, appId);
        }
        default: {
          return new Response('No bot configured for this platform', { status: 404 });
        }
      }
    };
  }

  // ------------------------------------------------------------------
  // Discord webhook routing
  // ------------------------------------------------------------------

  private async handleDiscordWebhook(req: Request): Promise<Response> {
    const bodyBuffer = await req.arrayBuffer();

    log('handleDiscordWebhook: method=%s, content-length=%d', req.method, bodyBuffer.byteLength);

    // Check for forwarded Gateway event (from Gateway worker)
    const gatewayToken = req.headers.get('x-discord-gateway-token');
    if (gatewayToken) {
      // Log forwarded event details
      try {
        const bodyText = new TextDecoder().decode(bodyBuffer);
        const event = JSON.parse(bodyText);

        if (event.type === 'GATEWAY_MESSAGE_CREATE') {
          const d = event.data;
          const mentions = d?.mentions?.map((m: any) => m.username).join(', ');
          log(
            'Gateway MESSAGE_CREATE: author=%s (bot=%s), mentions=[%s], content=%s',
            d?.author?.username,
            d?.author?.bot,
            mentions || '',
            d?.content?.slice(0, 100),
          );
        }
      } catch {
        // ignore parse errors
      }

      const bot = this.botInstancesByToken.get(gatewayToken);
      if (bot?.webhooks && 'discord' in bot.webhooks) {
        return bot.webhooks.discord(this.cloneRequest(req, bodyBuffer));
      }

      log('No matching bot for gateway token');
      return new Response('No matching bot for gateway token', { status: 404 });
    }

    // HTTP Interactions — route by applicationId in the interaction payload
    try {
      const bodyText = new TextDecoder().decode(bodyBuffer);
      const payload = JSON.parse(bodyText);
      const appId = payload.application_id;

      if (appId) {
        const bot = this.botInstances.get(`discord:${appId}`);
        if (bot?.webhooks && 'discord' in bot.webhooks) {
          return bot.webhooks.discord(this.cloneRequest(req, bodyBuffer));
        }
      }
    } catch {
      // Not valid JSON — fall through
    }

    // Fallback: try all registered Discord bots
    for (const [key, bot] of this.botInstances) {
      if (!key.startsWith('discord:')) continue;
      if (bot.webhooks && 'discord' in bot.webhooks) {
        try {
          const resp = await bot.webhooks.discord(this.cloneRequest(req, bodyBuffer));
          if (resp.status !== 401) return resp;
        } catch {
          // signature mismatch — try next
        }
      }
    }

    return new Response('No bot configured for Discord', { status: 404 });
  }

  // ------------------------------------------------------------------
  // Telegram webhook routing
  // ------------------------------------------------------------------

  private async handleTelegramWebhook(req: Request, appId?: string): Promise<Response> {
    const bodyBuffer = await req.arrayBuffer();

    log(
      'handleTelegramWebhook: method=%s, appId=%s, content-length=%d',
      req.method,
      appId ?? '(none)',
      bodyBuffer.byteLength,
    );

    // Log raw update for debugging
    try {
      const bodyText = new TextDecoder().decode(bodyBuffer);
      const update = JSON.parse(bodyText);
      const msg = update.message;
      if (msg) {
        log(
          'Telegram update: chat_type=%s, from=%s (id=%s), text=%s',
          msg.chat?.type,
          msg.from?.username || msg.from?.first_name,
          msg.from?.id,
          msg.text?.slice(0, 100),
        );
      } else {
        log('Telegram update (non-message): keys=%s', Object.keys(update).join(','));
      }
    } catch {
      // ignore parse errors
    }

    // Direct lookup by applicationId (bot-specific endpoint: /webhooks/telegram/{appId})
    if (appId) {
      const key = `telegram:${appId}`;
      const bot = this.botInstances.get(key);
      if (bot?.webhooks && 'telegram' in bot.webhooks) {
        log('handleTelegramWebhook: direct lookup hit for %s', key);
        return bot.webhooks.telegram(this.cloneRequest(req, bodyBuffer));
      }
      log('handleTelegramWebhook: no bot registered for %s', key);
      return new Response('No bot configured for Telegram', { status: 404 });
    }

    // Fallback: iterate all registered Telegram bots (legacy /webhooks/telegram endpoint).
    // Secret token verification will reject mismatches.
    for (const [key, bot] of this.botInstances) {
      if (!key.startsWith('telegram:')) continue;
      if (bot.webhooks && 'telegram' in bot.webhooks) {
        try {
          log('handleTelegramWebhook: trying bot %s', key);
          const resp = await bot.webhooks.telegram(this.cloneRequest(req, bodyBuffer));
          log('handleTelegramWebhook: bot %s responded with status=%d', key, resp.status);
          if (resp.status !== 401) return resp;
        } catch (error) {
          log('handleTelegramWebhook: bot %s webhook error: %O', key, error);
        }
      }
    }

    log('handleTelegramWebhook: no matching bot found');
    return new Response('No bot configured for Telegram', { status: 404 });
  }

  // ------------------------------------------------------------------
  // Lark / Feishu webhook routing (no Chat SDK adapter — handled directly)
  // ------------------------------------------------------------------

  /**
   * Handle Lark/Feishu webhook events directly (no Chat SDK adapter).
   *
   * Lark events: https://open.larksuite.com/document/server-docs/event-subscription
   * - URL verification challenge
   * - im.message.receive_v1 (new message)
   */
  private async handleLarkWebhook(
    req: Request,
    platform: string,
    appId?: string,
  ): Promise<Response> {
    const bodyText = await req.text();

    log(
      'handleLarkWebhook: platform=%s, appId=%s, content-length=%d',
      platform,
      appId,
      bodyText.length,
    );

    let body: any;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    // Decrypt encrypted events if needed
    if (body.encrypt && appId) {
      const key = `${platform}:${appId}`;
      const creds = this.credentialsByKey.get(key);
      if (creds?.encryptKey) {
        try {
          const decrypted = this.decryptLarkEvent(body.encrypt, creds.encryptKey);
          body = JSON.parse(decrypted);
        } catch (error) {
          log('handleLarkWebhook: decryption failed: %O', error);
          return new Response('Decryption failed', { status: 400 });
        }
      }
    }

    // URL verification challenge — Lark sends this when configuring the webhook
    if (body.type === 'url_verification') {
      log('handleLarkWebhook: URL verification challenge');
      return Response.json({ challenge: body.challenge });
    }

    // Verify token if configured
    const token = body.header?.token;
    if (appId && token) {
      const key = `${platform}:${appId}`;
      const creds = this.credentialsByKey.get(key);
      if (creds?.verificationToken && creds.verificationToken !== token) {
        log('handleLarkWebhook: token mismatch for %s', key);
        return new Response('Invalid verification token', { status: 401 });
      }
    }

    // Only handle message events
    const eventType = body.header?.event_type;
    if (eventType !== 'im.message.receive_v1') {
      log('handleLarkWebhook: ignoring event type=%s', eventType);
      return Response.json({ ok: true });
    }

    const event = body.event;
    const message = event?.message;
    const sender = event?.sender;

    if (!message || !sender) {
      return Response.json({ ok: true });
    }

    // Extract message content
    const chatId = message.chat_id;
    const messageType = message.message_type;

    // Only handle text messages for now
    if (messageType !== 'text') {
      log('handleLarkWebhook: ignoring message type=%s', messageType);
      return Response.json({ ok: true });
    }

    let messageText = '';
    try {
      const content = JSON.parse(message.content);
      messageText = content.text || '';
    } catch {
      // malformed content — treat as empty
    }

    if (!messageText.trim()) {
      return Response.json({ ok: true });
    }

    // Look up agent by appId from header or URL param
    const larkAppId = appId || body.header?.app_id;
    if (!larkAppId) {
      log('handleLarkWebhook: no appId found');
      return new Response('No app ID', { status: 400 });
    }

    const key = `${platform}:${larkAppId}`;
    const agentInfo = this.agentMap.get(key);
    const credentials = this.credentialsByKey.get(key);

    if (!agentInfo || !credentials) {
      log('handleLarkWebhook: no agent registered for %s', key);
      return new Response('No bot configured', { status: 404 });
    }

    log(
      'handleLarkWebhook: chatId=%s, sender=%s, text=%s, agent=%s',
      chatId,
      sender.sender_id?.open_id,
      messageText.slice(0, 80),
      agentInfo.agentId,
    );

    // Process message asynchronously (don't block the webhook response)
    this.processLarkMessage({
      agentId: agentInfo.agentId,
      chatId,
      credentials,
      messageText,
      platform,
      userId: agentInfo.userId,
    }).catch((error) => {
      log('handleLarkWebhook: processLarkMessage error: %O', error);
    });

    return Response.json({ ok: true });
  }

  /**
   * Process a Lark message: send ack, start agent execution with webhooks.
   */
  private async processLarkMessage(params: {
    agentId: string;
    chatId: string;
    credentials: StoredCredentials;
    messageText: string;
    platform: string;
    userId: string;
  }): Promise<void> {
    const { agentId, chatId, credentials, messageText, platform, userId } = params;
    const applicationId = credentials.appId;

    const lark = new LarkRestApi(credentials.appId, credentials.appSecret, platform);

    // Send initial ack message
    const ackText = renderStart(messageText);
    const { messageId: progressMessageId } = await lark.sendMessage(chatId, ackText);

    log('processLarkMessage: progressMessageId=%s', progressMessageId);

    // Get or create topicId from Redis thread state
    const redis = getAgentRuntimeRedisClient();
    const stateKey = `lark-thread:${platform}:${chatId}`;
    let topicId: string | undefined;

    if (redis) {
      try {
        const state = await redis.get(stateKey);
        if (state) {
          topicId = JSON.parse(state).topicId;
        }
      } catch {
        // ignore Redis errors
      }
    }

    // Build webhook callback
    const baseURL = appEnv.INTERNAL_APP_URL || appEnv.APP_URL;
    if (!baseURL) {
      throw new Error('APP_URL is required for bot webhooks');
    }
    const callbackUrl = urlJoin(baseURL, '/api/agent/webhooks/bot-callback');

    const platformThreadId = `${platform}:${chatId}`;
    const webhookBody = {
      applicationId,
      platformThreadId,
      progressMessageId,
    };

    const serverDB = await getServerDB();
    const aiAgentService = new AiAgentService(serverDB, userId);

    const botContext = { applicationId, platform, platformThreadId };
    const result = await aiAgentService.execAgent({
      agentId,
      appContext: topicId ? { topicId } : undefined,
      autoStart: true,
      botContext,
      completionWebhook: { body: webhookBody, url: callbackUrl },
      prompt: messageText,
      stepWebhook: { body: webhookBody, url: callbackUrl },
      title: '',
      trigger: 'bot',
      userInterventionConfig: { approvalMode: 'headless' },
      webhookDelivery: 'qstash',
    });

    // Store topicId in Redis for multi-turn conversations
    if (redis && result.topicId) {
      try {
        await redis.set(stateKey, JSON.stringify({ topicId: result.topicId }));
      } catch {
        // ignore Redis errors
      }
    }

    log('processLarkMessage: operationId=%s, topicId=%s', result.operationId, result.topicId);
  }

  /**
   * Decrypt Lark event body encrypted with AES-256-CBC.
   * https://open.larksuite.com/document/server-docs/event-subscription/event-subscription-configure-/encrypt-key-encryption-configuration-case
   */
  private decryptLarkEvent(encrypted: string, encryptKey: string): string {
    // Node.js crypto for AES-256-CBC decryption
    const crypto = require('node:crypto');
    const key = crypto.createHash('sha256').update(encryptKey).digest();
    const encryptedBuffer = Buffer.from(encrypted, 'base64');
    const iv = encryptedBuffer.subarray(0, 16);
    const ciphertext = encryptedBuffer.subarray(16);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(ciphertext, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  private cloneRequest(req: Request, body: ArrayBuffer): Request {
    return new Request(req.url, {
      body,
      headers: req.headers,
      method: req.method,
    });
  }

  // ------------------------------------------------------------------
  // Initialisation
  // ------------------------------------------------------------------

  private static REFRESH_INTERVAL_MS = 5 * 60_000;

  private initPromise: Promise<void> | null = null;
  private lastLoadedAt = 0;
  private refreshPromise: Promise<void> | null = null;

  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    await this.initPromise;

    // Periodically refresh bot mappings in the background so newly added bots are discovered
    if (
      Date.now() - this.lastLoadedAt > BotMessageRouter.REFRESH_INTERVAL_MS &&
      !this.refreshPromise
    ) {
      this.refreshPromise = this.loadAgentBots().finally(() => {
        this.refreshPromise = null;
      });
    }
  }

  async initialize(): Promise<void> {
    log('Initializing BotMessageRouter');

    await this.loadAgentBots();

    log('Initialized: %d agent bots', this.botInstances.size);
  }

  // ------------------------------------------------------------------
  // Per-agent bots from DB
  // ------------------------------------------------------------------

  private async loadAgentBots(): Promise<void> {
    try {
      const serverDB = await getServerDB();
      const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

      // Load all supported platforms
      for (const platform of ['discord', 'telegram', 'lark', 'feishu']) {
        const providers = await AgentBotProviderModel.findEnabledByPlatform(
          serverDB,
          platform,
          gateKeeper,
        );

        log('Found %d %s bot providers in DB', providers.length, platform);

        for (const provider of providers) {
          const { agentId, userId, applicationId, credentials } = provider;
          const key = `${platform}:${applicationId}`;

          if (this.agentMap.has(key)) {
            log('Skipping provider %s: already registered', key);
            continue;
          }

          // Lark/Feishu: no Chat SDK adapter — store mapping only, webhooks handled directly
          if (platform === 'lark' || platform === 'feishu') {
            this.agentMap.set(key, { agentId, userId });
            this.credentialsByKey.set(key, credentials);
            log(
              'Created %s bot for agent=%s, appId=%s (direct mode)',
              platform,
              agentId,
              applicationId,
            );
            continue;
          }

          const adapters = createAdapterForPlatform(platform, credentials, applicationId);
          if (!adapters) {
            log('Unsupported platform: %s', platform);
            continue;
          }

          const bot = this.createBot(adapters, `agent-${agentId}`);
          this.registerHandlers(bot, serverDB, {
            agentId,
            applicationId,
            platform,
            userId,
          });
          await bot.initialize();

          this.botInstances.set(key, bot);
          this.agentMap.set(key, { agentId, userId });
          this.credentialsByKey.set(key, credentials);

          // Discord-specific: also index by botToken for gateway forwarding
          if (platform === 'discord' && credentials.botToken) {
            this.botInstancesByToken.set(credentials.botToken, bot);
          }

          // Telegram: call setWebhook to ensure Telegram-side secret_token
          // stays in sync with the adapter config (idempotent, safe on every init)
          if (platform === 'telegram' && credentials.botToken) {
            const baseUrl = (credentials.webhookProxyUrl || appEnv.APP_URL || '').replace(
              /\/$/,
              '',
            );
            const webhookUrl = `${baseUrl}/api/agent/webhooks/telegram/${applicationId}`;
            setTelegramWebhook(credentials.botToken, webhookUrl, credentials.secretToken).catch(
              (err) => {
                log('Failed to set Telegram webhook for appId=%s: %O', applicationId, err);
              },
            );
          }

          log('Created %s bot for agent=%s, appId=%s', platform, agentId, applicationId);
        }
      }

      this.lastLoadedAt = Date.now();
    } catch (error) {
      log('Failed to load agent bots: %O', error);
    }
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private createBot(adapters: Record<string, any>, label: string): Chat<any> {
    const config: any = {
      adapters,
      userName: `lobehub-bot-${label}`,
    };

    const redisClient = getAgentRuntimeRedisClient();
    if (redisClient) {
      config.state = createIoRedisState({
        client: redisClient,
        keyPrefix: `chat-sdk:${label}`,
        logger: new ConsoleLogger(),
      });
    }

    return new Chat(config);
  }

  private registerHandlers(
    bot: Chat<any>,
    serverDB: LobeChatDatabase,
    info: ResolvedAgentInfo & { applicationId: string; platform: string },
  ): void {
    const { agentId, applicationId, platform, userId } = info;
    const bridge = new AgentBridgeService(serverDB, userId);

    bot.onNewMention(async (thread, message) => {
      log(
        'onNewMention: agent=%s, platform=%s, author=%s, thread=%s',
        agentId,
        platform,
        message.author.userName,
        thread.id,
      );
      await bridge.handleMention(thread, message, {
        agentId,
        botContext: { applicationId, platform, platformThreadId: thread.id },
      });
    });

    bot.onSubscribedMessage(async (thread, message) => {
      if (message.author.isBot === true) return;

      log(
        'onSubscribedMessage: agent=%s, platform=%s, author=%s, thread=%s',
        agentId,
        platform,
        message.author.userName,
        thread.id,
      );

      await bridge.handleSubscribedMessage(thread, message, {
        agentId,
        botContext: { applicationId, platform, platformThreadId: thread.id },
      });
    });

    // Telegram-only: handle messages in unsubscribed threads that aren't @mentions.
    // This covers Telegram private chats where users message the bot directly.
    // Discord relies solely on onNewMention/onSubscribedMessage — registering a
    // catch-all there would cause unsolicited replies in active channels.
    if (platform === 'telegram') {
      bot.onNewMessage(/./, async (thread, message) => {
        if (message.author.isBot === true) return;

        log(
          'onNewMessage (telegram catch-all): agent=%s, author=%s, thread=%s, text=%s',
          agentId,
          message.author.userName,
          thread.id,
          message.text?.slice(0, 80),
        );

        await bridge.handleMention(thread, message, {
          agentId,
          botContext: { applicationId, platform, platformThreadId: thread.id },
        });
      });
    }
  }
}

// ------------------------------------------------------------------
// Singleton
// ------------------------------------------------------------------

let instance: BotMessageRouter | null = null;

export function getBotMessageRouter(): BotMessageRouter {
  if (!instance) {
    instance = new BotMessageRouter();
  }
  return instance;
}
