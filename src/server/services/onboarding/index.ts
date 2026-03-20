import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { CURRENT_ONBOARDING_VERSION } from '@lobechat/const';
import type {
  UserAgentOnboarding,
  UserAgentOnboardingDraft,
  UserAgentOnboardingNode,
} from '@lobechat/types';
import { AGENT_ONBOARDING_NODES, MAX_ONBOARDING_STEPS } from '@lobechat/types';
import { merge } from '@lobechat/utils';

import { ONBOARDING_PRODUCTION_DEFAULT_MODEL } from '@/const/onboarding';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { AgentService } from '@/server/services/agent';
import { isDev } from '@/utils/env';

const defaultAgentOnboardingState = (): UserAgentOnboarding => ({
  completedNodes: [],
  currentNode: AGENT_ONBOARDING_NODES[0],
  draft: {},
  version: CURRENT_ONBOARDING_VERSION,
});

const getNextNode = (node?: UserAgentOnboardingNode) => {
  if (!node) return undefined;

  const currentIndex = AGENT_ONBOARDING_NODES.indexOf(node);
  if (currentIndex === -1) return undefined;

  return AGENT_ONBOARDING_NODES[currentIndex + 1];
};

const dedupeNodes = (nodes: UserAgentOnboardingNode[] = []) => Array.from(new Set(nodes));

const createWelcomeMessage = (node: UserAgentOnboardingNode) => {
  switch (node) {
    case 'fullName': {
      return "Let's continue. What should I call you?";
    }
    case 'interests': {
      return 'What do you mainly want help with? You can mention a few interests or workflows.';
    }
    case 'responseLanguage': {
      return 'Which language should I use by default when I reply to you?';
    }
    case 'proSettings': {
      return isDev
        ? 'You can set a default model or connect tools now. When you are ready, continue here.'
        : `The default model is preset to ${ONBOARDING_PRODUCTION_DEFAULT_MODEL.provider}/${ONBOARDING_PRODUCTION_DEFAULT_MODEL.model}. You can connect tools now, then continue here when you are ready.`;
    }
    case 'summary': {
      return 'I have everything I need. Review the setup summary and tell me if it looks good.';
    }
    case 'telemetry': {
      return 'Welcome. I will guide you through a quick setup. First, do you want to share anonymous telemetry to help improve the product?';
    }
  }
};

interface ProposePatchResult {
  committedValue?: unknown;
  content: string;
  draft: UserAgentOnboardingDraft;
  nextAction: 'ask' | 'commit' | 'confirm';
  success: boolean;
}

export class OnboardingService {
  private readonly agentService: AgentService;
  private readonly messageModel: MessageModel;
  private readonly topicModel: TopicModel;
  private readonly userId: string;
  private readonly userModel: UserModel;

  constructor(
    private readonly db: LobeChatDatabase,
    userId: string,
  ) {
    this.userId = userId;
    this.agentService = new AgentService(db, userId);
    this.messageModel = new MessageModel(db, userId);
    this.topicModel = new TopicModel(db, userId);
    this.userModel = new UserModel(db, userId);
  }

  private ensureState = (state?: UserAgentOnboarding): UserAgentOnboarding => {
    const nextState = merge(defaultAgentOnboardingState(), state ?? {});

    return {
      ...nextState,
      completedNodes: dedupeNodes(nextState.completedNodes),
      currentNode: nextState.currentNode ?? AGENT_ONBOARDING_NODES[0],
      draft: nextState.draft ?? {},
      version: nextState.version ?? CURRENT_ONBOARDING_VERSION,
    };
  };

  private saveState = async (state: UserAgentOnboarding) => {
    const normalizedState = this.ensureState(state);

    await this.userModel.updateUser({ agentOnboarding: normalizedState });

    return normalizedState;
  };

  private getUserState = async () => {
    return this.userModel.getUserState(KeyVaultsGateKeeper.getUserKeyVaults);
  };

  private ensureTopic = async (state: UserAgentOnboarding, agentId: string) => {
    const existingTopicId = state.activeTopicId;

    if (existingTopicId) {
      const topic = await this.topicModel.findById(existingTopicId);

      if (topic) return existingTopicId;
    }

    const topic = await this.topicModel.create({
      agentId,
      title: 'Onboarding',
      trigger: 'chat',
    });

    return topic.id;
  };

  private ensureWelcomeMessage = async (
    agentId: string,
    topicId: string,
    state: UserAgentOnboarding,
  ) => {
    const messages = await this.messageModel.query({ topicId });

    if (messages.length > 0) return;

    await this.messageModel.create({
      agentId,
      content: createWelcomeMessage(state.currentNode ?? AGENT_ONBOARDING_NODES[0]),
      role: 'assistant',
      topicId,
    });
  };

  getOrCreateContext = async () => {
    const builtinAgent = await this.agentService.getBuiltinAgent(BUILTIN_AGENT_SLUGS.webOnboarding);

    if (!builtinAgent?.id) {
      throw new Error('Failed to initialize onboarding agent');
    }

    const userState = await this.getUserState();
    const state = this.ensureState(userState.agentOnboarding);
    const topicId = await this.ensureTopic(state, builtinAgent.id);
    const nextState =
      topicId === state.activeTopicId
        ? state
        : await this.saveState({ ...state, activeTopicId: topicId });

    await this.ensureWelcomeMessage(builtinAgent.id, topicId, nextState);

    return {
      agentId: builtinAgent.id,
      agentOnboarding: nextState,
      topicId,
    };
  };

  getContext = async () => {
    const userState = await this.getUserState();
    const state = this.ensureState(userState.agentOnboarding);

    return {
      committed: {
        defaultModel: userState.settings.defaultAgent?.config
          ? {
              model: userState.settings.defaultAgent.config.model,
              provider: userState.settings.defaultAgent.config.provider,
            }
          : undefined,
        fullName: userState.fullName,
        interests: userState.interests,
        responseLanguage: userState.settings.general?.responseLanguage,
        telemetry: userState.settings.general?.telemetry,
      },
      completedNodes: state.completedNodes ?? [],
      currentNode: state.currentNode ?? AGENT_ONBOARDING_NODES[0],
      draft: state.draft ?? {},
      finishedAt: state.finishedAt,
      topicId: state.activeTopicId,
      version: state.version,
    };
  };

  proposePatch = async (params: {
    node: UserAgentOnboardingNode;
    patch: UserAgentOnboardingDraft;
  }): Promise<ProposePatchResult> => {
    const context = await this.getContext();
    const currentNode = context.currentNode;

    if (params.node !== currentNode) {
      return {
        content: `Current onboarding node is "${currentNode}", not "${params.node}". Continue from the current node.`,
        draft: context.draft,
        nextAction: 'ask',
        success: false,
      };
    }

    const patch = params.patch;

    switch (currentNode) {
      case 'telemetry': {
        if (typeof patch.telemetry !== 'boolean') {
          return {
            content: 'Telemetry consent is missing. Ask the user for a clear yes or no.',
            draft: context.draft,
            nextAction: 'ask',
            success: false,
          };
        }

        const draft = { ...context.draft, telemetry: patch.telemetry };

        await this.saveState({ ...(await this.ensurePersistedState()), draft });
        const commitResult = await this.commitNode(currentNode);

        return {
          committedValue: patch.telemetry,
          content: commitResult.content,
          draft: {},
          nextAction: 'ask',
          success: commitResult.success,
        };
      }
      case 'fullName': {
        const fullName = patch.fullName?.trim();

        if (!fullName) {
          return {
            content: 'Name is still missing. Ask the user what they want to be called.',
            draft: context.draft,
            nextAction: 'ask',
            success: false,
          };
        }

        const draft = { ...context.draft, fullName };

        await this.saveState({ ...(await this.ensurePersistedState()), draft });
        const commitResult = await this.commitNode(currentNode);

        return {
          committedValue: fullName,
          content: commitResult.content,
          draft: {},
          nextAction: 'ask',
          success: commitResult.success,
        };
      }
      case 'interests': {
        const interests = (patch.interests ?? [])
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 8);

        if (interests.length === 0) {
          return {
            content: 'No interests were captured. Ask the user what they want help with.',
            draft: context.draft,
            nextAction: 'ask',
            success: false,
          };
        }

        const draft = { ...context.draft, interests };

        await this.saveState({ ...(await this.ensurePersistedState()), draft });
        const commitResult = await this.commitNode(currentNode);

        return {
          committedValue: interests,
          content: commitResult.content,
          draft: {},
          nextAction: 'ask',
          success: commitResult.success,
        };
      }
      case 'responseLanguage': {
        const responseLanguage = patch.responseLanguage?.trim();

        if (responseLanguage === undefined) {
          return {
            content: 'Response language is missing. Ask the user to choose a default language.',
            draft: context.draft,
            nextAction: 'ask',
            success: false,
          };
        }

        const draft = { ...context.draft, responseLanguage };

        await this.saveState({ ...(await this.ensurePersistedState()), draft });
        const commitResult = await this.commitNode(currentNode);

        return {
          committedValue: responseLanguage,
          content: commitResult.content,
          draft: {},
          nextAction: 'ask',
          success: commitResult.success,
        };
      }
      case 'proSettings': {
        const defaultModel =
          patch.defaultModel || (!isDev ? ONBOARDING_PRODUCTION_DEFAULT_MODEL : undefined);
        const draft = {
          ...context.draft,
          ...(defaultModel ? { defaultModel } : {}),
        };

        await this.saveState({ ...(await this.ensurePersistedState()), draft });
        const commitResult = await this.commitNode(currentNode);

        return {
          committedValue: defaultModel,
          content: commitResult.content,
          draft: {},
          nextAction: 'ask',
          success: commitResult.success,
        };
      }
      case 'summary': {
        return {
          content: 'Summary is handled after all previous onboarding nodes are complete.',
          draft: context.draft,
          nextAction: 'ask',
          success: false,
        };
      }
    }
  };

  private ensurePersistedState = async () => {
    const userState = await this.getUserState();

    return this.ensureState(userState.agentOnboarding);
  };

  commitNode = async (node: UserAgentOnboardingNode) => {
    const state = await this.ensurePersistedState();
    const currentNode = state.currentNode ?? AGENT_ONBOARDING_NODES[0];

    if (node !== currentNode) {
      return {
        content: `Current onboarding node is "${currentNode}", not "${node}".`,
        nextNode: currentNode,
        success: false,
      };
    }

    const draft = state.draft ?? {};

    switch (currentNode) {
      case 'telemetry': {
        if (typeof draft.telemetry !== 'boolean') {
          return {
            content: 'Telemetry preference has not been captured yet.',
            nextNode: currentNode,
            success: false,
          };
        }

        const currentSettings = await this.userModel.getUserSettings();
        await this.userModel.updateSetting({
          general: merge(currentSettings?.general || {}, { telemetry: draft.telemetry }),
        });
        break;
      }
      case 'fullName': {
        if (!draft.fullName) {
          return {
            content: 'Name has not been captured yet.',
            nextNode: currentNode,
            success: false,
          };
        }

        await this.userModel.updateUser({ fullName: draft.fullName });
        break;
      }
      case 'interests': {
        if (!draft.interests?.length) {
          return {
            content: 'Interests have not been captured yet.',
            nextNode: currentNode,
            success: false,
          };
        }

        await this.userModel.updateUser({ interests: draft.interests });
        break;
      }
      case 'responseLanguage': {
        if (draft.responseLanguage === undefined) {
          return {
            content: 'Response language has not been captured yet.',
            nextNode: currentNode,
            success: false,
          };
        }

        const currentSettings = await this.userModel.getUserSettings();
        await this.userModel.updateSetting({
          general: merge(currentSettings?.general || {}, {
            responseLanguage: draft.responseLanguage,
          }),
        });
        break;
      }
      case 'proSettings': {
        if (draft.defaultModel?.model && draft.defaultModel.provider) {
          const currentSettings = await this.userModel.getUserSettings();
          await this.userModel.updateSetting({
            defaultAgent: merge(currentSettings?.defaultAgent || {}, {
              config: {
                model: draft.defaultModel.model,
                provider: draft.defaultModel.provider,
              },
            }),
          });
        }
        break;
      }
      case 'summary': {
        return {
          content: 'Use finishAgentOnboarding from the summary step.',
          nextNode: currentNode,
          success: false,
        };
      }
    }

    const nextNode = getNextNode(currentNode);
    const completedNodes = dedupeNodes([...(state.completedNodes ?? []), currentNode]);
    const nextDraft = { ...draft };

    if (currentNode === 'telemetry') delete nextDraft.telemetry;
    if (currentNode === 'fullName') delete nextDraft.fullName;
    if (currentNode === 'interests') delete nextDraft.interests;
    if (currentNode === 'responseLanguage') delete nextDraft.responseLanguage;

    if (currentNode === 'proSettings') delete nextDraft.defaultModel;

    await this.saveState({
      ...state,
      completedNodes,
      currentNode: nextNode ?? currentNode,
      draft: nextDraft,
    });

    return {
      content: nextNode
        ? `Committed node "${currentNode}". Continue with "${nextNode}".`
        : `Committed node "${currentNode}".`,
      nextNode: nextNode ?? currentNode,
      success: true,
    };
  };

  redirectOfftopic = async (reason?: string) => {
    const state = await this.ensurePersistedState();

    return {
      content: reason
        ? `Stay on onboarding. Off-topic reason: ${reason}`
        : 'Stay on onboarding and continue with the current question.',
      currentNode: state.currentNode ?? AGENT_ONBOARDING_NODES[0],
      success: true,
    };
  };

  finish = async () => {
    const state = await this.ensurePersistedState();
    const currentNode = state.currentNode ?? AGENT_ONBOARDING_NODES[0];

    if (currentNode !== 'summary') {
      return {
        content: `Current onboarding node is "${currentNode}". Finish is only allowed in "summary".`,
        success: false,
      };
    }

    const finishedAt = new Date().toISOString();

    await this.userModel.updateUser({
      agentOnboarding: {
        ...state,
        completedNodes: dedupeNodes([...(state.completedNodes ?? []), 'summary']),
        currentNode: 'summary',
        draft: {},
        finishedAt,
        version: CURRENT_ONBOARDING_VERSION,
      },
      onboarding: {
        currentStep: MAX_ONBOARDING_STEPS,
        finishedAt,
        version: CURRENT_ONBOARDING_VERSION,
      },
    });

    return {
      content: 'Agent onboarding completed successfully.',
      finishedAt,
      success: true,
    };
  };

  reset = async () => {
    const state = defaultAgentOnboardingState();

    await this.userModel.updateUser({ agentOnboarding: state });

    return state;
  };
}
