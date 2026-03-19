'use client';

import { type ProColumns, ProTable } from '@ant-design/pro-components';
import { type UserCredSummary } from '@lobechat/types';
import { Button } from '@lobehub/ui';
import { useMutation } from '@tanstack/react-query';
import { Avatar, Popconfirm, Space, Tag, Tooltip } from 'antd';
import { createStaticStyles } from 'antd-style';
import { File, Globe, Key, Pencil, TerminalSquare, Trash } from 'lucide-react';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaClient } from '@/libs/trpc/client';

import CredDisplay from './CredDisplay';
import EditCredModal from './EditCredModal';

const styles = createStaticStyles(({ css, cssVar }) => ({
  table: css`
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorBgContainer};

    .ant-pro-card-body {
      padding-inline: 0;

      .ant-pro-table-list-toolbar-container {
        padding-block-start: 0;
      }
    }
  `,
  typeTag: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;
  `,
}));

interface CredsTableProps {
  credentials: UserCredSummary[];
  onRefresh: () => void;
}

const typeIcons: Record<string, React.ReactNode> = {
  'file': <File size={12} />,
  'kv-env': <TerminalSquare size={12} />,
  'kv-header': <Globe size={12} />,
  'oauth': <Key size={12} />,
};

const typeColors: Record<string, string> = {
  'file': 'purple',
  'kv-env': 'blue',
  'kv-header': 'cyan',
  'oauth': 'green',
};

const CredsTable: FC<CredsTableProps> = ({ credentials, onRefresh }) => {
  const { t } = useTranslation('setting');
  const [editingCred, setEditingCred] = useState<UserCredSummary | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => lambdaClient.market.creds.delete.mutate({ id }),
    onSuccess: () => {
      onRefresh();
    },
  });

  const columns: ProColumns<UserCredSummary>[] = [
    {
      dataIndex: 'name',
      ellipsis: true,
      key: 'name',
      render: (_, cred) => {
        if (cred.type === 'oauth' && cred.oauthAvatar) {
          return (
            <span style={{ alignItems: 'center', display: 'inline-flex', gap: 8 }}>
              <Avatar size="small" src={cred.oauthAvatar} />
              <span>{cred.name}</span>
            </span>
          );
        }
        return cred.name;
      },
      title: t('creds.table.name'),
      width: 200,
    },
    {
      dataIndex: 'type',
      key: 'type',
      render: (_, cred) => (
        <Tag className={styles.typeTag} color={typeColors[cred.type]}>
          {typeIcons[cred.type]}
          {t(`creds.types.${cred.type}`)}
        </Tag>
      ),
      title: t('creds.table.type'),
      width: 140,
    },
    {
      dataIndex: 'key',
      key: 'key',
      render: (_, cred) => (
        <Tooltip title={cred.key}>
          <code style={{ fontSize: 12 }}>{cred.key}</code>
        </Tooltip>
      ),
      title: t('creds.table.key'),
      width: 150,
    },
    {
      dataIndex: 'maskedPreview',
      ellipsis: true,
      key: 'preview',
      render: (_, cred) => <CredDisplay cred={cred} />,
      title: t('creds.table.preview'),
    },
    {
      dataIndex: 'lastUsedAt',
      key: 'lastUsedAt',
      render: (_, cred) =>
        cred.lastUsedAt
          ? new Date(cred.lastUsedAt).toLocaleDateString()
          : t('creds.table.neverUsed'),
      title: t('creds.table.lastUsed'),
      width: 120,
    },
    {
      key: 'actions',
      render: (_, cred) => (
        <Space size={4}>
          <Button
            icon={Pencil}
            size="small"
            title={t('creds.actions.edit')}
            type="text"
            onClick={() => setEditingCred(cred)}
          />
          <Popconfirm
            cancelText={t('creds.actions.deleteConfirm.cancel')}
            description={t('creds.actions.deleteConfirm.content')}
            okText={t('creds.actions.deleteConfirm.ok')}
            title={t('creds.actions.deleteConfirm.title')}
            onConfirm={() => deleteMutation.mutate(cred.id)}
          >
            <Button
              icon={Trash}
              loading={deleteMutation.isPending}
              size="small"
              title={t('creds.actions.delete')}
              type="text"
            />
          </Popconfirm>
        </Space>
      ),
      title: t('creds.table.actions'),
      width: 100,
    },
  ];

  return (
    <>
      <ProTable<UserCredSummary>
        className={styles.table}
        columns={columns}
        dataSource={credentials}
        options={false}
        pagination={false}
        rowKey="id"
        search={false}
      />
      <EditCredModal
        cred={editingCred}
        open={!!editingCred}
        onClose={() => setEditingCred(null)}
        onSuccess={onRefresh}
      />
    </>
  );
};

export default CredsTable;
