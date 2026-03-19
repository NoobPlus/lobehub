'use client';

import { type CredType } from '@lobechat/types';
import { Segmented } from 'antd';
import { File, Globe, Key, TerminalSquare } from 'lucide-react';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

interface CredsTypeFilterProps {
  onChange: (type: CredType | 'all') => void;
  value: CredType | 'all';
}

const CredsTypeFilter: FC<CredsTypeFilterProps> = ({ value, onChange }) => {
  const { t } = useTranslation('setting');

  const options = [
    { label: t('creds.types.all'), value: 'all' },
    {
      icon: <TerminalSquare size={14} />,
      label: t('creds.types.kv-env'),
      value: 'kv-env',
    },
    {
      icon: <Globe size={14} />,
      label: t('creds.types.kv-header'),
      value: 'kv-header',
    },
    {
      icon: <Key size={14} />,
      label: t('creds.types.oauth'),
      value: 'oauth',
    },
    {
      icon: <File size={14} />,
      label: t('creds.types.file'),
      value: 'file',
    },
  ];

  return (
    <Segmented
      options={options}
      value={value}
      onChange={(val) => onChange(val as CredType | 'all')}
    />
  );
};

export default CredsTypeFilter;
