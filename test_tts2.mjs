import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

function ttsSpawn(text, voice = 'vi-VN-HoaiNeural') {
  return new Promise((resolve, reject) => {
    const tmpDir = os.tmpdir();
    const outPath = path.join(tmpDir, `tts-${Date.now()}.mp3`);

    const args = ['-m', 'edge_tts', '--voice', voice, '--text', text, '--write-media', outPath];
    console.log('Running: python', args.join(' '));

    const proc = spawn('python', args, {
      env: process.env,
      windowsHide: true,
    });

    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.stdout.on('data', d => { console.log('stdout:', d.toString().trim()); });

    proc.on('close', code => {
      console.log('Exit code:', code);
      if (stderr) console.log('stderr:', stderr.slice(0, 200));
      if (code === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
        console.log('✅ OK:', outPath, `(${fs.statSync(outPath).size} bytes)`);
        resolve(outPath);
      } else {
        reject(new Error(`TTS failed: code=${code}, stderr=${stderr.slice(0, 100)}`));
      }
    });

    proc.on('error', reject);
  });
}

try {
  const result = await ttsSpawn('Xin chào, tôi là Serena.');
  console.log('Result:', result);
} catch (e) {
  console.log('Error:', e.message);
}
