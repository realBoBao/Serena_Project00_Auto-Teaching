# My AI Brain — Serena, AI Robot Girl Companion

> Hệ thống AI đa tác nhân tự học, tự tiến hóa, tự bảo mật.
> **VPS/PM2 Production | Ponytail Optimized**
> **327+ tests PASS | 20 Agents | 7-tier RAG | Plugin System**

---

## Discord Commands

### Hỏi đáp & Tìm kiếm
```
!ask <câu hỏi>              → RAG-powered Q&A (7-tier pipeline)
!ask <câu hỏi> --deep       → Deep search (8 results, 5 web sources)
!learn <url>                → Học từ URL/PDF
!path <topic>               → Learning Path (Dễ → Khó, từ KG)
!path <topic> --short       → Chỉ 5 bước tiếp theo
!path <topic> --gaps        → Chỉ topic cần học
!recap <topic>              → Tóm tắt bài học
!history <topic>            → Xem facts gần đây từ KG
!whenwas <topic> [date]     → Query KG tại thời điểm cụ thể
!memory <nội dung>           → Lưu trí nhớ cá nhân
```

### Code & Thuật toán
```
!run <code>                 → Chạy code trong Sandbox
!code <bài toán>            → Viết + chạy code tự động
!debate <bài toán>          → Multi-agent debate
!analyze <code>             → Phân tích chất lượng code
!audit <code>               → Quét bảo mật code
!perf <code>                → Phân tích performance
!logs <text>                → Phân tích logs
!review                     → Shadow Review (ôn code cũ)
!incident                   → Chaos Engineering
```

### Voice Channel
```
!voice join                 → Tham gia voice channel
!voice leave                → Rời voice channel
!voice study                → Bật chế độ học (bot im lặng)
!voice stop                 → Tắt chế độ học
!voice + audio              → Transcribe giọng nói (whisper.cpp)
```

### Học tập
```
!quiz                       → Flashcard quiz (FSRS)
!quiz stats                 → Thống kê flashcard
!answer <id> <đáp án>       → Trả lời flashcard
!f1stats                    → F1 Score Dashboard
!profile                    → Hồ sơ học tập
!preferences                → Tùy chọn model/sources/learning
!prefer <style>             → Phong cách học (example_first | theory_first | code_heavy)
```

### Sáng tạo
```
!animate <mô tả>            → Tạo video animation (Manim)
!vision + ảnh               → Phân tích ảnh (Gemini Vision)
```

### Hệ thống
```
!schedule                   → Đồng bộ thời khóa biểu
!plugins                    → Danh sách plugins
!resources                  → Tài nguyên hệ thống
!cli <command>              → Chạy CLI command
!help                       → Danh sách lệnh
```

---

## Quick Start (VPS/PM2)

```bash
git clone https://github.com/realBoBao/Serena_Project00_Auto-Teaching.git
cd Serena_Project00_Auto-Teaching
npm install
cp .env.example .env
# Edit .env with your API keys
npm test
pm2 start ecosystem.config.cjs
pm2 save
```

---

## License

MIT
