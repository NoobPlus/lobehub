export interface TreeItem {
  children?: TreeItem[];
  fileType: string;
  id: string;
  isFolder: boolean;
  metadata?: { emoji?: string };
  name: string;
  slug?: string | null;
  sourceType?: string;
  url: string;
}
