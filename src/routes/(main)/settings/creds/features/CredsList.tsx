'use client';

import { type CredType } from '@lobechat/types';
import { Button, Flexbox } from '@lobehub/ui';
import { Empty, Spin } from 'antd';
import { createStaticStyles } from 'antd-style';
import { LogIn, Plus } from 'lucide-react';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { lambdaQuery } from '@/libs/trpc/client';

import CreateCredModal from './CreateCredModal';
import CredsTable from './CredsTable';
import CredsTypeFilter from './CredsTypeFilter';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    display: flex;
    flex-direction: column;
    gap: 16px;
  `,
  empty: css`
    padding-block: 48px;
    padding-inline: 0;
  `,
  header: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  signInPrompt: css`
    display: flex;
    flex-direction: column;
    gap: 16px;
    align-items: center;
    justify-content: center;

    padding: 48px;
  `,
}));

const CredsList: FC = () => {
  const { t } = useTranslation('setting');
  const [typeFilter, setTypeFilter] = useState<CredType | 'all'>('all');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const { isAuthenticated, isLoading: isAuthLoading, signIn } = useMarketAuth();

  const { data, isLoading, refetch } = lambdaQuery.market.creds.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const credentials = data?.data ?? [];

  const filteredCredentials =
    typeFilter === 'all' ? credentials : credentials.filter((c) => c.type === typeFilter);

  const handleCreateSuccess = () => {
    setCreateModalOpen(false);
    refetch();
  };

  // Show loading while checking auth status
  if (isAuthLoading) {
    return (
      <Flexbox align="center" justify="center" style={{ padding: 48 }}>
        <Spin />
      </Flexbox>
    );
  }

  // Show sign-in prompt if not authenticated
  if (!isAuthenticated) {
    return (
      <div className={styles.signInPrompt}>
        <Empty description={t('creds.signInRequired')} />
        <Button icon={LogIn} type="primary" onClick={() => signIn()}>
          {t('creds.signIn')}
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <CredsTypeFilter value={typeFilter} onChange={setTypeFilter} />
        <Button icon={Plus} type="primary" onClick={() => setCreateModalOpen(true)}>
          {t('creds.create')}
        </Button>
      </div>

      {isLoading ? (
        <Flexbox align="center" justify="center" style={{ padding: 48 }}>
          <Spin />
        </Flexbox>
      ) : filteredCredentials.length === 0 ? (
        <Empty className={styles.empty} description={t('creds.empty')} />
      ) : (
        <CredsTable credentials={filteredCredentials} onRefresh={refetch} />
      )}

      <CreateCredModal
        open={createModalOpen}
        onCancel={() => setCreateModalOpen(false)}
        onSuccess={handleCreateSuccess}
      />
    </div>
  );
};

export default CredsList;
