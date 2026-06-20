import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

function ttsSpawn(text, voice = 'vi-VN-HoaiNeural') {
  return new Promise((resolve, reject) => {
    const tmpDir = os.tmpdir();
    const outPath = path.join(tmpDir, `tts-${Date.now()}.mp3`);

    // Dùng full path đến python.exe
    const pythonExe = 'C:\\Users\\bogia\\AppData\\Local\\Programs\\Python\\Python312\\python.exe';
    const args = ['-m', 'edge_tts', '--voice', voice, '--text', text, '--write-media', outPath];
    console.log('Running:', pythonExe, args.join(' '));

    const proc = spawn(pythonExe, args, {
      env: { ...process.env },
      windowsHide: true,
    });

    let stderr = '';
    let stdout = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.stdout.on('data', d => { stdout += d.toString(); });

    proc.on('close', code => {
      console.log('Exit code:', code);
      if (stdout) console.log('stdout:', stdout.trim());
      if (stderr) console.log('stderr:', stderr.slice(0, 300));
      if (code === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
        console.log('✅ OK:', outPath, `(${fs.statSync(outPath).size} bytes)`);
        resolve(outPath);
      } else {
        reject(new Error(`TTS failed: code=${code}`));
      }
    });

    proc.on('error', (err) => {
      console.log('Spawn error:', err.message);
      reject(err);
    });
  });
}

try {
  const result = await ttsSpawn('Xin chào, tôi là Serena.');
  console.log('Result:', result);
} catch (e) {
  console.log('Error:', e.message);
}
