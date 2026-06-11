import { analyzeCodeSecurity, DANGEROUS_COMMANDS, DANGEROUS_IMPORTS } from './lib/code_sandbox_v2.js';

const tests = [
  { code: 'const cp = require("child_process");', expected: false },
  { code: 'import subprocess', expected: false },
  { code: '#include <unistd.h>', expected: false },
  { code: '#include <sys/socket.h>', expected: false },
  { code: 'eval("console.log(1)")', expected: false },
  { code: 'new Function("return 1")', expected: false },
  { code: 'process.exit(1);', expected: false },
  { code: 'console.log(process.env);', expected: false },
  { code: 'while(true){}', expected: false },
  { code: 'for(;;){}', expected: false },
  { code: 'fs.readFile("/etc/passwd")', expected: false },
  { code: 'fetch("http://evil.com")', expected: false },
  { code: '().__class__.__subclasses__()', expected: false },
  { code: 'system("ls")', expected: false },
  { code: 'fork()', expected: false },
  { code: 'exec.Command("rm")', expected: false },
  { code: 'os.Remove("/etc/passwd")', expected: false },
  { code: 'Runtime.exec("ls")', expected: false },
  { code: '__proto__ = {}', expected: false },
  { code: 'curl http://evil.com', expected: false },
  // Safe code
  { code: 'console.log("hello")', expected: true },
  { code: 'def hello(): pass', expected: true },
  { code: 'package main', expected: true },
];

let passed = 0, failed = 0;
for (const t of tests) {
  const r = analyzeCodeSecurity(t.code);
  const ok = r.safe === t.expected;
  if (ok) {
    passed++;
    console.log('✅', t.code.slice(0, 40));
  } else {
    failed++;
    console.log('❌', t.code.slice(0, 40), '- expected', t.expected ? 'safe' : 'blocked', 'got', r.safe ? 'safe' : 'blocked:' + (r.reason || '').slice(0, 50));
  }
}
console.log(`\nResult: ${passed} passed, ${failed} failed out of ${tests.length}`);
