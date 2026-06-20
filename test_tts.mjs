import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';

const execAsync = promisify(exec);

async function testTts(text, voice = 'vi-VN-HoaiNeural') {
  const tmpDir = os.tmpdir();
  const outPath = path.join(tmpDir, `tts-${Date.now()}.mp3`);
  const safeText = text.replace(/"/g, '\\"');

  // Thử cách 1: edge-tts.exe trực tiếp
  try {
    const cmd1 = `"C:\\Users\\bogia\\AppData\\Local\\Programs\\Python\\Python312\\Scripts\\edge-tts.exe" --voice ${voice} --text "${safeText}" --write-media "${outPath}"`;
    console.log('Cách 1: edge-tts.exe trực tiếp...');
    await execAsync(cmd1, { timeout: 15000 });
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
      console.log('✅ Cách 1 OK:', outPath, `(${fs.statSync(outPath).size} bytes)`);
      return outPath;
    }
  } catch (e) {
    console.log('❌ Cách 1 fail:', e.message.slice(0, 100));
  }

  // Thử cách 2: python -m edge_tts
  try {
    const cmd2 = `python -m edge_tts --voice ${voice} --text "${safeText}" --write-media "${outPath}"`;
    console.log('Cách 2: python -m edge_tts...');
    await execAsync(cmd2, { timeout: 15000 });
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
      console.log('✅ Cách 2 OK:', outPath, `(${fs.statSync(outPath).size} bytes)`);
      return outPath;
    }
  } catch (e) {
    console.log('❌ Cách 2 fail:', e.message.slice(0, 100));
  }

  // Thử cách 3: py -m edge_tts
  try {
    const cmd3 = `py -m edge_tts --voice ${voice} --text "${safeText}" --write-media "${outPath}"`;
    console.log('Cách 3: py -m edge_tts...');
    await execAsync(cmd3, { timeout: 15000 });
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
      console.log('✅ Cách 3 OK:', outPath, `(${fs.statSync(outPath).size} bytes)`);
      return outPath;
    }
  } catch (e) {
    console.log('❌ Cách 3 fail:', e.message.slice(0, 100));
  }

  return null;
}

const result = await testTts('Xin chào, tôi là Serena, trợ lý AI.');
console.log('\nFinal result:', result || 'ALL FAILED');
