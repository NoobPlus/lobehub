'use client';

import { Button, Flexbox, Text } from '@lobehub/ui';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';

interface ModeSwitchProps {
  actions?: ReactNode;
}

const ModeSwitch = memo<ModeSwitchProps>(({ actions }) => {
  const { t } = useTranslation('onboarding');
  const location = useLocation();
  const isAgent = location.pathname.startsWith('/onboarding/agent');

  return (
    <Flexbox horizontal align={'center'} gap={12} justify={'space-between'} width={'100%'}>
      <Text type={'secondary'}>{t('agent.modeSwitch.label')}</Text>
      <Flexbox horizontal gap={8}>
        {actions}
        <Link to={'/onboarding/agent'}>
          <Button size={'small'} type={isAgent ? 'primary' : 'default'}>
            {t('agent.modeSwitch.agent')}
          </Button>
        </Link>
        <Link to={'/onboarding/classic'}>
          <Button size={'small'} type={!isAgent ? 'primary' : 'default'}>
            {t('agent.modeSwitch.classic')}
          </Button>
        </Link>
      </Flexbox>
    </Flexbox>
  );
});

ModeSwitch.displayName = 'OnboardingModeSwitch';

export default ModeSwitch;
