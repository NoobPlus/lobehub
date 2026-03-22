// ── Formatting helpers for Task tool responses ──

const priorityLabel = (p?: number | null): string => {
  switch (p) {
    case 1: {
      return 'urgent';
    }
    case 2: {
      return 'high';
    }
    case 3: {
      return 'normal';
    }
    case 4: {
      return 'low';
    }
    default: {
      return '-';
    }
  }
};

const statusIcon = (s: string): string => {
  switch (s) {
    case 'backlog': {
      return '○';
    }
    case 'running': {
      return '●';
    }
    case 'paused': {
      return '◐';
    }
    case 'completed': {
      return '✓';
    }
    case 'failed': {
      return '✗';
    }
    case 'canceled': {
      return '⊘';
    }
    default: {
      return '?';
    }
  }
};

export interface TaskSummary {
  identifier: string;
  name?: string | null;
  priority?: number | null;
  status: string;
}

export interface TaskDetail extends TaskSummary {
  dependencies?: Array<{ dependsOn: string; type: string }>;
  instruction: string;
  parentTaskId?: string | null;
  subtasks?: TaskSummary[];
}

/**
 * Format a single task as a one-line summary
 */
export const formatTaskLine = (t: TaskSummary): string =>
  `${t.identifier} ${statusIcon(t.status)} ${t.status}  ${t.name || '(unnamed)'}  [${priorityLabel(t.priority)}]`;

/**
 * Format createTask response
 */
export const formatTaskCreated = (
  t: TaskSummary & { instruction: string; parentLabel?: string },
): string => {
  const lines = [
    `Task created: ${t.identifier} "${t.name}"`,
    `  Status: ${statusIcon(t.status)} ${t.status}`,
    `  Priority: ${priorityLabel(t.priority)}`,
  ];
  if (t.parentLabel) lines.push(`  Parent: ${t.parentLabel}`);
  lines.push(`  Instruction: ${t.instruction}`);
  return lines.join('\n');
};

/**
 * Format task list response
 */
export const formatTaskList = (
  tasks: TaskSummary[],
  parentLabel: string,
  filter?: string,
): string => {
  if (tasks.length === 0) {
    const filterNote = filter ? ` with status "${filter}"` : '';
    return `No subtasks found under ${parentLabel}${filterNote}.`;
  }

  return [
    `${tasks.length} task(s) under ${parentLabel}:`,
    ...tasks.map((t) => `  ${formatTaskLine(t)}`),
  ].join('\n');
};

/**
 * Format viewTask response
 */
export const formatTaskDetail = (t: TaskDetail): string => {
  const lines = [
    `${t.identifier} "${t.name || '(unnamed)'}"`,
    `  Status: ${statusIcon(t.status)} ${t.status}`,
    `  Priority: ${priorityLabel(t.priority)}`,
    `  Instruction: ${t.instruction}`,
  ];

  if (t.parentTaskId) lines.push(`  Parent: ${t.parentTaskId}`);

  if (t.subtasks && t.subtasks.length > 0) {
    lines.push(`  Subtasks (${t.subtasks.length}):`);
    for (const s of t.subtasks) {
      lines.push(`    ${formatTaskLine(s)}`);
    }
  }

  if (t.dependencies && t.dependencies.length > 0) {
    lines.push(`  Dependencies (${t.dependencies.length}):`);
    for (const d of t.dependencies) {
      lines.push(`    ${d.type}: ${d.dependsOn}`);
    }
  }

  return lines.join('\n');
};

/**
 * Format editTask response
 */
export const formatTaskEdited = (identifier: string, changes: string[]): string =>
  `Task ${identifier} updated:\n  ${changes.join('\n  ')}`;

/**
 * Format dependency change response
 */
export const formatDependencyAdded = (task: string, dependsOn: string): string =>
  `Dependency added: ${task} now blocks on ${dependsOn}.\n${task} will not start until ${dependsOn} is completed.`;

export const formatDependencyRemoved = (task: string, dependsOn: string): string =>
  `Dependency removed: ${task} no longer blocks on ${dependsOn}.`;

/**
 * Format brief created response
 */
export const formatBriefCreated = (args: {
  id: string;
  priority: string;
  summary: string;
  title: string;
  type: string;
}): string =>
  `Brief created (${args.type}, ${args.priority}):\n  "${args.title}"\n  ${args.summary}\n\nBrief ID: ${args.id}`;

/**
 * Format checkpoint response
 */
export const formatCheckpointCreated = (reason: string): string =>
  `Checkpoint created. Task is now paused and waiting for user review.\n\nReason: ${reason}\n\nThe user will see this as a "decision" brief and can resume the task after review.`;

// ── Task Run Prompt Builder ──

export interface TaskRunPromptComment {
  agentId?: string | null;
  content: string;
  createdAt?: string;
  id?: string;
}

export interface TaskRunPromptTopic {
  createdAt: string;
  handoff?: {
    keyFindings?: string[];
    nextAction?: string;
    summary?: string;
    title?: string;
  } | null;
  id?: string;
  seq?: number | null;
  status?: string | null;
  title?: string | null;
}

export interface TaskRunPromptBrief {
  createdAt: string;
  id?: string;
  priority?: string | null;
  resolvedAction?: string | null;
  resolvedAt?: string | null;
  resolvedComment?: string | null;
  summary: string;
  title: string;
  type: string;
}

export interface TaskRunPromptSubtask {
  createdAt?: string;
  id?: string;
  identifier: string;
  name?: string | null;
  status: string;
}

export interface TaskRunPromptInput {
  /** Activity data (all optional) */
  activities?: {
    briefs?: TaskRunPromptBrief[];
    comments?: TaskRunPromptComment[];
    subtasks?: TaskRunPromptSubtask[];
    topics?: TaskRunPromptTopic[];
  };
  /** --prompt flag content */
  extraPrompt?: string;
  /** Task data */
  task: {
    description?: string | null;
    identifier: string;
    instruction: string;
    name?: string | null;
  };
}

// ── Relative time helper ──

const timeAgo = (dateStr: string, now?: Date): string => {
  const date = new Date(dateStr);
  const ref = now || new Date();
  const diffMs = ref.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
};

// ── Brief icon ──

const briefIcon = (type: string): string => {
  switch (type) {
    case 'decision': {
      return '📋';
    }
    case 'result': {
      return '✅';
    }
    case 'insight': {
      return '💡';
    }
    case 'error': {
      return '❌';
    }
    default: {
      return '📌';
    }
  }
};

/**
 * Build the prompt for task.run — injected as user message to the Agent.
 *
 * Priority order:
 * 1. High Priority Instruction (--prompt) — the most important directive for this run
 * 2. User Feedback (user comments only, full content) — what the user wants
 * 3. Activities (topics + briefs + comments + subtasks, chronological) — full timeline
 * 4. Original Task (instruction + description) — the base requirement
 */
export const buildTaskRunPrompt = (input: TaskRunPromptInput, now?: Date): string => {
  const { task, activities, extraPrompt } = input;
  const sections: string[] = [];

  // ── 1. High Priority Instruction ──
  if (extraPrompt) {
    sections.push(`<high_priority_instruction>\n${extraPrompt}\n</high_priority_instruction>`);
  }

  // ── 2. User Feedback (user comments only, full content) ──
  const userComments = activities?.comments?.filter((c) => !c.agentId);
  if (userComments && userComments.length > 0) {
    const lines = userComments.map((c) => {
      const ago = c.createdAt ? timeAgo(c.createdAt, now) : '';
      const timeAttr = ago ? ` time="${ago}"` : '';
      const idAttr = c.id ? ` id="${c.id}"` : '';
      return `<comment${idAttr}${timeAttr}>${c.content}</comment>`;
    });
    sections.push(`<user_feedback>\n${lines.join('\n')}\n</user_feedback>`);
  }

  // ── 3. Activities (topics + briefs + comments + subtasks, chronological) ──
  const timelineEntries: { text: string; time: number }[] = [];

  if (activities?.comments) {
    for (const c of activities.comments) {
      const author = c.agentId ? 'agent' : 'user';
      const ago = c.createdAt ? timeAgo(c.createdAt, now) : '';
      const timeAttr = ago ? ` time="${ago}"` : '';
      const idAttr = c.id ? ` id="${c.id}"` : '';
      const truncated = c.content.length > 50 ? c.content.slice(0, 50) + '...' : c.content;
      timelineEntries.push({
        text: `<comment${idAttr} role="${author}"${timeAttr}>${truncated}</comment>`,
        time: c.createdAt ? new Date(c.createdAt).getTime() : 0,
      });
    }
  }

  if (activities?.subtasks) {
    for (const s of activities.subtasks) {
      const idAttr = s.id ? ` id="${s.id}"` : '';
      timelineEntries.push({
        text: `<subtask${idAttr} identifier="${s.identifier}" status="${s.status}">${s.name || s.identifier}</subtask>`,
        time: s.createdAt ? new Date(s.createdAt).getTime() : 0,
      });
    }
  }

  if (activities?.topics) {
    for (const t of activities.topics) {
      const ago = timeAgo(t.createdAt, now);
      const status = t.status || 'completed';
      const idAttr = t.id ? ` id="${t.id}"` : '';
      const h = t.handoff;
      const lines = [
        `<topic${idAttr} seq="${t.seq || '?'}" status="${status}" time="${ago}">`,
        `  ${t.title || h?.title || 'Untitled'}`,
      ];
      if (h?.summary) lines.push(`  ${h.summary}`);
      if (h?.nextAction) lines.push(`  Next: ${h.nextAction}`);
      if (h?.keyFindings && h.keyFindings.length > 0) {
        lines.push(`  Key findings: ${h.keyFindings.join('; ')}`);
      }
      lines.push('</topic>');
      timelineEntries.push({
        text: lines.join('\n'),
        time: new Date(t.createdAt).getTime(),
      });
    }
  }

  if (activities?.briefs) {
    for (const b of activities.briefs) {
      const ago = timeAgo(b.createdAt, now);
      const idAttr = b.id ? ` id="${b.id}"` : '';
      const priAttr = b.priority ? ` priority="${b.priority}"` : '';
      let resolvedAttr = '';
      if (b.resolvedAt) {
        resolvedAttr = b.resolvedAction
          ? ` resolved="${b.resolvedAction}${b.resolvedComment ? `: ${b.resolvedComment}` : ''}"`
          : ' resolved="true"';
      }
      const lines = [
        `<brief${idAttr} type="${b.type}"${priAttr}${resolvedAttr} time="${ago}">`,
        `  ${b.title}`,
        `  ${b.summary}`,
        '</brief>',
      ];
      timelineEntries.push({
        text: lines.join('\n'),
        time: new Date(b.createdAt).getTime(),
      });
    }
  }

  if (timelineEntries.length > 0) {
    timelineEntries.sort((a, b) => b.time - a.time);
    sections.push(`<activities>\n${timelineEntries.map((e) => e.text).join('\n')}\n</activities>`);
  }

  // ── 4. Original Task ──
  const descAttr = task.description ? ` description="${task.description}"` : '';
  sections.push(
    `<task name="${task.name || task.identifier}" identifier="${task.identifier}"${descAttr}>\n${task.instruction}\n</task>`,
  );

  return sections.join('\n\n');
};

export { priorityLabel, statusIcon };
