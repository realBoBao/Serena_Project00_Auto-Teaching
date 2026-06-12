# 📋 TODO — my-ai-brain Roadmap

> **Cập nhật:** 2026-06-11 07:00
> **Test Coverage:** 320/320 PASS (100%) | **Flashcards:** 198 cards | **Uptime:** 24/7 PM2
> **PM2 Services:** 10/10 online | **Redis:** In-memory fallback mode | **Security:** CSP + CORS + API key rotation + IP filtering + Audit log
> **UserProfile:** Hoàn thiện — getUserPreference, getProfileStats, streak, level/xp, cleanupOldEvents ✅
> **!profile fix:** Thêm PROFILE vào INTENT_KEYWORDS + routing ✅
> **Git conflict fix:** .gitignore thêm .query_dedup.json, .scheduler_last_run.json ✅
> **API:** 30+ REST endpoints | **PWA:** Mobile companion with voice input + offline sync | **Knowledge Graph:** SQLite-backed with D3.js visualization

---

## ✅ Đã hoàn thành (180+ tasks)

### Core Infrastructure
- ✅ Discord Bot + Webhook Bot + REST API + Scheduler
- ✅ RAG Pipeline (Vector + BM25 + HyDE + Query Expansion)
- ✅ LLM Layer (OpenRouter → Gemini → Local → Static fallback)
- ✅ 198 Flashcards (spaced repetition)
- ✅ Self-Evolution (A/B testing, model selection)
- ✅ Cross-Model Learning (học chéo giữa models)
- ✅ CodeAnalyzer, SecurityAuditor, PerformanceProfiler, LogAnalyzer
- ✅ DebateAgent với Planner Intervention
- ✅ Sandbox Security (4-layer patterns)
- ✅ Auto-Backup script + CI/CD pipeline

### Discord Commands
```
!ask <câu hỏi>     → RAG-powered Q&A
!debate <bài toán> → Multi-agent debate
!analyze <code>    → Code quality analysis
!audit <code>      → Security audit
!profile <code>    → Performance profiling
!logs <text>       → Log analysis
!quiz              → Flashcard quiz
!answer <id> <ans> → Review flashcard
!learn <url>       → Learn from URL/PDF
!preferences       → Set user preferences
!help              → Show all commands
```

---

## 🔴 Cần fix (Priority Order)

### P0 — Critical (blocker)
- [ ] **Discord token invalid** — cần update token mới từ Developer Portal
- [ ] **LLM rate limited** — Gemini + OpenRouter đều fail → static fallback
- [ ] **GitHub search 422** — query bị thay thế bằng static fallback text

### P1 — High (ảnh hưởng trải nghiệm)
- [ ] **Memory leaks** — incidentSessions, _memStore, inMemoryGraph không có cleanup
- [ ] **JSON.parse safety** — memory_manager.js thiếu try-catch
- [ ] **Auto-start side effects** — EvoAgent, GraphAgent tự start khi import
- [ ] **Duplicate patterns** — sandbox_patterns.js có duplicate entries

### P2 — Medium (tối ưu)
- [ ] **Tight coupling** — invokeLlm import từ RagAgent thay vì lib riêng
- [ ] **Hardcoded timeouts** — nhiều files có timeout values hardcoded
- [ ] **Missing registry** — SecurityAuditor, SuggestionAgent chưa có trong RouterAgent
- [ ] **Self-evolution persistence** — AB test data không persist giữa các lần chạy

---

## 📋 Roadmap tiếp theo

### Phase A: Deploy lên VPS (ưu tiên #1)
1. Setup GCP VPS với `scripts/setup_gcp.sh`
2. Configure GitHub Actions CI/CD
3. Test auto-deploy khi push lên main

### Phase B: Hoàn thiện Self-Learning
1. Cross-model learning persistence
2. User preference-based source selection
3. Auto-ingest từ artifacts/*.md

### Phase C: Monitoring & Alerting
1. Prometheus + Grafana dashboard
2. Discord alert khi service down
3. Auto-restart khi crash

---

## 🛠️ Quick Commands

```bash
# Local dev
npm run dev                    # Start all services
npm test                       # Run tests
node scripts/backup.sh         # Backup data

# Discord
!preferences model openrouter  # Set preferred model
!preferences sources youtube   # Set preferred sources
!preferences learning on       # Enable self-learning
!quiz                          # Start flashcard quiz
!quiz stats                    # View flashcard stats

# PM2
pm2 list                       # View services
pm2 logs AI_Brain              # View logs
pm2 restart AI_Brain           # Restart bot
```
