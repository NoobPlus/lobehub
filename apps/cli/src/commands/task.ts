import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { getAuthInfo } from '../api/http';
import { streamAgentEvents } from '../utils/agentStream';
import { confirm, outputJson, printTable, timeAgo, truncate } from '../utils/format';
import { log } from '../utils/logger';

export function registerTaskCommand(program: Command) {
  const task = program.command('task').description('Manage agent tasks');

  // ── list ──────────────────────────────────────────────

  task
    .command('list')
    .description('List tasks')
    .option(
      '--status <status>',
      'Filter by status (pending/running/paused/completed/failed/canceled)',
    )
    .option('--root', 'Only show root tasks (no parent)')
    .option('--parent <id>', 'Filter by parent task ID')
    .option('--agent <id>', 'Filter by assignee agent ID')
    .option('-L, --limit <n>', 'Page size', '50')
    .option('--offset <n>', 'Offset', '0')
    .option('--tree', 'Display as tree structure')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (options: {
        agent?: string;
        json?: string | boolean;
        limit?: string;
        offset?: string;
        parent?: string;
        root?: boolean;
        status?: string;
        tree?: boolean;
      }) => {
        const client = await getTrpcClient();

        const input: Record<string, any> = {};
        if (options.status) input.status = options.status;
        if (options.root) input.parentTaskId = null;
        if (options.parent) input.parentTaskId = options.parent;
        if (options.agent) input.assigneeAgentId = options.agent;
        if (options.limit) input.limit = Number.parseInt(options.limit, 10);
        if (options.offset) input.offset = Number.parseInt(options.offset, 10);

        // For tree mode, fetch all tasks (no pagination limit)
        if (options.tree) {
          input.limit = 100;
          delete input.offset;
        }

        const result = await client.task.list.query(input as any);

        if (options.json !== undefined) {
          outputJson(result.data, options.json);
          return;
        }

        if (!result.data || result.data.length === 0) {
          log.info('No tasks found.');
          return;
        }

        if (options.tree) {
          // Build tree display
          const taskMap = new Map<string, any>();
          for (const t of result.data) taskMap.set(t.id, t);

          const roots = result.data.filter((t: any) => !t.parentTaskId);
          const children = new Map<string, any[]>();
          for (const t of result.data) {
            if (t.parentTaskId) {
              const list = children.get(t.parentTaskId) || [];
              list.push(t);
              children.set(t.parentTaskId, list);
            }
          }

          // Sort children by sortOrder first, then seq
          for (const [, list] of children) {
            list.sort(
              (a: any, b: any) =>
                (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.seq ?? 0) - (b.seq ?? 0),
            );
          }

          const printNode = (t: any, prefix: string, isLast: boolean, isRoot: boolean) => {
            const connector = isRoot ? '' : isLast ? '└── ' : '├── ';
            const name = truncate(t.name || t.instruction, 40);
            console.log(
              `${prefix}${connector}${pc.dim(t.identifier)} ${statusBadge(t.status)} ${name}`,
            );
            const childList = children.get(t.id) || [];
            const newPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');
            childList.forEach((child: any, i: number) => {
              printNode(child, newPrefix, i === childList.length - 1, false);
            });
          };

          for (const root of roots) {
            printNode(root, '', true, true);
          }
          log.info(`Total: ${result.total}`);
          return;
        }

        const rows = result.data.map((t: any) => [
          pc.dim(t.identifier),
          truncate(t.name || t.instruction, 40),
          statusBadge(t.status),
          priorityLabel(t.priority),
          t.assigneeAgentId ? pc.dim(t.assigneeAgentId) : '-',
          t.parentTaskId ? pc.dim('↳ subtask') : '',
          timeAgo(t.createdAt),
        ]);

        printTable(rows, ['ID', 'NAME', 'STATUS', 'PRI', 'AGENT', 'TYPE', 'CREATED']);
        log.info(`Total: ${result.total}`);
      },
    );

  // ── view ──────────────────────────────────────────────

  task
    .command('view <id>')
    .description('View task details (by ID or identifier like TASK-1)')
    .option('--json [fields]', 'Output JSON')
    .action(async (id: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();

      const result = await client.task.detail.query({ id });

      if (options.json !== undefined) {
        outputJson(result.data, options.json);
        return;
      }

      const t = result.data;

      // ── Header ──
      console.log(`\n${pc.bold(t.identifier)} ${t.name || ''}`);
      console.log(
        `${pc.dim('Status:')} ${statusBadge(t.status)}  ${pc.dim('Priority:')} ${priorityLabel(t.priority)}`,
      );
      console.log(`${pc.dim('Instruction:')} ${t.instruction}`);
      if (t.description) console.log(`${pc.dim('Description:')} ${t.description}`);
      if (t.assigneeAgentId) console.log(`${pc.dim('Agent:')} ${t.assigneeAgentId}`);
      if (t.assigneeUserId) console.log(`${pc.dim('User:')} ${t.assigneeUserId}`);
      if (t.parentTaskId) console.log(`${pc.dim('Parent:')} ${t.parentTaskId}`);
      console.log(
        `${pc.dim('Topics:')} ${t.totalTopics}  ${pc.dim('Created:')} ${timeAgo(t.createdAt)}`,
      );
      if (t.heartbeatTimeout && t.lastHeartbeatAt) {
        const hb = timeAgo(t.lastHeartbeatAt);
        const interval = t.heartbeatInterval ? `${t.heartbeatInterval}s` : '-';
        const elapsed = (Date.now() - new Date(t.lastHeartbeatAt).getTime()) / 1000;
        const isStuck = t.status === 'running' && elapsed > t.heartbeatTimeout;
        console.log(
          `${pc.dim('Heartbeat:')} ${isStuck ? pc.red(hb) : hb}  ${pc.dim('interval:')} ${interval}  ${pc.dim('timeout:')} ${t.heartbeatTimeout}s${isStuck ? pc.red('  ⚠ TIMEOUT') : ''}`,
        );
      }
      if (t.error) console.log(`${pc.red('Error:')} ${t.error}`);

      // ── Subtasks ──
      if (t.subtasks && t.subtasks.length > 0) {
        // Build dependency lookup: taskId → [dependsOnIdentifier, ...]
        const subtaskDeps = (t.subtaskDeps || []) as any[];
        const idToIdentifier = new Map<string, string>();
        for (const s of t.subtasks) idToIdentifier.set(s.id, s.identifier);

        const blockedBy = new Map<string, string[]>();
        for (const d of subtaskDeps) {
          if (d.type === 'blocks') {
            const list = blockedBy.get(d.taskId) || [];
            const depIdentifier = idToIdentifier.get(d.dependsOnId) || d.dependsOnId;
            list.push(depIdentifier);
            blockedBy.set(d.taskId, list);
          }
        }

        console.log(`\n${pc.bold('Subtasks:')}`);
        for (const s of t.subtasks) {
          const deps = blockedBy.get(s.id);
          const depInfo = deps ? pc.dim(` ← blocks: ${deps.join(', ')}`) : '';
          console.log(
            `  ${pc.dim(s.identifier)} ${statusBadge(s.status)} ${s.name || s.instruction}${depInfo}`,
          );
        }
      }

      // ── Dependencies ──
      if (t.dependencies && t.dependencies.length > 0) {
        console.log(`\n${pc.bold('Dependencies:')}`);
        for (const d of t.dependencies as any[]) {
          console.log(`  ${pc.dim(d.type)}: ${d.dependsOnId}`);
        }
      }

      // ── Checkpoint ──
      {
        const cp = t.checkpoint as any;
        console.log(`\n${pc.bold('Checkpoint:')}`);
        const hasConfig =
          cp.onAgentRequest !== undefined ||
          cp.topic?.before ||
          cp.topic?.after ||
          cp.tasks?.beforeIds?.length > 0 ||
          cp.tasks?.afterIds?.length > 0;

        if (hasConfig) {
          if (cp.onAgentRequest !== undefined)
            console.log(`  onAgentRequest: ${cp.onAgentRequest}`);
          if (cp.topic?.before) console.log(`  topic.before: ${cp.topic.before}`);
          if (cp.topic?.after) console.log(`  topic.after: ${cp.topic.after}`);
          if (cp.tasks?.beforeIds?.length > 0)
            console.log(`  tasks.before: ${cp.tasks.beforeIds.join(', ')}`);
          if (cp.tasks?.afterIds?.length > 0)
            console.log(`  tasks.after: ${cp.tasks.afterIds.join(', ')}`);
        } else {
          console.log(`  ${pc.dim('(not configured, default: onAgentRequest=true)')}`);
        }
      }

      // ── Review ──
      {
        const rv = t.review as any;
        console.log(`\n${pc.bold('Review:')}`);
        if (rv && rv.enabled) {
          console.log(
            `  judge: ${rv.judge?.model || 'default'}${rv.judge?.provider ? ` (${rv.judge.provider})` : ''}`,
          );
          console.log(`  maxIterations: ${rv.maxIterations}  autoRetry: ${rv.autoRetry}`);
          if (rv.rubrics?.length > 0) {
            for (let i = 0; i < rv.rubrics.length; i++) {
              const rb = rv.rubrics[i];
              const threshold = rb.threshold ? ` ≥ ${Math.round(rb.threshold * 100)}%` : '';
              const typeTag = pc.dim(`[${rb.type}]`);
              let configInfo = '';
              if (rb.type === 'llm-rubric') configInfo = rb.config?.criteria || '';
              else if (rb.type === 'contains' || rb.type === 'equals')
                configInfo = `value="${rb.config?.value}"`;
              else if (rb.type === 'regex') configInfo = `pattern="${rb.config?.pattern}"`;
              console.log(`  ${i + 1}. ${rb.name} ${typeTag}${threshold} ${pc.dim(configInfo)}`);
            }
          }
        } else {
          console.log(`  ${pc.dim('(not configured)')}`);
        }
      }

      // ── Activities (last section) ──
      {
        const activities: {
          data: any;
          time: number;
          type: 'topic' | 'brief' | 'comment' | 'review';
        }[] = [];

        for (const tp of t.topics || []) {
          activities.push({
            data: tp,
            time: new Date(tp.createdAt).getTime(),
            type: 'topic',
          });
          // Add review as separate activity if topic has been reviewed
          if (tp.reviewedAt) {
            activities.push({
              data: tp,
              time: new Date(tp.reviewedAt).getTime(),
              type: 'review',
            });
          }
        }

        for (const b of t.briefs || []) {
          activities.push({
            data: b,
            time: new Date(b.createdAt).getTime(),
            type: 'brief',
          });
        }

        for (const c of t.comments || []) {
          activities.push({
            data: c,
            time: new Date(c.createdAt).getTime(),
            type: 'comment',
          });
        }

        if (activities.length > 0) {
          activities.sort((a, b) => a.time - b.time);

          const pad = (s: string, w: number) => s.padStart(w);

          console.log(`\n${pc.bold('Activities:')}`);
          for (const act of activities) {
            const ago = pad(
              timeAgo(act.type === 'review' ? act.data.reviewedAt : act.data.createdAt),
              7,
            );

            if (act.type === 'topic') {
              const tp = act.data;
              const sBadge = statusBadge(tp.status || 'running');
              console.log(
                `  💬 ${pc.dim(ago)} Topic #${tp.seq} ${tp.title || 'Untitled'} ${sBadge}  ${pc.dim(tp.id)}`,
              );
            } else if (act.type === 'review') {
              const tp = act.data;
              const passed = tp.reviewPassed === 1;
              const icon = passed ? pc.green('✓') : pc.red('✗');
              const scoreText = ((tp.reviewScores as any[]) || [])
                .map((s: any) => {
                  const pct = Math.round(s.score * 100);
                  const sIcon = s.passed ? pc.green('✓') : pc.red('✗');
                  return `${s.rubricId} ${pct}%${sIcon}`;
                })
                .join(' | ');
              const iter =
                tp.reviewIteration > 1 ? pc.dim(` (iteration ${tp.reviewIteration})`) : '';
              console.log(
                `  🔍 ${pc.dim(ago)} Review ${icon} ${passed ? 'passed' : 'failed'} (${tp.reviewScore}%) ${pc.dim(scoreText)}${iter}`,
              );
            } else if (act.type === 'comment') {
              const c = act.data;
              const author = c.agentId ? `🤖 ${c.agentId}` : '👤 user';
              console.log(`  💭 ${pc.dim(ago)} ${pc.cyan(author)} ${c.content}`);
            } else {
              const b = act.data;
              const icon = briefIcon(b.type);
              const pri =
                b.priority === 'urgent'
                  ? pc.red(' [urgent]')
                  : b.priority === 'normal'
                    ? pc.yellow(' [normal]')
                    : '';
              let statusTag: string;
              if (b.resolvedAt) {
                const actions = (b.actions as any[]) || [];
                const matched = actions.find((a: any) => a.key === b.resolvedAction);
                statusTag = pc.green(` ${matched?.label || '✓'}`);
              } else if (b.readAt) {
                statusTag = pc.dim(' (read)');
              } else {
                statusTag = pc.yellow(' ●');
              }
              const typeLabel = pc.dim(`[${b.type}]`);
              console.log(
                `  ${icon} ${pc.dim(ago)} Brief ${typeLabel} ${b.title}${pri}${statusTag}  ${pc.dim(b.id)}`,
              );
            }
          }
        }
      }

      console.log();
    });

  // ── create ──────────────────────────────────────────────

  task
    .command('create')
    .description('Create a new task')
    .requiredOption('-i, --instruction <text>', 'Task instruction')
    .option('-n, --name <name>', 'Task name')
    .option('--agent <id>', 'Assign to agent')
    .option('--parent <id>', 'Parent task ID')
    .option('--priority <n>', 'Priority (0=none, 1=urgent, 2=high, 3=normal, 4=low)', '0')
    .option('--prefix <prefix>', 'Identifier prefix', 'TASK')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (options: {
        agent?: string;
        instruction: string;
        json?: string | boolean;
        name?: string;
        parent?: string;
        prefix?: string;
        priority?: string;
      }) => {
        const client = await getTrpcClient();

        const input: Record<string, any> = {
          instruction: options.instruction,
        };
        if (options.name) input.name = options.name;
        if (options.agent) input.assigneeAgentId = options.agent;
        if (options.parent) input.parentTaskId = options.parent;
        if (options.priority) input.priority = Number.parseInt(options.priority, 10);
        if (options.prefix) input.identifierPrefix = options.prefix;

        const result = await client.task.create.mutate(input as any);

        if (options.json !== undefined) {
          outputJson(result.data, options.json);
          return;
        }

        log.info(`Task created: ${pc.bold(result.data.identifier)} ${result.data.name || ''}`);
      },
    );

  // ── edit ──────────────────────────────────────────────

  task
    .command('edit <id>')
    .description('Update a task')
    .option('-n, --name <name>', 'Task name')
    .option('-i, --instruction <text>', 'Task instruction')
    .option('--agent <id>', 'Assign to agent')
    .option('--priority <n>', 'Priority (0-4)')
    .option('--heartbeat-interval <n>', 'Heartbeat interval in seconds')
    .option('--heartbeat-timeout <n>', 'Heartbeat timeout in seconds (0 to disable)')
    .option('--description <text>', 'Task description')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (
        id: string,
        options: {
          agent?: string;
          description?: string;
          heartbeatInterval?: string;
          heartbeatTimeout?: string;
          instruction?: string;
          json?: string | boolean;
          name?: string;
          priority?: string;
        },
      ) => {
        const client = await getTrpcClient();

        const input: Record<string, any> = { id };
        if (options.name) input.name = options.name;
        if (options.instruction) input.instruction = options.instruction;
        if (options.description) input.description = options.description;
        if (options.agent) input.assigneeAgentId = options.agent;
        if (options.priority) input.priority = Number.parseInt(options.priority, 10);
        if (options.heartbeatInterval)
          input.heartbeatInterval = Number.parseInt(options.heartbeatInterval, 10);
        if (options.heartbeatTimeout !== undefined) {
          const val = Number.parseInt(options.heartbeatTimeout, 10);
          input.heartbeatTimeout = val === 0 ? null : val;
        }

        const result = await client.task.update.mutate(input as any);

        if (options.json !== undefined) {
          outputJson(result.data, typeof options.json === 'string' ? options.json : undefined);
          return;
        }

        log.info(`Task updated: ${pc.bold(result.data.identifier)}`);
      },
    );

  // ── delete ──────────────────────────────────────────────

  task
    .command('delete <id>')
    .description('Delete a task')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (id: string, options: { yes?: boolean }) => {
      if (!options.yes) {
        const ok = await confirm(`Delete task ${pc.bold(id)}?`);
        if (!ok) return;
      }

      const client = await getTrpcClient();
      await client.task.delete.mutate({ id });
      log.info(`Task ${pc.bold(id)} deleted.`);
    });

  // ── clear ──────────────────────────────────────────────

  task
    .command('clear')
    .description('Delete all tasks')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (options: { yes?: boolean }) => {
      if (!options.yes) {
        const ok = await confirm(`Delete ${pc.red('ALL')} tasks? This cannot be undone.`);
        if (!ok) return;
      }

      const client = await getTrpcClient();
      const result = (await client.task.clearAll.mutate()) as any;
      log.info(`${result.count} task(s) deleted.`);
    });

  // ── start ──────────────────────────────────────────────

  task
    .command('start <id>')
    .description('Start a task (pending → running)')
    .option('--no-run', 'Only update status, do not trigger agent execution')
    .option('-p, --prompt <text>', 'Additional context for the agent')
    .option('-f, --follow', 'Follow agent output in real-time (default: run in background)')
    .option('--json', 'Output full JSON event stream')
    .option('-v, --verbose', 'Show detailed tool call info')
    .action(
      async (
        id: string,
        options: {
          follow?: boolean;
          json?: boolean;
          prompt?: string;
          run?: boolean;
          verbose?: boolean;
        },
      ) => {
        const client = await getTrpcClient();

        // Check if already running
        const taskDetail = await client.task.find.query({ id });
        if (taskDetail.data.status === 'running') {
          log.info(`Task ${pc.bold(taskDetail.data.identifier)} is already running.`);
          return;
        }

        const statusResult = await client.task.updateStatus.mutate({ id, status: 'running' });
        log.info(`Task ${pc.bold(statusResult.data.identifier)} started.`);

        // Auto-run unless --no-run
        if (options.run === false) return;

        // Default agent to inbox if not assigned
        if (!taskDetail.data.assigneeAgentId) {
          await client.task.update.mutate({ assigneeAgentId: 'inbox', id });
          log.info(`Assigned default agent: ${pc.dim('inbox')}`);
        }

        const result = (await client.task.run.mutate({
          id,
          ...(options.prompt && { prompt: options.prompt }),
        })) as any;

        if (!result.success) {
          log.error(`Failed to run task: ${result.error || result.message || 'Unknown error'}`);
          process.exit(1);
        }

        log.info(
          `Operation: ${pc.dim(result.operationId)} · Topic: ${pc.dim(result.topicId || 'n/a')}`,
        );

        if (!options.follow) {
          log.info(
            `Agent running in background. Use ${pc.dim(`lh task view ${id}`)} to check status.`,
          );
          return;
        }

        const { serverUrl, headers } = await getAuthInfo();
        const streamUrl = `${serverUrl}/api/agent/stream?operationId=${encodeURIComponent(result.operationId)}`;

        await streamAgentEvents(streamUrl, headers, {
          json: options.json,
          verbose: options.verbose,
        });

        // Send heartbeat after completion
        try {
          await client.task.heartbeat.mutate({ id });
        } catch {
          // ignore heartbeat errors
        }
      },
    );

  // ── run ──────────────────────────────────────────────

  task
    .command('run <id>')
    .description('Run a task — trigger agent execution')
    .option('-p, --prompt <text>', 'Additional context for the agent')
    .option('-c, --continue <topicId>', 'Continue running on an existing topic')
    .option('-f, --follow', 'Follow agent output in real-time (default: run in background)')
    .option('--topics <n>', 'Run N topics in sequence (default: 1, implies --follow)', '1')
    .option('--delay <s>', 'Delay between topics in seconds', '0')
    .option('--json', 'Output full JSON event stream')
    .option('-v, --verbose', 'Show detailed tool call info')
    .action(
      async (
        id: string,
        options: {
          continue?: string;
          delay?: string;
          follow?: boolean;
          json?: boolean;
          prompt?: string;
          topics?: string;
          verbose?: boolean;
        },
      ) => {
        const topicCount = Number.parseInt(options.topics || '1', 10);
        const delaySec = Number.parseInt(options.delay || '0', 10);

        // --topics > 1 implies --follow
        const shouldFollow = options.follow || topicCount > 1;

        for (let i = 0; i < topicCount; i++) {
          if (i > 0) {
            log.info(`\n${'─'.repeat(60)}`);
            log.info(`Topic ${i + 1}/${topicCount}`);
            if (delaySec > 0) {
              log.info(`Waiting ${delaySec}s before next topic...`);
              await new Promise((r) => setTimeout(r, delaySec * 1000));
            }
          }

          const client = await getTrpcClient();

          // Auto-assign inbox agent on first topic if not assigned
          if (i === 0) {
            const taskDetail = await client.task.find.query({ id });
            if (!taskDetail.data.assigneeAgentId) {
              await client.task.update.mutate({ assigneeAgentId: 'inbox', id });
              log.info(`Assigned default agent: ${pc.dim('inbox')}`);
            }
          }

          // Only pass extra prompt and continue on first topic
          const result = (await client.task.run.mutate({
            id,
            ...(i === 0 && options.prompt && { prompt: options.prompt }),
            ...(i === 0 && options.continue && { continueTopicId: options.continue }),
          })) as any;

          if (!result.success) {
            log.error(`Failed to run task: ${result.error || result.message || 'Unknown error'}`);
            process.exit(1);
          }

          const operationId = result.operationId;
          if (i === 0) {
            log.info(`Task ${pc.bold(result.taskIdentifier)} running`);
          }
          log.info(`Operation: ${pc.dim(operationId)} · Topic: ${pc.dim(result.topicId || 'n/a')}`);

          if (!shouldFollow) {
            log.info(
              `Agent running in background. Use ${pc.dim(`lh task view ${id}`)} to check status.`,
            );
            return;
          }

          // Connect to SSE stream and wait for completion
          const { serverUrl, headers } = await getAuthInfo();
          const streamUrl = `${serverUrl}/api/agent/stream?operationId=${encodeURIComponent(operationId)}`;

          await streamAgentEvents(streamUrl, headers, {
            json: options.json,
            verbose: options.verbose,
          });

          // Update heartbeat after each topic
          try {
            await client.task.heartbeat.mutate({ id });
          } catch {
            // ignore heartbeat errors
          }
        }
      },
    );

  // ── comment ──────────────────────────────────────────────

  task
    .command('comment <id>')
    .description('Add a comment to a task')
    .requiredOption('-m, --message <text>', 'Comment content')
    .action(async (id: string, options: { message: string }) => {
      const client = await getTrpcClient();
      await client.task.addComment.mutate({ content: options.message, id });
      log.info('Comment added.');
    });

  // ── pause ──────────────────────────────────────────────

  task
    .command('pause <id>')
    .description('Pause a running task')
    .action(async (id: string) => {
      const client = await getTrpcClient();
      const result = await client.task.updateStatus.mutate({ id, status: 'paused' });
      log.info(`Task ${pc.bold(result.data.identifier)} paused.`);
    });

  // ── resume ──────────────────────────────────────────────

  task
    .command('resume <id>')
    .description('Resume a paused task')
    .action(async (id: string) => {
      const client = await getTrpcClient();
      const result = await client.task.updateStatus.mutate({ id, status: 'running' });
      log.info(`Task ${pc.bold(result.data.identifier)} resumed.`);
    });

  // ── complete ──────────────────────────────────────────────

  task
    .command('complete <id>')
    .description('Mark a task as completed')
    .action(async (id: string) => {
      const client = await getTrpcClient();
      const result = (await client.task.updateStatus.mutate({ id, status: 'completed' })) as any;
      log.info(`Task ${pc.bold(result.data.identifier)} completed.`);
      if (result.unlocked?.length > 0) {
        log.info(`Unlocked: ${result.unlocked.map((id: string) => pc.bold(id)).join(', ')}`);
      }
      if (result.paused?.length > 0) {
        log.info(
          `Paused (checkpoint): ${result.paused.map((id: string) => pc.yellow(id)).join(', ')}`,
        );
      }
      if (result.checkpointTriggered) {
        log.info(`${pc.yellow('Checkpoint triggered')} — parent task paused for review.`);
      }
      if (result.allSubtasksDone) {
        log.info(`All subtasks of parent task completed.`);
      }
    });

  // ── cancel ──────────────────────────────────────────────

  task
    .command('cancel <id>')
    .description('Cancel a task')
    .action(async (id: string) => {
      const client = await getTrpcClient();
      const result = await client.task.updateStatus.mutate({ id, status: 'canceled' });
      log.info(`Task ${pc.bold(result.data.identifier)} canceled.`);
    });

  // ── sort ──────────────────────────────────────────────

  task
    .command('sort <id> <identifiers...>')
    .description('Reorder subtasks (e.g. lh task sort TASK-1 TASK-2 TASK-4 TASK-3)')
    .action(async (id: string, identifiers: string[]) => {
      const client = await getTrpcClient();
      const result = (await client.task.reorderSubtasks.mutate({
        id,
        order: identifiers,
      })) as any;

      log.info('Subtasks reordered:');
      for (const item of result.data) {
        console.log(`  ${pc.dim(`#${item.sortOrder}`)} ${item.identifier}`);
      }
    });

  // ── tree ──────────────────────────────────────────────

  task
    .command('tree <id>')
    .description('Show task tree (subtasks + dependencies)')
    .option('--json [fields]', 'Output JSON')
    .action(async (id: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.task.getTaskTree.query({ id });

      if (options.json !== undefined) {
        outputJson(result.data, options.json);
        return;
      }

      if (!result.data || result.data.length === 0) {
        log.info('No tasks found.');
        return;
      }

      // Build tree display (raw SQL returns snake_case)
      const taskMap = new Map<string, any>();
      for (const t of result.data) taskMap.set(t.id, t);

      const printNode = (taskId: string, indent: number) => {
        const t = taskMap.get(taskId);
        if (!t) return;

        const prefix = indent === 0 ? '' : '  '.repeat(indent) + '├── ';
        const name = t.name || t.identifier || '';
        const status = t.status || 'pending';
        const identifier = t.identifier || t.id;
        console.log(`${prefix}${pc.dim(identifier)} ${statusBadge(status)} ${name}`);

        // Print children (handle both camelCase and snake_case)
        for (const child of result.data) {
          const childParent = child.parentTaskId || child.parent_task_id;
          if (childParent === taskId) {
            printNode(child.id, indent + 1);
          }
        }
      };

      // Find root - resolve identifier first
      const resolved = await client.task.find.query({ id });
      const rootId = resolved.data.id;
      const root = result.data.find((t: any) => t.id === rootId);
      if (root) printNode(root.id, 0);
      else log.info('Root task not found in tree.');
    });

  // ── heartbeat ──────────────────────────────────────────────

  task
    .command('heartbeat <id>')
    .description('Manually send heartbeat for a running task')
    .action(async (id: string) => {
      const client = await getTrpcClient();
      await client.task.heartbeat.mutate({ id });
      log.info(`Heartbeat sent for ${pc.bold(id)}.`);
    });

  // ── watchdog ──────────────────────────────────────────────

  task
    .command('watchdog')
    .description('Run watchdog check — detect and fail stuck tasks')
    .action(async () => {
      const client = await getTrpcClient();
      const result = (await client.task.watchdog.mutate()) as any;

      if (result.failed?.length > 0) {
        log.info(
          `${pc.red('Stuck tasks failed:')} ${result.failed.map((id: string) => pc.bold(id)).join(', ')}`,
        );
      } else {
        log.info('No stuck tasks found.');
      }
    });

  // ── checkpoint ──────────────────────────────────────────────

  const cp = task.command('checkpoint').description('Manage task checkpoints');

  cp.command('view <id>')
    .description('View checkpoint config for a task')
    .action(async (id: string) => {
      const client = await getTrpcClient();
      const result = await client.task.getCheckpoint.query({ id });
      const c = result.data as any;

      console.log(`\n${pc.bold('Checkpoint config:')}`);
      console.log(`  onAgentRequest: ${c.onAgentRequest ?? pc.dim('not set (default: true)')}`);
      if (c.topic) {
        console.log(`  topic.before: ${c.topic.before ?? false}`);
        console.log(`  topic.after: ${c.topic.after ?? false}`);
      }
      if (c.tasks?.beforeIds?.length > 0) {
        console.log(`  tasks.beforeIds: ${c.tasks.beforeIds.join(', ')}`);
      }
      if (c.tasks?.afterIds?.length > 0) {
        console.log(`  tasks.afterIds: ${c.tasks.afterIds.join(', ')}`);
      }
      if (
        !c.topic &&
        !c.tasks?.beforeIds?.length &&
        !c.tasks?.afterIds?.length &&
        c.onAgentRequest === undefined
      ) {
        console.log(`  ${pc.dim('(no checkpoints configured)')}`);
      }
      console.log();
    });

  cp.command('set <id>')
    .description('Configure checkpoints')
    .option('--on-agent-request <bool>', 'Allow agent to request review (true/false)')
    .option('--topic-before <bool>', 'Pause before each topic (true/false)')
    .option('--topic-after <bool>', 'Pause after each topic (true/false)')
    .option('--before <ids>', 'Pause before these subtask identifiers (comma-separated)')
    .option('--after <ids>', 'Pause after these subtask identifiers (comma-separated)')
    .action(
      async (
        id: string,
        options: {
          after?: string;
          before?: string;
          onAgentRequest?: string;
          topicAfter?: string;
          topicBefore?: string;
        },
      ) => {
        const client = await getTrpcClient();

        // Get current config first
        const current = (await client.task.getCheckpoint.query({ id })).data as any;
        const checkpoint: any = { ...current };

        if (options.onAgentRequest !== undefined) {
          checkpoint.onAgentRequest = options.onAgentRequest === 'true';
        }
        if (options.topicBefore !== undefined || options.topicAfter !== undefined) {
          checkpoint.topic = { ...checkpoint.topic };
          if (options.topicBefore !== undefined)
            checkpoint.topic.before = options.topicBefore === 'true';
          if (options.topicAfter !== undefined)
            checkpoint.topic.after = options.topicAfter === 'true';
        }
        if (options.before !== undefined) {
          checkpoint.tasks = { ...checkpoint.tasks };
          checkpoint.tasks.beforeIds = options.before
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean);
        }
        if (options.after !== undefined) {
          checkpoint.tasks = { ...checkpoint.tasks };
          checkpoint.tasks.afterIds = options.after
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean);
        }

        await client.task.updateCheckpoint.mutate({ checkpoint, id });
        log.info('Checkpoint updated.');
      },
    );

  // ── review ──────────────────────────────────────────────

  const rv = task.command('review').description('Manage task review (LLM-as-Judge)');

  rv.command('view <id>')
    .description('View review config for a task')
    .action(async (id: string) => {
      const client = await getTrpcClient();
      const result = await client.task.getReview.query({ id });
      const r = result.data as any;

      if (!r || !r.enabled) {
        log.info('Review not configured for this task.');
        return;
      }

      console.log(`\n${pc.bold('Review config:')}`);
      console.log(`  enabled: ${r.enabled}`);
      if (r.judge?.model)
        console.log(`  judge: ${r.judge.model}${r.judge.provider ? ` (${r.judge.provider})` : ''}`);
      console.log(`  maxIterations: ${r.maxIterations}`);
      console.log(`  autoRetry: ${r.autoRetry}`);
      if (r.rubrics?.length > 0) {
        console.log(`  rubrics:`);
        for (let i = 0; i < r.rubrics.length; i++) {
          const rb = r.rubrics[i];
          const threshold = rb.threshold ? ` ≥ ${Math.round(rb.threshold * 100)}%` : '';
          const typeTag = pc.dim(`[${rb.type}]`);
          let configInfo = '';
          if (rb.type === 'llm-rubric') configInfo = rb.config?.criteria || '';
          else if (rb.type === 'contains' || rb.type === 'equals')
            configInfo = `value="${rb.config?.value}"`;
          else if (rb.type === 'regex') configInfo = `pattern="${rb.config?.pattern}"`;
          console.log(`    ${i + 1}. ${rb.name} ${typeTag}${threshold} ${pc.dim(configInfo)}`);
        }
      } else {
        console.log(`  rubrics: ${pc.dim('(none)')}`);
      }
      console.log();
    });

  rv.command('set <id>')
    .description('Enable review and configure judge settings')
    .option('--model <model>', 'Judge model')
    .option('--provider <provider>', 'Judge provider')
    .option('--max-iterations <n>', 'Max review iterations', '3')
    .option('--no-auto-retry', 'Disable auto retry on failure')
    .option('--recursive', 'Apply to all subtasks as well')
    .action(
      async (
        id: string,
        options: {
          autoRetry?: boolean;
          maxIterations?: string;
          model?: string;
          provider?: string;
          recursive?: boolean;
        },
      ) => {
        const client = await getTrpcClient();

        // Read current review config to preserve rubrics
        const current = (await client.task.getReview.query({ id })).data as any;
        const existingRubrics = current?.rubrics || [];

        const review = {
          autoRetry: options.autoRetry !== false,
          enabled: true,
          judge: {
            ...(options.model && { model: options.model }),
            ...(options.provider && { provider: options.provider }),
          },
          maxIterations: Number.parseInt(options.maxIterations || '3', 10),
          rubrics: existingRubrics,
        };

        await client.task.updateReview.mutate({ id, review });

        if (options.recursive) {
          const subtasks = await client.task.getSubtasks.query({ id });
          for (const s of subtasks.data || []) {
            const subCurrent = (await client.task.getReview.query({ id: s.id })).data as any;
            await client.task.updateReview.mutate({
              id: s.id,
              review: { ...review, rubrics: subCurrent?.rubrics || existingRubrics },
            });
          }
          log.info(
            `Review enabled for ${pc.bold(id)} + ${(subtasks.data || []).length} subtask(s).`,
          );
        } else {
          log.info('Review enabled.');
        }
      },
    );

  // ── review criteria ──────────────────────────────────────

  const rc = rv.command('criteria').description('Manage review rubrics');

  rc.command('list <id>')
    .description('List review rubrics for a task')
    .action(async (id: string) => {
      const client = await getTrpcClient();
      const result = await client.task.getReview.query({ id });
      const r = result.data as any;
      const rubrics = r?.rubrics || [];

      if (rubrics.length === 0) {
        log.info('No rubrics configured.');
        return;
      }

      const rows = rubrics.map((r: any, i: number) => {
        const config = r.config || {};
        const configStr =
          r.type === 'llm-rubric'
            ? config.criteria || ''
            : r.type === 'contains' || r.type === 'equals'
              ? `value: "${config.value}"`
              : r.type === 'regex'
                ? `pattern: "${config.pattern}"`
                : JSON.stringify(config);

        return [
          String(i + 1),
          r.name,
          r.type,
          r.threshold ? `≥ ${Math.round(r.threshold * 100)}%` : '-',
          String(r.weight ?? 1),
          truncate(configStr, 40),
        ];
      });

      printTable(rows, ['#', 'NAME', 'TYPE', 'THRESHOLD', 'WEIGHT', 'CONFIG']);
    });

  rc.command('add <id>')
    .description('Add a review rubric')
    .requiredOption('-n, --name <name>', 'Rubric name (e.g. "内容准确性")')
    .option('--type <type>', 'Rubric type (default: llm-rubric)', 'llm-rubric')
    .option('-t, --threshold <n>', 'Pass threshold 0-100 (converted to 0-1)')
    .option('-d, --description <text>', 'Criteria description (for llm-rubric type)')
    .option('--value <value>', 'Expected value (for contains/equals type)')
    .option('--pattern <pattern>', 'Regex pattern (for regex type)')
    .option('-w, --weight <n>', 'Weight for scoring (default: 1)')
    .option('--recursive', 'Add to all subtasks as well')
    .action(
      async (
        id: string,
        options: {
          description?: string;
          name: string;
          pattern?: string;
          recursive?: boolean;
          threshold?: string;
          type: string;
          value?: string;
          weight?: string;
        },
      ) => {
        const client = await getTrpcClient();

        // Build rubric config based on type
        const buildConfig = (): Record<string, any> | null => {
          switch (options.type) {
            case 'llm-rubric': {
              return { criteria: options.description || options.name };
            }
            case 'contains':
            case 'equals':
            case 'starts-with':
            case 'ends-with': {
              if (!options.value) {
                log.error(`--value is required for type "${options.type}"`);
                return null;
              }
              return { value: options.value };
            }
            case 'regex': {
              if (!options.pattern) {
                log.error('--pattern is required for type "regex"');
                return null;
              }
              return { pattern: options.pattern };
            }
            default: {
              return { criteria: options.description || options.name };
            }
          }
        };

        const config = buildConfig();
        if (!config) return;

        const rubric: Record<string, any> = {
          config,
          id: `rubric-${Date.now()}`,
          name: options.name,
          type: options.type,
          weight: options.weight ? Number.parseFloat(options.weight) : 1,
        };
        if (options.threshold) {
          rubric.threshold = Number.parseInt(options.threshold, 10) / 100;
        }

        const addToTask = async (taskId: string) => {
          const current = (await client.task.getReview.query({ id: taskId })).data as any;
          const rubrics = current?.rubrics || [];

          // Replace if same name exists, otherwise append
          const filtered = rubrics.filter((r: any) => r.name !== options.name);
          filtered.push(rubric);

          await client.task.updateReview.mutate({
            id: taskId,
            review: {
              autoRetry: current?.autoRetry ?? true,
              enabled: current?.enabled ?? true,
              judge: current?.judge ?? {},
              maxIterations: current?.maxIterations ?? 3,
              rubrics: filtered,
            },
          });
        };

        await addToTask(id);

        if (options.recursive) {
          const subtasks = await client.task.getSubtasks.query({ id });
          for (const s of subtasks.data || []) {
            await addToTask(s.id);
          }
          log.info(
            `Rubric "${options.name}" [${options.type}] added to ${pc.bold(id)} + ${(subtasks.data || []).length} subtask(s).`,
          );
        } else {
          log.info(`Rubric "${options.name}" [${options.type}] added.`);
        }
      },
    );

  rc.command('rm <id>')
    .description('Remove a review rubric')
    .requiredOption('-n, --name <name>', 'Rubric name to remove')
    .option('--recursive', 'Remove from all subtasks as well')
    .action(async (id: string, options: { name: string; recursive?: boolean }) => {
      const client = await getTrpcClient();

      const removeFromTask = async (taskId: string) => {
        const current = (await client.task.getReview.query({ id: taskId })).data as any;
        if (!current) return;

        const rubrics = (current.rubrics || []).filter((r: any) => r.name !== options.name);

        await client.task.updateReview.mutate({
          id: taskId,
          review: { ...current, rubrics },
        });
      };

      await removeFromTask(id);

      if (options.recursive) {
        const subtasks = await client.task.getSubtasks.query({ id });
        for (const s of subtasks.data || []) {
          await removeFromTask(s.id);
        }
        log.info(
          `Rubric "${options.name}" removed from ${pc.bold(id)} + ${(subtasks.data || []).length} subtask(s).`,
        );
      } else {
        log.info(`Rubric "${options.name}" removed.`);
      }
    });

  rv.command('run <id>')
    .description('Manually run review on content')
    .requiredOption('--content <text>', 'Content to review')
    .action(async (id: string, options: { content: string }) => {
      const client = await getTrpcClient();
      const result = (await client.task.runReview.mutate({
        content: options.content,
        id,
      })) as any;
      const r = result.data;

      console.log(
        `\n${r.passed ? pc.green('✓ Review passed') : pc.red('✗ Review failed')} (${r.overallScore}%)`,
      );
      for (const s of r.rubricResults || []) {
        const icon = s.passed ? pc.green('✓') : pc.red('✗');
        const pct = Math.round(s.score * 100);
        console.log(`  ${icon} ${s.rubricId}: ${pct}%${s.reason ? ` — ${s.reason}` : ''}`);
      }
      console.log();
    });

  // ── dep ──────────────────────────────────────────────

  const dep = task.command('dep').description('Manage task dependencies');

  dep
    .command('add <taskId> <dependsOnId>')
    .description('Add dependency (taskId blocks on dependsOnId)')
    .option('--type <type>', 'Dependency type (blocks/relates)', 'blocks')
    .action(async (taskId: string, dependsOnId: string, options: { type?: string }) => {
      const client = await getTrpcClient();
      await client.task.addDependency.mutate({
        dependsOnId,
        taskId,
        type: (options.type || 'blocks') as any,
      });
      log.info(`Dependency added: ${taskId} ${options.type || 'blocks'} on ${dependsOnId}`);
    });

  dep
    .command('rm <taskId> <dependsOnId>')
    .description('Remove dependency')
    .action(async (taskId: string, dependsOnId: string) => {
      const client = await getTrpcClient();
      await client.task.removeDependency.mutate({ dependsOnId, taskId });
      log.info(`Dependency removed.`);
    });

  dep
    .command('list <taskId>')
    .description('List dependencies for a task')
    .option('--json [fields]', 'Output JSON')
    .action(async (taskId: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.task.getDependencies.query({ id: taskId });

      if (options.json !== undefined) {
        outputJson(result.data, options.json);
        return;
      }

      if (!result.data || result.data.length === 0) {
        log.info('No dependencies.');
        return;
      }

      const rows = result.data.map((d: any) => [d.type, d.dependsOnId, timeAgo(d.createdAt)]);
      printTable(rows, ['TYPE', 'DEPENDS ON', 'CREATED']);
    });

  // ── topic ──────────────────────────────────────────────

  const tp = task.command('topic').description('Manage task topics');

  tp.command('list <id>')
    .description('List topics for a task')
    .option('--json [fields]', 'Output JSON')
    .action(async (id: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.task.getTopics.query({ id });

      if (options.json !== undefined) {
        outputJson(result.data, options.json);
        return;
      }

      if (!result.data || result.data.length === 0) {
        log.info('No topics found for this task.');
        return;
      }

      const rows = result.data.map((t: any) => [
        `#${t.seq}`,
        t.id,
        statusBadge(t.status || 'running'),
        truncate(t.title || 'Untitled', 40),
        t.operationId ? pc.dim(truncate(t.operationId, 20)) : '-',
        timeAgo(t.createdAt),
      ]);

      printTable(rows, ['SEQ', 'TOPIC ID', 'STATUS', 'TITLE', 'OPERATION', 'CREATED']);
    });

  tp.command('view <id> <topicId>')
    .description('View messages of a topic (topicId can be a seq number like "1")')
    .option('--json [fields]', 'Output JSON')
    .action(async (id: string, topicId: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();

      let resolvedTopicId = topicId;

      // If it's a number, treat as seq index
      const seqNum = Number.parseInt(topicId, 10);
      if (!Number.isNaN(seqNum) && String(seqNum) === topicId) {
        const topicsResult = await client.task.getTopics.query({ id });
        const match = (topicsResult.data || []).find((t: any) => t.seq === seqNum);
        if (!match) {
          log.error(`Topic #${seqNum} not found for this task.`);
          return;
        }
        resolvedTopicId = match.id;
        log.info(
          `Topic #${seqNum}: ${pc.bold(match.title || 'Untitled')} ${pc.dim(resolvedTopicId)}`,
        );
      }

      const messages = await client.message.getMessages.query({ topicId: resolvedTopicId });
      const items = Array.isArray(messages) ? messages : [];

      if (options.json !== undefined) {
        outputJson(items, options.json);
        return;
      }

      if (items.length === 0) {
        log.info('No messages in this topic.');
        return;
      }

      console.log();
      for (const msg of items) {
        const role =
          msg.role === 'assistant'
            ? pc.green('Assistant')
            : msg.role === 'user'
              ? pc.blue('User')
              : pc.dim(msg.role);

        console.log(`${pc.bold(role)} ${pc.dim(timeAgo(msg.createdAt))}`);
        if (msg.content) {
          console.log(msg.content);
        }
        console.log();
      }
    });

  tp.command('cancel <id> <topicId>')
    .description('Cancel a running topic and pause the task')
    .action(async (id: string, topicId: string) => {
      const client = await getTrpcClient();
      await client.task.cancelTopic.mutate({ id, topicId });
      log.info(`Topic ${pc.bold(topicId)} canceled. Task paused.`);
    });

  tp.command('delete <id> <topicId>')
    .description('Delete a topic and its messages from the task')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (id: string, topicId: string, options: { yes?: boolean }) => {
      if (!options.yes) {
        const ok = await confirm(`Delete topic ${pc.bold(topicId)} and all its messages?`);
        if (!ok) return;
      }

      const client = await getTrpcClient();
      await client.task.deleteTopic.mutate({ id, topicId });
      log.info(`Topic ${pc.bold(topicId)} deleted.`);
    });
}

function statusBadge(status: string): string {
  switch (status) {
    case 'backlog': {
      return pc.dim('○ backlog');
    }
    case 'running': {
      return pc.blue('● running');
    }
    case 'paused': {
      return pc.yellow('◐ paused');
    }
    case 'completed': {
      return pc.green('✓ completed');
    }
    case 'failed': {
      return pc.red('✗ failed');
    }
    case 'timeout': {
      return pc.red('⏱ timeout');
    }
    case 'canceled': {
      return pc.dim('⊘ canceled');
    }
    default: {
      return status;
    }
  }
}

function briefIcon(type: string): string {
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
}

function priorityLabel(priority: number | null | undefined): string {
  switch (priority) {
    case 1: {
      return pc.red('urgent');
    }
    case 2: {
      return pc.yellow('high');
    }
    case 3: {
      return 'normal';
    }
    case 4: {
      return pc.dim('low');
    }
    default: {
      return pc.dim('-');
    }
  }
}
