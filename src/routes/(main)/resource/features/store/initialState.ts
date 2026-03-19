import { type ResourceManagerMode } from '@/features/ResourceManager';
import { FilesTabs, SortType } from '@/types/files';

export type ViewMode = 'list' | 'masonry';
export type SelectAllState = 'all' | 'loaded' | 'none';

export interface State {
  /**
   * Current file category filter
   */
  category: FilesTabs;
  /**
   * Current folder ID for navigation
   */
  currentFolderId?: string | null;
  /**
   * Current view item ID (document ID or file ID)
   */
  currentViewItemId?: string;
  /**
   * Whether there are more files to load (pagination)
   */
  fileListHasMore: boolean;
  /**
   * Current pagination offset
   */
  fileListOffset: number;
  /**
   * Masonry view ready state
   */
  isMasonryReady: boolean;
  /**
   * Whether the explorer is currently loading remaining pages for select-all
   */
  isSelectingAllItems: boolean;
  /**
   * View transition state
   */
  isTransitioning: boolean;
  /**
   * Current library ID
   */
  libraryId?: string;
  /**
   * View mode for displaying resources
   */
  mode: ResourceManagerMode;
  /**
   * ID of item currently being renamed (for inline editing)
   */
  pendingRenameItemId: string | null;
  /**
   * Search query for filtering files
   */
  searchQuery: string | null;
  /**
   * Current select-all mode shared across explorer views
   */
  selectAllState: SelectAllState;
  /**
   * Selected file IDs in the file explorer
   */
  selectedFileIds: string[];
  /**
   * Field to sort files by
   */
  sorter: 'name' | 'createdAt' | 'size';
  /**
   * Sort direction (ascending or descending)
   */
  sortType: SortType;
  /**
   * File explorer view mode (list or masonry)
   */
  viewMode: ViewMode;
}

export const initialState: State = {
  category: FilesTabs.All,
  currentFolderId: undefined,
  currentViewItemId: undefined,
  fileListHasMore: false,
  fileListOffset: 0,
  isMasonryReady: false,
  isSelectingAllItems: false,
  isTransitioning: false,
  libraryId: undefined,
  mode: 'explorer',
  pendingRenameItemId: null,
  searchQuery: null,
  selectAllState: 'none',
  selectedFileIds: [],
  sortType: SortType.Desc,
  sorter: 'createdAt',
  viewMode: 'list',
};
