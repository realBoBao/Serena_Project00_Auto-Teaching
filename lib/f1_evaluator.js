/**
 * lib/f1_evaluator.js — F1 Score Evaluation & Monitoring
 *
 * Đo lường chất lượng bằng F1 thay vì accuracy đơn thuần.
 * F1 = harmonic mean của Precision và Recall — phát hiện "AI illusion" khi accuracy cao nhưng recall thấp.
 *
 * Usage:
 *   import { F1Evaluator } from './f1_evaluator.js';
 *   const metrics = F1Evaluator.compute(tp, fp, fn);
 *   await F1Evaluator.logMetrics(db, 'RouterAgent', metrics);
 */

import { getLogger } from './logger.js';

const logger = getLogger('F1Evaluator');

export class F1Evaluator {

  // ─── Core metrics ──────────────────────────────────────────────────────────
  static compute(tp, fp, fn) {
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall    = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1        = precision + recall === 0
      ? 0
      : 2 * (precision * recall) / (precision + recall);

    return {
      precision: parseFloat(precision.toFixed(4)),
      recall:    parseFloat(recall.toFixed(4)),
      f1:        parseFloat(f1.toFixed(4)),
      tp, fp, fn,
    };
  }

  // ─── Multi-class F1 cho RouterAgent ────────────────────────────────────────
  static multiClassF1(predictions, labels) {
    if (!predictions.length || !labels.length) {
      return { perClass: {}, macroF1: 0, weightedF1: 0, accuracy: 0 };
    }

    const classes = [...new Set([...predictions, ...labels])];
    const perClass = {};

    for (const cls of classes) {
      const tp = predictions.filter((p, i) => p === cls && labels[i] === cls).length;
      const fp = predictions.filter((p, i) => p === cls && labels[i] !== cls).length;
      const fn = predictions.filter((p, i) => p !== cls && labels[i] === cls).length;
      perClass[cls] = this.compute(tp, fp, fn);
    }

    const macroF1 = Object.values(perClass).reduce((s, m) => s + m.f1, 0) / classes.length;
    const totalSamples = labels.length;
    const weightedF1 = Object.entries(perClass).reduce((s, [cls, m]) => {
      const support = labels.filter(l => l === cls).length;
      return s + m.f1 * (support / totalSamples);
    }, 0);

    const accuracy = predictions.filter((p, i) => p === labels[i]).length / totalSamples;

    return {
      perClass,
      macroF1:    parseFloat(macroF1.toFixed(4)),
      weightedF1: parseFloat(weightedF1.toFixed(4)),
      accuracy:   parseFloat(accuracy.toFixed(4)),
    };
  }

  // ─── RAG retrieval metrics ─────────────────────────────────────────────────
  static retrievalMetrics(retrieved, relevant, k = null) {
    const topK = k ? retrieved.slice(0, k) : retrieved;
    const relevantSet = new Set(relevant);

    const tp = topK.filter(id => relevantSet.has(id)).length;
    const fp = topK.filter(id => !relevantSet.has(id)).length;
    const fn = relevant.filter(id => !new Set(topK).has(id)).length;

    return {
      ...this.compute(tp, fp, fn),
      k: topK.length,
    };
  }

  // ─── Log metrics vào SQLite ────────────────────────────────────────────────
  static async logMetrics(db, component, metrics, context = '') {
    try {
      if (!db) return;
      db.prepare(`
        INSERT INTO f1_metrics_log (component, precision, recall, f1, tp, fp, fn, context, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        component,
        metrics.precision || 0,
        metrics.recall || 0,
        metrics.f1 || 0,
        metrics.tp || 0,
        metrics.fp || 0,
        metrics.fn || 0,
        context.slice(0, 500),
      );
    } catch (err) {
      logger.warn('[F1Evaluator] logMetrics failed:', err.message);
    }
  }

  // ─── Query metrics từ DB ───────────────────────────────────────────────────
  static async getMetrics(db, component, days = 7) {
    try {
      if (!db) return null;
      const rows = db.prepare(`
        SELECT
          COUNT(*) as samples,
          AVG(f1) as avg_f1,
          AVG(precision) as avg_precision,
          AVG(recall) as avg_recall,
          AVG(CASE WHEN tp + fp + fn > 0 THEN tp * 1.0 / (tp + fp + fn) END) as avg_accuracy,
          MAX(created_at) as last_updated
        FROM f1_metrics_log
        WHERE component = ? AND created_at > datetime('now', ?)
      `).get(component, `-${days} days`);

      return rows;
    } catch {
      return null;
    }
  }

  // ─── Get all components metrics ────────────────────────────────────────────
  static async getAllMetrics(db, days = 7) {
    try {
      if (!db) return [];
      return db.prepare(`
        SELECT
          component,
          COUNT(*) as samples,
          ROUND(AVG(f1), 4) as avg_f1,
          ROUND(AVG(precision), 4) as avg_precision,
          ROUND(AVG(recall), 4) as avg_recall,
          ROUND(AVG(CASE WHEN tp + fp + fn > 0 THEN tp * 1.0 / (tp + fp + fn) END), 4) as avg_accuracy,
          MAX(created_at) as last_updated
        FROM f1_metrics_log
        WHERE created_at > datetime('now', ?)
        GROUP BY component
        ORDER BY avg_f1 ASC
      `.all(`-${days} days`);
    } catch {
      return [];
    }
  }

  // ─── Format cho Discord embed ──────────────────────────────────────────────
  static formatDashboard(metricsList) {
    if (!metricsList.length) {
      return 'Chưa có đủ data — cần ít nhất 50 routing decisions hoặc 100 relevance checks.';
    }

    return metricsList.map(r => {
      const f1Bar = '█'.repeat(Math.round((r.avg_f1 || 0) * 10))
                  + '░'.repeat(10 - Math.round((r.avg_f1 || 0) * 10));
      const accGap = r.avg_accuracy && r.avg_f1
        ? (r.avg_accuracy - r.avg_f1).toFixed(3)
        : null;
      const illusionWarning = accGap && parseFloat(accGap) > 0.15 ? ' ⚠️ illusion!' : '';

      return [
        `**${r.component}**`,
        `\`${f1Bar}\` F1: ${r.avg_f1 || 'N/A'}`,
        `P: ${r.avg_precision || 'N/A'} · R: ${r.avg_recall || 'N/A'}`,
        accGap ? `Acc: ${r.avg_accuracy} (gap: +${accGap}${illusionWarning})` : '',
        `${r.samples} samples · ${r.last_updated?.slice(0, 10)}`,
      ].filter(Boolean).join('\n');
    }).join('\n\n');
  }
}

export default F1Evaluator;
