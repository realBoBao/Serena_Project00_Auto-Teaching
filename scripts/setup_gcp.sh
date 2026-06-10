#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# GCP Server Setup Script
# Chạy 1 lần trên GCP VPS để setup môi trường
# ═══════════════════════════════════════════════════════════════

set -e

echo "═══════════════════════════════════════════════"
echo "  AI Brain — GCP Server Setup"
echo "═══════════════════════════════════════════════"

# ── 1. Install dependencies ──
echo ""
echo "[1/5] Installing dependencies..."
sudo apt update && sudo apt install -y git curl build-essential

# Install Node.js 22
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22 | sudo -E bash -
    sudo apt install -y nodejs
fi
echo "  Node.js: $(node --version)"
echo "  npm: $(npm --version)"

# Install PM2
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
fi
echo "  PM2: $(pm2 --version)"

# ── 2. Clone project ──
echo ""
echo "[2/5] Setting up project..."
PROJECT_DIR="$HOME/my-ai-brain"

if [ -d "$PROJECT_DIR" ]; then
    echo "  Project exists, pulling latest..."
    cd "$PROJECT_DIR" && git pull origin main
else
    echo "  Cloning project..."
    git clone https://github.com/realBoBao/Serena_Project00-System_Tutor.git "$PROJECT_DIR"
    cd "$PROJECT_DIR"
fi

# ── 3. Install npm dependencies ──
echo ""
echo "[3/5] Installing npm packages..."
npm ci --only-production

# ── 4. Setup .env ──
echo ""
echo "[4/5] Setting up .env..."
if [ ! -f .env ]; then
    echo "  ⚠️  .env not found! Please create it with your API keys:"
    echo "     cp .env.example .env"
    echo "     nano .env"
    echo ""
    echo "  Required keys:"
    echo "    - DISCORD_BOT_TOKEN"
    echo "    - GEMINI_API_KEY"
    echo "    - OPENROUTER_API_KEY"
    exit 1
fi
echo "  ✅ .env found"

# ── 5. Setup Auto-Backup cronjob ──
echo ""
echo "[5/5] Setting up auto-backup..."
mkdir -p "$HOME/backups"

# Thêm cronjob nếu chưa có
CRON_JOB="0 2 * * * $PROJECT_DIR/scripts/backup.sh >> $HOME/backups/backup.log 2>&1"
(crontab -l 2>/dev/null | grep -v "backup.sh"; echo "$CRON_JOB") | crontab -
echo "  ✅ Cronjob added: daily backup at 2AM"

# ── 6. Start PM2 ──
echo ""
echo "Starting PM2..."
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u $USER --hp $HOME 2>/dev/null || true

echo ""
echo "═══════════════════════════════════════════════"
echo "  ✅ Setup complete!"
echo "═══════════════════════════════════════════════"
echo ""
echo "  Useful commands:"
echo "    pm2 list          — View running services"
echo "    pm2 logs AI_Brain — View bot logs"
echo "    pm2 restart AI_Brain — Restart bot"
echo "    pm2 monit         — Monitor resources"
echo ""
echo "  Backup:"
echo "    ~/backups/        — Backup files"
echo "    crontab -l        — View cronjobs"
