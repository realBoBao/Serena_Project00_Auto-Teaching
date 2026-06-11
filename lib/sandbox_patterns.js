/**
 * Sandbox Security Patterns — Single source of truth
 * Imported by both code_sandbox.js and code_sandbox_v2.js.
 */

// ── Layer 1: Dangerous Commands ──
export const DANGEROUS_COMMANDS = [
  /\brm\s+-rf\s+\//, /\brm\s+-rf\s+~/, /\bformat\s+[a-z]:/i,
  /\bdel\s+\/s\s+\/q/i, /\bshutdown\b/i, /\breboot\b/i,
  /\bdd\s+if=\/dev\//i, /\bdd\s+.*of=\/dev\//i,
  /\bkill\s+-9\b/i, /\bkill\s+-SIGKILL\b/i, /\bkillall\b/i,
  /\bsystem\s*\(/i, /\bfork\s*\(/i,
  /\bexec\.Command\s*\(/i, /\bexec\s*\(/i,
  /\bos\.Remove\s*\(/i, /\bRuntime\.exec\s*\(/i,
  /\bcurl\s+/i,
];

// ── Layer 2: Dangerous Imports ──
export const DANGEROUS_IMPORTS = [
  /\brequire\s*\(\s*['"]child_process['"]\s*\)/i,
  /\brequire\s*\(\s*['"]fs['"]\s*\)/i,
  /\brequire\s*\(\s*['"]net['"]\s*\)/i,
  /\brequire\s*\(\s*['"]http['"]\s*\)/i,
  /\bimport\s+.*from\s+['"]child_process['"]/i,
  /\bimport\s+.*from\s+['"]fs['"]/i,
  /\bimport\s+os\b/i, /\bimport\s+subprocess\b/i,
  /\b__import__\s*\(\s*['"]os['"]\s*\)/i,
  /\bimport\s+java\.lang\.Runtime/i,
  /#include\s*<unistd\.h>/i, /#include\s*<sys\/socket\.h>/i,
  /\buse\s+std::process::Command/i,
];

// ── Layer 3: Code Injection Patterns ──
export const DANGEROUS_PATTERNS = [
  /\beval\s*\(/i,
  /\bnew\s+Function\s*\(/i,
  /\bprocess\.exit\s*\(/i,
  /\bprocess\.env\b/i,
  /\bwhile\s*\(\s*true\s*\)\s*\{/,
  /\bfor\s*\(\s*;\s*;\s*\)\s*\{/,
  /\bfs\.(readFile|writeFile|readdir|unlink|rmdir)\s*\(/i,
  /\bfetch\s*\(/i,
  /\b__class__\.__subclasses__\s*\(/i,
  /\b__proto__\s*=/i,
];

// ── Layer 4: Data Exfiltration ──
export const EXFILTRATION_PATTERNS = [
  /\bcurl\s+.*POST/i, /\bwget\s+.*--post-data/i,
  /\bfs\.readFileSync\s*\(\s*['"]\/etc\//i,
  /\bfs\.readFileSync\s*\(\s*['"]\.env['"]/i,
  /\bfs\.readFileSync\s*\(\s*['"]\.ssh\//i,
  /\bchild_process.*exec\s*\(\s*['"]cat\s+\/etc\//i,
  /\bchild_process.*exec\s*\(\s*['"]env['"]/i,
  /\bwget\s+http/i,
  /\bnc\s+\S+\s+\d{2,5}/i,
  /\bnetcat\b/i,
];
