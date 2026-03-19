'use client';

import { type UserCredSummary } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Typography } from 'antd';
import { createStaticStyles } from 'antd-style';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;
  `,
  value: css`
    font-family: monospace;
    font-size: 12px;
  `,
}));

interface CredDisplayProps {
  cred: UserCredSummary;
}

const CredDisplay: FC<CredDisplayProps> = ({ cred }) => {
  const { t } = useTranslation('setting');
  const [copied, setCopied] = useState(false);

  // For OAuth type, show username
  if (cred.type === 'oauth') {
    return (
      <span className={styles.value}>
        {cred.oauthUsername ? `@${cred.oauthUsername}` : cred.oauthProvider || '-'}
      </span>
    );
  }

  // For file type, show filename
  if (cred.type === 'file') {
    return (
      <Flexbox className={styles.container}>
        <span className={styles.value}>{cred.fileName || '-'}</span>
        {cred.fileSize && (
          <Typography.Text type="secondary">
            ({(cred.fileSize / 1024).toFixed(1)} KB)
          </Typography.Text>
        )}
      </Flexbox>
    );
  }

  // For KV types, show masked preview
  const handleCopy = () => {
    if (cred.maskedPreview) {
      navigator.clipboard.writeText(cred.maskedPreview);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Flexbox className={styles.container}>
      <span className={styles.value}>{cred.maskedPreview || '-'}</span>
    </Flexbox>
  );
};

export default CredDisplay;
