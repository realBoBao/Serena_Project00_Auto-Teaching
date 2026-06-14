/**
 * ═══════════════════════════════════════════════════════════════
 * Discord Interactions Endpoint — Serverless Discord Bot
 * ═══════════════════════════════════════════════════════════════
 *
 * Replaces the WebSocket-based discord_bot.js for Cloud Run.
 *
 * CƠ CHẾ:
 *   Discord → HTTP POST → /discord/interactions (Cloud Run)
 *   Cloud Run wakes up → handles command → responds → sleeps
 *
 *   Không cần WebSocket 24/7. Không cần Gateway process.
 *   Chi phí = $0 khi không có ai dùng.
 *
 * CÀI ĐẶT:
 *   1. Tạo Application trên https://discord.com/developers
 *   2. Bật "Interactions Endpoint URL" → https://YOUR-RUN-URL/discord/interactions
 *   3. Copy Public Key vào .env: DISCORD_PUBLIC_KEY=xxxxx
 *   4. Register slash commands (bên dưới)
 *
 * @module discord_interactions
 */

import 'dotenv/config';
import crypto from 'crypto';

const DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY || '';
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const DISCORD_APPLICATION_ID = process.env.DISCORD_APPLICATION_ID || '';

// ═══════════════════════════════════════════════════════════
//  DISCORD INTERACTION TYPES (from Discord API docs)
// ═══════════════════════════════════════════════════════════
const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5,
};

const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
};

// ═══════════════════════════════════════════════════════════
//  DISCORD REQUEST VERIFICATION (Ed25519, native Node crypto)
// ═══════════════════════════════════════════════════════════

/**
 * Verify that a request actually came from Discord.
 * Uses Ed25519 signature verification via Node.js crypto (no external dep).
 *
 * Discord signs requests with: Ed25519(timestamp + body)
 * We verify using the application's public key.
 */
export function verifyDiscordRequest(req, rawBody) {
  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];

  if (!signature || !timestamp || !DISCORD_PUBLIC_KEY) {
    return false;
  }

  try {
    // Discord uses Ed25519 (curve25519) — supported natively in Node 16+
    const signatureBuf = Buffer.from(signature, 'hex');
    const publicKeyBuf = Buffer.from(DISCORD_PUBLIC_KEY, 'hex');
    const message = Buffer.concat([
      Buffer.from(timestamp),
      Buffer.from(rawBody, 'utf8'),
    ]);

    return crypto.verify(null, message, {
      key: publicKeyBuf,
      format: 'raw',
      type: 'ed25519',
    }, signatureBuf);
  } catch (err) {
    console.error('[DiscordInteractions] Signature verification failed:', err.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════
//  SLASH COMMAND HANDLERS
// ═══════════════════════════════════════════════════════════

/**
 * Registry of slash command handlers.
 * Each handler receives the interaction data and returns a Discord response object.
 */
const commandHandlers = new Map();

export function registerCommand(name, handler) {
  commandHandlers.set(name, handler);
}

// ═══════════════════════════════════════════════════════════
//  MAIN INTERACTION HANDLER (Express middleware)
// ═══════════════════════════════════════════════════════════

/**
 * Express route handler for POST /discord/interactions
 *
 * Discord sends 3 types of interactions:
 * 1. PING → respond with PONG (for endpoint verification)
 * 2. APPLICATION_COMMAND → user used a slash command
 * 3. MESSAGE_COMPONENT → user clicked a button
 */
export async function handleInteraction(req, res) {
  // 1. Verify signature using raw body (pre-read by server for Ed25519 verification)
  const rawBody = req.rawBody || (req.body ? JSON.stringify(req.body) : '');
  if (!verifyDiscordRequest(req, rawBody)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const interaction = req.body;

  // 2. Handle PING (Discord verifying our endpoint)
  if (interaction.type === InteractionType.PING) {
    return res.json({ type: InteractionResponseType.PONG });
  }

  // 3. Handle APPLICATION_COMMAND (slash commands)
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const commandName = interaction.data.name;
    const handler = commandHandlers.get(commandName);

    if (!handler) {
      return res.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: `❌ Lệnh /${commandName} chưa được đăng ký.` },
      });
    }

    try {
      // Acknowledge immediately (Discord requires response within 3s)
      // Then use follow-up messages for slow operations
      res.json({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        data: { flags: 0 }, // flags: 64 = ephemeral
      });

      // Execute handler asynchronously
      const result = await handler(interaction);

      // Send follow-up message
      await sendFollowUp(interaction, result);
    } catch (err) {
      console.error(`[DiscordInteractions] Command /${commandName} failed:`, err.message);
      await sendFollowUp(interaction, {
        content: `❌ Lỗi xử lý lệnh: ${err.message}`,
      });
    }
    return;
  }

  // 4. Handle MESSAGE_COMPONENT (button clicks)
  if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
    const customId = interaction.data.custom_id;
    // Route to component handler (registered separately)
    const componentHandler = componentHandlers.get(customId);
    if (componentHandler) {
      try {
        res.json({
          type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE,
        });
        const result = await componentHandler(interaction);
        await sendFollowUp(interaction, result);
      } catch (err) {
        await sendFollowUp(interaction, { content: `❌ ${err.message}` });
      }
    } else {
      res.json({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: { content: '⚠️ Hành động không còn hợp lệ.', components: [] },
      });
    }
    return;
  }

  // Unknown type
  res.status(400).json({ error: 'Unknown interaction type' });
}

// ═══════════════════════════════════════════════════════════
//  COMPONENT HANDLER REGISTRY (buttons, select menus)
// ═══════════════════════════════════════════════════════════

const componentHandlers = new Map();

export function registerComponent(customId, handler) {
  componentHandlers.set(customId, handler);
}

// ═══════════════════════════════════════════════════════════
//  FOLLOW-UP MESSAGES
// ═══════════════════════════════════════════════════════════

/**
 * Send a follow-up message after deferred response.
 * Uses Discord webhook API with the interaction token.
 */
async function sendFollowUp(interaction, { content, embeds, components, ephemeral = false }) {
  const url = `https://discord.com/api/v10/webhooks/${DISCORD_APPLICATION_ID}/${interaction.token}/messages/@original`;

  const body = {};
  if (content) body.content = content.slice(0, 2000);
  if (embeds) body.embeds = embeds;
  if (components) body.components = components;
  if (ephemeral) body.flags = 64;

  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error('[DiscordInteractions] Follow-up failed:', res.status, await res.text());
    }
  } catch (err) {
    console.error('[DiscordInteractions] Follow-up error:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════
//  REGISTER SLASH COMMANDS (one-time setup)
// ═══════════════════════════════════════════════════════════

/**
 * Register all slash commands with Discord API.
 * Call this once during setup or when commands change.
 */
export async function registerSlashCommands() {
  if (!DISCORD_APPLICATION_ID || !DISCORD_BOT_TOKEN) {
    console.warn('[DiscordInteractions] DISCORD_APPLICATION_ID or DISCORD_BOT_TOKEN not set — skipping command registration');
    return;
  }

  const commands = [
    {
      name: 'ask',
      description: 'Hỏi AI bất cứ điều gì',
      options: [{
        type: 3, // STRING
        name: 'query',
        description: 'Câu hỏi của bạn',
        required: true,
      }],
    },
    {
      name: 'quiz',
      description: 'Bắt đầu quiz flashcards',
      options: [{
        type: 3,
        name: 'topic',
        description: 'Chủ đề (để trống = tất cả)',
        required: false,
      }],
    },
    {
      name: 'path',
      description: 'Xem lộ trình học tập',
      options: [{
        type: 3,
        name: 'topic',
        description: 'Chủ đề cần học',
        required: true,
      }],
    },
    {
      name: 'studyplan',
      description: 'Lập kế hoạch học tập tuần',
      options: [{
        type: 3,
        name: 'topic',
        description: 'Chủ đề cần lập kế hoạch',
        required: true,
      }],
    },
    {
      name: 'debate',
      description: 'Khiêu tranh một vấn đề',
      options: [{
        type: 3,
        name: 'topic',
        description: 'Chủ đề khiêu tranh',
        required: true,
      }],
    },
    {
      name: 'sandbox',
      description: 'Chạy code trong sandbox',
      options: [
        {
          type: 3,
          name: 'code',
          description: 'Code cần chạy',
          required: true,
        },
        {
          type: 3,
          name: 'language',
          description: 'Ngôn ngữ (python, javascript, cpp)',
          required: false,
          choices: [
            { name: 'Python', value: 'python' },
            { name: 'JavaScript', value: 'javascript' },
            { name: 'C++', value: 'cpp' },
          ],
        },
      ],
    },
    {
      name: 'status',
      description: 'Xem trạng thái hệ thống',
    },
  ];

  try {
    const res = await fetch(
      `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/commands`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(commands),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      console.error('[DiscordInteractions] Command registration failed:', res.status, err);
      return;
    }

    const data = await res.json();
    console.log(`[DiscordInteractions] Registered ${data.length} slash commands`);
  } catch (err) {
    console.error('[DiscordInteractions] Command registration error:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════
//  DEFAULT COMMAND HANDLERS (basic implementations)
// ═══════════════════════════════════════════════════════════

// /ask — RAG-powered Q&A
registerCommand('ask', async (interaction) => {
  const query = interaction.data.options?.[0]?.value || '';
  const { answerQuestion } = await import('./agents/RagAgent.js');
  const result = await answerQuestion(query);
  return {
    content: result.answer?.slice(0, 2000) || 'Không tìm thấy câu trả lời.',
    embeds: result.sourcesFormatted ? [{
      title: '📚 Nguồn tham khảo',
      description: result.sourcesFormatted,
      color: 0x4A90D9,
    }] : undefined,
  };
});

// /quiz — Flashcard quiz
registerCommand('quiz', async (interaction) => {
  const topic = interaction.data.options?.[0]?.value || null;
  const { getRandomFlashcards } = await import('./lib/flashcard_db.js');
  const cards = await getRandomFlashcards(1, topic);
  if (!cards.length) {
    return { content: '📭 Không có flashcard nào.' };
  }
  const card = cards[0];
  return {
    embeds: [{
      title: '🎴 Quiz',
      description: `**${card.question}**\n\n||${card.answer}||`,
      color: 0x7F77DD,
      footer: { text: `Category: ${card.category} · Dùng /quiz để tiếp tục` },
    }],
  };
});

// /path — Learning path
registerCommand('path', async (interaction) => {
  const topic = interaction.data.options?.[0]?.value || '';
  const { LearningPathGenerator } = await import('./lib/learning_path.js');
  const result = await LearningPathGenerator.generate('discord-user', topic);
  if (result.error) return { content: result.error };
  const discord = LearningPathGenerator.formatDiscord(result, { short: true });
  return { embeds: discord.embeds };
});

// /studyplan — Weekly study plan (CSP)
registerCommand('studyplan', async (interaction) => {
  const topic = interaction.data.options?.[0]?.value || '';
  const { LearningPathGenerator } = await import('./lib/learning_path.js');
  const { StudyCSP, DAYS } = await import('./lib/study_csp.js');

  const path = await LearningPathGenerator.generate('discord-user', topic);
  if (path.error) return { content: path.error };

  const todoTopics = path.nodes
    .filter(n => n.status !== 'mastered')
    .slice(0, 15); // Cap at 15 for CSP performance

  const cspResult = StudyCSP.solve(todoTopics, {
    availableHours: [1, 1.5, 1, 1.5, 1, 2, 2],
    peakEnergyHours: [9, 10, 14],
  });

  const formatted = StudyCSP.formatDiscord(cspResult, todoTopics);
  return { embeds: [formatted] };
});

// /debate — Quick debate
registerCommand('debate', async (interaction) => {
  const topic = interaction.data.options?.[0]?.value || '';
  const { quickDebate } = await import('./agents/DebateAgent.js');
  const result = await quickDebate(topic);
  return {
    embeds: [{
      title: `⚔️ Debate: ${topic}`,
      description: result.summary?.slice(0, 4000) || 'Không thể tạo debate.',
      color: 0xE67E22,
    }],
  };
});

// /sandbox — Code execution
registerCommand('sandbox', async (interaction) => {
  const code = interaction.data.options?.find(o => o.name === 'code')?.value || '';
  const language = interaction.data.options?.find(o => o.name === 'language')?.value || 'python';
  const { sandboxGateway } = await import('./sandbox_gateway.js');
  const result = await sandboxGateway.execute({ agent: 'discord_interaction', code, language });
  return {
    content: result.success
      ? `\`\`\`\n${(result.output || '(no output)').slice(0, 1900)}\n\`\`\``
      : `❌ ${result.error || 'Sandbox error'}`,
  };
});

// /status — System status
registerCommand('status', async (interaction) => {
  const mem = process.memoryUsage();
  return {
    embeds: [{
      title: '📊 System Status',
      fields: [
        { name: 'Uptime', value: `${Math.round(process.uptime() / 60)}m`, inline: true },
        { name: 'Memory', value: `${Math.round(mem.rss / 1024 / 1024)}MB`, inline: true },
        { name: 'Platform', value: 'Cloud Run (Serverless)', inline: true },
      ],
      color: 0x1D9E75,
    }],
  };
});
