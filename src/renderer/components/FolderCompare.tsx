import { useState, useEffect, useMemo } from 'react';
import { FolderOpen, ArrowRight, RefreshCw, AlertCircle, Copy, FileText, Folder, Check, FileCode, GitCompare, ChevronRight, ChevronDown } from 'lucide-react';

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
  const [filter, setFilter] = useState<'all' | 'diff' | 'leftOnly' | 'rightOnly'>('all');
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  // Copying Progress & Toast State
  const [syncingState, setSyncingState] = useState<{
    relativePath: string;
    name: string;
    direction: 'left-to-right' | 'right-to-left';
  } | null>(null);
  const [syncSuccessMsg, setSyncSuccessMsg] = useState<string | null>(null);

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
    if (initialLeftPath && initialRightPath) {
      runCompare();
    }
  }, [initialLeftPath, initialRightPath]);


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
          // Compare files by size (modified time is excluded from diff criteria per user request)
          const sizeDiff = leftSize !== rightSize;
          if (sizeDiff) {
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
            >
              All Files ({rows.length})
            </button>
            <button
              onClick={() => setFilter('diff')}
              className={`btn ${filter === 'diff' ? 'btn-primary' : ''}`}
              style={{ padding: '4px 10px', fontSize: '0.75rem', color: filter === 'diff' ? 'white' : 'var(--diff-modified-text)' }}
            >
              Differences ({rows.filter(r => r.status !== 'identical').length})
            </button>
            <button
              onClick={() => setFilter('leftOnly')}
              className={`btn ${filter === 'leftOnly' ? 'btn-primary' : ''}`}
              style={{ padding: '4px 10px', fontSize: '0.75rem', color: filter === 'leftOnly' ? 'white' : 'var(--diff-removed-text)' }}
            >
              Left Only ({rows.filter(r => r.status === 'leftOnly').length})
            </button>
            <button
              onClick={() => setFilter('rightOnly')}
              className={`btn ${filter === 'rightOnly' ? 'btn-primary' : ''}`}
              style={{ padding: '4px 10px', fontSize: '0.75rem', color: filter === 'rightOnly' ? 'white' : 'var(--diff-added-text)' }}
            >
              Right Only ({rows.filter(r => r.status === 'rightOnly').length})
            </button>
          </div>
          
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
              <div style={{ flex: '1', display: 'grid', gridTemplateColumns: gridLayout, padding: '0 16px', position: 'relative' }}>
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
              <div style={{ width: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.1)' }}>
                Sync
              </div>

              {/* Right Header */}
              <div style={{ flex: '1', display: 'grid', gridTemplateColumns: gridLayout, padding: '0 16px', position: 'relative' }}>
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
              {filteredRows.map((row, idx) => {
                let leftBg = 'transparent';
                let rightBg = 'transparent';
                let leftColor = 'var(--text-primary)';
                let rightColor = 'var(--text-primary)';

                if (row.status === 'different') {
                  leftBg = 'var(--diff-modified-bg)';
                  rightBg = 'var(--diff-modified-bg)';
                  leftColor = 'var(--diff-modified-text)';
                  rightColor = 'var(--diff-modified-text)';
                } else if (row.status === 'leftOnly') {
                  leftBg = 'var(--diff-removed-bg)';
                  leftColor = 'var(--diff-removed-text)';
                } else if (row.status === 'rightOnly') {
                  rightBg = 'var(--diff-added-bg)';
                  rightColor = 'var(--diff-added-text)';
                }

                return (
                  <div
                    key={idx}
                    onDoubleClick={() => {
                      if (!row.isDirectory) {
                        onOpenTextCompare(row.leftFullPath, row.rightFullPath);
                      }
                    }}
                    onClick={() => {
                      if (row.isDirectory) {
                        toggleExpand(row.relativePath);
                      }
                    }}
                    style={{
                      display: 'flex',
                      borderBottom: '1px solid var(--border-color)',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      alignItems: 'stretch'
                    }}
                    className="hover:bg-white/5 transition-colors"
                  >
                    {/* Left Side */}
                    <div style={{ flex: '1', display: 'grid', gridTemplateColumns: gridLayout, padding: '3px 12px', alignItems: 'center', backgroundColor: leftBg, color: leftColor }}>
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
                            {row.isDirectory ? (
                              <Folder size={14} style={{ color: '#fbbf24', flexShrink: 0 }} />
                            ) : (
                              <FileText size={14} style={{ flexShrink: 0 }} />
                            )}
                            <span className="truncate" style={{ fontWeight: row.isDirectory ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
                          </div>
                          <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', paddingRight: '8px' }}>
                            {!row.isDirectory ? formatSize(row.leftSize) : ''}
                          </div>
                          <div style={{ color: leftColor !== 'var(--text-primary)' ? leftColor : 'var(--text-secondary)', fontSize: '0.75rem', paddingLeft: '16px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
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
                    <div style={{ width: '90px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', borderLeft: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.1)' }}>
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
                    <div style={{ flex: '1', display: 'grid', gridTemplateColumns: gridLayout, padding: '3px 12px', alignItems: 'center', backgroundColor: rightBg, color: rightColor }}>
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
                            {row.isDirectory ? (
                              <Folder size={14} style={{ color: '#fbbf24', flexShrink: 0 }} />
                            ) : (
                              <FileText size={14} style={{ flexShrink: 0 }} />
                            )}
                            <span className="truncate" style={{ fontWeight: row.isDirectory ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
                          </div>
                          <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', paddingRight: '8px' }}>
                            {!row.isDirectory ? formatSize(row.rightSize) : ''}
                          </div>
                          <div style={{ color: rightColor !== 'var(--text-primary)' ? rightColor : 'var(--text-secondary)', fontSize: '0.75rem', paddingLeft: '16px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
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
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

