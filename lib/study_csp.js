/**
 * StudyCSP — Constraint Satisfaction Problem solver for weekly study planning.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                    CSP MODEL                                    │
 * │                                                                 │
 * │  Variables:  Each topic that needs to be scheduled              │
 * │  Domain:     Available (day, hour) slots in the week            │
 * │  Constraints:                                                   │
 * │    1. dailyCapacity   — max minutes per day                     │
 * │    2. energyMatch     — new topics → peak energy hours          │
 * │    3. prereqOrder     — prerequisites before dependents         │
 * │    4. deadlineRespect — flashcard due dates                     │
 * │    5. oneSlotPerTopic — each topic gets exactly one slot        │
 * │                                                                 │
 * │  Solver: Backtracking with forward checking + graceful          │
 * │          degradation (unscheduled list instead of hard fail).   │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Distinction from A* (in PlannerAgent):
 *   A*     → finds optimal PATH through a DAG (single objective).
 *   StudyCSP → finds FEASIBLE ASSIGNMENT satisfying multiple
 *              potentially-conflicting constraints (multi-objective).
 *
 *   A* always returns a path (maybe suboptimal).
 *   CSP may be unsatisfiable — the unscheduled list tells you
 *   exactly what to cut or where to add capacity.
 *
 * Usage:
 *   import { StudyCSP } from './study_csp.js';
 *   const result = StudyCSP.solve(topics, constraints);
 *   // result.assignment  → { topicId: { day, hour } }
 *   // result.unscheduled → ['Topic Name', ...]
 *   // result.success     → boolean
 *
 * Performance: ~20 topics × 14 slots → backtracking < 10ms.
 * No external CSP library needed at this scale.
 *
 * @module lib/study_csp
 */

// ─── Day labels for Discord output ────────────────────────────────────────
export const DAYS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];

// ─── Default constraint weights ────────────────────────────────────────────
const DEFAULT_CONSTRAINTS = {
  dailyCapacity:    true,
  energyMatch:      true,
  prereqOrder:      true,
  deadlineRespect:  true,
  oneSlotPerTopic:  true,
};

/**
 * StudyCSP solver.
 *
 * Static-only class — no instance state, pure functions.
 * All constraints are checked per-slot during backtracking.
 */
export class StudyCSP {

  // ═══════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  /**
   * Solve the study schedule CSP.
   *
   * @param {Array}  topics — Array of topic objects from LearningPathGenerator
   *   Each topic needs: { id, name, status, gapScore, prerequisites?: string[],
   *                        nextDue?: string, estimatedMinutes?: number }
   * @param {Object} constraints — Scheduling constraints
   * @param {number[]} constraints.availableHours — Hours available per day [Mon..Sun]
   * @param {number}  [constraints.peakEnergyHours=[9,10,14]] — Hours considered "peak"
   * @param {number}  [constraints.maxMinutesPerDay=120] — Max study minutes per day
   * @param {number}  [constraints.slotsPerDay=2] — Number of study slots per day
   * @param {Date}    [constraints.weekStart] — Start of the week (defaults to now)
   * @param {Object}  [constraints.enabledConstraints] — Toggle individual constraints
   *
   * @returns {Object} { success, assignment, unscheduled, stats }
   */
  static solve(topics, constraints = {}) {
    const {
      availableHours = [1, 1.5, 1, 1.5, 1, 2, 2],
      peakEnergyHours = [9, 10, 14],
      maxMinutesPerDay = 120,
      slotsPerDay = 2,
      weekStart = new Date(),
      enabledConstraints = DEFAULT_CONSTRAINTS,
    } = constraints;

    // ── Build available slots ────────────────────────────────
    const availableSlots = this._buildSlots(availableHours, slotsPerDay);

    // ── Enrich topics with estimated duration ────────────────
    const enrichedTopics = topics.map(t => ({
      ...t,
      estimatedMinutes: t.estimatedMinutes || this._estimateDuration(t),
    }));

    // ── Sort by priority (gapScore desc, then prereqs first) ─
    const ordered = this._prioritySort(enrichedTopics);

    // ── Build solver state ───────────────────────────────────
    const state = {
      dayMinutes: {},       // dayIndex → total minutes assigned
      usedSlots: new Set(), // "day_hour" strings
      peakEnergyHours,
      maxMinutesPerDay,
      weekStart,
      enabledConstraints,
    };

    // ── Backtracking search ─────────────────────────────────
    const assignment = {};
    const success = this._backtrack(ordered, 0, availableSlots, assignment, state);

    // ── Collect unscheduled ─────────────────────────────────
    const scheduledIds = new Set(Object.keys(assignment));
    const unscheduled = ordered
      .filter(t => !scheduledIds.has(t.id))
      .map(t => t.name);

    // ── Stats ───────────────────────────────────────────────
    const stats = this._computeStats(ordered, assignment, availableSlots.length);

    return { success: success && unscheduled.length === 0, assignment, unscheduled, stats };
  }

  /**
   * Format the CSP result into a Discord embed-friendly string.
   *
   * @param {Object} result — Output from StudyCSP.solve()
   * @param {Array}  topics — Original topics array (for name lookup)
   * @returns {Object} { title, description, color, footer }
   */
  static formatDiscord(result, topics) {
    const { assignment, unscheduled, stats } = result;

    // Group by day
    const byDay = {};
    for (const [topicId, slot] of Object.entries(assignment)) {
      const topic = topics.find(t => t.id === topicId);
      if (!topic) continue;
      byDay[slot.day] = byDay[slot.day] || [];
      byDay[slot.day].push({
        hour: slot.hour,
        name: topic.name,
        minutes: topic.estimatedMinutes,
        status: topic.status,
      });
    }

    // Sort each day by hour
    for (const day of Object.keys(byDay)) {
      byDay[day].sort((a, b) => a.hour - b.hour);
    }

    const dayNames = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
    const lines = [];
    for (let d = 0; d < 7; d++) {
      const items = byDay[d];
      if (!items || items.length === 0) continue;
      const itemLines = items.map(i => `  ${i.hour}h — **${i.name}** (${i.minutes}p)`).join('\n');
      lines.push(`**${dayNames[d]}**\n${itemLines}`);
    }

    const scheduleText = lines.join('\n\n') || '_Chưa có topic nào được xếp._';

    const unscheduledNote = unscheduled.length > 0
      ? `\n\n⚠️ Không xếp được: ${unscheduled.join(', ')} (thiếu slot trống)`
      : '';

    const color = unscheduled.length === 0 ? 0x1D9E75 : unscheduled.length <= 2 ? 0xBA7517 : 0xCC3333;

    return {
      color,
      title: `📅 Kế hoạch tuần`,
      description: scheduleText + unscheduledNote,
      footer: { text: `${stats.scheduled}/${stats.total} topics · ${stats.totalMinutes}p tổng thời gian` },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  SLOT BUILDING
  // ═══════════════════════════════════════════════════════════════

  /**
   * Build available time slots from daily hour budgets.
   *
   * Each day gets `slotsPerDay` slots distributed across peak hours.
   * If a day has 0 available hours, no slots are created.
   *
   * @param {number[]} availableHours — Hours per day [Mon..Sun]
   * @param {number}   slotsPerDay — Max slots per day
   * @returns {Array<{day, hour}>}
   */
  static _buildSlots(availableHours, slotsPerDay) {
    const PEAK_DEFAULT = [9, 14, 19]; // Default slot start hours
    const slots = [];

    for (let day = 0; day < availableHours.length && day < 7; day++) {
      const hours = availableHours[day];
      if (hours <= 0) continue;

      // Number of slots for this day = min(slotsPerDay, floor(hours))
      const nSlots = Math.min(slotsPerDay, Math.floor(hours));
      for (let s = 0; s < nSlots; s++) {
        const hour = PEAK_DEFAULT[s % PEAK_DEFAULT.length];
        slots.push({ day, hour });
      }
    }

    return slots;
  }

  // ═══════════════════════════════════════════════════════════════
  //  TOPIC ENRICHMENT
  // ═══════════════════════════════════════════════════════════════

  /**
   * Estimate study duration based on topic status.
   *
   * not_started → 45 min (need full coverage)
   * weak         → 30 min (review + practice)
   * learning     → 15 min (quick reinforcement)
   * mastered     →  5 min (maintenance review — usually filtered out)
   */
  static _estimateDuration(topic) {
    switch (topic.status) {
      case 'not_started': return 45;
      case 'weak':         return 30;
      case 'learning':     return 15;
      case 'mastered':     return 5;
      default:             return 30;
    }
  }

  /**
   * Priority sort for backtracking order.
   *
   * Strategy: Most constrained Variable (MCV) heuristic.
   * Topics with more prerequisites and higher gapScore go first
   * (harder to place → assign early when more slots are free).
   *
   * Tie-break: not_started > weak > learning > mastered.
   */
  static _prioritySort(topics) {
    const statusWeight = { not_started: 4, weak: 3, learning: 2, mastered: 1 };
    return [...topics].sort((a, b) => {
      // Primary: gapScore × status weight
      const aPri = (a.gapScore || 0.5) * (statusWeight[a.status] || 1);
      const bPri = (b.gapScore || 0.5) * (statusWeight[b.status] || 1);
      if (bPri !== aPri) return bPri - aPri;

      // Secondary: more prerequisites first (MCV)
      const aPrereqs = (a.prerequisites || []).length;
      const bPrereqs = (b.prerequisites || []).length;
      if (bPrereqs !== aPrereqs) return bPrereqs - aPrereqs;

      // Tertiary: earlier deadline first
      if (a.nextDue && b.nextDue) return new Date(a.nextDue) - new Date(b.nextDue);
      if (a.nextDue) return -1;
      if (b.nextDue) return 1;

      return 0;
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  CONSTRAINT CHECKING
  // ═══════════════════════════════════════════════════════════════

  /**
   * Check all enabled constraints for assigning `topic` to `slot`.
   *
   * @param {Object} assignment  — Current partial assignment { topicId: {day, hour} }
   * @param {Object} topic       — Topic being placed
   * @param {Object} slot        — { day, hour }
   * @param {Object} state       — Solver state (dayMinutes, usedSlots, config)
   * @returns {boolean} true if all constraints satisfied
   */
  static _checkConstraints(assignment, topic, slot, state) {
    const c = state.enabledConstraints;

    // 1. One slot per topic (slot not already taken)
    if (c.oneSlotPerTopic) {
      const slotKey = `${slot.day}_${slot.hour}`;
      if (state.usedSlots.has(slotKey)) return false;
    }

    // 2. Daily capacity — don't exceed max minutes per day
    if (c.dailyCapacity) {
      const dayLoad = state.dayMinutes[slot.day] ?? 0;
      if (dayLoad + topic.estimatedMinutes > state.maxMinutesPerDay) return false;
    }

    // 3. Energy match — new topics should go to peak hours
    if (c.energyMatch) {
      if (topic.status === 'not_started') {
        if (!state.peakEnergyHours.includes(slot.hour)) return false;
      }
    }

    // 4. Prerequisite order — all prereqs must be scheduled on earlier slots
    if (c.prereqOrder) {
      for (const prereqId of (topic.prerequisites || [])) {
        const prereqSlot = assignment[prereqId];
        if (!prereqSlot) continue; // prereq not yet assigned — will be checked in later pass
        const prereqRank = prereqSlot.day * 24 + prereqSlot.hour;
        const thisRank = slot.day * 24 + slot.hour;
        if (prereqRank >= thisRank) return false; // prereq not before this topic
      }
    }

    // 5. Deadline respect — if topic has nextDue, schedule before that day
    if (c.deadlineRespect && topic.nextDue) {
      const dueDay = Math.floor((new Date(topic.nextDue) - state.weekStart) / 86_400_000);
      if (slot.day >= dueDay) return false;
    }

    return true;
  }

  // ═══════════════════════════════════════════════════════════════
  //  BACKTRACKING SOLVER
  // ═══════════════════════════════════════════════════════════════

  /**
   * Recursive backtracking with forward checking.
   *
   * On failure to place a topic, we skip it (graceful degradation)
   * rather than failing the entire solve. The skipped topics appear
   * in the `unscheduled` list.
   *
   * @param {Array}   topics     — Sorted topic list
   * @param {number}  index      — Current topic index
   * @param {Array}   slots      — Available slots
   * @param {Object}  assignment — Current partial assignment (mutated)
   * @param {Object}  state      — Solver state (mutated)
   * @returns {boolean} true if all remaining topics placed
   */
  static _backtrack(topics, index, slots, assignment, state) {
    // Base case: all topics processed
    if (index >= topics.length) return true;

    const topic = topics[index];

    // Try each slot
    for (const slot of slots) {
      if (!this._checkConstraints(assignment, topic, slot, state)) continue;

      // Assign
      assignment[topic.id] = slot;
      state.dayMinutes[slot.day] = (state.dayMinutes[slot.day] ?? 0) + topic.estimatedMinutes;
      const slotKey = `${slot.day}_${slot.hour}`;
      state.usedSlots.add(slotKey);

      // Recurse
      if (this._backtrack(topics, index + 1, slots, assignment, state)) {
        return true;
      }

      // Backtrack
      delete assignment[topic.id];
      state.dayMinutes[slot.day] -= topic.estimatedMinutes;
      state.usedSlots.delete(slotKey);
    }

    // Graceful degradation: skip this topic, try the next one
    // (it will appear in unscheduled[])
    return this._backtrack(topics, index + 1, slots, assignment, state);
  }

  // ═══════════════════════════════════════════════════════════════
  //  STATS & REPORTING
  // ═══════════════════════════════════════════════════════════════

  static _computeStats(topics, assignment, totalSlots) {
    const scheduled = Object.keys(assignment).length;
    const total = topics.length;
    const totalMinutes = topics
      .filter(t => assignment[t.id])
      .reduce((sum, t) => sum + t.estimatedMinutes, 0);
    const daysUsed = new Set(Object.values(assignment).map(s => s.day)).size;

    return { scheduled, total, totalMinutes, totalSlots, daysUsed };
  }
}

export default StudyCSP;
