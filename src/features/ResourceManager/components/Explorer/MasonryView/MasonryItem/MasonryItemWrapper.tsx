import { memo } from 'react';

import { type FileListItem } from '@/types/files';

import MasonryFileItem from '.';

interface MasonryItemWrapperProps {
  context: {
    knowledgeBaseId?: string;
    onSelectedChange: (id: string, checked: boolean) => void;
    selectAllState: 'all' | 'loaded' | 'none';
    selectFileIds: string[];
  };
  data: FileListItem;
  index: number;
}

const MasonryItemWrapper = memo<MasonryItemWrapperProps>(({ data: item, context }) => {
  // Safety check: return null if item is undefined (can happen during deletion)
  if (!item || !item.id) {
    return null;
  }

  return (
    <div style={{ padding: '8px 4px' }}>
      <MasonryFileItem
        knowledgeBaseId={context.knowledgeBaseId}
        selected={context.selectAllState === 'all' || context.selectFileIds.includes(item.id)}
        onSelectedChange={context.onSelectedChange}
        {...item}
      />
    </div>
  );
});

MasonryItemWrapper.displayName = 'MasonryItemWrapper';

export default MasonryItemWrapper;
