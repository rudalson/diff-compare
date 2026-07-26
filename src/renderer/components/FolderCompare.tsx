import { useState, useEffect, useMemo } from 'react';
import { FolderOpen, ArrowRight, ArrowLeft, RefreshCw, AlertCircle, Copy, Folder, Check, FileCode, GitCompare, ChevronRight, ChevronDown, Trash2, X, Layers, Equal } from 'lucide-react';

interface ContextMenuState {
  mouseX: number;
  mouseY: number;
  row: CompareRow;
  side: 'left' | 'right';
  targetPath: string;
}

interface FolderCompareProps {
  onOpenTextCompare: (leftPath: string, rightPath: string) => void;
  updateTitle: (title: string) => void;
  initialLeftPath?: string;
  initialRightPath?: string;
}

interface CompareRow {
  name: string;
  relativePath: string;
  isDirectory: boolean;
  leftExists: boolean;
  rightExists: boolean;
  leftSize: number;
  rightSize: number;
  leftMtime: number;
  rightMtime: number;
  leftFullPath: string;
  rightFullPath: string;
  status: 'identical' | 'different' | 'leftOnly' | 'rightOnly';
  depth: number;
}

export default function FolderCompare({ onOpenTextCompare, updateTitle, initialLeftPath, initialRightPath }: FolderCompareProps) {
  const [leftPath, setLeftPath] = useState<string>(() => {
    return initialLeftPath || localStorage.getItem('tinydiff_last_left_folder') || '';
  });
  const [rightPath, setRightPath] = useState<string>(() => {
    return initialRightPath || localStorage.getItem('tinydiff_last_right_folder') || '';
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [rows, setRows] = useState<CompareRow[]>([]);
  const [filter, setFilter] = useState<'all' | 'diff' | 'same' | 'leftOnly' | 'rightOnly'>('all');
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  // Copying Progress & Toast State
  const [syncingState, setSyncingState] = useState<{
    relativePath: string;
    name: string;
    direction: 'left-to-right' | 'right-to-left';
  } | null>(null);
  const [syncSuccessMsg, setSyncSuccessMsg] = useState<string | null>(null);

  // Context Menu & Delete Confirm Modal States
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{
    path: string;
    name: string;
    isDirectory: boolean;
    side: 'left' | 'right';
  } | null>(null);

  // Multi-Select States
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(null);
  const [deleteConfirmTargetBatch, setDeleteConfirmTargetBatch] = useState<{
    path: string;
    name: string;
    isDirectory: boolean;
    side: 'left' | 'right';
  }[] | null>(null);

  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  const handleRowClick = (e: React.MouseEvent, row: CompareRow) => {
    if (e.ctrlKey || e.metaKey) {
      setSelectedPaths(prev => {
        const next = new Set(prev);
        if (next.has(row.relativePath)) {
          next.delete(row.relativePath);
        } else {
          next.add(row.relativePath);
        }
        return next;
      });
      setLastSelectedPath(row.relativePath);
    } else if (e.shiftKey && lastSelectedPath) {
      const startIdx = filteredRows.findIndex(r => r.relativePath === lastSelectedPath);
      const endIdx = filteredRows.findIndex(r => r.relativePath === row.relativePath);
      if (startIdx !== -1 && endIdx !== -1) {
        const min = Math.min(startIdx, endIdx);
        const max = Math.max(startIdx, endIdx);
        const rangeSet = new Set(selectedPaths);
        for (let i = min; i <= max; i++) {
          rangeSet.add(filteredRows[i].relativePath);
        }
        setSelectedPaths(rangeSet);
      }
    } else {
      if (row.isDirectory) {
        toggleExpand(row.relativePath);
      }
      setSelectedPaths(new Set([row.relativePath]));
      setLastSelectedPath(row.relativePath);
    }
  };

  const handleSyncBatch = async (direction: 'left-to-right' | 'right-to-left') => {
    if (syncingState || selectedPaths.size === 0) return;

    const selectedRows = rows.filter(r => selectedPaths.has(r.relativePath) && !r.isDirectory);
    const eligibleRows = selectedRows.filter(r => direction === 'left-to-right' ? r.leftExists : r.rightExists);

    if (eligibleRows.length === 0) {
      setError('No eligible files found to copy in the selected items.');
      return;
    }

    setSyncingState({
      relativePath: 'batch',
      name: `${eligibleRows.length} files`,
      direction,
    });
    setError(null);
    setSyncSuccessMsg(null);

    let copiedCount = 0;
    try {
      for (const row of eligibleRows) {
        const src = direction === 'left-to-right' ? row.leftFullPath : row.rightFullPath;
        const dest = direction === 'left-to-right' ? row.rightFullPath : row.leftFullPath;
        await window.api.copyFile(src, dest);
        copiedCount++;
        setSyncSuccessMsg(`Copying files (${copiedCount}/${eligibleRows.length})...`);
      }

      await runCompare(true);
      const dirLabel = direction === 'left-to-right' ? 'Left ➔ Right' : 'Right ➔ Left';
      setSyncSuccessMsg(`Copied ${copiedCount} files (${dirLabel}) successfully.`);
      setTimeout(() => setSyncSuccessMsg(null), 3500);
    } catch (err: any) {
      setError(`Batch sync failed after copying ${copiedCount} files: ${err.message}`);
    } finally {
      setSyncingState(null);
    }
  };

  const handleBatchDelete = async () => {
    if (!deleteConfirmTargetBatch || deleteConfirmTargetBatch.length === 0) return;
    setLoading(true);
    let deletedCount = 0;
    try {
      for (const target of deleteConfirmTargetBatch) {
        await window.api.deleteItem(target.path);
        deletedCount++;
      }
      setSyncSuccessMsg(`Deleted ${deletedCount} items successfully.`);
      setTimeout(() => setSyncSuccessMsg(null), 3500);
      setSelectedPaths(new Set());
      setDeleteConfirmTargetBatch(null);
      await runCompare(true);
    } catch (err: any) {
      setError(`Batch delete failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteItem = async () => {
    if (!deleteConfirmTarget) return;
    try {
      setLoading(true);
      await window.api.deleteItem(deleteConfirmTarget.path);
      setSyncSuccessMsg(`"${deleteConfirmTarget.name}" deleted successfully.`);
      setTimeout(() => setSyncSuccessMsg(null), 3000);
      setDeleteConfirmTarget(null);
      await runCompare(true);
    } catch (err: any) {
      setError(`Delete failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // History states for auto-complete datalists
  const [leftHistory, setLeftHistory] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('tinydiff_left_folder_history');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const [rightHistory, setRightHistory] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('tinydiff_right_folder_history');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const saveFolderHistory = (side: 'left' | 'right', pathStr: string) => {
    if (!pathStr) return;
    const historyKey = side === 'left' ? 'tinydiff_left_folder_history' : 'tinydiff_right_folder_history';
    const lastKey = side === 'left' ? 'tinydiff_last_left_folder' : 'tinydiff_last_right_folder';
    
    localStorage.setItem(lastKey, pathStr);

    try {
      const raw = localStorage.getItem(historyKey);
      const list: string[] = raw ? JSON.parse(raw) : [];
      const updated = [pathStr, ...list.filter(p => p !== pathStr)].slice(0, 10);
      localStorage.setItem(historyKey, JSON.stringify(updated));
      if (side === 'left') setLeftHistory(updated);
      else setRightHistory(updated);
    } catch (e) {
      // Ignore storage errors
    }
  };

  useEffect(() => {
    if (leftPath && rightPath) {
      runCompare();
    }
  }, []);


  // Column Width States (Default: Size=100px, Modified=200px to ensure 1-line date display)
  const [sizeWidth, setSizeWidth] = useState<number>(100);
  const [modifiedWidth, setModifiedWidth] = useState<number>(200);
  const [resizing, setResizing] = useState<'size' | 'modified' | null>(null);

  const startResize = (col: 'size' | 'modified', e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setResizing(col);

    const startX = e.clientX;
    const startSize = sizeWidth;
    const startModified = modifiedWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      if (col === 'size') {
        const newWidth = Math.max(50, Math.min(300, startSize - deltaX));
        setSizeWidth(newWidth);
      } else if (col === 'modified') {
        const newWidth = Math.max(100, Math.min(450, startModified - deltaX));
        setModifiedWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setResizing(null);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const gridLayout = `minmax(100px, 1fr) ${sizeWidth}px ${modifiedWidth}px`;


  const toggleExpand = (path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const isRowVisible = (relativePath: string) => {
    const parts = relativePath.split('/');
    if (parts.length <= 1) return true; // Root nodes are always visible
    
    let currentParent = '';
    for (let i = 0; i < parts.length - 1; i++) {
      currentParent = currentParent ? `${currentParent}/${parts[i]}` : parts[i];
      if (!expandedPaths.has(currentParent)) {
        return false;
      }
    }
    return true;
  };

  const selectLeftFolder = async () => {
    const startPath = leftPath || localStorage.getItem('tinydiff_last_left_folder') || undefined;
    const path = await window.api.selectDirectory(startPath);
    if (path) {
      setLeftPath(path);
      saveFolderHistory('left', path);
      const folderName = path.split(/[\\/]/).pop() || 'Folder';
      updateTitle(`FC: ${folderName}`);
    }
  };

  const selectRightFolder = async () => {
    const startPath = rightPath || localStorage.getItem('tinydiff_last_right_folder') || undefined;
    const path = await window.api.selectDirectory(startPath);
    if (path) {
      setRightPath(path);
      saveFolderHistory('right', path);
      if (leftPath) {
        const folderNameLeft = leftPath.split(/[\\/]/).pop() || 'Folder';
        const folderNameRight = path.split(/[\\/]/).pop() || 'Folder';
        updateTitle(`${folderNameLeft} ↔ ${folderNameRight}`);
      }
    }
  };

  const runCompare = async (keepExpanded = false) => {
    if (!leftPath || !rightPath) {
      setError('Both left and right directory paths must be specified.');
      return;
    }

    saveFolderHistory('left', leftPath);
    saveFolderHistory('right', rightPath);

    setLoading(true);
    setError(null);
    if (!keepExpanded) {
      setExpandedPaths(new Set()); // Collapse all folders by default on fresh initial comparison
    }

    try {
      const leftNodes = await window.api.scanDirectory(leftPath);
      const rightNodes = await window.api.scanDirectory(rightPath);

      const leftMap = new Map<string, FileNode>();
      leftNodes.forEach(node => leftMap.set(node.relativePath, node));

      const rightMap = new Map<string, FileNode>();
      rightNodes.forEach(node => rightMap.set(node.relativePath, node));

      // Combine all relative paths
      const allPathsSet = new Set<string>([...leftMap.keys(), ...rightMap.keys()]);
      const isDir = (relPath: string): boolean => {
        const node = leftMap.get(relPath) || rightMap.get(relPath);
        return node ? node.isDirectory : false;
      };

      const sortedPaths = Array.from(allPathsSet).sort((a, b) => {
        const aParts = a.split('/');
        const bParts = b.split('/');
        const minLen = Math.min(aParts.length, bParts.length);
        for (let i = 0; i < minLen; i++) {
          if (aParts[i] !== bParts[i]) {
            const relA = aParts.slice(0, i + 1).join('/');
            const relB = bParts.slice(0, i + 1).join('/');
            const dirA = isDir(relA);
            const dirB = isDir(relB);
            
            if (dirA !== dirB) {
              return dirA ? -1 : 1;
            }
            return aParts[i].localeCompare(bParts[i]);
          }
        }
        return a.length - b.length;
      });

      const comparedRows: CompareRow[] = sortedPaths.map(relPath => {
        const leftNode = leftMap.get(relPath);
        const rightNode = rightMap.get(relPath);

        const leftExists = !!leftNode;
        const rightExists = !!rightNode;

        const isDirectory = leftNode?.isDirectory ?? rightNode?.isDirectory ?? false;
        const depth = relPath.split('/').length - 1;

        const leftSize = leftNode?.size ?? 0;
        const rightSize = rightNode?.size ?? 0;
        const leftMtime = leftNode?.mtimeMs ?? 0;
        const rightMtime = rightNode?.mtimeMs ?? 0;

        const leftFullPath = leftNode?.path ?? `${leftPath}/${relPath}`;
        const rightFullPath = rightNode?.path ?? `${rightPath}/${relPath}`;

        let status: CompareRow['status'] = 'identical';

        if (leftExists && !rightExists) {
          status = 'leftOnly';
        } else if (!leftExists && rightExists) {
          status = 'rightOnly';
        } else if (isDirectory) {
          status = 'identical'; // Directories themselves don't differ in content
        } else {
          // Compare files by size and modified timestamp
          const sizeDiff = leftSize !== rightSize;
          const timeDiff = leftMtime !== rightMtime;
          if (sizeDiff || timeDiff) {
            status = 'different';
          }
        }

        const name = relPath.split('/').pop() || '';

        return {
          name,
          relativePath: relPath,
          isDirectory,
          leftExists,
          rightExists,
          leftSize,
          rightSize,
          leftMtime,
          rightMtime,
          leftFullPath,
          rightFullPath,
          status,
          depth,
        };
      });

      setRows(comparedRows);
    } catch (err: any) {
      setError(err.message || 'An error occurred during comparison.');
    } finally {
      setLoading(false);
    }
  };

  const handleSyncFile = async (row: CompareRow, direction: 'left-to-right' | 'right-to-left') => {
    if (syncingState) return; // Prevent duplicate concurrent sync operations

    try {
      if (row.isDirectory) {
        setError('Synchronizing full directories is not supported in this version. Please sync individual files.');
        return;
      }

      setSyncingState({
        relativePath: row.relativePath,
        name: row.name,
        direction,
      });
      setError(null);
      setSyncSuccessMsg(null);

      const src = direction === 'left-to-right' ? row.leftFullPath : row.rightFullPath;
      const dest = direction === 'left-to-right' ? row.rightFullPath : row.leftFullPath;

      if (direction === 'left-to-right' && !row.leftExists) return;
      if (direction === 'right-to-left' && !row.rightExists) return;

      // Fast OS native copy file
      await window.api.copyFile(src, dest);

      // Re-run comparison while preserving current open/expanded folder state
      await runCompare(true);

      const dirLabel = direction === 'left-to-right' ? 'Left ➔ Right' : 'Right ➔ Left';
      setSyncSuccessMsg(`Copied "${row.name}" (${dirLabel}) successfully`);
      setTimeout(() => setSyncSuccessMsg(null), 3000);
    } catch (err: any) {
      setError(`Sync failed: ${err.message}`);
    } finally {
      setSyncingState(null);
    }
  };

  const dirStatusMap = useMemo(() => {
    const map = new Map<string, {
      leftHasNewer: boolean;
      rightHasNewer: boolean;
      leftHasOnly: boolean;
      rightHasOnly: boolean;
      hasDiff: boolean;
    }>();

    // Collect all files with differences (modified) and orphan items (left/right only)
    const modifiedFiles = rows.filter(r => !r.isDirectory && r.leftExists && r.rightExists && (r.leftMtime !== r.rightMtime || r.leftSize !== r.rightSize));
    const leftOnlyItems = rows.filter(r => r.leftExists && !r.rightExists);
    const rightOnlyItems = rows.filter(r => !r.leftExists && r.rightExists);

    rows.forEach(r => {
      if (r.isDirectory) {
        const prefix = r.relativePath + '/';
        let leftHasNewer = false;
        let rightHasNewer = false;
        let leftHasOnly = r.leftExists && !r.rightExists;
        let rightHasOnly = !r.leftExists && r.rightExists;
        let hasDiff = false;

        for (const mf of modifiedFiles) {
          if (mf.relativePath.startsWith(prefix)) {
            hasDiff = true;
            if (mf.leftMtime > mf.rightMtime) {
              leftHasNewer = true;
            } else if (mf.rightMtime > mf.leftMtime) {
              rightHasNewer = true;
            } else if (mf.leftSize !== mf.rightSize) {
              leftHasNewer = true;
              rightHasNewer = true;
            }
          }
        }

        if (!leftHasOnly) {
          leftHasOnly = leftOnlyItems.some(item => item.relativePath.startsWith(prefix));
        }
        if (!rightHasOnly) {
          rightHasOnly = rightOnlyItems.some(item => item.relativePath.startsWith(prefix));
        }

        map.set(r.relativePath, { leftHasNewer, rightHasNewer, leftHasOnly, rightHasOnly, hasDiff });
      }
    });

    return map;
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (filter === 'all') {
      return rows.filter(row => isRowVisible(row.relativePath));
    }

    // 1. Find all matching file relative paths
    const matchingFilePaths = new Set<string>();
    rows.forEach(row => {
      if (!row.isDirectory) {
        let isMatch = false;
        if (filter === 'diff') isMatch = row.status !== 'identical';
        else if (filter === 'same') isMatch = row.status === 'identical';
        else if (filter === 'leftOnly') isMatch = row.status === 'leftOnly';
        else if (filter === 'rightOnly') isMatch = row.status === 'rightOnly';

        if (isMatch) {
          matchingFilePaths.add(row.relativePath);
        }
      }
    });

    // 2. Find all ancestor directory paths for matching files to preserve folder hierarchy
    const neededDirPaths = new Set<string>();
    matchingFilePaths.forEach(filePath => {
      const parts = filePath.split('/');
      let current = '';
      for (let i = 0; i < parts.length - 1; i++) {
        current = current ? `${current}/${parts[i]}` : parts[i];
        neededDirPaths.add(current);
      }
    });

    // 3. Keep matching files and their parent directory rows
    return rows.filter(row => {
      if (!isRowVisible(row.relativePath)) return false;

      if (row.isDirectory) {
        return neededDirPaths.has(row.relativePath);
      }
      return matchingFilePaths.has(row.relativePath);
    });
  }, [rows, filter, expandedPaths]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const allPaths = new Set(filteredRows.map(r => r.relativePath));
        setSelectedPaths(allPaths);
      } else if (e.key === 'Escape') {
        setSelectedPaths(new Set());
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredRows]);

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDate = (mtimeMs: number) => {
    if (mtimeMs === 0) return '-';
    return new Date(mtimeMs).toLocaleString('ko-KR', {
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '12px 16px' }}>
      
      {/* Folder Picker bar */}
      <div className="glass-panel" style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          
          {/* Left Folder Input */}
          <div style={{ flex: 1, display: 'flex', gap: '8px' }}>
            <input
              type="text"
              className="input-field"
              placeholder="Left Folder Path"
              value={leftPath}
              list="left-folder-history-list"
              onChange={(e) => setLeftPath(e.target.value)}
              style={{ flex: 1, height: '34px', padding: '6px 10px', fontSize: '0.8rem' }}
            />
            <datalist id="left-folder-history-list">
              {leftHistory.map((item, idx) => (
                <option key={idx} value={item} />
              ))}
            </datalist>
            <button className="btn" onClick={selectLeftFolder} style={{ height: '34px', padding: '0 12px', fontSize: '0.8rem' }}>
              <FolderOpen size={14} />
              Browse
            </button>
          </div>

          <ArrowRight size={16} className="text-slate-500" style={{ color: 'var(--text-muted)' }} />

          {/* Right Folder Input */}
          <div style={{ flex: 1, display: 'flex', gap: '8px' }}>
            <input
              type="text"
              className="input-field"
              placeholder="Right Folder Path"
              value={rightPath}
              list="right-folder-history-list"
              onChange={(e) => setRightPath(e.target.value)}
              style={{ flex: 1, height: '34px', padding: '6px 10px', fontSize: '0.8rem' }}
            />
            <datalist id="right-folder-history-list">
              {rightHistory.map((item, idx) => (
                <option key={idx} value={item} />
              ))}
            </datalist>
            <button className="btn" onClick={selectRightFolder} style={{ height: '34px', padding: '0 12px', fontSize: '0.8rem' }}>
              <FolderOpen size={14} />
              Browse
            </button>
          </div>

          {/* Compare Button */}
          <button className="btn btn-primary" onClick={runCompare} disabled={loading} style={{ height: '34px', paddingLeft: '16px', paddingRight: '16px', fontSize: '0.8rem' }}>
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <GitCompare size={14} />}
            Compare
          </button>
        </div>

        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444', fontSize: '0.85rem' }}>
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Toolbar / Filters */}
      {rows.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          {/* Filter Buttons */}
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              onClick={() => setFilter('all')}
              className={`btn ${filter === 'all' ? 'btn-primary' : ''}`}
              style={{ padding: '4px 10px', fontSize: '0.75rem' }}
              title="All Files"
            >
              <Layers size={14} />
              All
            </button>
            <button
              onClick={() => setFilter('diff')}
              className={`btn ${filter === 'diff' ? 'btn-primary' : ''}`}
              style={{ padding: '4px 10px', fontSize: '0.75rem', color: filter === 'diff' ? 'white' : '#ef4444' }}
              title="Differences (다른 파일)"
            >
              <GitCompare size={14} />
            </button>
            <button
              onClick={() => setFilter('same')}
              className={`btn ${filter === 'same' ? 'btn-primary' : ''}`}
              style={{ padding: '4px 10px', fontSize: '0.75rem', color: filter === 'same' ? 'white' : 'var(--text-secondary)' }}
              title="Identical (같은 파일)"
            >
              <Equal size={14} />
            </button>
            <button
              onClick={() => setFilter('leftOnly')}
              className={`btn ${filter === 'leftOnly' ? 'btn-primary' : ''}`}
              style={{ padding: '4px 10px', fontSize: '0.75rem', color: filter === 'leftOnly' ? 'white' : '#9ca3af' }}
              title="Left Only (왼쪽만)"
            >
              <ArrowLeft size={14} />
            </button>
            <button
              onClick={() => setFilter('rightOnly')}
              className={`btn ${filter === 'rightOnly' ? 'btn-primary' : ''}`}
              style={{ padding: '4px 10px', fontSize: '0.75rem', color: filter === 'rightOnly' ? 'white' : '#9ca3af' }}
              title="Right Only (오른쪽만)"
            >
              <ArrowRight size={14} />
            </button>
          </div>

          {/* Bulk Action Bar */}
          {selectedPaths.size > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(99, 102, 241, 0.15)', border: '1px solid rgba(99, 102, 241, 0.35)', borderRadius: '6px', padding: '3px 10px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#a5b4fc' }}>
                {selectedPaths.size} selected
              </span>
              <button
                className="btn"
                onClick={() => handleSyncBatch('left-to-right')}
                disabled={!!syncingState}
                style={{ padding: '2px 8px', fontSize: '0.75rem', background: '#6366f1', borderColor: '#6366f1', color: 'white', height: '24px' }}
                title="Copy all selected left files to right"
              >
                <ArrowRight size={12} />
                Copy Left ➔ Right
              </button>
              <button
                className="btn"
                onClick={() => handleSyncBatch('right-to-left')}
                disabled={!!syncingState}
                style={{ padding: '2px 8px', fontSize: '0.75rem', background: '#6366f1', borderColor: '#6366f1', color: 'white', height: '24px' }}
                title="Copy all selected right files to left"
              >
                <ArrowRight size={12} style={{ transform: 'rotate(180deg)' }} />
                Copy Right ➔ Left
              </button>
              <button
                className="btn"
                onClick={() => {
                  const targetsToDelete: { path: string; name: string; isDirectory: boolean; side: 'left' | 'right' }[] = [];
                  rows.filter(r => selectedPaths.has(r.relativePath)).forEach(r => {
                    if (r.leftExists) targetsToDelete.push({ path: r.leftFullPath, name: r.name, isDirectory: r.isDirectory, side: 'left' });
                    if (r.rightExists) targetsToDelete.push({ path: r.rightFullPath, name: r.name, isDirectory: r.isDirectory, side: 'right' });
                  });
                  setDeleteConfirmTargetBatch(targetsToDelete);
                }}
                style={{ padding: '2px 8px', fontSize: '0.75rem', background: 'rgba(239, 68, 68, 0.2)', borderColor: '#ef4444', color: '#f87171', height: '24px' }}
                title="Delete all selected files/folders"
              >
                <Trash2 size={12} />
                Delete
              </button>
              <button
                onClick={() => setSelectedPaths(new Set())}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '2px', marginLeft: '4px' }}
                title="Clear selection (Esc)"
              >
                <X size={14} />
              </button>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {syncingState && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#60a5fa', fontWeight: 600 }}>
                <RefreshCw size={13} className="animate-spin" />
                <span>Copying "{syncingState.name}" ({syncingState.direction === 'left-to-right' ? 'Left ➔ Right' : 'Right ➔ Left'})...</span>
              </div>
            )}
            {syncSuccessMsg && !syncingState && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#34d399', fontWeight: 600 }}>
                <Check size={13} />
                <span>{syncSuccessMsg}</span>
              </div>
            )}
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Double click a file to open file comparison
            </div>
          </div>
        </div>
      )}

      {/* Main Grid View */}
      <div className="glass-panel" style={{ flex: 1, overflow: 'hidden', borderRadius: '8px', display: 'flex', flexDirection: 'column' }}>
        {rows.length === 0 ? (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifycontent: 'center', color: 'var(--text-muted)', gap: '8px', padding: '48px' }}>
            <FolderOpen size={48} style={{ strokeWidth: 1.5 }} />
            <span>Select folders and click Compare to list files.</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            
            {/* Headers */}
            <div style={{ display: 'flex', background: 'rgba(0,0,0,0.25)', borderBottom: '1px solid var(--border-color)', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.8rem', userSelect: 'none' }}>
              {/* Left Header */}
              <div style={{ flex: '1', display: 'grid', gridTemplateColumns: gridLayout, padding: '0 12px', position: 'relative' }}>
                <div style={{ padding: '10px 8px 10px 0', position: 'relative', display: 'flex', alignItems: 'center', minWidth: 0 }}>
                  <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>Left Folder Contents</span>
                  <div
                    className={`column-resizer column-resizer-right ${resizing === 'size' ? 'is-resizing' : ''}`}
                    onMouseDown={(e) => startResize('size', e)}
                    onDoubleClick={(e) => { e.stopPropagation(); setSizeWidth(100); }}
                    title="Drag to resize Size column (Double-click to reset)"
                  />
                </div>
                <div style={{ padding: '10px 8px 10px 0', textAlign: 'right', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', minWidth: 0 }}>
                  <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>Size</span>
                  <div
                    className={`column-resizer column-resizer-right ${resizing === 'modified' ? 'is-resizing' : ''}`}
                    onMouseDown={(e) => startResize('modified', e)}
                    onDoubleClick={(e) => { e.stopPropagation(); setModifiedWidth(200); }}
                    title="Drag to resize Modified column (Double-click to reset)"
                  />
                </div>
                <div style={{ padding: '10px 0 10px 16px', display: 'flex', alignItems: 'center', minWidth: 0 }}>
                  <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>Modified</span>
                </div>
              </div>
              
              {/* Actions Divider */}
              <div style={{ width: '54px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.1)' }}>
                Sync
              </div>

              {/* Right Header */}
              <div style={{ flex: '1', display: 'grid', gridTemplateColumns: gridLayout, padding: '0 12px', position: 'relative' }}>
                <div style={{ padding: '10px 8px 10px 0', position: 'relative', display: 'flex', alignItems: 'center', minWidth: 0 }}>
                  <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>Right Folder Contents</span>
                  <div
                    className={`column-resizer column-resizer-right ${resizing === 'size' ? 'is-resizing' : ''}`}
                    onMouseDown={(e) => startResize('size', e)}
                    onDoubleClick={(e) => { e.stopPropagation(); setSizeWidth(100); }}
                    title="Drag to resize Size column (Double-click to reset)"
                  />
                </div>
                <div style={{ padding: '10px 8px 10px 0', textAlign: 'right', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', minWidth: 0 }}>
                  <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>Size</span>
                  <div
                    className={`column-resizer column-resizer-right ${resizing === 'modified' ? 'is-resizing' : ''}`}
                    onMouseDown={(e) => startResize('modified', e)}
                    onDoubleClick={(e) => { e.stopPropagation(); setModifiedWidth(200); }}
                    title="Drag to resize Modified column (Double-click to reset)"
                  />
                </div>
                <div style={{ padding: '10px 0 10px 16px', display: 'flex', alignItems: 'center', minWidth: 0 }}>
                  <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>Modified</span>
                </div>
              </div>
            </div>

            {/* List Body */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredRows.length === 0 ? (
                <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                  <FolderOpen size={32} style={{ opacity: 0.5 }} />
                  <span>
                    {filter === 'all'
                      ? 'No items to show. Click a folder in the list to expand.'
                      : `No items match the current filter ("${filter}").`}
                  </span>
                </div>
              ) : (
                <>
                  {filteredRows.map((row, idx) => {
                    const isSelected = selectedPaths.has(row.relativePath);

                    // Requirement 1: "단순 왼쪽 오른쪽 편에만 있는 경우 배경색을 바꾸지는 말것."
                    // Both left and right side row backgrounds remain transparent (unless selected).
                    const leftBg = isSelected ? 'rgba(99, 102, 241, 0.22)' : 'transparent';
                    const rightBg = isSelected ? 'rgba(99, 102, 241, 0.22)' : 'transparent';

                    let leftTextColor = 'var(--text-primary)';
                    let leftIconColor = 'var(--text-secondary)';
                    let rightTextColor = 'var(--text-primary)';
                    let rightIconColor = 'var(--text-secondary)';

                    if (row.isDirectory) {
                      const dirStatus = dirStatusMap.get(row.relativePath);
                      if (row.leftExists) {
                        if (dirStatus?.leftHasNewer) {
                          // Subdirectory with newer modified file on left -> Red folder icon & text
                          leftTextColor = '#ef4444';
                          leftIconColor = '#ef4444';
                        } else if (dirStatus?.leftHasOnly) {
                          // Folder contains left-only items or exists only on left -> Blue folder icon & text
                          leftTextColor = '#60a5fa';
                          leftIconColor = '#60a5fa';
                        } else {
                          // Identical or no diffs -> Grey
                          leftTextColor = '#9ca3af';
                          leftIconColor = '#9ca3af';
                        }
                      }

                      if (row.rightExists) {
                        if (dirStatus?.rightHasNewer) {
                          // Subdirectory with newer modified file on right -> Red folder icon & text
                          rightTextColor = '#ef4444';
                          rightIconColor = '#ef4444';
                        } else if (dirStatus?.rightHasOnly) {
                          // Folder contains right-only items or exists only on right -> Blue folder icon & text
                          rightTextColor = '#60a5fa';
                          rightIconColor = '#60a5fa';
                        } else {
                          // Identical or no diffs -> Grey
                          rightTextColor = '#9ca3af';
                          rightIconColor = '#9ca3af';
                        }
                      }
                    } else {
                      // File row
                      if (row.leftExists && row.rightExists) {
                        if (row.leftMtime > row.rightMtime) {
                          leftTextColor = '#ef4444';
                          leftIconColor = '#ef4444';
                          rightTextColor = '#9ca3af';
                          rightIconColor = '#9ca3af';
                        } else if (row.rightMtime > row.leftMtime) {
                          leftTextColor = '#9ca3af';
                          leftIconColor = '#9ca3af';
                          rightTextColor = '#ef4444';
                          rightIconColor = '#ef4444';
                        } else if (row.leftSize !== row.rightSize) {
                          leftTextColor = '#ef4444';
                          leftIconColor = '#ef4444';
                          rightTextColor = '#ef4444';
                          rightIconColor = '#ef4444';
                        } else {
                          leftTextColor = 'var(--text-primary)';
                          leftIconColor = '#9ca3af';
                          rightTextColor = 'var(--text-primary)';
                          rightIconColor = '#9ca3af';
                        }
                      } else if (row.leftExists && !row.rightExists) {
                        // Left-only file -> Blue text & icon
                        leftTextColor = '#60a5fa';
                        leftIconColor = '#60a5fa';
                      } else if (!row.leftExists && row.rightExists) {
                        // Right-only file -> Blue text & icon
                        rightTextColor = '#60a5fa';
                        rightIconColor = '#60a5fa';
                      }
                    }

                    return (
                      <div
                        key={idx}
                        onDoubleClick={() => {
                          if (!row.isDirectory) {
                            onOpenTextCompare(row.leftFullPath, row.rightFullPath);
                          }
                        }}
                        onClick={(e) => handleRowClick(e, row)}
                        style={{
                          display: 'flex',
                          borderBottom: '1px solid var(--border-color)',
                          fontSize: '0.8rem',
                          cursor: 'pointer',
                          alignItems: 'stretch',
                          boxShadow: isSelected ? 'inset 0 0 0 1px #6366f1' : 'none',
                        }}
                        className="hover:bg-white/5 transition-colors"
                      >
                        {/* Left Side */}
                        <div
                          onContextMenu={(e) => {
                            if (row.leftExists) {
                              e.preventDefault();
                              e.stopPropagation();
                              if (!selectedPaths.has(row.relativePath)) {
                                setSelectedPaths(new Set([row.relativePath]));
                                setLastSelectedPath(row.relativePath);
                              }
                              setContextMenu({
                                mouseX: e.clientX,
                                mouseY: e.clientY,
                                row,
                                side: 'left',
                                targetPath: row.leftFullPath,
                              });
                            }
                          }}
                          style={{ flex: '1', display: 'grid', gridTemplateColumns: gridLayout, padding: '3px 12px', alignItems: 'center', backgroundColor: leftBg, color: leftTextColor }}
                        >
                          {row.leftExists ? (
                            <>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: `${row.depth * 16}px`, minWidth: 0, overflow: 'hidden' }}>
                                {row.isDirectory ? (
                                  <span style={{ display: 'flex', alignItems: 'center', width: '12px', flexShrink: 0 }}>
                                    {expandedPaths.has(row.relativePath) ? (
                                      <ChevronDown size={12} style={{ color: 'var(--text-secondary)' }} />
                                    ) : (
                                      <ChevronRight size={12} style={{ color: 'var(--text-secondary)' }} />
                                    )}
                                  </span>
                                ) : (
                                  <div style={{ width: '12px', flexShrink: 0 }} />
                                )}
                                {row.isDirectory && (
                                  <Folder size={14} style={{ color: leftIconColor, flexShrink: 0 }} />
                                )}
                                <span className="truncate" style={{ color: leftTextColor, fontWeight: row.isDirectory ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
                              </div>
                              <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', paddingRight: '8px' }}>
                                {!row.isDirectory ? formatSize(row.leftSize) : ''}
                              </div>
                              <div style={{ color: leftTextColor !== 'var(--text-primary)' ? leftTextColor : 'var(--text-secondary)', fontSize: '0.75rem', paddingLeft: '16px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                                {formatDate(row.leftMtime)}
                              </div>
                            </>
                          ) : (
                            <>
                              <div></div>
                              <div></div>
                              <div></div>
                            </>
                          )}
                        </div>

                        {/* Actions Spacer/Buttons */}
                        <div style={{ width: '54px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', borderLeft: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.1)' }}>
                          {!row.isDirectory && (
                            syncingState?.relativePath === row.relativePath ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#60a5fa', fontSize: '0.7rem', fontWeight: 600 }}>
                                <RefreshCw size={11} className="animate-spin" />
                                <span>Copying...</span>
                              </div>
                            ) : (
                              <>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSyncFile(row, 'left-to-right');
                                  }}
                                  disabled={!row.leftExists || !!syncingState}
                                  title="Copy left file to right"
                                  style={{
                                    padding: '2px 4px',
                                    borderRadius: '3px',
                                    background: 'rgba(255,255,255,0.05)',
                                    border: '1px solid var(--border-color)',
                                    cursor: row.leftExists && !syncingState ? 'pointer' : 'not-allowed',
                                    color: 'var(--text-primary)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    opacity: row.leftExists && !syncingState ? 1 : 0.2
                                  }}
                                >
                                  <ArrowRight size={11} />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSyncFile(row, 'right-to-left');
                                  }}
                                  disabled={!row.rightExists || !!syncingState}
                                  title="Copy right file to left"
                                  style={{
                                    padding: '2px 4px',
                                    borderRadius: '3px',
                                    background: 'rgba(255,255,255,0.05)',
                                    border: '1px solid var(--border-color)',
                                    cursor: row.rightExists && !syncingState ? 'pointer' : 'not-allowed',
                                    color: 'var(--text-primary)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    opacity: row.rightExists && !syncingState ? 1 : 0.2
                                  }}
                                >
                                  <ArrowRight size={11} style={{ transform: 'rotate(180deg)' }} />
                                </button>
                              </>
                            )
                          )}
                        </div>

                        {/* Right Side */}
                        <div
                          onContextMenu={(e) => {
                            if (row.rightExists) {
                              e.preventDefault();
                              e.stopPropagation();
                              if (!selectedPaths.has(row.relativePath)) {
                                setSelectedPaths(new Set([row.relativePath]));
                                setLastSelectedPath(row.relativePath);
                              }
                              setContextMenu({
                                mouseX: e.clientX,
                                mouseY: e.clientY,
                                row,
                                side: 'right',
                                targetPath: row.rightFullPath,
                              });
                            }
                          }}
                          style={{ flex: '1', display: 'grid', gridTemplateColumns: gridLayout, padding: '3px 12px', alignItems: 'center', backgroundColor: rightBg, color: rightTextColor }}
                        >
                          {row.rightExists ? (
                            <>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: `${row.depth * 16}px`, minWidth: 0, overflow: 'hidden' }}>
                                {row.isDirectory ? (
                                  <span style={{ display: 'flex', alignItems: 'center', width: '12px', flexShrink: 0 }}>
                                    {expandedPaths.has(row.relativePath) ? (
                                      <ChevronDown size={12} style={{ color: 'var(--text-secondary)' }} />
                                    ) : (
                                      <ChevronRight size={12} style={{ color: 'var(--text-secondary)' }} />
                                    )}
                                  </span>
                                ) : (
                                  <div style={{ width: '12px', flexShrink: 0 }} />
                                )}
                                {row.isDirectory && (
                                  <Folder size={14} style={{ color: rightIconColor, flexShrink: 0 }} />
                                )}
                                <span className="truncate" style={{ color: rightTextColor, fontWeight: row.isDirectory ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
                              </div>
                              <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', paddingRight: '8px' }}>
                                {!row.isDirectory ? formatSize(row.rightSize) : ''}
                              </div>
                              <div style={{ color: rightTextColor !== 'var(--text-primary)' ? rightTextColor : 'var(--text-secondary)', fontSize: '0.75rem', paddingLeft: '16px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                                {formatDate(row.rightMtime)}
                              </div>
                            </>
                          ) : (
                            <>
                              <div></div>
                              <div></div>
                              <div></div>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
            </>
          )}
        </div>

          </div>
        )}
      </div>
      {/* Context Menu Popup */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            top: Math.min(contextMenu.mouseY, window.innerHeight - 210),
            left: Math.min(contextMenu.mouseX, window.innerWidth - 240),
            zIndex: 1000,
            minWidth: '220px',
            background: 'rgba(22, 28, 36, 0.96)',
            backdropFilter: 'blur(16px)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
            padding: '6px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ padding: '6px 10px', fontSize: '0.75rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', marginBottom: '4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <span className="truncate font-semibold text-slate-200" style={{ maxWidth: '140px' }}>
              {selectedPaths.size > 1 ? `${selectedPaths.size} items selected` : contextMenu.row.name}
            </span>
            <span style={{ fontSize: '0.65rem', padding: '1px 6px', borderRadius: '3px', background: 'rgba(255,255,255,0.08)', fontWeight: 600 }}>
              {contextMenu.side === 'left' ? 'Left' : 'Right'}
            </span>
          </div>

          {selectedPaths.size <= 1 && !contextMenu.row.isDirectory && (
            <button
              className="btn-menu-item"
              onClick={() => {
                onOpenTextCompare(contextMenu.row.leftFullPath, contextMenu.row.rightFullPath);
                setContextMenu(null);
              }}
            >
              <FileCode size={14} className="text-indigo-400" />
              <span>Open File Compare</span>
            </button>
          )}

          <button
            className="btn-menu-item"
            onClick={() => {
              if (selectedPaths.size > 1) {
                handleSyncBatch(contextMenu.side === 'left' ? 'left-to-right' : 'right-to-left');
              } else {
                handleSyncFile(contextMenu.row, contextMenu.side === 'left' ? 'left-to-right' : 'right-to-left');
              }
              setContextMenu(null);
            }}
          >
            <ArrowRight size={14} style={{ transform: contextMenu.side === 'right' ? 'rotate(180deg)' : 'none' }} />
            <span>Copy {selectedPaths.size > 1 ? `${selectedPaths.size} items` : ''} to {contextMenu.side === 'left' ? 'Right' : 'Left'}</span>
          </button>

          <button
            className="btn-menu-item"
            onClick={() => {
              if (selectedPaths.size > 1) {
                const paths = rows.filter(r => selectedPaths.has(r.relativePath)).map(r => contextMenu.side === 'left' ? r.leftFullPath : r.rightFullPath).filter(Boolean).join('\n');
                navigator.clipboard.writeText(paths);
              } else {
                navigator.clipboard.writeText(contextMenu.targetPath);
              }
              setSyncSuccessMsg('Path(s) copied to clipboard!');
              setTimeout(() => setSyncSuccessMsg(null), 2500);
              setContextMenu(null);
            }}
          >
            <Copy size={14} />
            <span>Copy Path{selectedPaths.size > 1 ? 's' : ''}</span>
          </button>

          <div style={{ height: '1px', background: 'var(--border-color)', margin: '4px 0' }} />

          <button
            className="btn-menu-item btn-menu-danger"
            onClick={() => {
              if (selectedPaths.size > 1) {
                const targetsToDelete: { path: string; name: string; isDirectory: boolean; side: 'left' | 'right' }[] = [];
                rows.filter(r => selectedPaths.has(r.relativePath)).forEach(r => {
                  if (contextMenu.side === 'left' && r.leftExists) targetsToDelete.push({ path: r.leftFullPath, name: r.name, isDirectory: r.isDirectory, side: 'left' });
                  if (contextMenu.side === 'right' && r.rightExists) targetsToDelete.push({ path: r.rightFullPath, name: r.name, isDirectory: r.isDirectory, side: 'right' });
                });
                setDeleteConfirmTargetBatch(targetsToDelete);
              } else {
                setDeleteConfirmTarget({
                  path: contextMenu.targetPath,
                  name: contextMenu.row.name,
                  isDirectory: contextMenu.row.isDirectory,
                  side: contextMenu.side,
                });
              }
              setContextMenu(null);
            }}
          >
            <Trash2 size={14} />
            <span>Delete {selectedPaths.size > 1 ? `${selectedPaths.size} Items` : (contextMenu.row.isDirectory ? 'Folder' : 'File')}</span>
          </button>
        </div>
      )}

      {/* Delete Confirmation Modal (Single Item) */}
      {deleteConfirmTarget && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.65)',
          backdropFilter: 'blur(4px)',
          zIndex: 2000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div className="glass-panel" style={{
            width: '420px',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            borderRadius: '12px',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            background: '#161c24',
            boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#ef4444' }}>
              <Trash2 size={22} />
              <span style={{ fontSize: '1.1rem', fontWeight: 600 }}>Delete Confirmation</span>
            </div>

            <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
              Are you sure you want to delete this {deleteConfirmTarget.isDirectory ? 'folder' : 'file'} from <strong>{deleteConfirmTarget.side === 'left' ? 'Left' : 'Right'}</strong> directory?
              <div style={{
                marginTop: '10px',
                padding: '10px 12px',
                background: 'rgba(0,0,0,0.3)',
                borderRadius: '6px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.75rem',
                color: '#f87171',
                wordBreak: 'break-all',
                border: '1px solid rgba(239, 68, 68, 0.2)',
              }}>
                {deleteConfirmTarget.path}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
              <button
                className="btn"
                onClick={() => setDeleteConfirmTarget(null)}
                style={{ padding: '6px 16px', fontSize: '0.85rem' }}
              >
                Cancel
              </button>
              <button
                className="btn"
                onClick={handleDeleteItem}
                style={{
                  padding: '6px 16px',
                  fontSize: '0.85rem',
                  background: '#ef4444',
                  borderColor: '#ef4444',
                  color: 'white',
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal (Batch Items) */}
      {deleteConfirmTargetBatch && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.65)',
          backdropFilter: 'blur(4px)',
          zIndex: 2000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div className="glass-panel" style={{
            width: '440px',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            borderRadius: '12px',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            background: '#161c24',
            boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#ef4444' }}>
              <Trash2 size={22} />
              <span style={{ fontSize: '1.1rem', fontWeight: 600 }}>Batch Delete Confirmation</span>
            </div>

            <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
              Are you sure you want to delete <strong>{deleteConfirmTargetBatch.length} selected items</strong>?
              <div style={{
                marginTop: '10px',
                maxHeight: '140px',
                overflowY: 'auto',
                padding: '8px 12px',
                background: 'rgba(0,0,0,0.3)',
                borderRadius: '6px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.72rem',
                color: '#f87171',
                wordBreak: 'break-all',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
              }}>
                {deleteConfirmTargetBatch.slice(0, 10).map((t, i) => (
                  <div key={i} className="truncate">[{t.side.toUpperCase()}] {t.path}</div>
                ))}
                {deleteConfirmTargetBatch.length > 10 && (
                  <div style={{ fontStyle: 'italic', opacity: 0.7 }}>...and {deleteConfirmTargetBatch.length - 10} more items</div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
              <button
                className="btn"
                onClick={() => setDeleteConfirmTargetBatch(null)}
                style={{ padding: '6px 16px', fontSize: '0.85rem' }}
              >
                Cancel
              </button>
              <button
                className="btn"
                onClick={handleBatchDelete}
                style={{
                  padding: '6px 16px',
                  fontSize: '0.85rem',
                  background: '#ef4444',
                  borderColor: '#ef4444',
                  color: 'white',
                }}
              >
                Delete {deleteConfirmTargetBatch.length} Items
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

