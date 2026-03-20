'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type ActionKeys } from '@/features/ChatInput';
import { ChatInput, ChatList } from '@/features/Conversation';
import { isDev } from '@/utils/env';

import StructuredActions from './StructuredActions';

interface AgentOnboardingConversationProps {
  currentNode?: string;
}

const chatInputLeftActions: ActionKeys[] = isDev ? ['model'] : [];

const AgentOnboardingConversation = memo<AgentOnboardingConversationProps>(({ currentNode }) => {
  const { t } = useTranslation('onboarding');

  return (
    <>
      <Flexbox gap={8} paddingInline={8}>
        <Text weight={'bold'}>{t('agent.title')}</Text>
        <Text type={'secondary'}>{t('agent.subtitle')}</Text>
      </Flexbox>
      <Flexbox
        flex={1}
        width={'100%'}
        style={{
          overflowX: 'hidden',
          overflowY: 'auto',
          position: 'relative',
        }}
      >
        <ChatList />
      </Flexbox>
      <Flexbox gap={12} paddingInline={8}>
        <StructuredActions currentNode={currentNode} />
      </Flexbox>
      <ChatInput leftActions={chatInputLeftActions} />
    </>
  );
});

AgentOnboardingConversation.displayName = 'AgentOnboardingConversation';

export default AgentOnboardingConversation;
