# 🚀 Deployment Guide

## GCP VPS Setup (One-time)

```bash
# 1. SSH into GCP
ssh -i ~/.ssh/gcp_key username@YOUR_IP

# 2. Clone and setup
git clone https://github.com/realBoBao/Serena_Project00-System_Tutor.git
cd Serena_Project00-System_Tutor
bash scripts/setup_gcp.sh

# 3. Add API keys
nano .env  # Add your keys

# 4. Start bot
pm2 start ecosystem.config.cjs
pm2 save
```

## CI/CD Setup (GitHub Actions)

1. Go to GitHub Repository → Settings → Secrets → Actions
2. Add these secrets:
   - `GCP_HOST`: Your GCP IP address
   - `GCP_USER`: SSH username (e.g., `ubuntu`)
   - `GCP_SSH_KEY`: Private SSH key (copy from `~/.ssh/id_rsa`)
   - `DISCORD_WEBHOOK`: Your Discord webhook URL

3. Now every `git push origin main` will auto-deploy!

## Auto-Backup

- Runs daily at 2AM via cronjob
- Keeps 7 days of backups
- Stored in `~/backups/`

```bash
# Manual backup
bash scripts/backup.sh

# View backups
ls -la ~/backups/

# Restore from backup
tar -xzf ~/backups/ai_data_2024-01-01.tar.gz
```

## Useful Commands

```bash
pm2 list                    # View all services
pm2 logs AI_Brain           # View bot logs
pm2 restart AI_Brain        # Restart bot
pm2 monit                   # Monitor CPU/RAM
pm2 save                    # Save PM2 config
```
