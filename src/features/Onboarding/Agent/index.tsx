'use client';

import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { Button, Flexbox, Text } from '@lobehub/ui';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Loading from '@/components/Loading/BrandTextLoading';
import ModeSwitch from '@/features/Onboarding/components/ModeSwitch';
import { useOnlyFetchOnceSWR } from '@/libs/swr';
import OnboardingContainer from '@/routes/onboarding/_layout';
import { userService } from '@/services/user';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { isDev } from '@/utils/env';

import AgentOnboardingConversation from './Conversation';
import OnboardingConversationProvider from './OnboardingConversationProvider';

interface LocalOnboardingContext {
  currentNode?: string;
  topicId: string;
}

const AgentOnboardingPage = memo(() => {
  const { t } = useTranslation('onboarding');
  const useInitBuiltinAgent = useAgentStore((s) => s.useInitBuiltinAgent);
  const onboardingAgentId = useAgentStore(
    builtinAgentSelectors.getBuiltinAgentId(BUILTIN_AGENT_SLUGS.webOnboarding),
  );
  const [refreshUserState, resetAgentOnboarding] = useUserStore((s) => [
    s.refreshUserState,
    s.resetAgentOnboarding,
  ]);
  const [localContext, setLocalContext] = useState<LocalOnboardingContext>();
  const [isResetting, setIsResetting] = useState(false);

  useInitBuiltinAgent(BUILTIN_AGENT_SLUGS.webOnboarding);

  const { data, error, isLoading, mutate } = useOnlyFetchOnceSWR(
    'agent-onboarding-bootstrap',
    () => userService.getOrCreateAgentOnboardingContext(),
    {
      onSuccess: async () => {
        await refreshUserState();
      },
    },
  );

  useEffect(() => {
    if (!data?.topicId) return;

    setLocalContext((current) => {
      if (
        current?.topicId === data.topicId &&
        current.currentNode === data.agentOnboarding.currentNode
      ) {
        return current;
      }

      return {
        currentNode: data.agentOnboarding.currentNode,
        topicId: data.topicId,
      };
    });
  }, [data?.agentOnboarding.currentNode, data?.topicId]);

  if (error) {
    return (
      <OnboardingContainer>
        <Flexbox gap={16} style={{ maxWidth: 720, width: '100%' }}>
          <ModeSwitch />
          <Flexbox gap={8}>
            <Text weight={'bold'}>Failed to initialize onboarding.</Text>
            <Button onClick={() => mutate()}>Retry</Button>
          </Flexbox>
        </Flexbox>
      </OnboardingContainer>
    );
  }

  if (isLoading || !data?.topicId || !onboardingAgentId) {
    return <Loading debugId="AgentOnboarding" />;
  }

  const syncOnboardingContext = async () => {
    const nextContext = await userService.getOrCreateAgentOnboardingContext();
    setLocalContext({
      currentNode: nextContext.agentOnboarding.currentNode,
      topicId: nextContext.topicId,
    });
  };

  const handleReset = async () => {
    setIsResetting(true);

    try {
      await resetAgentOnboarding();
      await syncOnboardingContext();
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <OnboardingContainer>
      <Flexbox gap={24} style={{ height: '100%', maxWidth: 720, width: '100%' }}>
        <ModeSwitch
          actions={
            isDev ? (
              <Button danger loading={isResetting} size={'small'} onClick={handleReset}>
                {t('agent.modeSwitch.reset')}
              </Button>
            ) : undefined
          }
        />
        <Flexbox flex={1} gap={16} style={{ minHeight: 0 }}>
          <OnboardingConversationProvider
            agentId={onboardingAgentId}
            topicId={localContext?.topicId || data.topicId}
            hooks={{
              onAfterSendMessage: async () => {
                await syncOnboardingContext();
                await refreshUserState();
              },
            }}
          >
            <AgentOnboardingConversation
              currentNode={localContext?.currentNode || data.agentOnboarding.currentNode}
            />
          </OnboardingConversationProvider>
        </Flexbox>
      </Flexbox>
    </OnboardingContainer>
  );
});

AgentOnboardingPage.displayName = 'AgentOnboardingPage';

export default AgentOnboardingPage;
