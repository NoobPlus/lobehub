import { isDesktop } from '@lobechat/const';
import { cssVar } from 'antd-style';
import { LaptopIcon, LaptopMinimalCheckIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';
import Action from '../components/Action';
import Controls from './Controls';

const LocalSystem = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const isMobile = useIsMobile();
  const { updateAgentChatConfig } = useUpdateAgentConfig();

  const [isLoading, isEnabled] = useAgentStore((s) => [
    agentByIdSelectors.isAgentConfigLoadingById(agentId)(s),
    chatConfigByIdSelectors.isLocalSystemEnabledById(agentId)(s),
  ]);

  // Only show on desktop
  if (!isDesktop) return null;

  if (isLoading) return <Action disabled icon={LaptopIcon} />;

  return (
    <Action
      color={isEnabled ? cssVar.colorInfo : undefined}
      icon={isEnabled ? LaptopMinimalCheckIcon : LaptopIcon}
      showTooltip={false}
      title={t('localSystem.title')}
      popover={{
        content: <Controls />,
        maxWidth: 320,
        minWidth: 320,
        placement: 'topLeft',
        styles: {
          content: {
            padding: 4,
          },
        },
        trigger: isMobile ? 'click' : 'hover',
      }}
      onClick={
        isMobile
          ? undefined
          : async (e) => {
              e?.preventDefault?.();
              e?.stopPropagation?.();
              await updateAgentChatConfig({ localSystem: { enabled: !isEnabled } });
            }
      }
    />
  );
});

LocalSystem.displayName = 'LocalSystem';

export default LocalSystem;
