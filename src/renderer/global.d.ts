interface FileNode {
  name: string;
  path: string;
  relativePath: string;
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
}

interface DiffRow {
  type: 'unchanged' | 'added' | 'removed' | 'modified';
  leftLineNumber?: number;
  rightLineNumber?: number;
  leftContent: string;
  rightContent: string;
}

interface DiffResult {
  rows: DiffRow[];
  hasDifferences: boolean;
  stats: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
}

interface Window {
  api: {
    selectDirectory: () => Promise<string | null>;
    selectFile: () => Promise<string | null>;
    readFile: (filePath: string) => Promise<string>;
    writeFile: (filePath: string, content: string) => Promise<boolean>;
    scanDirectory: (dirPath: string) => Promise<FileNode[]>;
    compareFiles: (leftPath: string, rightPath: string) => Promise<DiffResult>;
  };
}
