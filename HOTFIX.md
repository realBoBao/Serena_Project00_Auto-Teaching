# 🔥 HOTFIX — Production Server Issues

## 0. CI/CD Deploy — SSH Permission Denied

**Error:** `***@***: Permission denied (publickey)`

**Nguyên nhân:** SSH key trong GitHub Secrets (`GCP_SSH_KEY`) không khớp với server.

**Fix trên GitHub:**
1. Vào repo → Settings → Secrets and variables → Actions
2. Kiểm tra `GCP_SSH_KEY` có đúng private key không
3. Nếu key mới, cần update cả 3 secrets:
   - `GCP_HOST` — IP/domain của VPS
   - `GCP_USERNAME` — username SSH (ví dụ: `realBoBao`)
   - `GCP_SSH_KEY` — nội dung file `~/.ssh/id_rsa` (private key)

**Tạo SSH key mới (nếu cần):**
```bash
# Trên local machine
ssh-keygen -t ed25519 -C "github-actions-deploy"
# Copy public key lên server
ssh-copy-id -i ~/.ssh/id_ed25519.pub realBoBao@server_host
# Copy private key vào GitHub Secrets
cat ~/.ssh/id_ed25519
```

## 1. `Pipeline error: score is not defined`

**Nguyên nhân:** Trong `pipeline_report_v2.js`, hàm `calculateSourceScore()` trả về giá trị 0-1, nhưng code so sánh `r.score >= 6` (giả định thang 0-10).

**Fix đã áp dụng:** Đổi threshold từ `6/4` → `0.7/0.4`.

**Trên production server, chạy:**
```bash
cd /home/bogiabao2006/ai-brain
grep -n "score >= 6" pipeline_report_v2.js
# Nếu có, sửa thành:
# const goodRepos = repos.filter(r => r.score >= 0.7);
# const okRepos = repos.filter(r => r.score >= 0.4 && r.score < 0.7);
# const weakRepos = repos.filter(r => r.score < 0.4);
```

## 2. `Backup failed: Unexpected end of input`

**Nguyên nhân:** File `catch-up.json` hoặc backup metadata bị corrupt (empty hoặc truncated).

**Fix:** Thêm defensive JSON.parse vào tất cả đọc file:

```javascript
// Trong scheduler.js — thay thế mọi JSON.parse(file) bằng:
function safeReadJson(filePath, defaultValue = {}) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw || raw.trim() === '') return defaultValue;
    return JSON.parse(raw);
  } catch {
    console.warn(`[scheduler] Corrupt JSON file: ${filePath}, using defaults`);
    return defaultValue;
  }
}
```

**Trên production server:**
```bash
# Kiểm tra file corrupt
cat /home/bogiabao2006/ai-brain/catch-up.json
# Nếu empty hoặc truncated:
echo '{}' > /home/bogiabao2006/ai-brain/catch-up.json
```

## 3. Các lỗi KHÔNG CẦN SỬA (expected behavior)

| Lý do | Fallback |
|---|---|
| `Qdrant not available` | ✅ Tự fallback SQLite |
| `Reddit 403` | ✅ Trả về empty results |
| `LLM API error` | ✅ Fallback heuristic |
| `Gemini 503` | ✅ Tự retry |
| `Discord shard reconnecting` | ✅ Auto-reconnect |
