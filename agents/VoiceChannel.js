/**
 * agents/VoiceChannel.js — Discord Voice Channel Handler
 * Tham gia voice channel, nghe user nói, trả lời bằng giọng nói.
 * @module agents/VoiceChannel
 */

import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} from '@discordjs/voice';
import { getLogger } from '../lib/logger.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';

const logger = getLogger('VoiceChannel');
const execAsync = promisify(exec);

const _connections = new Map(); // guildId → { connection, player, speaking }

/**
 * Tham gia voice channel.
 * @param {import('discord.js').VoiceChannel} channel
 */
export async function joinChannel(channel) {
  const guildId = channel.guild.id;

  // Nếu đã kết nối → disconnect trước
  if (_connections.has(guildId)) {
    leaveChannel(guildId);
  }

  try {
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,  // ← FIX: Không tự điếc, bot có thể nghe
      selfMute: false,  // ← FIX: Không tự tắt mic
    });

    // Chờ kết nối sẵn sàng
    await entersState(connection, VoiceConnectionStatus.Ready, 10000);

    const player = createAudioPlayer();
    connection.subscribe(player);

    _connections.set(guildId, { connection, player, speaking: false });

    // Xử lý disconnect
    connection.on(VoiceConnectionStatus.Disconnected, () => {
      logger.info(`[Voice] Disconnected from ${guildId}`);
      _connections.delete(guildId);
    });

    logger.info(`[Voice] Joined channel: ${channel.name} (${guildId})`);

    // TODO: TTS greeting — install edge-tts for voice output
    return { success: true };
  } catch (err) {
    logger.error(`[Voice] Join failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Rời voice channel.
 * @param {string} guildId
 */
export function leaveChannel(guildId) {
  const entry = _connections.get(guildId);
  if (!entry) return;

  try {
    entry.connection.destroy();
    _connections.delete(guildId);
    logger.info(`[Voice] Left channel: ${guildId}`);
  } catch (err) {
    logger.error(`[Voice] Leave error: ${err.message}`);
  }
}

/**
 * Phát audio từ URL hoặc Buffer.
 * @param {string} guildId
 * @param {string|Buffer} audioSource — URL hoặc audio buffer
 */
export async function playAudio(guildId, audioSource) {
  const entry = _connections.get(guildId);
  if (!entry) {
    logger.warn(`[Voice] No connection for ${guildId}`);
    return { success: false, error: 'Not connected' };
  }

  try {
    const resource = createAudioResource(audioSource);
    entry.player.play(resource);
    entry.speaking = true;

    // Chờ phát xong
    await new Promise((resolve) => {
      entry.player.once(AudioPlayerStatus.Idle, () => {
        entry.speaking = false;
        resolve();
      });
    });

    return { success: true };
  } catch (err) {
    logger.error(`[Voice] Play error: ${err.message}`);
    entry.speaking = false;
    return { success: false, error: err.message };
  }
}

/**
 * Kiểm tra đang nói không.
 * @param {string} guildId
 */
export function isSpeaking(guildId) {
  return _connections.get(guildId)?.speaking || false;
}

/**
 * Kiểm tra đã kết nối voice chưa.
 * @param {string} guildId
 */
export function isConnected(guildId) {
  return _connections.has(guildId);
}

/**
 * Lấy danh sách voice connections.
 */
export function listConnections() {
  return [..._connections.keys()];
}

/**
 * Text-to-Speech bằng edge-tts (miễn phí, không cần API key).
 * @param {string} text — Nội dung cần đọc
 * @param {string} [voice='vi-VN-NamNeural'] — Giọng đọc (Vietnamese male)
 * @returns {Promise<string>} — Đường dẫn file MP3
 */
export async function textToSpeech(text, voice = 'vi-VN-HoaiNeural') {
  try {
    // Tạo file tạm
    const tmpDir = os.tmpdir();
    const outPath = path.join(tmpDir, `tts-${Date.now()}.mp3`);

    // Gọi edge-tts — dùng full path vì exec không inherit full PATH trên Windows
    const safeText = text.replace(/"/g, '\\"').replace(/'/g, "\\'");
    const edgeTtsPath = process.env.EDGE_TTS_PATH || 'edge-tts';
    const cmd = `"${edgeTtsPath}" --voice ${voice} --text "${safeText}" --write-media "${outPath}"`;

    // Thêm Python Scripts vào PATH nếu chưa có
    const env = { ...process.env };
    const pythonScripts = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'Scripts');
    if (fs.existsSync(pythonScripts) && !env.PATH.includes(pythonScripts)) {
      env.PATH = pythonScripts + ';' + env.PATH;
    }

    await execAsync(cmd, { timeout: 30000, env });

    // Verify file exists
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
      logger.info(`[Voice] TTS generated: ${outPath}`);
      return outPath;
    }

    throw new Error('TTS output file is empty');
  } catch (err) {
    logger.error(`[Voice] TTS failed: ${err.message}`);
    return null;
  }
}

/**
 * Phát text trong voice channel (TTS + play).
 * @param {string} guildId
 * @param {string} text
 * @param {string} [voice='vi-VN-NamNeural']
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function speakInChannel(guildId, text, voice = 'vi-VN-NamNeural') {
  // Generate TTS audio
  const audioPath = await textToSpeech(text, voice);
  if (!audioPath) {
    return { success: false, error: 'TTS failed' };
  }

  // Play in channel
  const result = await playAudio(guildId, audioPath);

  // Cleanup temp file
  try {
    setTimeout(() => {
      fs.unlink(audioPath, () => {});
    }, 5000);
  } catch { /* ignore */ }

  return result;
}
