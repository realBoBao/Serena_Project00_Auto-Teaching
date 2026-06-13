/**
 * ═══════════════════════════════════════════════════════════════
 * Out-of-Scope Detector — TF-IDF similarity (không cần labels)
 * ═══════════════════════════════════════════════════════════════
 *
 * Thay vì Naive Bayes (cần 500+ labeled examples mỗi class),
 * dùng TF-IDF similarity để detect câu hỏi nằm ngoài scope.
 *
 * Nguyên lý: So sánh cosine similarity của query với các câu hỏi
 * mẫu TRONG scope. Nếu similarity quá thấp → out of scope.
 *
 * Ưu điểm:
 * - Không cần labeled data
 * - Không cần training
 * - Chạy ngay với ~50 seed examples
 * - Cập nhật seed examples từ Discord logs là đủ
 */

import natural from 'natural';

const TfIdf = natural.TfIdf;

// ── Seed examples — câu hỏi TRONG scope
// Cập nhật thêm từ Discord logs khi có dữ liệu thực tế
const IN_SCOPE_SEEDS = [
  // Programming & Algorithms
  'explain binary search algorithm',
  'how does quicksort work',
  'what is dynamic programming',
  'implement linked list in Python',
  'debug this JavaScript code',
  'what is time complexity',
  'how does hash table work',
  'explain depth first search',
  'what is object oriented programming',
  'how to reverse a string',

  // System Design
  'how does TCP handshake work',
  'what is database indexing',
  'explain distributed systems',
  'what is load balancing',
  'how does caching work',
  'what is microservices architecture',
  'explain REST API design',
  'what is message queue',

  // Data Science & ML
  'what is machine learning',
  'explain neural network',
  'what is supervised learning',
  'how does gradient descent work',
  'what is overfitting',

  // DevOps & Infrastructure
  'what is Docker container',
  'explain Kubernetes deployment',
  'what is CI CD pipeline',
  'how does load balancer work',

  // General Knowledge
  'what is blockchain technology',
  'explain quantum computing',
  'what is cloud computing',
  'how does internet work',
];

// ── Singleton TF-IDF instance
let _tfidf = null;
let _seedsLoaded = false;

function getTfidf() {
  if (_tfidf && _seedsLoaded) return _tfidf;

  _tfidf = new TfIdf();
  for (const seed of IN_SCOPE_SEEDS) {
    _tfidf.addDocument(seed.toLowerCase());
  }
  _seedsLoaded = true;
  return _tfidf;
}

/**
 * Kiểm tra query có nằm trong scope không.
 * @param {string} query
 * @returns {{ inScope: boolean, maxSimilarity: number }}
 */
export function checkScope(query) {
  const tfidf = getTfidf();
  const queryLower = query.toLowerCase();

  // Tính TF-IDF similarity với tất cả seed documents
  const scores = [];
  tfidf.tfidfs(queryLower, (i, measure) => scores.push(measure));

  const maxSim = scores.length > 0 ? Math.max(...scores) : 0;

  // Ngưỡng — điều chỉnh sau khi xem log
  // TF-IDF similarity thường 0–1, ngưỡng 0.15 là conservative
  const THRESHOLD = 0.15;

  return {
    inScope: maxSim >= THRESHOLD,
    maxSimilarity: Math.round(maxSim * 1000) / 1000,
  };
}

/**
 * Thêm seed example mới (từ Discord logs).
 */
export function addSeedExample(text) {
  const tfidf = getTfidf();
  tfidf.addDocument(text.toLowerCase());
}

/**
 * Lất danh sách seed examples hiện tại.
 */
export function getSeedExamples() {
  return [...IN_SCOPE_SEEDS];
}

export default { checkScope, addSeedExample, getSeedExamples };
