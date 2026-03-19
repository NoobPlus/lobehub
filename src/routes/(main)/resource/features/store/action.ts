import { type StateCreator } from 'zustand/vanilla';

import { type ResourceManagerMode } from '@/features/ResourceManager';
import { type FilesTabs, type SortType } from '@/types/files';

import { type SelectAllState, type State, type ViewMode } from './initialState';
import { initialState } from './initialState';

export type MultiSelectActionType =
  | 'addToKnowledgeBase'
  | 'moveToOtherKnowledgeBase'
  | 'batchChunking'
  | 'delete'
  | 'deleteLibrary'
  | 'removeFromKnowledgeBase';

export interface FolderCrumb {
  id: string;
  name: string;
  slug: string;
}

export interface Action {
  clearSelectAllState: () => void;
  /**
   * Handle navigating back to list from file preview
   */
  handleBackToList: () => void;
  /**
   * Load more knowledge items (pagination)
   */
  loadMoreKnowledgeItems: () => Promise<void>;
  /**
   * Handle multi-select actions (delete, chunking, KB operations, etc.)
   */
  onActionClick: (type: MultiSelectActionType) => Promise<void>;
  /**
   * Resolve effective selection IDs. When select-all is active, this asks the server
   * to expand the current query into a full ID list.
   */
  resolveSelectedResourceIds: () => Promise<string[]>;
  selectAllLoadedResources: (ids: string[]) => void;
  selectAllResources: () => void;
  /**
   * Set the current file category filter
   */
  setCategory: (category: FilesTabs) => void;
  /**
   * Set the current folder ID
   */
  setCurrentFolderId: (folderId: string | null | undefined) => void;
  /**
   * Set the current view item ID
   */
  setCurrentViewItemId: (id?: string) => void;
  /**
   * Set whether there are more files to load
   */
  setFileListHasMore: (value: boolean) => void;
  /**
   * Set the pagination offset
   */
  setFileListOffset: (value: number) => void;
  /**
   * Set masonry ready state
   */
  setIsMasonryReady: (value: boolean) => void;
  /**
   * Set whether select-all is currently loading all remaining items
   */
  setIsSelectingAllItems: (value: boolean) => void;
  /**
   * Set view transition state
   */
  setIsTransitioning: (value: boolean) => void;
  /**
   * Set the current library ID
   */
  setLibraryId: (id?: string) => void;
  /**
   * Set the view mode
   */
  setMode: (mode: ResourceManagerMode) => void;
  /**
   * Set the pending rename item ID
   */
  setPendingRenameItemId: (id: string | null) => void;
  /**
   * Set search query
   */
  setSearchQuery: (query: string | null) => void;
  /**
   * Set the current shared select-all state
   */
  setSelectAllState: (state: SelectAllState) => void;
  /**
   * Set selected file IDs
   */
  setSelectedFileIds: (ids: string[]) => void;
  /**
   * Set the field to sort files by
   */
  setSorter: (sorter: 'name' | 'createdAt' | 'size') => void;
  /**
   * Set the sort direction
   */
  setSortType: (sortType: SortType) => void;
  /**
   * Set the file explorer view mode
   */
  setViewMode: (viewMode: ViewMode) => void;
}

export type Store = Action & State;

type CreateStore = (
  initState?: Partial<State>,
) => StateCreator<Store, [['zustand/devtools', never]]>;

export const store: CreateStore = (publicState) => (set, get) => ({
  ...initialState,
  ...publicState,

  clearSelectAllState: () => {
    set({ isSelectingAllItems: false, selectAllState: 'none' });
  },

  handleBackToList: () => {
    set({ currentViewItemId: undefined, mode: 'explorer' });
  },

  loadMoreKnowledgeItems: async () => {
    const { fileListHasMore } = get();

    // Don't load if there's no more data
    if (!fileListHasMore) return;

    const { useFileStore } = await import('@/store/file');
    const fileStore = useFileStore.getState();

    // Delegate to FileStore's loadMoreKnowledgeItems
    await fileStore.loadMoreKnowledgeItems();

    // Sync pagination state back to ResourceManagerStore
    set({
      fileListHasMore: fileStore.fileListHasMore,
      fileListOffset: fileStore.fileListOffset,
    });
  },

  onActionClick: async (type) => {
    const { libraryId } = get();
    const { useFileStore } = await import('@/store/file');
    const { useKnowledgeBaseStore } = await import('@/store/library');
    const { isChunkingUnsupported } = await import('@/utils/isChunkingUnsupported');

    const fileStore = useFileStore.getState();
    const kbStore = useKnowledgeBaseStore.getState();
    const { selectAllState } = get();

    switch (type) {
      case 'delete': {
        if (selectAllState === 'all' && fileStore.queryParams) {
          const { resourceService } = await import('@/services/resource');
          const { revalidateResources } = await import('@/store/file/slices/resource/hooks');

          await resourceService.deleteResourcesByQuery(fileStore.queryParams as any);
          await revalidateResources(fileStore.queryParams);

          set({ isSelectingAllItems: false, selectAllState: 'none', selectedFileIds: [] });
          return;
        }

        const selectedFileIds = get().selectedFileIds;
        await fileStore.deleteResources(selectedFileIds);

        set({ selectedFileIds: [] });
        return;
      }

      case 'removeFromKnowledgeBase': {
        const selectedFileIds = await get().resolveSelectedResourceIds();
        if (!libraryId) return;
        await kbStore.removeFilesFromKnowledgeBase(libraryId, selectedFileIds);
        set({ selectedFileIds: [] });
        return;
      }

      case 'addToKnowledgeBase': {
        // Modal operations need to be handled in component layer
        // Store just marks that action was requested
        // Component will handle opening modal via useAddFilesToKnowledgeBaseModal hook
        return;
      }

      case 'moveToOtherKnowledgeBase': {
        // Modal operations need to be handled in component layer
        // Store just marks that action was requested
        // Component will handle opening modal via useAddFilesToKnowledgeBaseModal hook
        return;
      }

      case 'batchChunking': {
        const selectedFileIds = await get().resolveSelectedResourceIds();
        const chunkableFileIds = selectedFileIds.filter((id) => {
          const resource = fileStore.resourceMap?.get(id);
          return resource && !isChunkingUnsupported(resource.fileType);
        });
        await fileStore.parseFilesToChunks(chunkableFileIds, { skipExist: true });
        set({ selectedFileIds: [] });
        return;
      }

      case 'deleteLibrary': {
        if (!libraryId) return;
        await kbStore.removeKnowledgeBase(libraryId);
        // Navigate to knowledge base page using window.location
        // (can't use useNavigate hook from store)
        if (typeof window !== 'undefined') {
          window.location.href = '/knowledge';
        }
        return;
      }
    }
  },

  selectAllLoadedResources: (selectedFileIds) => {
    set({ selectedFileIds, selectAllState: 'loaded' });
  },

  selectAllResources: () => {
    set({ selectAllState: 'all' });
  },

  resolveSelectedResourceIds: async () => {
    const { selectAllState, selectedFileIds } = get();
    if (selectAllState !== 'all') return selectedFileIds;

    const { resourceService } = await import('@/services/resource');
    const { useFileStore } = await import('@/store/file');
    const queryParams = useFileStore.getState().queryParams;

    if (!queryParams) return selectedFileIds;

    const result = await resourceService.resolveSelectionIds(queryParams as any);
    return result.ids;
  },

  setCategory: (category) => {
    set({ category });
  },

  setCurrentFolderId: (currentFolderId) => {
    set({ currentFolderId });
  },

  setCurrentViewItemId: (currentViewItemId) => {
    set({ currentViewItemId });
  },

  setFileListHasMore: (fileListHasMore) => {
    set({ fileListHasMore });
  },

  setFileListOffset: (fileListOffset) => {
    set({ fileListOffset });
  },

  setIsSelectingAllItems: (isSelectingAllItems) => {
    set({ isSelectingAllItems });
  },

  setIsMasonryReady: (isMasonryReady) => {
    set({ isMasonryReady });
  },

  setIsTransitioning: (isTransitioning) => {
    set({ isTransitioning });
  },

  setLibraryId: (libraryId) => {
    set({ libraryId });

    // Reset pagination state when switching libraries to prevent showing stale data
    set({
      fileListHasMore: false,
      fileListOffset: 0,
    });

    // Note: No need to manually refresh - Explorer's useEffect will automatically
    // call fetchResources when libraryId changes
  },

  setMode: (mode) => {
    set({ mode });
  },

  setPendingRenameItemId: (pendingRenameItemId) => {
    set({ pendingRenameItemId });
  },

  setSelectAllState: (selectAllState) => {
    set({ selectAllState });
  },

  setSearchQuery: (searchQuery) => {
    set({ searchQuery });
  },

  setSelectedFileIds: (selectedFileIds) => {
    set({
      isSelectingAllItems: selectedFileIds.length === 0 ? false : get().isSelectingAllItems,
      selectAllState: selectedFileIds.length === 0 ? 'none' : get().selectAllState,
      selectedFileIds,
    });
  },

  setSortType: (sortType) => {
    set({ sortType });
  },

  setSorter: (sorter) => {
    set({ sorter });
  },

  setViewMode: (viewMode) => {
    set({ viewMode });
  },
});
